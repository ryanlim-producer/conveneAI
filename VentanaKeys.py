# VentanaKeys.py
import os
import requests
import customtkinter as ctk
from tkinter import messagebox

import utils
from utils import guardar_claves_cifradas, validar_api_key_deepgram


class VentanaLicencia(ctk.CTkToplevel):
    """
    Ventana modal para registrar SOLO la API Key de Deepgram.
    - Elimina por completo OpenRouter en este flujo.
    - Cifra y persiste en config.json.cif.
    """

    def __init__(self, root, deepgram_key: str | None = None):
        super().__init__(root)

        self.title("Registrar Licencia — Deepgram")
        self.geometry("500x200")
        self.resizable(False, False)
        self.center_window()

        # Icono (opcional)
        try:
            ico_path = utils.ruta_absoluta("media/logo.ico")
            if os.path.exists(ico_path):
                self.iconbitmap(ico_path)
        except Exception:
            pass

        ctk.set_appearance_mode("light")
        ctk.set_default_color_theme("blue")

        # ---- Deepgram API Key ----
        ctk.CTkLabel(self, text="Deepgram API Key:").pack(pady=(15, 5))
        frame_deepgram = ctk.CTkFrame(self, fg_color="transparent")
        frame_deepgram.pack(pady=5, padx=10, fill="x")

        self.entry_deepgram = ctk.CTkEntry(frame_deepgram, show="*", width=360)
        # Prefill con la que ya exista en ENV/archivo/global si no nos pasaron arg
        if deepgram_key:
            self.entry_deepgram.insert(0, deepgram_key)
        else:
            prior = utils.obtener_deepgram_key_prioritaria()
            if prior:
                self.entry_deepgram.insert(0, prior)
        self.entry_deepgram.pack(side="left", padx=(0, 10), expand=True, fill="x")

        self.show_deepgram = ctk.CTkCheckBox(
            frame_deepgram, text="👁", command=self.toggle_deepgram_visibility, width=30
        )
        self.show_deepgram.pack(side="left")

        # Botón guardar
        ctk.CTkButton(self, text="Guardar Clave", command=self.guardar_key, width=200).pack(pady=25)

        self.protocol("WM_DELETE_WINDOW", lambda: self.withdraw())

    def toggle_deepgram_visibility(self):
        self.entry_deepgram.configure(show="" if self.show_deepgram.get() else "*")

    def guardar_key(self):
        deepgram_key = self.entry_deepgram.get().strip()
        if not deepgram_key:
            messagebox.showerror("Error", "Por favor ingresa la clave de Deepgram.")
            return

        if not validar_api_key_deepgram(deepgram_key):
            messagebox.showerror("Error", "La clave de Deepgram no es válida o no se pudo validar.")
            return

        ok = guardar_claves_cifradas(deepgram_key)
        if not ok:
            messagebox.showerror("Error", "No se pudo guardar el archivo cifrado.")
            return

        utils.DEEPGRAM_API_KEY = deepgram_key
        messagebox.showinfo("Guardado", "La clave de Deepgram ha sido guardada correctamente.")
        self.destroy()

    def center_window(self):
        self.update_idletasks()
        width = self.winfo_width() or 500
        height = self.winfo_height() or 200
        x = (self.winfo_screenwidth() // 2) - (width // 2)
        y = (self.winfo_screenheight() // 2) - (height // 2)
        self.geometry(f"{width}x{height}+{x}+{y}")
