"""Чтение прайса ПГИ.

С 4-й строки листа:
1 код, 2 флаг «пропустить», 3 имя, 4 цвет, 5 флаг «пропустить»,
6 цена с запятой, 7 единица 0, 2, 3 или 4.
Ложь во флаге строку не отбрасывает. Истина, 1, «да», «x» — отбрасывает.
"""

from __future__ import annotations

from pathlib import Path

import openpyxl

from money import normalize_money

_KEEP = {"", "0", "false", "нет", "no", "н", "n"}
_SKIP = {"1", "true", "да", "yes", "y", "x", "*", "+"}


def is_skip(flag) -> bool:
    if flag is None or flag is False:
        return False
    if flag is True:
        return True
    if isinstance(flag, (int, float)) and not isinstance(flag, bool):
        return flag != 0
    text = str(flag).strip().lower()
    if text in _KEEP:
        return False
    if text in _SKIP:
        return True
    return True


def as_code(value) -> str:
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, int):
        return str(value)
    return str(value).strip()


def as_text(value) -> str:
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, int):
        return str(value)
    return str(value).strip()


def as_unit(value):
    if value is None or isinstance(value, bool) or value == "":
        return None
    if isinstance(value, float) and not value.is_integer():
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    if number in (0, 2, 3, 4):
        return number
    return None


def read_pgi(path: Path) -> tuple[list[dict], int]:
    """Позиции и число пропущенных по флагу или с нечитаемой ценой.

    Повтор кода в одном файле: остаётся последняя строка.
    """
    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        sheet = workbook.worksheets[0]
        items: dict[str, dict] = {}
        order: list[str] = []
        skipped = 0
        for row in sheet.iter_rows(min_row=4, max_col=7, values_only=True):
            cells = list(row) + [None] * 7
            code, flag_a, name, color, flag_b, price, unit = cells[:7]
            if is_skip(flag_a) or is_skip(flag_b):
                skipped += 1
                continue
            code_text = as_code(code)[:80]
            if not code_text:
                continue
            if price is None or price is False or str(price).strip() == "":
                price_text = "0.00"
            else:
                price_text = normalize_money(price)
                if price_text is None:
                    skipped += 1
                    continue
            if code_text not in items:
                order.append(code_text)
            items[code_text] = {
                "code": code_text,
                "name": as_text(name)[:200],
                "color": as_text(color)[:80],
                "unit": as_unit(unit),
                "file_price": price_text,
            }
        return [items[code] for code in order], skipped
    finally:
        workbook.close()
