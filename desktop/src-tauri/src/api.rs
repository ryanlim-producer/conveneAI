use reqwest::multipart;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Configuration for the API client
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiConfig {
    /// Base URL of the deployed server (e.g., http://localhost:3000)
    pub api_url: String,
}

impl Default for ApiConfig {
    fn default() -> Self {
        Self {
            api_url: "http://localhost:3000".to_string(),
        }
    }
}

/// Result of an audio upload — the server queues a job and returns 202.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct UploadResult {
    #[serde(rename = "jobId")]
    pub job_id: String,
    pub status: String,
}

/// API error types
#[derive(Debug)]
pub enum ApiError {
    Unauthorized(String),
    ServerError(String),
    NetworkError(String),
    InvalidFile(String),
}

fn error_message(body: &str, fallback: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from))
        .unwrap_or_else(|| fallback.to_string())
}

/// HTTP client for the deployed AsisVoz server.
/// The reqwest cookie jar holds the httpOnly session cookie after login,
/// so one client instance must be shared across all authenticated calls.
pub struct ApiClient {
    client: reqwest::Client,
    api_url: String,
}

impl ApiClient {
    pub fn new(api_url: impl Into<String>) -> Result<Self, ApiError> {
        let client = reqwest::Client::builder()
            .cookie_store(true)
            .build()
            .map_err(|e| ApiError::NetworkError(e.to_string()))?;
        Ok(Self {
            client,
            api_url: api_url.into(),
        })
    }

    /// POST /api/auth/login — on success the session cookie lands in the jar.
    pub async fn login(&self, email: &str, password: &str) -> Result<(), ApiError> {
        let url = format!("{}/api/auth/login", self.api_url);
        let response = self
            .client
            .post(&url)
            .json(&serde_json::json!({ "email": email, "password": password }))
            .send()
            .await
            .map_err(|e| ApiError::NetworkError(e.to_string()))?;

        match response.status() {
            StatusCode::OK => Ok(()),
            StatusCode::UNAUTHORIZED => {
                let body = response.text().await.unwrap_or_default();
                Err(ApiError::Unauthorized(error_message(
                    &body,
                    "Invalid email or password.",
                )))
            }
            _ => {
                let body = response.text().await.unwrap_or_default();
                Err(ApiError::ServerError(error_message(&body, "Login failed.")))
            }
        }
    }

    /// Cheap authenticated probe — GET /api/settings.
    pub async fn is_authenticated(&self) -> Result<bool, ApiError> {
        let url = format!("{}/api/settings", self.api_url);
        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ApiError::NetworkError(e.to_string()))?;
        Ok(response.status() == StatusCode::OK)
    }

    /// Upload a recording. POST /api/upload multipart; server responds 202
    /// with a job id — all transcription happens server-side.
    pub async fn upload_audio(
        &self,
        audio_path: &str,
        language: &str,
    ) -> Result<UploadResult, ApiError> {
        let url = format!("{}/api/upload", self.api_url);

        let file_bytes = std::fs::read(Path::new(audio_path))
            .map_err(|_| ApiError::InvalidFile(audio_path.to_string()))?;

        let filename = Path::new(audio_path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let mime = if filename.ends_with(".wav") {
            "audio/wav"
        } else {
            "audio/mpeg"
        };

        let part = multipart::Part::bytes(file_bytes)
            .file_name(filename)
            .mime_str(mime)
            .map_err(|e| ApiError::NetworkError(e.to_string()))?;

        let form = multipart::Form::new()
            .part("file", part)
            .text("language", language.to_string())
            .text("source", "desktop");

        let response = self
            .client
            .post(&url)
            .multipart(form)
            .send()
            .await
            .map_err(|e| ApiError::NetworkError(e.to_string()))?;

        match response.status() {
            StatusCode::ACCEPTED => response
                .json()
                .await
                .map_err(|e| ApiError::ServerError(e.to_string())),
            StatusCode::UNAUTHORIZED => {
                let body = response.text().await.unwrap_or_default();
                Err(ApiError::Unauthorized(error_message(
                    &body,
                    "Session expired — sign in again.",
                )))
            }
            StatusCode::BAD_REQUEST | StatusCode::PAYLOAD_TOO_LARGE => {
                let body = response.text().await.unwrap_or_default();
                Err(ApiError::InvalidFile(error_message(&body, "Invalid file.")))
            }
            _ => {
                let body = response.text().await.unwrap_or_default();
                Err(ApiError::ServerError(error_message(&body, "Upload failed.")))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[test]
    fn test_api_config_default_url() {
        let config = ApiConfig::default();
        assert_eq!(config.api_url, "http://localhost:3000");
    }

    #[test]
    fn test_upload_result_deserialize() {
        let json = r#"{ "jobId": "job-123", "status": "queued" }"#;
        let result: UploadResult = serde_json::from_str(json).unwrap();
        assert_eq!(result.job_id, "job-123");
        assert_eq!(result.status, "queued");
    }

    #[test]
    fn test_api_client_creates_with_url() {
        let client = ApiClient::new("http://localhost:3000");
        assert!(client.is_ok());
    }

    #[tokio::test]
    async fn test_login_success_and_session_reuse() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/auth/login"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("set-cookie", "asisvoz-auth=tok123; Path=/; HttpOnly")
                    .set_body_json(serde_json::json!({ "userId": "u1" })),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/settings"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
            .mount(&server)
            .await;

        let client = ApiClient::new(server.uri()).unwrap();
        client.login("a@e.com", "hunter2secret").await.unwrap();
        assert!(client.is_authenticated().await.unwrap());
    }

    #[tokio::test]
    async fn test_login_invalid_credentials() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/auth/login"))
            .respond_with(
                ResponseTemplate::new(401)
                    .set_body_json(serde_json::json!({ "error": "Invalid email or password." })),
            )
            .mount(&server)
            .await;

        let client = ApiClient::new(server.uri()).unwrap();
        let err = client.login("a@e.com", "wrong").await.unwrap_err();
        match err {
            ApiError::Unauthorized(msg) => assert!(msg.contains("Invalid email")),
            other => panic!("expected Unauthorized, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_upload_returns_job_id_on_202() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/upload"))
            .respond_with(
                ResponseTemplate::new(202)
                    .set_body_json(serde_json::json!({ "jobId": "j-9", "status": "queued" })),
            )
            .mount(&server)
            .await;

        let tmp = std::env::temp_dir().join("asisvoz-api-test.mp3");
        std::fs::write(&tmp, b"fake mp3").unwrap();

        let client = ApiClient::new(server.uri()).unwrap();
        let result = client
            .upload_audio(tmp.to_str().unwrap(), "es")
            .await
            .unwrap();
        assert_eq!(result.job_id, "j-9");
        assert_eq!(result.status, "queued");

        let _ = std::fs::remove_file(&tmp);
    }
}
