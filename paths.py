"""Пути программы: база рядом с exe, интерфейс — из пакета сборки."""

from __future__ import annotations

import sys
import traceback
from datetime import datetime
from pathlib import Path

_log_dir: Path | None = None


def app_dir() -> Path:
    """Папка с exe или с исходниками. Сюда кладутся xlsx и data/."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def web_index() -> Path:
    """index.html. В сборке PyInstaller он лежит во временной папке _MEIPASS, не рядом с exe."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        root = Path(sys._MEIPASS)
    else:
        root = Path(__file__).resolve().parent
    return root / "web" / "index.html"


def set_log_dir(path: Path | None) -> None:
    global _log_dir
    _log_dir = None if path is None else Path(path)


def log_exception() -> None:
    folder = _log_dir if _log_dir is not None else app_dir() / "data"
    try:
        folder.mkdir(parents=True, exist_ok=True)
        with (folder / "roll_3d.log").open("a", encoding="utf-8") as handle:
            handle.write("\n--- " + datetime.now().isoformat(timespec="seconds") + " ---\n")
            traceback.print_exc(file=handle)
    except OSError:
        traceback.print_exc()
