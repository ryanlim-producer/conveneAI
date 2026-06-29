import os
import sys
import json
import mimetypes
import time
import base64
import re
import tkinter as tk
from tkinter import filedialog

import requests
from deepgram import DeepgramClient, PrerecordedOptions
from fpdf import FPDF

# ----------------------------
# CONFIGURACIONES DE API
# ----------------------------
DEEPGRAM_API_KEY    = os.getenv("DEEPGRAM_API_KEY")
DEEPGRAM_PROJECT_ID = os.getenv("DEEPGRAM_PROJECT_ID")

OPENROUTER_API_KEY  = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_URL      = "https://openrouter.ai/api/v1/chat/completions"

if not DEEPGRAM_API_KEY or not OPENROUTER_API_KEY:
    print("ERROR: Define DEEPGRAM_API_KEY y OPENROUTER_API_KEY en un archivo .env o como variables de entorno.")
    sys.exit(1)

# ----------------------------
# FUNCIONES AUXILIARES DE DEEPGRAM
# ----------------------------
def obtener_balance_deepgram() -> None:
    """
    Llama a GET /v1/projects/:project_id/balances
    y muestra sólo el amount y la unidad.
    """
    url = f"https://api.deepgram.com/v1/projects/{DEEPGRAM_PROJECT_ID}/balances"
    headers = {
        "Authorization": f"Token {DEEPGRAM_API_KEY}"
    }
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        # Extraer amount y units del primer balance
        balances = data.get("balances", [])
        if balances:
            amount = balances[0].get("amount")
            units  = balances[0].get("units")
            print(f"{amount} {units}")
        else:
            print("No se encontró ningún balance disponible.")
    except requests.RequestException as e:
        print(f"❌ Error al obtener balance de Deepgram: {e}")


def seleccionar_archivo_audio() -> str:
    """
    Abre un diálogo (tkinter) para que el usuario seleccione un archivo de audio.
    Devuelve la ruta completa, o None si cancela.
    """
    root = tk.Tk()
    root.withdraw()
    filetypes = [
        ("Archivos de audio", "*.wav *.mp3 *.m4a *.flac *.ogg"),
        ("Todos los archivos", "*.*"),
    ]
    ruta = filedialog.askopenfilename(
        title="Selecciona el archivo de audio",
        filetypes=filetypes
    )
    root.destroy()
    return ruta or None

def verificar_extension_audio(ruta_audio: str) -> None:
    """
    Muestra un aviso si la extensión de audio es poco común (opcional).
    """
    ext = os.path.splitext(ruta_audio)[1].lower()
    if ext not in [".wav", ".mp3", ".m4a", ".flac", ".ogg"]:
        print(f"⚠️  Atención: la extensión '{ext}' podría no ser totalmente compatible con Deepgram.")

def segundos_a_mmss(segundos: float) -> str:
    """
    Convierte segundos (float) a formato "MM:SS".
    """
    total = int(segundos)
    minutos = total // 60
    seg = total % 60
    return f"{minutos:02d}:{seg:02d}"

def transcribir_con_deepgram(ruta_audio: str) -> object:
    """
    Envía el archivo de audio a Deepgram de forma síncrona, solicitando diarization y smart_format.
    Devuelve el objeto de respuesta de Deepgram (que contiene canales, alternativas, etc.).
    Lanza excepción si algo falla.
    """
    if not DEEPGRAM_API_KEY:
        raise RuntimeError("La clave API de Deepgram no está definida.")

    try:
        deepgram = DeepgramClient(DEEPGRAM_API_KEY)
    except Exception as e:
        raise RuntimeError(f"Error al inicializar DeepgramClient: {e}")

    try:
        with open(ruta_audio, "rb") as f:
            audio_bytes = f.read()
    except FileNotFoundError:
        raise RuntimeError(f"ERROR: No existe el archivo: {ruta_audio}")

    mime_type, _ = mimetypes.guess_type(ruta_audio)
    mimetype = mime_type or "application/octet-stream"

    source = {
        "buffer": audio_bytes,
        "mimetype": mimetype
    }

    opciones = PrerecordedOptions(
        model="whisper",
        language="es",
        punctuate=True,
        diarize=True,
        smart_format=True,
        paragraphs=True
    )

    try:
        respuesta = deepgram.listen.rest.v("1").transcribe_file(
            source=source,
            options=opciones,
            timeout=900
        )
    except Exception as e:
        raise RuntimeError(f"ERROR durante la petición a Deepgram:\n{e}")

    return respuesta

