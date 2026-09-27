"""Roll_3d — офлайн-смета рольставенного шкафа для Windows."""

from __future__ import annotations

import traceback

import db
from paths import report_error, web_index


def _run() -> None:
    import sys

    if sys.platform != "win32":
        report_error("Roll_3d запускается только на Windows.")
        raise SystemExit(1)

    import webview

    from api import Api

    index = web_index()
    if not index.is_file():
        report_error(f"Не найден интерфейс: {index}")
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
    import os
    import sys

    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")
    try:
        _run()
    except SystemExit:
        raise
    except Exception:
        report_error(traceback.format_exc())
        raise SystemExit(1)


if __name__ == "__main__":
    main()
