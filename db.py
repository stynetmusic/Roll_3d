"""SQLite: прайсы, позиции, сметы и настройки."""

from __future__ import annotations

import sqlite3
import threading
from datetime import date, datetime
from pathlib import Path

import pgi
from money import (
    cents_to_money,
    line_sum_cents,
    normalize_discount,
    normalize_measure,
    normalize_money,
    normalize_qty,
    order_total_cents,
)
from paths import app_dir

SEED_FILES = (
    ("ПГИ-06-12-2024.xlsx", True),
    ("ПГИ-16.09.2024.xlsx", False),
    ("ПГИ-16.09.2024-42.xlsx", False),
)

PART_IDS = (
    "box",
    "curtain",
    "guide_left",
    "guide_right",
    "shaft",
    "drive",
    "end_profile",
    "covers",
)

DEFAULT_PREFIX = {
    "box": "SB",
    "curtain": "AR",
    "guide_left": "GR",
    "guide_right": "GR",
    "shaft": "RT",
    "drive": "AM",
    "end_profile": "ES",
    "covers": "SF",
}

UNIT_CODES = (0, 2, 3, 4)
DEFAULT_UNIT_LABELS = {
    0: "ед. 0",
    2: "ед. 2",
    3: "ед. 3",
    4: "ед. 4",
}

