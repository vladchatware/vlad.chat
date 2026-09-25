#!/usr/bin/env python3
"""Always-on-top software cursor for VNC desks where the X cursor is invisible."""
from __future__ import annotations

import os
import subprocess
import sys
import time

# Prefer Tk overlay (visible in framebuffer). Fallback: exit non-zero.
try:
    import tkinter as tk
except ImportError:
    sys.stderr.write("soft-cursor: tkinter missing\n")
    sys.exit(2)


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


def main() -> None:
    os.environ.setdefault("DISPLAY", ":99")
    root = tk.Tk()
    root.title("cua-soft-cursor")
    root.overrideredirect(True)
    try:
        root.attributes("-topmost", True)
    except tk.TclError:
        pass
    # Punch out black so VNC shows only the magenta arrow (best-effort on X11).
    try:
        root.attributes("-transparentcolor", "#111111")
    except tk.TclError:
        pass
    # Magenta arrow on black — high contrast on any page
    w, h = 36, 44
    root.geometry(f"{w}x{h}+0+0")
    c = tk.Canvas(root, width=w, height=h, highlightthickness=0, bg="#111111")
    c.pack()
    # Classic pointer polygon (hotspot near tip)
    tip = (2, 2)
    pts = [2, 2, 2, 34, 10, 26, 16, 40, 22, 37, 14, 24, 28, 24]
    c.create_polygon(pts, fill="#ff2bd6", outline="#ffffff", width=2)
    c.create_oval(tip[0], tip[1], tip[0] + 4, tip[1] + 4, fill="#ffffff", outline="")

    def tick() -> None:
        x, y = mouse_pos()
        # Place so tip ≈ pointer hotspot
        root.geometry(f"{w}x{h}+{max(0, x)}+{max(0, y)}")
        root.lift()
        root.after(33, tick)  # ~30 fps

    tick()
    root.mainloop()


if __name__ == "__main__":
    main()
