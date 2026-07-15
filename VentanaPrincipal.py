# ---------- ConveneAIApp COMPACTA (solo Deepgram, sin chatbot) ----------
import os
import tempfile
import threading
import customtkinter as ctk
from moviepy import AudioFileClip
import requests

from tkinter import filedialog, messagebox
from tkinterdnd2 import DND_FILES, TkinterDnD
import tkinter as tk
import platform
import subprocess
from PIL import Image, ImageTk

import utils
from DeepGramClient import DeepgramPDFTranscriber


def centrar_ventana(win, ancho=800, alto=1050):
    """Centra la ventana con tamaño dado."""
    win.update_idletasks()
    x = (win.winfo_screenwidth() // 2) - (ancho // 2)
    y = (win.winfo_screenheight() // 2) - (alto // 2)
    win.geometry(f"{ancho}x{alto}+{x}+{y}")


class ConveneAIApp(TkinterDnD.Tk):
    """
    App sin chatbot.
    - Drag & drop / selección de audio
    - Conversión .mp4 -> .mp3
    - Transcripción Deepgram a .docx
    - Historial (hasta 50) y apertura de transcripciones
    - Balance y costo aproximado (si hay permisos)
    - UI con tarjetas (formato compacto)
    """
    def __init__(self, deepgram_key):
        super().__init__()
        ctk.set_appearance_mode("light")
        ctk.set_default_color_theme("blue")

        self.title("conveneAI")
        self.resizable(False, False)
        centrar_ventana(self, 860, 550)

        # Icono
        ico_path = utils.ruta_absoluta("media/logo.ico")
        if os.path.exists(ico_path):
            try:
                self.iconbitmap(ico_path)
            except Exception:
                pass

        # Estado
        self.selected_files = []
        self.deepgram_api_key = deepgram_key
        self.transcriptor = DeepgramPDFTranscriber(self.deepgram_api_key)

        # Menú (Historial)
        menubar = tk.Menu(self)
        self.config(menu=menubar)
        self.historial_menu = tk.Menu(menubar, tearoff=0)
        menubar.add_cascade(label="Historial", menu=self.historial_menu)

        self.historial_archivo = "historial.txt"
        self.historial_transcripciones = self._cargar_historial()
        self._actualizar_menu_historial()

        # ---------- Layout principal (compacto) ----------
        root_padx, root_pady = 12, 12
        main = ctk.CTkFrame(self, fg_color="transparent")
        main.pack(fill="both", expand=True, padx=root_padx, pady=root_pady)

        # Columna izquierda: Cargar archivo (AHORA MÁS ANCHA)
        left_col = ctk.CTkFrame(main, fg_color="transparent")
        left_col.pack(side="left", fill="y", padx=(0, 12))
        left_col.configure(width=340)           # ← ancho objetivo
        left_col.pack_propagate(False)          # ← mantiene el ancho

        self._build_card_upload(left_col)
        self._build_card_selected(left_col)     # ← panel de archivos más ancho

        # Columna derecha: Saldo + Acciones + Progreso
        right_col = ctk.CTkFrame(main, fg_color="transparent")
        right_col.pack(side="left", fill="both", expand=True)

        right_col.grid_columnconfigure(0, weight=1)
        right_col.grid_rowconfigure(2, weight=1)  # tarjeta de progreso se expande

        self._build_card_balance(right_col)
        self._build_card_actions(right_col)
        self._build_card_progress(right_col)

        # Gif de "cargando"
        self.gif_path = "media/cargando.gif"
        self._gif_frames = []
        self._gif_job = None
        self._gif_loaded = False
        if os.path.exists(self.gif_path):
            self._cargar_frames_gif()
            self._gif_loaded = True

        # Sonido de inicio
        utils.reproducir_sonido("inicio")

    # ---------- TARJETAS (Cards) ----------
    def _build_card_upload(self, parent):
        card = ctk.CTkFrame(parent, corner_radius=14, border_width=1, border_color="#dcdcdc", fg_color="#ffffff")
        card.pack(fill="x", pady=(0, 10))

        header = ctk.CTkFrame(card, fg_color="transparent")
        header.pack(fill="x", padx=12, pady=(10, 0))
        ctk.CTkLabel(header, text="Cargar audio", font=ctk.CTkFont(size=15, weight="bold")).pack(anchor="w")

        # Zona drag & drop
        drop = ctk.CTkFrame(card, height=120, corner_radius=10, border_width=1, border_color="#c9c9c9")
        drop.pack(padx=12, pady=10, fill="x")
        drop.pack_propagate(False)

        ctk.CTkLabel(drop, text="🎵", font=ctk.CTkFont(size=28)).pack(pady=(6, 2))
        ctk.CTkLabel(
            drop,
            text="Arrastra tu archivo de audio aquí o usa el botón",
            font=ctk.CTkFont(size=11),
            wraplength=280,     # texto más ancho
            justify="center"
        ).pack(padx=8)
        ctk.CTkButton(drop, text="Buscar archivo", height=30, command=self._on_browse_files).pack(pady=(6, 8))

        # Habilitar drop
        drop.drop_target_register(DND_FILES)
        drop.dnd_bind('<<Drop>>', self._on_drop_files)

    def _build_card_selected(self, parent):
        card = ctk.CTkFrame(parent, corner_radius=14, border_width=1, border_color="#dcdcdc", fg_color="#ffffff")
        card.pack(fill="both", expand=True)

        header = ctk.CTkFrame(card, fg_color="transparent")
        header.pack(fill="x", padx=12, pady=(10, 6))
        ctk.CTkLabel(header, text="Archivo seleccionado", font=ctk.CTkFont(size=15, weight="bold")).pack(anchor="w")

        # ← scrollable más ancho/alto
        self.archivos_frame = ctk.CTkScrollableFrame(card, fg_color="#fbfbfb", corner_radius=10, height=180)
        self.archivos_frame.pack(fill="both", expand=True, padx=12, pady=(0, 12))

        ctk.CTkLabel(self.archivos_frame, text="(Aún no hay archivo seleccionado)", text_color="#666666").pack(pady=8)

    def _build_card_balance(self, parent):
        card = ctk.CTkFrame(parent, corner_radius=14, border_width=1, border_color="#dcdcdc", fg_color="#ffffff")
        card.grid(row=0, column=0, sticky="ew", pady=(0, 10))

        inner = ctk.CTkFrame(card, fg_color="transparent")
        inner.pack(fill="x", padx=12, pady=10)

        left = ctk.CTkFrame(inner, fg_color="transparent")
        left.pack(side="left", fill="x", expand=True)

        ctk.CTkLabel(left, text="Saldo Deepgram", font=ctk.CTkFont(size=15, weight="bold")).pack(anchor="w")
        self.lbl_saldo = ctk.CTkLabel(left, text=self.obtener_balance_deepgram(), font=ctk.CTkFont(size=12))
        self.lbl_saldo.pack(anchor="w", pady=(3, 0))

        # Icono a la derecha (opcional)
        right = ctk.CTkFrame(inner, fg_color="transparent")
        right.pack(side="right")
        icon_path = utils.ruta_absoluta(os.path.join("media", "icono.png"))
        if os.path.exists(icon_path):
            img = ctk.CTkImage(light_image=Image.open(icon_path), dark_image=Image.open(icon_path), size=(40, 40))
            ctk.CTkLabel(right, image=img, text="").pack()

    def _build_card_actions(self, parent):
        card = ctk.CTkFrame(parent, corner_radius=14, border_width=1, border_color="#dcdcdc", fg_color="#ffffff")
        card.grid(row=1, column=0, sticky="ew", pady=(0, 10))

        inner = ctk.CTkFrame(card, fg_color="transparent")
        inner.pack(fill="x", padx=12, pady=10)

        ctk.CTkLabel(inner, text="Acciones", font=ctk.CTkFont(size=15, weight="bold")).pack(anchor="w", pady=(0, 6))

        btns = ctk.CTkFrame(inner, fg_color="transparent")
        btns.pack(fill="x")

        self.btn_transcribir = ctk.CTkButton(
            btns, text="✍️  Transcribir", height=34, command=self._on_transcribir, state="disabled", width=140
        )
        self.btn_transcribir.pack(side="left", padx=(0, 8))

        self.btn_abrir_transcripcion = ctk.CTkButton(
            btns, text="📄  Abrir transcripción", height=34, command=self._on_open_transcripcion,
            state="disabled", width=160
        )
        self.btn_abrir_transcripcion.pack(side="left")

    def _build_card_progress(self, parent):
        card = ctk.CTkFrame(parent, corner_radius=14, border_width=1, border_color="#dcdcdc", fg_color="#ffffff")
        card.grid(row=2, column=0, sticky="nsew")

        inner = ctk.CTkFrame(card, fg_color="transparent")
        inner.pack(fill="both", expand=True, padx=12, pady=10)

        ctk.CTkLabel(inner, text="Progreso", font=ctk.CTkFont(size=15, weight="bold")).pack(anchor="w")

        self.progress_holder = ctk.CTkFrame(inner, fg_color="#fbfbfb", corner_radius=10, height=120)
        self.progress_holder.pack(fill="both", expand=True, pady=(8, 0))

        self.progress_label = ctk.CTkLabel(self.progress_holder, text="En espera…", text_color="#666666")
        self.progress_label.pack(pady=8)

        # Espacio para gif
        self.gif_label = ctk.CTkLabel(self.progress_holder, text="")
        self.gif_label.pack(pady=(0, 8))

    # ---------- Drag & Drop / Browse ----------
    def _on_drop_files(self, event):
        rutas = self.tk.splitlist(event.data)
        extensiones_validas = ('.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.webm', '.opus', '.mp4')

        ruta = next((r for r in rutas if r.lower().endswith(extensiones_validas)), None)
        if not ruta:
            messagebox.showerror("Error", "Por favor arrastra un archivo de audio válido.")
            return

        self._cargar_ruta(ruta)

    def _on_browse_files(self):
        tipos_permitidos = [("Audio/Video", "*.mp3 *.wav *.m4a *.flac *.ogg *.aac *.webm *.opus *.mp4")]
        try:
            ruta = filedialog.askopenfilename(title="Selecciona un archivo", filetypes=tipos_permitidos)
        except Exception as e:
            messagebox.showerror("Error", f"No se pudo abrir el diálogo de archivos:\n{e}")
            return

        if not ruta:
            return

        self._cargar_ruta(ruta)

    def _cargar_ruta(self, ruta):
        try:
            if ruta.lower().endswith(".mp4"):
                # Convertir mp4 -> mp3 temporal
                nombre_base = os.path.splitext(os.path.basename(ruta))[0]
                tmp_dir = tempfile.gettempdir()
                ruta_convertida = os.path.join(tmp_dir, f"{nombre_base}.mp3")

                clip = AudioFileClip(ruta)
                clip.write_audiofile(ruta_convertida, logger=None)
                clip.close()
                self.selected_files = [ruta_convertida]
            else:
                self.selected_files = [ruta]
        except Exception as e:
            messagebox.showerror("Error al procesar", f"Ocurrió un problema con el archivo:\n{e}")
            return

        # Actualiza lista + habilita botón
        self._actualizar_lista_archivos()
        try:
            nombre_base = os.path.splitext(os.path.basename(self.selected_files[0]))[0]
            self.nombre_word = f"{nombre_base}.docx"
        except Exception:
            self.nombre_word = "transcripcion.docx"

        self.btn_transcribir.configure(state="normal")
        self.btn_abrir_transcripcion.configure(state="disabled")
        self.progress_label.configure(text="Listo para transcribir.")

    def _actualizar_lista_archivos(self):
        for w in self.archivos_frame.winfo_children():
            w.destroy()

        if not self.selected_files:
            ctk.CTkLabel(self.archivos_frame, text="(Aún no hay archivo seleccionado)", text_color="#666666").pack(pady=8)
            return

        extensiones_validas = ('.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.webm', '.opus', '.mp4')
        for ruta in self.selected_files:
            if not ruta.lower().endswith(extensiones_validas):
                continue
            fila = ctk.CTkFrame(self.archivos_frame, fg_color="transparent")
            fila.pack(fill="x", padx=8, pady=4)

            nombre = os.path.basename(ruta)
            # ← etiqueta más ancha (aprovecha columna izquierda)
            ctk.CTkLabel(fila, text=f"• {nombre}", anchor="w", wraplength=380)\
                .pack(side="left", padx=(0, 8), fill="x", expand=True)

            ctk.CTkButton(
                fila,
                text="🗑️",
                height=28,
                fg_color="#d9534f",
                hover_color="#c9302c",
                command=lambda r=ruta: self._eliminar_archivo(r),
                width=70
            ).pack(side="right")

    def _eliminar_archivo(self, ruta):
        if ruta in self.selected_files:
            self.selected_files.remove(ruta)
        self._actualizar_lista_archivos()
        if not self.selected_files:
            self.btn_transcribir.configure(state="disabled")
            self.btn_abrir_transcripcion.configure(state="disabled")
            self.progress_label.configure(text="En espera…")

    # ---------- Transcripción ----------
    def _on_transcribir(self):
        if not self.selected_files:
            messagebox.showinfo("Sin archivos", "Primero selecciona un archivo.")
            return

        carpeta_destino = filedialog.askdirectory(title="Selecciona una carpeta para guardar el Word")
        if not carpeta_destino:
            return

        nombre_base = os.path.splitext(os.path.basename(self.selected_files[0]))[0]
        nombre_base = (nombre_base[:70] + '...') if len(nombre_base) > 50 else nombre_base
        self.nombre_word = os.path.join(carpeta_destino, f"{nombre_base}.docx")

        def tarea():
            try:
                ruta = self.selected_files[0]
                # UI: progreso
                self.after(0, lambda: self.progress_label.configure(text="Transcribiendo…"))
                self.after(0, self._mostrar_gif)

                self.btn_transcribir.configure(state="disabled")
                self.transcriptor.transcribir_audio(ruta, self.nombre_word)

                self.after(0, self._transcripcion_exitosa)
            except Exception as e:
                messagebox.showerror("Error", str(e))
            finally:
                self.after(0, self._ocultar_gif)
                self.after(0, lambda: self.btn_transcribir.configure(state="normal"))

        threading.Thread(target=tarea, daemon=True).start()

    def _transcripcion_exitosa(self):
        self._guardar_en_historial(self.nombre_word)

        # Solo intenta costo si hay datos previos válidos
        if getattr(self, "balance_anterior", None) is not None and getattr(self, "balance_actual", None) is not None:
            try:
                _ = self.calcular_costo_transcripcion()
            except Exception:
                pass

        self.progress_label.configure(text=f"✔ Transcripción completada:\n{self.nombre_word}")
        utils.reproducir_sonido("inicio")
        self.btn_abrir_transcripcion.configure(state="normal")
        self.lbl_saldo.configure(text=self.obtener_balance_deepgram())

    def _on_open_transcripcion(self):
        if not hasattr(self, "nombre_word"):
            messagebox.showerror("Error", "No se ha generado ningún Word.")
            return
        ruta_word = self.nombre_word
        if not os.path.exists(ruta_word):
            messagebox.showerror("Archivo no encontrado", f"No se encontró el archivo {ruta_word}.")
            return

        sistema = platform.system()
        try:
            if sistema == "Windows":
                os.startfile(ruta_word)
            elif sistema == "Darwin":
                subprocess.call(["open", ruta_word])
            else:
                subprocess.call(["xdg-open", ruta_word])
        except Exception as e:
            messagebox.showerror("Error al abrir archivo", f"No se pudo abrir:\n{ruta_word}\n\n{e}")

    # ---------- Historial (hasta 50) ----------
    def _cargar_historial(self):
        if not os.path.exists(self.historial_archivo):
            return []
        with open(self.historial_archivo, "r", encoding="utf-8") as f:
            lineas = [line.strip() for line in f.readlines() if line.strip()]
        return lineas[-50:]  # ← 50

    def _guardar_en_historial(self, ruta_word):
        self.historial_transcripciones.append(ruta_word)
        self.historial_transcripciones = self.historial_transcripciones[-50:]  # ← 50
        with open(self.historial_archivo, "a", encoding="utf-8") as f:
            f.write(ruta_word + "\n")
        self._actualizar_menu_historial()

    def _actualizar_menu_historial(self):
        if not hasattr(self, 'historial_menu'):
            return
        self.historial_menu.delete(0, tk.END)
        if not self.historial_transcripciones:
            self.historial_menu.add_command(label="(Sin historial)", state="disabled")
        else:
            for ruta in reversed(self.historial_transcripciones):
                nombre = os.path.basename(ruta)
                self.historial_menu.add_command(
                    label=nombre,
                    command=lambda r=ruta: self._abrir_transcripcion_desde_historial(r)
                )

    def _abrir_transcripcion_desde_historial(self, ruta_word):
        if not os.path.exists(ruta_word):
            messagebox.showerror("Error", f"No se encontró el archivo:\n{ruta_word}")
            return
        try:
            sistema = platform.system()
            if sistema == "Windows":
                os.startfile(ruta_word)
            elif sistema == "Darwin":
                subprocess.call(["open", ruta_word])
            else:
                subprocess.call(["xdg-open", ruta_word])
        except Exception as e:
            messagebox.showerror("Error al abrir archivo", f"No se pudo abrir:\n{ruta_word}\n\n{e}")

    # ---------- Balance / Costos ----------
    def obtener_balance_deepgram(self) -> str:
        """
        Intenta obtener el balance de Deepgram.
        Si la API devuelve 401/403 u otro error, no rompe la app; muestra texto amigable.
        """
        try:
            project_id = utils.obtener_project_id_deepgram(self.deepgram_api_key)
            if not project_id:
                self.balance_anterior = None
                self.balance_actual = None
                return "Balance no disponible"

            url = f"https://api.deepgram.com/v1/projects/{project_id}/balances"
            headers = {"Authorization": f"Token {self.deepgram_api_key}"}
            tasa_dolar_a_cop = 4000

            resp = requests.get(url, headers=headers, timeout=10)
            if resp.status_code in (401, 403):
                self.balance_anterior = None
                self.balance_actual = None
                return "Balance no disponible (permiso requerido)"
            if resp.status_code >= 400:
                self.balance_anterior = None
                self.balance_actual = None
                return "Balance no disponible"

            data = resp.json()
            balances = data.get("balances", [])
            if not balances:
                self.balance_anterior = None
                self.balance_actual = None
                return "Balance no disponible"

            amount = balances[0].get("amount")
            units = balances[0].get("units", "usd")

            if getattr(self, "balance_actual", None) is not None:
                self.balance_anterior = self.balance_actual
            else:
                self.balance_anterior = amount

            self.balance_actual = amount
            amount_cop = round((amount or 0) * tasa_dolar_a_cop)
            return f"${amount:.2f} {units.upper()} / ${amount_cop:,} COP"
        except Exception as e:
            print(f"❌ Error al obtener balance de Deepgram: {e}")
            self.balance_anterior = None
            self.balance_actual = None
            return "Balance no disponible"

    def calcular_costo_transcripcion(self) -> str:
        tasa_dolar_a_cop = 4000
        if getattr(self, "balance_actual", None) is None:
            self.obtener_balance_deepgram()
        if getattr(self, "balance_anterior", None) is None:
            self.balance_anterior = self.balance_actual
            return "No hay datos anteriores para calcular el costo (primer registro tomado)."

        balance_previo = self.balance_anterior
        self.obtener_balance_deepgram()
        balance_nuevo = self.balance_actual

        costo_usd = balance_previo - balance_nuevo
        costo_cop = round(costo_usd * tasa_dolar_a_cop)

        if costo_usd < 0:
            return "Error: el costo calculado es negativo. Verifica el flujo de llamadas."

        messagebox.showinfo(
            "Costo de la transcripción",
            f"El costo de esta transcripción fue de: {costo_usd:.2f} USD / ${costo_cop:,} COP"
        )
        return f"🧾 Costo de la transcripción: {costo_usd:.2f} USD / ${costo_cop:,} COP"

    # ---------- GIF ----------
    def _cargar_frames_gif(self):
        try:
            imagen = Image.open(self.gif_path)
            self._gif_frames = []
            while True:
                frame = imagen.copy().convert("RGBA").resize((84, 84), Image.LANCZOS)
                self._gif_frames.append(ImageTk.PhotoImage(frame))
                imagen.seek(len(self._gif_frames))
        except EOFError:
            pass

    def _mostrar_gif(self):
        if not self._gif_loaded:
            return
        if not hasattr(self, "_gif_frames") or not self._gif_frames:
            self._cargar_frames_gif()
        self._gif_index = 0
        self._animar_gif()

    def _animar_gif(self):
        if not hasattr(self, "_gif_frames") or not self._gif_frames:
            return
        frame = self._gif_frames[self._gif_index]
        self.gif_label.configure(image=frame)
        self.gif_label.image = frame
        self._gif_index = (self._gif_index + 1) % len(self._gif_frames)
        self._gif_job = self.after(100, self._animar_gif)

    def _ocultar_gif(self):
        if self._gif_job:
            self.after_cancel(self._gif_job)
            self._gif_job = None
        self.gif_label.configure(image=None)
        self.gif_label.image = None
