#!/usr/bin/env python3
"""Large transparent software cursor for VNC desks (phone PiP–visible).

Xvfb runs 24-bit without a compositor, so RGBA windows still look boxed.
We shape-combine the window to the PNG alpha mask (XShape) so only the
arrow is visible — no black/green chrome.
"""
from __future__ import annotations

import base64
import os
import subprocess
import sys

CURSOR_PNG_B64 = """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"""


def mouse_pos() -> tuple[int, int]:
    try:
        out = subprocess.check_output(
            ["xdotool", "getmouselocation", "--shell"],
            text=True,
            timeout=1,
        )
        x = y = 0
        for line in out.splitlines():
            if line.startswith("X="):
                x = int(line.split("=", 1)[1])
            elif line.startswith("Y="):
                y = int(line.split("=", 1)[1])
        return x, y
    except Exception:
        return 0, 0


def write_cursor_png() -> str:
    path = os.environ.get("SOFT_CURSOR_PNG", "/tmp/cu/cursor-arrow.png")
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "wb") as f:
        f.write(base64.b64decode(CURSOR_PNG_B64))
    return path


def run_gtk_shaped(png_path: str) -> None:
    import gi

    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gtk, Gdk, GLib, GdkPixbuf  # type: ignore

    pixbuf = GdkPixbuf.Pixbuf.new_from_file(png_path)
    if pixbuf is None:
        raise RuntimeError("failed to load cursor png")

    win = Gtk.Window(type=Gtk.WindowType.POPUP)
    win.set_decorated(False)
    win.set_keep_above(True)
    win.set_accept_focus(False)
    win.set_skip_taskbar_hint(True)
    win.set_skip_pager_hint(True)
    win.set_resizable(False)
    try:
        win.set_type_hint(Gdk.WindowTypeHint.NOTIFICATION)
    except Exception:
        pass

    # Prefer RGBA when available; XShape still does the real punch-out.
    screen = Gdk.Screen.get_default()
    if screen is not None:
        visual = screen.get_rgba_visual()
        if visual is not None:
            win.set_visual(visual)
            win.set_app_paintable(True)

    img = Gtk.Image.new_from_pixbuf(pixbuf)
    win.add(img)

    # Hotspot near tip (top-left of asset, padded)
    hot_x, hot_y = 8, 8

    def apply_shape(_widget=None) -> None:
        gdk_win = win.get_window()
        if gdk_win is None:
            return
        # Build a region from non-transparent pixels
        try:
            surface = Gdk.cairo_surface_create_from_pixbuf(pixbuf, 1, gdk_win)
            region = Gdk.cairo_region_create_from_surface(surface)
            gdk_win.shape_combine_region(region, 0, 0)
            # Also shape input so clicks pass through transparent areas
            try:
                gdk_win.input_shape_combine_region(region, 0, 0)
            except Exception:
                pass
        except Exception as exc:
            sys.stderr.write(f"soft-cursor: shape failed ({exc!r})\n")

    def on_realize(_widget) -> None:
        apply_shape()

    win.connect("realize", on_realize)

    def tick() -> bool:
        x, y = mouse_pos()
        win.move(max(0, x - hot_x), max(0, y - hot_y))
        return True

    win.show_all()
    # Re-apply after map (some WMs ignore pre-map shape)
    GLib.idle_add(apply_shape)
    GLib.timeout_add(33, tick)
    Gtk.main()


def run_tk_shaped(png_path: str) -> None:
    """Tk + python-xlib XShape mask from PNG alpha."""
    import tkinter as tk
    from PIL import Image  # type: ignore
    from Xlib import X, display  # type: ignore
    from Xlib.ext import shape  # type: ignore

    im = Image.open(png_path).convert("RGBA")
    w, h = im.size
    # 1-bit mask: opaque where alpha > 32
    mask_bits = bytearray()
    # XBM: row padded to 8 bits, LSB first
    for y in range(h):
        row = 0
        bit = 0
        for x in range(w):
            a = im.getpixel((x, y))[3]
            if a > 32:
                row |= 1 << bit
            bit += 1
            if bit == 8:
                mask_bits.append(row)
                row = 0
                bit = 0
        if bit:
            mask_bits.append(row)

    root = tk.Tk()
    root.overrideredirect(True)
    try:
        root.attributes("-topmost", True)
    except tk.TclError:
        pass
    photo = tk.PhotoImage(file=png_path)
    lbl = tk.Label(root, image=photo, borderwidth=0, highlightthickness=0, bg="#010101")
    lbl.image = photo  # type: ignore[attr-defined]
    lbl.pack()
    root.geometry(f"{w}x{h}+0+0")
    root.update_idletasks()
    root.update()

    d = display.Display()
    xw = d.create_resource_object("window", root.winfo_id())
    pixmap = xw.create_pixmap(w, h, 1)
    gc = pixmap.create_gc(foreground=0, background=0)
    # clear
    pixmap.fill_rectangle(gc, 0, 0, w, h)
    gc.change(foreground=1)
    # Put image: use ZPixmap via put_image
    from Xlib.protocol import request  # noqa: F401
    pixmap.put_image(gc, 0, 0, w, h, X.XYBitmap, 0, 0, bytes(mask_bits))
    xw.shape_mask(shape.SO.Set, shape.SK.Bounding, 0, 0, pixmap)
    try:
        xw.shape_mask(shape.SO.Set, shape.SK.Input, 0, 0, pixmap)
    except Exception:
        pass
    d.sync()

    hot_x, hot_y = 8, 8

    def tick() -> None:
        x, y = mouse_pos()
        root.geometry(f"{w}x{h}+{max(0, x - hot_x)}+{max(0, y - hot_y)}")
        root.lift()
        root.after(33, tick)

    tick()
    root.mainloop()


def main() -> None:
    os.environ.setdefault("DISPLAY", ":99")
    png_path = write_cursor_png()
    try:
        run_gtk_shaped(png_path)
        return
    except Exception as exc:
        sys.stderr.write(f"soft-cursor: gtk shaped failed ({exc!r}); trying tk+xlib\n")
    try:
        run_tk_shaped(png_path)
    except Exception as exc:
        sys.stderr.write(f"soft-cursor: fatal {exc!r}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