def extraer_transcripcion_con_diarization(respuesta) -> str:
    """
    A partir del objeto devuelto por Deepgram (con diarization y smart_format),
    arma un string formateado que incluya párrafos separados por orador y las marcas de tiempo (MM:SS) al inicio.
    """
    texto_formateado = ""
    try:
        canal0 = respuesta.results.channels[0]
        alt    = canal0.alternatives[0]

        # 1) Intentamos usar smart_format_results (puede incluir timestamps en cada párrafo)
        smart = getattr(alt, "smart_format_results", None)
        if smart and isinstance(smart, dict) and "paragraphs" in smart:
            for par in smart["paragraphs"]:
                speaker_id = par.get("speaker", 0)
                texto      = par.get("text", "").strip()
                inicio     = par.get("start", None)
                if texto:
                    ts = segundos_a_mmss(inicio) if inicio is not None else "00:00"
                    texto_formateado += f"[{ts}] Speaker {speaker_id}: {texto}\n\n"
            return texto_formateado.rstrip("\n")

        # 2) Si no hay smart_format_results, agrupamos palabra a palabra
        palabras = getattr(alt, "words", None)
        if not palabras:
            texto_formateado = getattr(alt, "transcript", "").strip()
            return texto_formateado

        speaker_actual   = palabras[0].speaker
        inicio_actual    = palabras[0].start
        linea = f"[{segundos_a_mmss(inicio_actual)}] Speaker {speaker_actual}: "
        for w in palabras:
            if w.speaker != speaker_actual:
                texto_formateado += linea.strip() + "\n\n"
                speaker_actual = w.speaker
                inicio_actual  = w.start
                linea = f"[{segundos_a_mmss(inicio_actual)}] Speaker {speaker_actual}: "
            linea += w.word + " "
        texto_formateado += linea.strip()
        return texto_formateado

    except Exception as e:
        try:
            detalle = json.dumps(respuesta, default=lambda o: o.__dict__, indent=2, ensure_ascii=False)
        except:
            detalle = str(respuesta)
        raise RuntimeError("ERROR al extraer diarization:\n" + detalle)

def guardar_texto_en_archivo(texto: str, ruta_salida: str) -> None:
    """
    Guarda el 'texto' completo en el archivo de texto indicado.
    """
    with open(ruta_salida, "w", encoding="utf-8") as f:
        f.write(texto)

def generar_pdf_desde_texto(texto: str, ruta_salida: str) -> None:
    """
    Genera un PDF sencillo que contiene todo el 'texto'
    y lo guarda en 'ruta_salida', usando fuente más pequeña (10 pt) y line height reducido (6 mm).
    """
    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    pdf.set_font("Arial", size=10)
    pdf.multi_cell(0, 6, texto)
    pdf.output(ruta_salida)

# ----------------------------
# FUNCIONES AUXILIARES DE DEEPSEEK (OPENROUTER)
# ----------------------------
def seleccionar_archivo_pdf() -> str:
    """
    Abre un diálogo para que el usuario seleccione un archivo PDF.
    Devuelve la ruta completa, o None si cancela.
    """
    root = tk.Tk()
    root.withdraw()
    filetypes = [("Archivos PDF", "*.pdf"), ("Todos los archivos", "*.*")]
    ruta = filedialog.askopenfilename(
        title="Selecciona el archivo PDF",
        filetypes=filetypes
    )
    root.destroy()
    return ruta or None

def encode_pdf_to_base64(pdf_path: str) -> str:
    """
    Codifica un PDF en Base64 para enviarlo a OpenRouter.
    """
    with open(pdf_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

def limpiar_markdown(texto: str) -> str:
    """
    Elimina los asteriscos usados para negritas (o cualquier '*' suelto)
    para que el texto quede sin formato Markdown.
    """
    texto = re.sub(r"\*\*(.*?)\*\*", r"\1", texto)
    return texto.replace("*", "")

def preguntar_a_deepseek(pdf_base64: str, pregunta: str) -> tuple[str, float]:
    """
    Envía 'pregunta' y el PDF (en Base64) al modelo Deepseek vía OpenRouter.
    Devuelve una tupla (respuesta_limpia, tiempo_en_segundos).
    """
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": pregunta},
                {
                    "type": "file",
                    "file": {
                        "filename": "transcripcion.pdf",
                        "file_data": f"data:application/pdf;base64,{pdf_base64}"
                    }
                }
            ]
        }
    ]
    plugins = [
        {
            "id": "file-parser",
            "pdf": {"engine": "pdf-text"}
        }
    ]
    payload = {
        "model": "deepseek/deepseek-r1:free",
        "messages": messages,
        "plugins": plugins
    }
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json"
    }

    start_time = time.time()
    respuesta = requests.post(OPENROUTER_URL, headers=headers, json=payload)
    elapsed = time.time() - start_time

    if respuesta.status_code != 200:
        raise RuntimeError(f"Error OpenRouter (status {respuesta.status_code}): {respuesta.text}")

    data = respuesta.json()
    try:
        content_raw = data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError):
        detalle = json.dumps(data, indent=2, ensure_ascii=False)
        raise RuntimeError("Respuesta inesperada de Deepseek:\n" + detalle)

    content_limpio = limpiar_markdown(content_raw)
    return content_limpio, elapsed

