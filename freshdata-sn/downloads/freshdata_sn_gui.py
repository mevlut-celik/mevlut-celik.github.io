import tkinter as tk
from tkinter import ttk, messagebox

CROCKFORD32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def normalize_deveui(deveui: str) -> str:
    deveui = (
        deveui.replace(":", "")
        .replace("-", "")
        .replace(" ", "")
        .upper()
    )

    if len(deveui) != 16:
        raise ValueError("DevEUI 16 hexadecimal karakter olmalı.")

    try:
        int(deveui, 16)
    except ValueError:
        raise ValueError("DevEUI yalnızca 0-9 ve A-F karakterlerinden oluşmalı.")

    return deveui


def deveui_to_sn(deveui: str, product: str) -> str:
    deveui = normalize_deveui(deveui)
    number = int(deveui, 16)

    encoded = ""
    if number == 0:
        encoded = "0"
    else:
        while number > 0:
            number, remainder = divmod(number, 32)
            encoded = CROCKFORD32[remainder] + encoded

    encoded = encoded.rjust(13, "0")

    prefix = "RLY" if product == "Relay" else "EXT"
    return f"{prefix}-{encoded}"


def generate_sn(event=None):
    try:
        sn = deveui_to_sn(deveui_var.get(), product_var.get())
        result_var.set(sn)
        status_var.set("S/N oluşturuldu.")
    except ValueError as e:
        result_var.set("")
        status_var.set("")
        messagebox.showerror("Hatalı DevEUI", str(e))


def copy_sn():
    sn = result_var.get().strip()

    if not sn:
        messagebox.showwarning("Uyarı", "Önce bir seri numarası oluşturun.")
        return

    root.clipboard_clear()
    root.clipboard_append(sn)
    root.update()
    status_var.set("S/N panoya kopyalandı.")


def clear_all():
    deveui_var.set("")
    result_var.set("")
    status_var.set("")
    deveui_entry.focus_set()


root = tk.Tk()
root.title("FRESHDATA S/N Generator")
root.geometry("520x320")
root.resizable(False, False)

main = ttk.Frame(root, padding=24)
main.pack(fill="both", expand=True)

title = ttk.Label(
    main,
    text="FRESHDATA S/N Generator",
    font=("Arial", 18, "bold")
)
title.pack(anchor="w", pady=(0, 20))

product_frame = ttk.Frame(main)
product_frame.pack(fill="x", pady=5)

ttk.Label(product_frame, text="Cihaz:").pack(side="left")

product_var = tk.StringVar(value="Relay")
product_box = ttk.Combobox(
    product_frame,
    textvariable=product_var,
    values=["Relay", "Extender"],
    state="readonly",
    width=15
)
product_box.pack(side="left", padx=(15, 0))

ttk.Label(main, text="DevEUI:").pack(anchor="w", pady=(16, 5))

deveui_var = tk.StringVar()
deveui_entry = ttk.Entry(
    main,
    textvariable=deveui_var,
    font=("Courier New", 14)
)
deveui_entry.pack(fill="x")
deveui_entry.bind("<Return>", generate_sn)

example = ttk.Label(
    main,
    text="Örnek: 00:16:C0:01:F0:08:60:69",
    foreground="#666666"
)
example.pack(anchor="w", pady=(4, 15))

button_frame = ttk.Frame(main)
button_frame.pack(fill="x")

ttk.Button(
    button_frame,
    text="S/N Oluştur",
    command=generate_sn
).pack(side="left")

ttk.Button(
    button_frame,
    text="Temizle",
    command=clear_all
).pack(side="left", padx=8)

ttk.Label(main, text="Serial Number:").pack(anchor="w", pady=(22, 5))

result_var = tk.StringVar()

result_entry = ttk.Entry(
    main,
    textvariable=result_var,
    state="readonly",
    font=("Courier New", 16, "bold")
)
result_entry.pack(fill="x")

ttk.Button(
    main,
    text="Kopyala",
    command=copy_sn
).pack(anchor="e", pady=(8, 0))

status_var = tk.StringVar()
status_label = ttk.Label(
    main,
    textvariable=status_var,
    foreground="#555555"
)
status_label.pack(anchor="w", pady=(10, 0))

deveui_entry.focus_set()
root.mainloop()
