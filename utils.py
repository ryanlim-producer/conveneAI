# utils.py
import os
import sys
import json
import requests
import platform
if platform.system() == "Windows":
    import winsound
else:
    winsound = None
from typing import Optional
from cryptography.fernet import Fernet

# ------------------ CONSTANTES ------------------
CLAVE_FIJA = b'K9TOUzAY5sQWnrsMfSrSWS9MD9KTv6c_Btf5n65_1Lc='
fernet = Fernet(CLAVE_FIJA)
RUTA_ARCHIVO = "config.json.cif"

# ------------------ VARIABLES GLOBALES ------------------
OPENROUTER_API_KEY: Optional[str] = None   # opcional: ya no se pide en la UI
DEEPGRAM_API_KEY: Optional[str] = None

# ------------------ UTILIDADES UI ------------------
def reproducir_sonido(tipo="finalizado"):
    if winsound is None:
        return  # macOS/Linux: no system beep available
    if tipo == "finalizado":
        winsound.MessageBeep(winsound.MB_OK)
    elif tipo == "error":
        winsound.MessageBeep(winsound.MB_ICONHAND)
    elif tipo == "inicio":
        winsound.MessageBeep(winsound.MB_ICONASTERISK)

def ruta_absoluta(relative_path: str) -> str:
    try:
        base_path = sys._MEIPASS  # type: ignore
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

# ------------------ CIFRADO / DESCIFRADO ------------------
def cifrar_archivo(path_entrada: str, path_salida: str | None = None) -> None:
    try:
        with open(path_entrada, "rb") as f:
            datos = f.read()
        cifrado = fernet.encrypt(datos)
        if not path_salida:
            path_salida = path_entrada + ".cif"
        with open(path_salida, "wb") as f:
            f.write(cifrado)
    except Exception as e:
        print(f"❌ Error al cifrar: {e}")

def _descifrar_bytes(path: str) -> bytes:
    with open(path, "rb") as f:
        datos_cifrados = f.read()
    return fernet.decrypt(datos_cifrados)

# ------------------ GESTIÓN DE CLAVES ------------------
def validar_api_key_deepgram(api_key: str) -> bool:
    """
    Verifica si la clave API de Deepgram es válida haciendo GET /v1/projects.
    """
    url = "https://api.deepgram.com/v1/projects"
    headers = {"Authorization": f"Token {api_key.strip()}"}
    try:
        response = requests.get(url, headers=headers, timeout=10)
        return response.status_code == 200
    except Exception as e:
        print(f"❌ Error al conectar con Deepgram: {e}")
        return False

# (Opcional) se mantiene por compatibilidad si en otra parte de tu código lo llamas,
# pero ya NO se usa desde la ventana de licencia.
def verificar_openrouter_key(api_key: str) -> bool:
    url = "https://openrouter.ai/api/v1/key"
    headers = {"Authorization": f"Bearer {api_key.strip()}"}
    try:
        r = requests.get(url, headers=headers, timeout=10)
        return r.status_code == 200
    except Exception as e:
        print(f"❌ Error al conectar con OpenRouter: {e}")
        return False

def guardar_claves_cifradas(deepgram_key: str) -> bool:
    """
    Guarda SOLO Deepgram en config.json.cif.
    Estructura final: {"deepgram_api_key": "<key>"}
    """
    try:
        data = {"deepgram_api_key": deepgram_key}
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        datos_cifrados = fernet.encrypt(raw)
        with open(RUTA_ARCHIVO, "wb") as f:
            f.write(datos_cifrados)
        return True
    except Exception as e:
        print(f"❌ Error al guardar claves cifradas: {e}")
        return False

def descifrar_y_extraer_claves() -> dict | None:
    """
    Descifra config.json.cif y extrae claves.
    Compat:
      - Lee "deepgram_api_key" (nuevo) o "deepgram_key" (muy viejo).
      - Si existe "openrouter_api_key" (viejo), la carga como opcional.
    """
    global OPENROUTER_API_KEY, DEEPGRAM_API_KEY
    if not os.path.exists(RUTA_ARCHIVO) or os.path.getsize(RUTA_ARCHIVO) == 0:
        return None

    try:
        raw = _descifrar_bytes(RUTA_ARCHIVO)
        data = json.loads(raw.decode("utf-8"))

        OPENROUTER_API_KEY = data.get("openrouter_api_key") or None  # opcional
        DEEPGRAM_API_KEY = data.get("deepgram_api_key") or data.get("deepgram_key") or None

        return {
            "openrouter_api_key": OPENROUTER_API_KEY,
            "deepgram_api_key": DEEPGRAM_API_KEY
        }
    except Exception as e:
        print(f"❌ Error al descifrar o extraer claves: {e}")
        return None

def obtener_deepgram_key_prioritaria() -> Optional[str]:
    """
    Orden de búsqueda:
    1) ENV DEEPGRAM_API_KEY
    2) Global si ya fue cargada
    3) Archivo cifrado (si aún no)
    """
    envk = os.getenv("DEEPGRAM_API_KEY")
    if envk:
        return envk.strip()
    if DEEPGRAM_API_KEY:
        return DEEPGRAM_API_KEY.strip()
    cfg = descifrar_y_extraer_claves()
    if cfg and cfg.get("deepgram_api_key"):
        return cfg["deepgram_api_key"].strip()
    return None

# ------------------ Deepgram Helpers ------------------
def obtener_project_id_deepgram(api_key: str) -> str | None:
    try:
        headers = {"Authorization": f"Token {api_key}"}
        response = requests.get("https://api.deepgram.com/v1/projects", headers=headers, timeout=10)
        if response.status_code == 200:
            data = response.json()
            return data["projects"][0]["project_id"]
        else:
            print(f"Error al obtener project_id: {response.status_code} - {response.text[:200]}")
    except Exception as e:
        print(f"Excepción al obtener project_id: {e}")
    return None
