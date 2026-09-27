"""Методы, которые вызывает окно. Диалоги файлов открываются только по кнопке."""

from __future__ import annotations

import re
from pathlib import Path

import db
import xlsx_io
from db import AppError
from paths import app_dir, log_exception


def _call(fn):
    try:
        data = fn()
        if isinstance(data, dict):
            return {"ok": True, **data}
        return {"ok": True}
    except AppError as exc:
        return {"ok": False, "error": str(exc)}
    except Exception:
        log_exception()
        return {
            "ok": False,
            "error": "Внутренняя ошибка. Подробности записаны в data\\roll_3d.log",
        }


def _safe_filename(name: str, fallback: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*]', " ", name or "").strip().rstrip(".")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return (cleaned or fallback)[:80]


def _xlsx_path(chosen: str) -> Path:
    path = Path(chosen)
    if path.suffix.lower() != ".xlsx":
        path = path.with_suffix(".xlsx")
    if not path.parent.exists():
        raise AppError("Папка для файла не найдена.")
    return path


def _window():
    import webview

    if not webview.windows:
        raise AppError("Окно программы ещё не готово.")
    return webview


class Api:
    def bootstrap(self):
        def run():
            seed = db.seed_price_files()
            return {
                "unit_labels": db.get_unit_labels(),
                "part_prefixes": db.get_part_prefixes(),
                "price_lists": db.list_price_lists(),
                "active_price_list_id": db.active_id(),
                "estimate": db.next_estimate_defaults()["estimate"],
                "seed": seed,
            }

        return _call(run)

    def search_items(self, params):
        def run():
            payload = params or {}
            list_id = payload.get("price_list_id") or db.active_id()
            if not list_id:
                raise AppError("Нет активного прайса.")
            return db.search_items(
                list_id,
                payload.get("query") or "",
                payload.get("prefix") or "",
                payload.get("show_zero"),
                payload.get("offset") or 0,
                payload.get("limit") or 200,
            )

        return _call(run)

    def set_active_price_list(self, price_list_id):
        return _call(lambda: db.set_active_price_list(price_list_id))

    def set_item_price(self, item_id, price):
        return _call(lambda: db.set_item_price(item_id, price))

    def reset_item_price(self, item_id):
        return _call(lambda: db.reset_item_price(item_id))

    def replace_user_prices(self, price_list_id):
        return _call(lambda: db.replace_user_prices(price_list_id))

    def save_settings(self, params):
        return _call(lambda: db.save_settings(params or {}))

    def save_estimate(self, estimate):
        return _call(lambda: db.save_estimate(estimate or {}))

    def list_estimates(self):
        return _call(db.list_estimates)

    def load_estimate(self, estimate_id):
        return _call(lambda: db.load_estimate(estimate_id))

    def delete_estimate(self, estimate_id):
        return _call(lambda: db.delete_estimate(estimate_id))

    def next_estimate_defaults(self):
        return _call(db.next_estimate_defaults)

    def import_price_dialog(self):
        def run():
            webview = _window()
            chosen = webview.windows[0].create_file_dialog(
                webview.FileDialog.OPEN,
                directory=str(app_dir()),
                allow_multiple=False,
                file_types=("Excel (*.xlsx)",),
            )
            if not chosen:
                return {"cancelled": True}
            info = db.import_pgi_file(chosen[0], make_active=False)
            return {
                "cancelled": False,
                "price_list": info,
                "price_lists": db.list_price_lists(),
                "active_price_list_id": db.active_id(),
            }

        return _call(run)

    def export_price_dialog(self, price_list_id):
        def run():
            price_list = db.get_price_list(int(price_list_id))
            webview = _window()
            chosen = webview.windows[0].create_file_dialog(
                webview.FileDialog.SAVE,
                directory=str(app_dir()),
                save_filename=_safe_filename(price_list["name"], "Прайс") + ".xlsx",
                file_types=("Excel (*.xlsx)",),
            )
            if not chosen:
                return {"cancelled": True}
            path = _xlsx_path(chosen[0])
            try:
                xlsx_io.write_price(
                    path,
                    price_list,
                    db.all_items(price_list["id"]),
                    db.get_unit_labels(),
                )
            except PermissionError as exc:
                raise AppError(
                    "Не удалось записать файл. Закройте его, если он открыт в Excel, и повторите."
                ) from exc
            return {"cancelled": False, "path": str(path)}

        return _call(run)

    def export_estimate_dialog(self, estimate):
        def run():
            prepared = db.normalize_estimate(estimate or {})
            number = prepared["number"] or "смета"
            webview = _window()
            chosen = webview.windows[0].create_file_dialog(
                webview.FileDialog.SAVE,
                directory=str(app_dir()),
                save_filename=_safe_filename(f"Смета {number}", "Смета") + ".xlsx",
                file_types=("Excel (*.xlsx)",),
            )
            if not chosen:
                return {"cancelled": True}
            path = _xlsx_path(chosen[0])
            try:
                xlsx_io.write_estimate(path, prepared, db.get_unit_labels())
            except PermissionError as exc:
                raise AppError(
                    "Не удалось записать файл. Закройте его, если он открыт в Excel, и повторите."
                ) from exc
            return {"cancelled": False, "path": str(path)}

        return _call(run)
