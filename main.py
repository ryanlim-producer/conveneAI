import ctypes
import json
import os
import platform

import customtkinter as ctk
import tkinter as tk  # Necesario para Menu
from tkinter import messagebox
from screeninfo import get_monitors

from VentanaKeys import VentanaLicencia
from VentanaPrincipal import ConveneAIApp
import utils
from PIL import Image

# Configuración del tema
ctk.set_appearance_mode("light")
ctk.set_default_color_theme("blue")

# Lista de licencias válidas
LICENCIAS_VALIDAS = [
    "A7X4D9-KLM3Q2-Z8N6YP",
    "P3W9XK-8JDLQ1-R2M4VT",
    "QZ8C1B-MN4V7E-5TPR6X"
]

ventana_licencia = None
ventana_registro_equipo = None

def traer_ventana_al_frente(ventana, modal=True):
    """Función para traer una ventana al frente de manera robusta"""
    try:
        ventana.deiconify()
        ventana.lift()
        ventana.attributes('-topmost', True)
        ventana.focus_force()
        if modal:
            ventana.grab_set()
        ventana.after(100, lambda: ventana.attributes('-topmost', False))
    except:
        pass

def mostrar_ventana_licencia(root):
    """Abrir ventana para registrar SOLO la clave de Deepgram"""
    global ventana_licencia
    if ventana_licencia is not None and ventana_licencia.winfo_exists():
        traer_ventana_al_frente(ventana_licencia, modal=False)
    else:
        # ⬇️ AHORA SOLO PASAMOS LA CLAVE DE DEEPGRAM
        ventana_licencia = VentanaLicencia(root, utils.DEEPGRAM_API_KEY)

        # Cierre seguro
        original_destroy = ventana_licencia.destroy
        def safe_destroy():
            try:
                ventana_licencia.grab_release()
            except:
                pass
            original_destroy()
        ventana_licencia.destroy = safe_destroy
        ventana_licencia.protocol("WM_DELETE_WINDOW", safe_destroy)

        traer_ventana_al_frente(ventana_licencia, modal=False)

ARCHIVO_ESTADO_LICENCIA = "estado_licencia.json"

def validar_keys():
    """AHORA solo exige Deepgram"""
    if not utils.DEEPGRAM_API_KEY:
        messagebox.showerror("Claves API inválidas", "❌ Falta configurar la clave de Deepgram.")
        return False
    return True

# ✅ Verificar si la licencia ingresada está en la lista
def verificar_licencia(clave_ingresada):
    return clave_ingresada in LICENCIAS_VALIDAS

# ✅ Guardar en archivo local que la licencia fue aceptada
def guardar_licencia_valida():
    try:
        with open(ARCHIVO_ESTADO_LICENCIA, "w") as f:
            json.dump({"licencia_valida": True}, f)
    except Exception as e:
        messagebox.showerror("Error", f"No se pudo guardar el estado de licencia:\n{e}")

# ✅ Verificar si ya hay una licencia registrada válida
def licencia_ya_registrada():
    if os.path.exists(ARCHIVO_ESTADO_LICENCIA):
        try:
            with open(ARCHIVO_ESTADO_LICENCIA, "r") as f:
                data = json.load(f)
                return data.get("licencia_valida", False)
        except:
            return False
    return False

def validar_licencia(self):
    clave = self.entry_licencia.get().strip()
    if verificar_licencia(clave):
        guardar_licencia_valida()
        messagebox.showinfo("✅ Licencia válida", "La licencia fue aceptada.")
        self.destroy()
    else:
        messagebox.showerror("❌ Licencia inválida", "La licencia no es válida.")

# ✅ Lógica para iniciar app solo si ya hay licencia
def iniciar_si_hay_licencia(root):
    if licencia_ya_registrada():
        iniciar_conveneai(root)
    else:
        messagebox.showwarning("Licencia Requerida", "⚠️ Debe ingresar una licencia válida.")
        VentanaLicencia(root)

def mostrar_ventana_registro_equipo(root):
    global ventana_registro_equipo
    if ventana_registro_equipo is not None and ventana_registro_equipo.winfo_exists():
        traer_ventana_al_frente(ventana_registro_equipo, modal=True)
    else:
        ventana_registro_equipo = ctk.CTkToplevel(root)
        ventana_registro_equipo.title("Registrar Equipo")
        ico_path = utils.ruta_absoluta("media/logo.ico")
        if os.path.exists(ico_path):
            try:
                ventana_registro_equipo.iconbitmap(ico_path)
            except Exception:
                pass
        ventana_registro_equipo.geometry("400x200")
        ventana_registro_equipo.resizable(False, False)

        centrar_ctk(ventana_registro_equipo, 200, 400)

        ventana_registro_equipo.transient(root)
        ventana_registro_equipo.grab_set()

        label_titulo = ctk.CTkLabel(
            ventana_registro_equipo,
            text="Ingrese su clave de licencia:",
            font=ctk.CTkFont(size=14, weight="bold")
        )
        label_titulo.pack(pady=20)

        entry_clave = ctk.CTkEntry(
            ventana_registro_equipo,
            font=ctk.CTkFont(size=12),
            width=300,
            height=35,
            placeholder_text="Ingrese su clave de licencia"
        )
        entry_clave.pack(pady=10)

        def registrar():
            clave = entry_clave.get()
            if verificar_licencia(clave):
                guardar_licencia_valida()
                messagebox.showinfo("Licencia válida", "✅ Licencia válida. Equipo registrado.")
                ventana_registro_equipo.grab_release()
                ventana_registro_equipo.destroy()
            else:
                messagebox.showerror("Licencia inválida", "❌ La clave de licencia no es válida.")

        def cerrar_ventana():
            ventana_registro_equipo.grab_release()
            ventana_registro_equipo.destroy()

        btn_registrar = ctk.CTkButton(
            ventana_registro_equipo,
            text="Registrar",
            font=ctk.CTkFont(size=12, weight="bold"),
            width=150,
            height=35,
            command=registrar
        )
        btn_registrar.pack(pady=20)

        ventana_registro_equipo.protocol("WM_DELETE_WINDOW", cerrar_ventana)
        ventana_registro_equipo.after(10, lambda: traer_ventana_al_frente(ventana_registro_equipo, modal=True))

