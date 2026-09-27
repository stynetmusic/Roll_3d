"""Деньги и количества.

Тот же алгоритм, что в web/money.js: целые единицы и округление половины вверх.
Цена — 2 знака, количество — 3, скидка — 2. Строка сметы:
количество × цена × (1 − скидка строки / 100), затем итог заказа.
"""

from __future__ import annotations

import re

_SPACES = (" ", "\u00a0", "\u202f")
_NUMBER = re.compile(r"^(\d+)(?:\.(\d+))?$")

MAX_MONEY_CENTS = 9_999_999_999  # 99 999 999.99
MAX_QTY_MILLI = 1_000_000_000  # 1 000 000
MAX_MEASURE_CENTI = 10_000_000  # 100 000.00


def clean_number(value) -> str:
    text = "" if value is None else str(value).strip()
    for space in _SPACES:
        text = text.replace(space, "")
    return text.replace(",", ".")


def to_units(value, scale: int) -> int | None:
    text = clean_number(value)
    if text == "":
        return None
    match = _NUMBER.fullmatch(text)
    if not match:
        return None
    whole, frac = match.group(1), match.group(2) or ""
    head = frac[:scale]
    rest = frac[scale:]
    padded = (head + ("0" * scale))[:scale]
    number = int(whole) * (10**scale) + (int(padded) if padded else 0)
    if rest and rest[0] >= "5":
        number += 1
    return number


def div_round_half_up(num: int, den: int) -> int:
    if num < 0:
        return -div_round_half_up(-num, den)
    return (num + den // 2) // den


def line_sum_cents(qty, price, discount) -> int:
    qty_u = to_units(qty, 3)
    price_u = to_units(price, 2)
    if qty_u is None or price_u is None:
        return 0
    disc = to_units(discount, 2)
    disc = 0 if disc is None else disc
    if disc < 0:
        disc = 0
    if disc > 10000:
        disc = 10000
    return div_round_half_up(qty_u * price_u * (10000 - disc), 10_000_000)


def order_total_cents(sum_cents: int, discount) -> int:
    disc = to_units(discount, 2)
    disc = 0 if disc is None else disc
    if disc < 0:
        disc = 0
    if disc > 10000:
        disc = 10000
    return div_round_half_up(int(sum_cents) * (10000 - disc), 10000)


def cents_to_money(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    whole, frac = divmod(abs(int(cents)), 100)
    return f"{sign}{whole}.{frac:02d}"


def format_grouped(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    whole, frac = divmod(abs(int(cents)), 100)
    body = f"{whole:,}".replace(",", " ")
    return f"{sign}{body},{frac:02d}"


def _strip_zeros(text: str) -> str:
    if "." not in text:
        return text
    text = text.rstrip("0").rstrip(".")
    return text or "0"


def normalize_money(value) -> str | None:
    units = to_units(value, 2)
    if units is None:
        return None
    if units > MAX_MONEY_CENTS:
        units = MAX_MONEY_CENTS
    return cents_to_money(units)


def normalize_qty(value) -> str | None:
    text = clean_number(value)
    if text == "":
        return "0"
    units = to_units(text, 3)
    if units is None:
        return None
    if units > MAX_QTY_MILLI:
        units = MAX_QTY_MILLI
    whole, frac = divmod(units, 1000)
    return _strip_zeros(f"{whole}.{frac:03d}")


def normalize_discount(value) -> str | None:
    text = clean_number(value)
    if text == "":
        return "0"
    units = to_units(text, 2)
    if units is None:
        return None
    if units < 0:
        units = 0
    if units > 10000:
        units = 10000
    whole, frac = divmod(units, 100)
    return _strip_zeros(f"{whole}.{frac:02d}")


def normalize_measure(value) -> str | None:
    """Пустая строка — поле не заполнено. None — текст не является числом."""
    text = clean_number(value)
    if text == "":
        return ""
    units = to_units(text, 2)
    if units is None:
        return None
    if units > MAX_MEASURE_CENTI:
        units = MAX_MEASURE_CENTI
    whole, frac = divmod(units, 100)
    return _strip_zeros(f"{whole}.{frac:02d}")
