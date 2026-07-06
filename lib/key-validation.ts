interface ValidationResult {
  valid: boolean;
  error?: string;
}

const DEEPGRAM_API = "https://api.deepgram.com/v1/projects";
const VERCEL_AI_GATEWAY_API = "https://ai-gateway.vercel.sh/v1/models";

export async function validateDeepgramKey(
  key: string,
): Promise<ValidationResult> {
  const trimmedKey = key.trim();

  try {
    const response = await fetch(DEEPGRAM_API, {
      method: "GET",
      headers: {
        Authorization: `Token ${trimmedKey}`,
        "Content-Type": "application/json",
      },
    });

    if (response.status === 200) {
      return { valid: true };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        error: "Invalid Deepgram API key. Please check your key and try again.",
      };
    }

    return {
      valid: false,
      error: `Deepgram API returned unexpected status: ${response.status}`,
    };
  } catch {
    return {
      valid: false,
      error: "Could not reach Deepgram API. Please check your network connection and try again.",
    };
  }
}

export async function validateVercelAIGatewayKey(
  key: string,
): Promise<ValidationResult> {
  const trimmedKey = key.trim();

  try {
    const response = await fetch(VERCEL_AI_GATEWAY_API, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${trimmedKey}`,
        "Content-Type": "application/json",
      },
    });

    if (response.status === 200) {
      return { valid: true };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        error: "Invalid Vercel AI Gateway key. Please check your key and try again.",
      };
    }

    return {
      valid: false,
      error: `Vercel AI Gateway returned unexpected status: ${response.status}`,
    };
  } catch {
    return {
      valid: false,
      error: "Could not reach Vercel AI Gateway. Please check your network connection and try again.",
    };
  }
}
