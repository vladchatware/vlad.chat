#!/usr/bin/env python3
"""Large shaped software cursor for VNC desks (phone-PiP visible).

Xvfb is 24-bit without a compositor, so we XShape the window to the
arrow silhouette — no black box. Drawn with Cairo (no PNG/glycin).
"""
from __future__ import annotations

import os
import subprocess
import sys

# Arrow polygon in local coords (tip near 0,0). Scaled up for PiP.
# Base path ~ classic pointer; SCALE makes it ~200px tall.
SCALE = float(os.environ.get("SOFT_CURSOR_SCALE", "7.0"))
BASE = [(2, 2), (2, 34), (10, 26), (16, 40), (22, 37), (14, 24), (28, 24)]
PAD = 10


def pts_scaled():
    return [(PAD + x * SCALE, PAD + y * SCALE) for x, y in BASE]


def size_wh():
    pts = pts_scaled()
    w = int(max(p[0] for p in pts) + PAD + 8)
    h = int(max(p[1] for p in pts) + PAD + 8)
    return w, h


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


def draw_arrow(cr, fill=(1.0, 0.17, 0.84), outline=(1, 1, 1), outline_w=3.0):
    pts = pts_scaled()
    cr.new_path()
    cr.move_to(*pts[0])
    for p in pts[1:]:
        cr.line_to(*p)
    cr.close_path()
    # white outline via stroke under fill
    cr.set_source_rgb(*outline)
    cr.set_line_width(outline_w * (SCALE / 4.0))
    cr.set_line_join(1)  # ROUND
    cr.stroke_preserve()
    cr.set_source_rgb(*fill)
    cr.fill()


def run_gtk() -> None:
    import gi
    import cairo

    gi.require_version("Gtk", "3.0")
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gtk, Gdk, GLib  # type: ignore

    w, h = size_wh()
    win = Gtk.Window(type=Gtk.WindowType.POPUP)
    win.set_decorated(False)
    win.set_keep_above(True)
    win.set_accept_focus(False)
    win.set_skip_taskbar_hint(True)
    win.set_skip_pager_hint(True)
    win.set_app_paintable(True)
    win.set_size_request(w, h)
    try:
        win.set_type_hint(Gdk.WindowTypeHint.NOTIFICATION)
    except Exception:
        pass

    screen = Gdk.Screen.get_default()
    if screen is not None:
        visual = screen.get_rgba_visual() or screen.get_system_visual()
        if visual is not None:
            win.set_visual(visual)

    da = Gtk.DrawingArea()
    da.set_size_request(w, h)
    win.add(da)

    def on_draw(_widget, cr):
        cr.set_operator(cairo.OPERATOR_SOURCE)
        cr.set_source_rgba(0, 0, 0, 0)
        cr.paint()
        cr.set_operator(cairo.OPERATOR_OVER)
        # soft shadow
        cr.save()
        cr.translate(3, 4)
        draw_arrow(cr, fill=(0, 0, 0), outline=(0, 0, 0), outline_w=1.0)
        cr.set_source_rgba(0, 0, 0, 0.35)
        # redraw shadow as translucent: clip already filled black — use paint trick
        cr.restore()
        # actual arrow
        draw_arrow(cr)
        return False

    da.connect("draw", on_draw)

    def apply_shape(_=None) -> bool:
        gdk_win = win.get_window()
        if gdk_win is None:
            return False
        surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, w, h)
        cr = cairo.Context(surface)
        cr.set_operator(cairo.OPERATOR_SOURCE)
        cr.set_source_rgba(0, 0, 0, 0)
        cr.paint()
        cr.set_operator(cairo.OPERATOR_OVER)
        draw_arrow(cr)
        # fatten mask slightly so outline is included
        region = Gdk.cairo_region_create_from_surface(surface)
        gdk_win.shape_combine_region(region, 0, 0)
        try:
            gdk_win.input_shape_combine_region(region, 0, 0)
        except Exception:
            pass
        return False

    def on_realize(_widget):
        GLib.idle_add(apply_shape)

    win.connect("realize", on_realize)
    hot_x, hot_y = int(PAD + 2 * SCALE * 0.15), int(PAD + 2 * SCALE * 0.15)

    def tick() -> bool:
        x, y = mouse_pos()
        win.move(max(0, x - hot_x), max(0, y - hot_y))
        return True

    win.show_all()
    GLib.idle_add(apply_shape)
    GLib.timeout_add(33, tick)
    Gtk.main()


def run_tk_canvas() -> None:
    """Fallback: Tk canvas arrow + transparentcolor green (best-effort)."""
    import tkinter as tk

    w, h = size_wh()
    root = tk.Tk()
    root.overrideredirect(True)
    try:
        root.attributes("-topmost", True)
    except tk.TclError:
        pass
    try:
        root.attributes("-transparentcolor", "#00ff00")
    except tk.TclError:
        pass
    c = tk.Canvas(root, width=w, height=h, highlightthickness=0, bg="#00ff00", bd=0)
    c.pack()
    pts = [coord for p in pts_scaled() for coord in p]
    # shadow
    sp = [pts[i] + (3 if i % 2 == 0 else 4) for i in range(len(pts))]
    c.create_polygon(sp, fill="#333333", outline="")
    c.create_polygon(pts, fill="#ff2bd6", outline="#ffffff", width=max(2, int(SCALE / 2)))
    hot_x = int(PAD + 1)
    hot_y = int(PAD + 1)

    def tick() -> None:
        x, y = mouse_pos()
        root.geometry(f"{w}x{h}+{max(0, x - hot_x)}+{max(0, y - hot_y)}")
        root.lift()
        root.after(33, tick)

    tick()
    root.mainloop()


def main() -> None:
    os.environ.setdefault("DISPLAY", ":99")
    try:
        run_gtk()
        return
    except Exception as exc:
        sys.stderr.write(f"soft-cursor: gtk failed ({exc!r}); trying tk\n")
    try:
        run_tk_canvas()
    except Exception as exc:
        sys.stderr.write(f"soft-cursor: fatal {exc!r}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