EFFECTIVE_PRICE = (
    "CASE WHEN user_edited = 1 AND user_price IS NOT NULL "
    "THEN user_price ELSE file_price END"
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS price_lists (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    source_filename TEXT NOT NULL UNIQUE,
    imported_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    unit INTEGER,
    file_price TEXT NOT NULL,
    user_price TEXT,
    user_edited INTEGER NOT NULL DEFAULT 0,
    UNIQUE (price_list_id, code)
);

CREATE TABLE IF NOT EXISTS estimates (
    id INTEGER PRIMARY KEY,
    number TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT '',
    client TEXT NOT NULL DEFAULT '',
    object_name TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    order_discount TEXT NOT NULL DEFAULT '0',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS estimate_lines (
    id INTEGER PRIMARY KEY,
    estimate_id INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '',
    unit INTEGER,
    width_mm TEXT,
    height_mm TEXT,
    qty TEXT NOT NULL DEFAULT '0',
    price TEXT NOT NULL DEFAULT '0.00',
    discount TEXT NOT NULL DEFAULT '0'
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_list ON items(price_list_id);
CREATE INDEX IF NOT EXISTS idx_lines_estimate ON estimate_lines(estimate_id, position);
"""

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None
_db_override: Path | None = None


class AppError(Exception):
    pass


def set_db_path(path: Path | None) -> None:
    global _db_override, _conn
    _db_override = None if path is None else Path(path)
    if _conn is not None:
        _conn.close()
        _conn = None


def close() -> None:
    global _conn
    if _conn is not None:
        _conn.close()
        _conn = None


def database_file() -> Path:
    if _db_override is not None:
        _db_override.parent.mkdir(parents=True, exist_ok=True)
        return _db_override
    folder = app_dir() / "data"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / "roll_3d.sqlite"


def get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        connection = sqlite3.connect(database_file(), check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        _conn = connection
    return _conn


def now_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def init_db() -> None:
    with _lock:
        conn = get_conn()
        conn.executescript(SCHEMA)
        for code, label in DEFAULT_UNIT_LABELS.items():
            conn.execute(
                "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO NOTHING",
                (f"unit_label_{code}", label),
            )
        for part, prefix in DEFAULT_PREFIX.items():
            conn.execute(
                "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO NOTHING",
                (f"part_prefix_{part}", prefix),
            )
        conn.commit()


def _clip(value, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _as_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "да"}
    return False


def _date(value) -> str:
    text = str(value or "").strip()
    if len(text) == 10 and text[4] == "-" and text[7] == "-":
        try:
            datetime.strptime(text, "%Y-%m-%d")
        except ValueError:
            return ""
        return text
    return ""


def get_unit_labels() -> dict[str, str]:
    with _lock:
        init_db()
        conn = get_conn()
        labels = {str(code): DEFAULT_UNIT_LABELS[code] for code in UNIT_CODES}
        rows = conn.execute(
            "SELECT key, value FROM settings WHERE key LIKE 'unit_label_%'"
        ).fetchall()
        for row in rows:
            code = row["key"].replace("unit_label_", "")
            if code in labels and str(row["value"]).strip():
                labels[code] = str(row["value"]).strip()
        return labels


def get_part_prefixes() -> dict[str, str]:
    with _lock:
        init_db()
        conn = get_conn()
        prefixes = dict(DEFAULT_PREFIX)
        rows = conn.execute(
            "SELECT key, value FROM settings WHERE key LIKE 'part_prefix_%'"
        ).fetchall()
        for row in rows:
            part = row["key"].replace("part_prefix_", "")
            if part in prefixes:
                prefixes[part] = str(row["value"] or "").strip()
        return prefixes


def _price_list_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "source_filename": row["source_filename"],
        "imported_at": row["imported_at"],
        "is_active": bool(row["is_active"]),
        "item_count": row["item_count"],
    }


def list_price_lists() -> list[dict]:
    with _lock:
        init_db()
        conn = get_conn()
        rows = conn.execute(
            """
            SELECT p.id, p.name, p.source_filename, p.imported_at, p.is_active,
                   (SELECT COUNT(*) FROM items i WHERE i.price_list_id = p.id) AS item_count
            FROM price_lists p
            ORDER BY p.id
            """
        ).fetchall()
        return [_price_list_dict(row) for row in rows]


def active_id() -> int | None:
    with _lock:
        init_db()
        row = get_conn().execute(
            "SELECT id FROM price_lists WHERE is_active = 1 ORDER BY id LIMIT 1"
        ).fetchone()
        return None if row is None else int(row["id"])


def _activate(conn: sqlite3.Connection, list_id: int) -> None:
    found = conn.execute("SELECT id FROM price_lists WHERE id = ?", (list_id,)).fetchone()
    if found is None:
        raise AppError("Прайс не найден.")
    conn.execute("UPDATE price_lists SET is_active = 0")
    conn.execute("UPDATE price_lists SET is_active = 1 WHERE id = ?", (list_id,))


def set_active_price_list(list_id: int) -> dict:
    with _lock:
        init_db()
        conn = get_conn()
        with conn:
            _activate(conn, int(list_id))
        return {
            "active_price_list_id": active_id(),
            "price_lists": list_price_lists(),
        }


def import_pgi_file(path: Path, make_active: bool = False) -> dict:
    source = Path(path)
    if not source.is_file():
        raise AppError(f"Файл не найден: {source.name}")
    if source.suffix.lower() != ".xlsx":
        raise AppError("Нужен файл Excel .xlsx в формате ПГИ.")
    try:
        parsed, skipped = pgi.read_pgi(source)
    except Exception as exc:
        raise AppError(
            "Не удалось прочитать файл как прайс ПГИ. "
            "Нужен xlsx с данными с 4-й строки."
        ) from exc
    if not parsed:
        raise AppError("В файле нет позиций с 4-й строки.")

    filename = source.name
    title = source.stem
    stamp = now_iso()
    with _lock:
        init_db()
        conn = get_conn()
        with conn:
            current = conn.execute(
                "SELECT id FROM price_lists WHERE source_filename = ?",
                (filename,),
            ).fetchone()
            existed = current is not None
            preserved = 0
            if existed:
                list_id = int(current["id"])
                conn.execute(
                    "UPDATE price_lists SET name = ?, imported_at = ? WHERE id = ?",
                    (title, stamp, list_id),
                )
                existing = {
                    row["code"]: row
                    for row in conn.execute(
                        "SELECT id, code, user_edited FROM items WHERE price_list_id = ?",
                        (list_id,),
                    )
                }
                updates = []
                inserts = []
                for item in parsed:
                    old = existing.get(item["code"])
                    if old is not None:
                        updates.append(
                            (
                                item["name"],
                                item["color"],
                                item["unit"],
                                item["file_price"],
                                old["id"],
                            )
                        )
                        if old["user_edited"]:
                            preserved += 1
                    else:
                        inserts.append(
                            (
                                list_id,
                                item["code"],
                                item["name"],
                                item["color"],
                                item["unit"],
                                item["file_price"],
                            )
                        )
                conn.executemany(
                    """
                    UPDATE items
                    SET name = ?, color = ?, unit = ?, file_price = ?
                    WHERE id = ?
                    """,
                    updates,
                )
                conn.executemany(
                    """
                    INSERT INTO items (
                        price_list_id, code, name, color, unit, file_price, user_edited
                    ) VALUES (?, ?, ?, ?, ?, ?, 0)
                    """,
                    inserts,
                )
                added = len(inserts)
                updated = len(updates)
            else:
                cursor = conn.execute(
                    """
                    INSERT INTO price_lists (name, source_filename, imported_at, is_active)
                    VALUES (?, ?, ?, 0)
                    """,
                    (title, filename, stamp),
                )
                list_id = int(cursor.lastrowid)
                conn.executemany(
                    """
                    INSERT INTO items (
                        price_list_id, code, name, color, unit, file_price, user_edited
                    ) VALUES (?, ?, ?, ?, ?, ?, 0)
                    """,
                    [
                        (
                            list_id,
                            item["code"],
                            item["name"],
                            item["color"],
                            item["unit"],
                            item["file_price"],
                        )
                        for item in parsed
                    ],
                )
                added = len(parsed)
                updated = 0
            if make_active:
                _activate(conn, list_id)
            elif conn.execute(
                "SELECT id FROM price_lists WHERE is_active = 1"
            ).fetchone() is None:
                _activate(conn, list_id)
        row = conn.execute(
            """
            SELECT p.id, p.name, p.source_filename, p.imported_at, p.is_active,
                   (SELECT COUNT(*) FROM items i WHERE i.price_list_id = p.id) AS item_count
            FROM price_lists p WHERE p.id = ?
            """,
            (list_id,),
        ).fetchone()
        info = _price_list_dict(row)
        info.update(
            {
                "existed": existed,
                "added": added,
                "updated": updated,
                "preserved_user": preserved,
                "skipped": skipped,
            }
        )
        return info


def seed_price_files() -> dict:
    """Первый запуск: три файла ПГИ рядом с программой. Test.xlsx не читается."""
    with _lock:
        init_db()
        count = get_conn().execute("SELECT COUNT(*) AS n FROM price_lists").fetchone()["n"]
        if count:
            return {"already": True, "imported": [], "errors": []}
    imported = []
    errors = []
    for filename, make_active in SEED_FILES:
        path = app_dir() / filename
        if not path.is_file():
            errors.append(f"Не найден файл {filename}.")
            continue
        try:
            imported.append(import_pgi_file(path, make_active=make_active))
        except AppError as exc:
            errors.append(f"{filename}: {exc}")
    with _lock:
        if active_id() is None:
            first = get_conn().execute(
                "SELECT id FROM price_lists ORDER BY id LIMIT 1"
            ).fetchone()
            if first is not None:
                set_active_price_list(int(first["id"]))
    return {"already": False, "imported": imported, "errors": errors}


def _like_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _item_dict(row: sqlite3.Row) -> dict:
    unit = row["unit"]
    return {
        "id": row["id"],
        "code": row["code"],
        "name": row["name"],
        "color": row["color"],
        "unit": None if unit is None else int(unit),
        "file_price": row["file_price"],
        "user_price": row["user_price"],
        "user_edited": bool(row["user_edited"]),
        "price": row["price"],
    }


def search_items(price_list_id, query, prefix, show_zero, offset, limit) -> dict:
    list_id = int(price_list_id)
    query_text = _clip(query, 80)
    prefix_text = _clip(prefix, 40)
    include_zero = _as_bool(show_zero)
    try:
        start = max(0, int(offset or 0))
    except (TypeError, ValueError):
        start = 0
    try:
        size = max(1, min(500, int(limit or 200)))
    except (TypeError, ValueError):
        size = 200
    where = ["price_list_id = ?"]
    args: list = [list_id]
    if prefix_text:
        where.append("name LIKE ? ESCAPE '\\'")
        args.append(_like_escape(prefix_text) + "%")
    if query_text:
        pattern = "%" + _like_escape(query_text) + "%"
        where.append(
            "(code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR color LIKE ? ESCAPE '\\')"
        )
        args.extend([pattern, pattern, pattern])
    if not include_zero:
        where.append(f"CAST(({EFFECTIVE_PRICE}) AS REAL) > 0")
    clause = " AND ".join(where)
    with _lock:
        init_db()
        conn = get_conn()
        found = conn.execute(
            "SELECT id FROM price_lists WHERE id = ?",
            (list_id,),
        ).fetchone()
        if found is None:
            raise AppError("Прайс не найден.")
        total = conn.execute(
            f"SELECT COUNT(*) AS n FROM items WHERE {clause}",
            args,
        ).fetchone()["n"]
        rows = conn.execute(
            f"""
            SELECT id, code, name, color, unit, file_price, user_price, user_edited,
                   {EFFECTIVE_PRICE} AS price
            FROM items
            WHERE {clause}
            ORDER BY name, color, code
            LIMIT ? OFFSET ?
            """,
            [*args, size, start],
        ).fetchall()
        return {"total": int(total), "rows": [_item_dict(row) for row in rows]}


def _require_item(conn: sqlite3.Connection, item_id: int) -> sqlite3.Row:
    row = conn.execute(
        f"""
        SELECT id, code, name, color, unit, file_price, user_price, user_edited,
               {EFFECTIVE_PRICE} AS price
        FROM items WHERE id = ?
        """,
        (item_id,),
    ).fetchone()
    if row is None:
        raise AppError("Позиция не найдена.")
    return row


def set_item_price(item_id, price_text) -> dict:
    price = normalize_money(price_text)
    if price is None:
        raise AppError("Некорректная цена.")
    with _lock:
        init_db()
        conn = get_conn()
        with conn:
            current = conn.execute(
                "SELECT id FROM items WHERE id = ?",
                (int(item_id),),
            ).fetchone()
            if current is None:
                raise AppError("Позиция не найдена.")
            conn.execute(
                "UPDATE items SET user_price = ?, user_edited = 1 WHERE id = ?",
                (price, int(item_id)),
            )
            row = _require_item(conn, int(item_id))
        return {"item": _item_dict(row)}


def reset_item_price(item_id) -> dict:
    with _lock:
        init_db()
        conn = get_conn()
        with conn:
            cursor = conn.execute(
                "UPDATE items SET user_price = NULL, user_edited = 0 WHERE id = ?",
                (int(item_id),),
            )
            if cursor.rowcount == 0:
                raise AppError("Позиция не найдена.")
            row = _require_item(conn, int(item_id))
        return {"item": _item_dict(row)}


def replace_user_prices(price_list_id) -> dict:
    list_id = int(price_list_id)
    with _lock:
        init_db()
        conn = get_conn()
        with conn:
            found = conn.execute(
                "SELECT id FROM price_lists WHERE id = ?",
                (list_id,),
            ).fetchone()
            if found is None:
                raise AppError("Прайс не найден.")
            cursor = conn.execute(
                """
                UPDATE items
                SET user_price = NULL, user_edited = 0
                WHERE price_list_id = ? AND user_edited = 1
                """,
                (list_id,),
            )
            updated = cursor.rowcount
        return {"updated": int(updated)}


def get_price_list(list_id: int) -> dict:
    with _lock:
        init_db()
        row = get_conn().execute(
            """
            SELECT p.id, p.name, p.source_filename, p.imported_at, p.is_active,
                   (SELECT COUNT(*) FROM items i WHERE i.price_list_id = p.id) AS item_count
            FROM price_lists p WHERE p.id = ?
            """,
            (int(list_id),),
        ).fetchone()
        if row is None:
            raise AppError("Прайс не найден.")
        return _price_list_dict(row)


def all_items(list_id: int) -> list[dict]:
    with _lock:
        init_db()
        rows = get_conn().execute(
            f"""
            SELECT id, code, name, color, unit, file_price, user_price, user_edited,
                   {EFFECTIVE_PRICE} AS price
            FROM items
            WHERE price_list_id = ?
            ORDER BY name, color, code
            """,
            (int(list_id),),
        ).fetchall()
        return [_item_dict(row) for row in rows]


def save_settings(params: dict) -> dict:
    labels_in = params.get("unit_labels") or {}
    prefixes_in = params.get("part_prefixes") or {}
    if not isinstance(labels_in, dict) or not isinstance(prefixes_in, dict):
        raise AppError("Некорректные настройки.")
    active = params.get("active_price_list_id")
    with _lock:
        init_db()
        conn = get_conn()
        with conn:
            for code in UNIT_CODES:
                raw = labels_in.get(str(code), labels_in.get(code, ""))
                label = _clip(raw, 40) or DEFAULT_UNIT_LABELS[code]
                conn.execute(
                    """
                    INSERT INTO settings(key, value) VALUES(?, ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value
                    """,
                    (f"unit_label_{code}", label),
                )
            for part in PART_IDS:
                prefix = _clip(prefixes_in.get(part, ""), 40)
                conn.execute(
                    """
                    INSERT INTO settings(key, value) VALUES(?, ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value
                    """,
                    (f"part_prefix_{part}", prefix),
                )
            if active not in (None, "", 0, "0"):
                _activate(conn, int(active))
        return {
            "unit_labels": get_unit_labels(),
            "part_prefixes": get_part_prefixes(),
            "price_lists": list_price_lists(),
            "active_price_list_id": active_id(),
        }


def _unit_value(value):
    if value is None or value == "":
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    if number in UNIT_CODES:
        return number
    return None


def _normalize_line(raw) -> dict:
    if not isinstance(raw, dict):
        raw = {}
    qty = normalize_qty(raw.get("qty"))
    price = normalize_money(raw.get("price"))
    discount = normalize_discount(raw.get("discount"))
    width = normalize_measure(raw.get("width_mm"))
    height = normalize_measure(raw.get("height_mm"))
    return {
        "code": _clip(raw.get("code"), 80),
        "name": _clip(raw.get("name"), 200),
        "color": _clip(raw.get("color"), 80),
        "unit": _unit_value(raw.get("unit")),
        "width_mm": None if not width else width,
        "height_mm": None if not height else height,
        "qty": qty or "0",
        "price": price or "0.00",
        "discount": discount or "0",
    }


def normalize_estimate(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise AppError("Некорректная смета.")
    lines_in = payload.get("lines") or []
    if not isinstance(lines_in, list):
        raise AppError("Некорректные строки сметы.")
    if len(lines_in) > 5000:
        raise AppError("Слишком много строк в смете.")
    discount = normalize_discount(payload.get("order_discount"))
    estimate_id = payload.get("id")
    if estimate_id in (None, "", 0, "0"):
        estimate_id = None
    else:
        estimate_id = int(estimate_id)
    return {
        "id": estimate_id,
        "number": _clip(payload.get("number"), 80),
        "date": _date(payload.get("date")),
        "client": _clip(payload.get("client"), 200),
        "object_name": _clip(payload.get("object_name"), 200),
        "comment": _clip(payload.get("comment"), 2000),
        "order_discount": discount or "0",
        "lines": [_normalize_line(line) for line in lines_in],
    }


def _line_out(row: sqlite3.Row) -> dict:
    unit = row["unit"]
    return {
        "code": row["code"],
        "name": row["name"],
        "color": row["color"],
        "unit": None if unit is None else int(unit),
        "width_mm": row["width_mm"] or "",
        "height_mm": row["height_mm"] or "",
        "qty": row["qty"],
        "price": row["price"],
        "discount": row["discount"],
    }


def _estimate_out(row: sqlite3.Row, lines: list[sqlite3.Row]) -> dict:
    return {
        "id": row["id"],
        "number": row["number"],
        "date": row["date"],
        "client": row["client"],
        "object_name": row["object_name"],
        "comment": row["comment"],
        "order_discount": row["order_discount"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "lines": [_line_out(line) for line in lines],
    }


def save_estimate(payload: dict) -> dict:
    prepared = normalize_estimate(payload)
    stamp = now_iso()
    with _lock:
        init_db()
        conn = get_conn()
        with conn:
            estimate_id = prepared["id"]
            if estimate_id is not None:
                found = conn.execute(
                    "SELECT id, created_at FROM estimates WHERE id = ?",
                    (estimate_id,),
                ).fetchone()
                if found is None:
                    raise AppError("Смета не найдена.")
                conn.execute(
                    """
                    UPDATE estimates
                    SET number = ?, date = ?, client = ?, object_name = ?, comment = ?,
                        order_discount = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        prepared["number"],
                        prepared["date"],
                        prepared["client"],
                        prepared["object_name"],
                        prepared["comment"],
                        prepared["order_discount"],
                        stamp,
                        estimate_id,
                    ),
                )
                conn.execute(
                    "DELETE FROM estimate_lines WHERE estimate_id = ?",
                    (estimate_id,),
                )
            else:
                cursor = conn.execute(
                    """
                    INSERT INTO estimates (
                        number, date, client, object_name, comment, order_discount,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        prepared["number"],
                        prepared["date"],
                        prepared["client"],
                        prepared["object_name"],
                        prepared["comment"],
                        prepared["order_discount"],
                        stamp,
                        stamp,
                    ),
                )
                estimate_id = int(cursor.lastrowid)
            conn.executemany(
                """
                INSERT INTO estimate_lines (
                    estimate_id, position, code, name, color, unit,
                    width_mm, height_mm, qty, price, discount
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        estimate_id,
                        index,
                        line["code"],
                        line["name"],
                        line["color"],
                        line["unit"],
                        line["width_mm"],
                        line["height_mm"],
                        line["qty"],
                        line["price"],
                        line["discount"],
                    )
                    for index, line in enumerate(prepared["lines"], start=1)
                ],
            )
        return {"estimate": load_estimate(estimate_id)["estimate"]}


def load_estimate(estimate_id) -> dict:
    with _lock:
        init_db()
        conn = get_conn()
        row = conn.execute(
            "SELECT * FROM estimates WHERE id = ?",
            (int(estimate_id),),
        ).fetchone()
        if row is None:
            raise AppError("Смета не найдена.")
        lines = conn.execute(
            """
            SELECT * FROM estimate_lines
            WHERE estimate_id = ?
            ORDER BY position, id
            """,
            (int(estimate_id),),
        ).fetchall()
        return {"estimate": _estimate_out(row, lines)}


def list_estimates() -> dict:
    with _lock:
        init_db()
        conn = get_conn()
        estimates = conn.execute(
            "SELECT * FROM estimates ORDER BY updated_at DESC, id DESC"
        ).fetchall()
        if not estimates:
            return {"estimates": []}
        ids = [row["id"] for row in estimates]
        placeholders = ",".join("?" for _ in ids)
        lines = conn.execute(
            f"SELECT * FROM estimate_lines WHERE estimate_id IN ({placeholders})",
            ids,
        ).fetchall()
        grouped: dict[int, list] = {}
        for line in lines:
            grouped.setdefault(line["estimate_id"], []).append(line)
        result = []
        for row in estimates:
            own = grouped.get(row["id"], [])
            cents = 0
            for line in own:
                cents += line_sum_cents(line["qty"], line["price"], line["discount"])
            total = order_total_cents(cents, row["order_discount"])
            result.append(
                {
                    "id": row["id"],
                    "number": row["number"],
                    "date": row["date"],
                    "client": row["client"],
                    "object_name": row["object_name"],
                    "updated_at": row["updated_at"],
                    "line_count": len(own),
                    "total": cents_to_money(total),
                }
            )
        return {"estimates": result}


def delete_estimate(estimate_id) -> dict:
    with _lock:
        init_db()
        conn = get_conn()
        with conn:
            cursor = conn.execute(
                "DELETE FROM estimates WHERE id = ?",
                (int(estimate_id),),
            )
            if cursor.rowcount == 0:
                raise AppError("Смета не найдена.")
        return {"deleted": int(estimate_id)}


def next_estimate_defaults() -> dict:
    with _lock:
        init_db()
        rows = get_conn().execute("SELECT number FROM estimates").fetchall()
        best = 0
        for row in rows:
            text = (row["number"] or "").strip()
            if text.isdigit() and len(text) < 10:
                best = max(best, int(text))
        return {
            "estimate": {
                "id": None,
                "number": str(best + 1),
                "date": date.today().isoformat(),
                "client": "",
                "object_name": "",
                "comment": "",
                "order_discount": "0",
                "lines": [],
            }
        }