def obtener_resolucion_windows():
    if platform.system() != "Windows":
        return 1440, 900  # default fallback for macOS/Linux
    user32 = ctypes.windll.user32
    return user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)

def centrar_ctk(win, alto, ancho):
    win.update_idletasks()

    # Márgenes de la ventana
    border_x = win.winfo_rootx() - win.winfo_x()
    border_y = win.winfo_rooty() - win.winfo_y()

    # Corrección para bordes en CustomTkinter
    border_x_corrected = int(border_x * 1.5)

    # Resolución del monitor principal
    monitor = get_monitors()[0]
    screen_width = monitor.width
    screen_height = monitor.height

    # Calcular posición centrada
    x = (screen_width // 2) - ((ancho + border_x_corrected) // 2)
    y = (screen_height // 2) - ((alto + border_y + border_x_corrected // 2) // 2)

    # Aplicar tamaño y posición
    win.geometry(f"{ancho}x{alto}+{x}+{y}")
    win.update()

def iniciar_conveneai(root):
    if not licencia_ya_registrada():
        messagebox.showwarning("Licencia requerida", "⚠️ Debe ingresar una licencia válida antes de continuar.")
        root.after(100, lambda: mostrar_ventana_registro_equipo(root))
        return

    if not validar_keys():
        root.after(100, lambda: mostrar_ventana_licencia(root))  # VentanaLicencia (solo Deepgram)
        return

    root.destroy()

    # ⬇️ AHORA LA APP SOLO RECIBE LA CLAVE DE DEEPGRAM
    app = ConveneAIApp(utils.DEEPGRAM_API_KEY)
    app.mainloop()

def crear_ventana_principal():
    root = ctk.CTk()
    root.title("conveneAI")

    # Crear menú
    menubar = tk.Menu(root)
    root.config(menu=menubar)
    root.geometry("400x500")
    _ = obtener_resolucion_windows()

    root.after(200, lambda: centrar_ctk(root, 400, 500))

    ico_path = utils.ruta_absoluta("media/logo.ico")
    if os.path.exists(ico_path):
        try:
            root.iconbitmap(ico_path)
        except Exception:
            pass

    menu_opciones = tk.Menu(menubar, tearoff=0)
    menubar.add_cascade(label="Opciones", menu=menu_opciones)
    menu_opciones.add_command(label="Registrar Licencia", command=lambda: mostrar_ventana_licencia(root))
    menu_opciones.add_command(label="Registrar Equipo", command=lambda: mostrar_ventana_registro_equipo(root))
    menu_opciones.add_separator()
    menu_opciones.add_command(label="Salir", command=root.quit)

    # Frame principal
    main_frame = ctk.CTkFrame(root)
    main_frame.pack(fill="both", expand=True, padx=20, pady=20)

    # Imagen
    try:
        ruta_imagen = os.path.join("media", "icono.png")
        image = Image.open(ruta_imagen).resize((110, 110))
        ctk_img = ctk.CTkImage(light_image=image, dark_image=image, size=(110, 110))
        label_img = ctk.CTkLabel(main_frame, image=ctk_img, text="")
        label_img.image = ctk_img
        label_img.pack(pady=(50, 15))
    except Exception as e:
        print(f"❌ Error al cargar imagen: {e}")

    # Botón principal
    btn_iniciar = ctk.CTkButton(
        main_frame,
        text="Iniciar Aplicación",
        font=ctk.CTkFont(size=18, weight="bold"),
        width=250,
        height=60,
        command=lambda: iniciar_conveneai(root)
    )
    btn_iniciar.pack(pady=18)

    # Info
    info_label = ctk.CTkLabel(
        main_frame,
        text="Asegúrese de tener una licencia válida antes de iniciar la aplicación",
        font=ctk.CTkFont(size=10),
        text_color="black"
    )
    info_label.pack(pady=(10, 20))

    root.resizable(False, False)
    root.mainloop()

if __name__ == "__main__":
    utils.descifrar_y_extraer_claves()  # Debe cargar solo deepgram_api_key
    utils.reproducir_sonido("inicio")
    crear_ventana_principal()