# ----------------------------
# FLUJO PRINCIPAL UNIFICADO
# ----------------------------
def main():
    # 0) Mostrar balance de créditos antes de empezar


    print("\n=== 1) Audio → Deepgram (diarization + smart_format + timestamps) ===\n")

    # 1) Seleccionar archivo de audio
    print("1) Selecciona el archivo de audio…")
    ruta_audio = seleccionar_archivo_audio()
    if not ruta_audio:
        print("No se seleccionó ningún archivo. Saliendo.")
        sys.exit(0)
    if not os.path.isfile(ruta_audio):
        print(f"ERROR: El archivo '{ruta_audio}' no existe. Saliendo.")
        sys.exit(1)

    verificar_extension_audio(ruta_audio)

    # 2) Transcribir con Deepgram
    print("\n2) Enviando audio a Deepgram para transcripción…")
    t_inicio_trans = time.time()
    try:
        respuesta_deep = transcribir_con_deepgram(ruta_audio)
    except Exception as e:
        print(f"\n❌ Error durante la transcripción:\n{e}\n")
        sys.exit(1)
    t_fin_trans = time.time()
    duracion_trans = t_fin_trans - t_inicio_trans
    print(f"   ► Tiempo de transcripción Deepgram: {duracion_trans:.2f} segundos.\n")

    # 3) Extraer texto con diarization
    print("--- Armando transcripción con diarization (inicio) ---")
    t_inicio_diar = time.time()
    try:
        transcripcion_txt = extraer_transcripcion_con_diarization(respuesta_deep)
    except Exception as e:
        print(f"\n❌ Error al procesar diarization:\n{e}\n")
        sys.exit(1)
    t_fin_diar = time.time()
    duracion_diar = t_fin_diar - t_inicio_diar
    print(transcripcion_txt)
    print("--- Armando transcripción con diarization (fin) ---")
    print(f"   ► Tiempo de procesamiento de diarización: {duracion_diar:.2f} segundos.\n")

    # 4) Guardar transcripción en .txt
    nombre_txt = "transcripcion.txt"
    print(f"3) Guardando transcripción de texto en '{nombre_txt}'…")
    t_inicio_guardado_txt = time.time()
    try:
        guardar_texto_en_archivo(transcripcion_txt, nombre_txt)
    except Exception as e:
        print(f"\n❌ Error guardando archivo de texto:\n{e}\n")
        sys.exit(1)
    t_fin_guardado_txt = time.time()
    duracion_guardado_txt = t_fin_guardado_txt - t_inicio_guardado_txt
    print(f"   ► Archivo de texto generado exitosamente en {duracion_guardado_txt:.2f} segundos.\n")

    # 5) Generar PDF a partir del mismo texto
    nombre_pdf = "transcripcion.pdf"
    print(f"4) Generando PDF en '{nombre_pdf}'…")
    t_inicio_pdf = time.time()
    try:
        generar_pdf_desde_texto(transcripcion_txt, nombre_pdf)
    except Exception as e:
        print(f"\n❌ Error generando PDF:\n{e}\n")
        sys.exit(1)
    t_fin_pdf = time.time()
    duracion_pdf = t_fin_pdf - t_inicio_pdf
    print(f"   ► PDF generado exitosamente en {duracion_pdf:.2f} segundos.\n")

    tiempo_total = time.time() - t_inicio_trans
    print(f"¡Proceso de transcripción completado! Tiempo total: {tiempo_total:.2f} segundos.\n")
    print(f"Revisa '{nombre_txt}' y '{nombre_pdf}'.\n")
    obtener_balance_deepgram()
    # ----------------------------
    # 6) Codificar PDF y comenzar bucle de preguntas a Deepseek
    # ----------------------------
    print("\n=== 2) Ahora puedes hacer preguntas sobre el PDF generado ===\n")
    try:
        pdf_base64 = encode_pdf_to_base64(nombre_pdf)
    except Exception as e:
        print(f"❌ Error al codificar PDF:\n{e}\n")
        sys.exit(1)

    print("Escribe 'salir' o 'exit' para terminar.\n")
    while True:
        pregunta = input("Pregunta: ").strip()
        if pregunta.lower() in {"salir", "exit"}:
            print("\n¡Hasta luego!")
            break
        if not pregunta:
            print("→ Debes escribir algo o 'salir'.")
            continue

        print("\n   ► Enviando consulta a Deepseek…")
        try:
            respuesta_limpia, tiempo = preguntar_a_deepseek(pdf_base64, pregunta)
        except Exception as e:
            print(f"\n❌ Error al consultar Deepseek:\n{e}\n")
            continue

        print("\nRespuesta:\n")
        print(respuesta_limpia)
        print(f"\n→ Tiempo de respuesta: {tiempo:.2f} segundos")
        print("\n" + "-"*60 + "\n")

if __name__ == "__main__":
    main()
