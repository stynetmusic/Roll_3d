"""Roll_3d — офлайн-смета рольставенного шкафа. Только Windows 10 и 11, 64-bit."""

from __future__ import annotations

import struct
import sys

import db
from paths import log_exception, web_index


def _run() -> None:
    if sys.platform != "win32":
        sys.stderr.write("Roll_3d запускается только на Windows 10 и 11, 64-bit.\n")
        raise SystemExit(1)
    if struct.calcsize("P") != 8:
        sys.stderr.write(
            "Нужен 64-bit Python. Установите Windows installer (64-bit) с python.org.\n"
        )
        raise SystemExit(1)

    import webview

    from api import Api

    index = web_index()
    if not index.is_file():
        sys.stderr.write(f"Не найден интерфейс: {index}\n")
        raise SystemExit(1)

    webview.settings["SHOW_DEFAULT_MENUS"] = False
    webview.create_window(
        "Roll_3d",
        url=str(index),
        js_api=Api(),
        width=1440,
        height=900,
        min_size=(1100, 700),
        background_color="#121418",
        text_select=True,
        zoomable=False,
        confirm_close=False,
    )
    try:
        webview.start(http_server=True, debug=False, private_mode=True)
    finally:
        db.close()


def main() -> None:
    try:
        _run()
    except SystemExit:
        raise
    except Exception:
        log_exception()
        sys.stderr.write("Roll_3d не запустился. Подробности в data\\roll_3d.log\n")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
