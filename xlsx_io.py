"""Экспорт сметы и прайса в xlsx."""

from __future__ import annotations

import re
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from money import cents_to_money, line_sum_cents, order_total_cents, to_units

_THIN = Border(
    left=Side(style="thin", color="BFBFBF"),
    right=Side(style="thin", color="BFBFBF"),
    top=Side(style="thin", color="BFBFBF"),
    bottom=Side(style="thin", color="BFBFBF"),
)
_HEADER_FILL = PatternFill("solid", fgColor="E6E6E6")
_TITLE_FONT = Font(name="Calibri", size=16, bold=True)
_BOLD = Font(name="Calibri", size=11, bold=True)
_FONT = Font(name="Calibri", size=11)


def ru_date(iso: str) -> str:
    match = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", iso or "")
    if not match:
        return iso or ""
    year, month, day = match.groups()
    return f"{day}.{month}.{year}"


def _money(cell, text) -> None:
    units = to_units(text, 2)
    if units is None:
        cell.value = None
        return
    cell.value = units / 100
    cell.number_format = "#,##0.00"
    cell.font = _FONT


def _qty(cell, text) -> None:
    units = to_units(text, 3)
    if units is None:
        cell.value = None
        return
    cell.value = units / 1000
    cell.number_format = "0.###"
    cell.font = _FONT


def _percent(cell, text) -> None:
    units = to_units(text, 2)
    if units is None:
        cell.value = None
        return
    cell.value = units / 100
    cell.number_format = "0.##"
    cell.font = _FONT


def _text(cell, value, bold=False) -> None:
    cell.value = "" if value is None else value
    cell.font = _BOLD if bold else _FONT
    cell.alignment = Alignment(vertical="center")


def _header(cell, value) -> None:
    cell.value = value
    cell.font = _BOLD
    cell.fill = _HEADER_FILL
    cell.border = _THIN
    cell.alignment = Alignment(vertical="center", wrap_text=True)


def _fit(sheet, widths: list[float]) -> None:
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.horizontalCentered = True
    sheet.sheet_view.showGridLines = False
    sheet.page_margins.left = 0.5
    sheet.page_margins.right = 0.5
    sheet.page_margins.top = 0.6
    sheet.page_margins.bottom = 0.6


def unit_label(labels: dict, unit) -> str:
    if unit is None or unit == "":
        return ""
    return labels.get(str(unit), f"ед. {unit}")


def write_estimate(path: Path, estimate: dict, labels: dict) -> None:
    book = Workbook()
    sheet = book.active
    sheet.title = "Смета"
    sheet.merge_cells("A1:J1")
    sheet["A1"].value = "Смета Roll_3d"
    sheet["A1"].font = _TITLE_FONT
    sheet.row_dimensions[1].height = 24

    _text(sheet["A2"], "Номер", bold=True)
    _text(sheet["B2"], estimate.get("number") or "")
    _text(sheet["C2"], "Дата", bold=True)
    _text(sheet["D2"], ru_date(estimate.get("date") or ""))

    _text(sheet["A3"], "Клиент", bold=True)
    _text(sheet["B3"], estimate.get("client") or "")
    _text(sheet["C3"], "Объект", bold=True)
    _text(sheet["D3"], estimate.get("object_name") or "")
    sheet.merge_cells("D3:J3")

    _text(sheet["A4"], "Комментарий", bold=True)
    _text(sheet["B4"], estimate.get("comment") or "")
    sheet.merge_cells("B4:J4")
    sheet["B4"].alignment = Alignment(wrap_text=True, vertical="center")

    _text(sheet["A5"], "Скидка заказа, %", bold=True)
    _percent(sheet["B5"], estimate.get("order_discount") or "0")

    headers = [
        "Код",
        "Имя",
        "Цвет",
        "Ед.",
        "Ширина, мм",
        "Высота, мм",
        "Кол-во",
        "Цена",
        "Скидка %",
        "Сумма",
    ]
    header_row = 7
    for column, title in enumerate(headers, start=1):
        _header(sheet.cell(header_row, column), title)

    sum_cents = 0
    row_index = header_row + 1
    for line in estimate.get("lines") or []:
        line_cents = line_sum_cents(line.get("qty"), line.get("price"), line.get("discount"))
        sum_cents += line_cents
        values = [
            line.get("code") or "",
            line.get("name") or "",
            line.get("color") or "",
            unit_label(labels, line.get("unit")),
        ]
        for column, value in enumerate(values, start=1):
            cell = sheet.cell(row_index, column, value)
            cell.font = _FONT
            cell.border = _THIN
            cell.alignment = Alignment(vertical="center")
        for column, measure in ((5, line.get("width_mm")), (6, line.get("height_mm"))):
            cell = sheet.cell(row_index, column)
            cell.border = _THIN
            if measure:
                units = to_units(measure, 2)
                cell.value = None if units is None else units / 100
                cell.number_format = "0.##"
                cell.font = _FONT
        qty_cell = sheet.cell(row_index, 7)
        qty_cell.border = _THIN
        _qty(qty_cell, line.get("qty"))
        price_cell = sheet.cell(row_index, 8)
        price_cell.border = _THIN
        _money(price_cell, line.get("price"))
        discount_cell = sheet.cell(row_index, 9)
        discount_cell.border = _THIN
        _percent(discount_cell, line.get("discount"))
        sum_cell = sheet.cell(row_index, 10)
        sum_cell.border = _THIN
        _money(sum_cell, cents_to_money(line_cents))
        row_index += 1

    total_cents = order_total_cents(sum_cents, estimate.get("order_discount") or "0")
    row_index += 1
    _text(sheet.cell(row_index, 1), "Сумма строк", bold=True)
    _money(sheet.cell(row_index, 2), cents_to_money(sum_cents))
    row_index += 1
    total_label = sheet.cell(row_index, 1, "Итого")
    total_label.font = Font(name="Calibri", size=12, bold=True)
    total_cell = sheet.cell(row_index, 2)
    _money(total_cell, cents_to_money(total_cents))
    total_cell.font = Font(name="Calibri", size=12, bold=True)

    sheet.auto_filter.ref = f"A{header_row}:J{max(header_row, row_index - 3)}"
    sheet.freeze_panes = "A8"
    sheet.oddHeader.left.text = "Roll_3d"
    sheet.oddFooter.right.text = "Стр. &P"
    _fit(sheet, [16, 34, 12, 14, 14, 14, 12, 14, 12, 16])
    sheet.auto_filter.ref = f"A{header_row}:J{header_row + max(1, len(estimate.get('lines') or []))}"
    book.properties.title = "Смета Roll_3d"
    book.properties.creator = "Roll_3d"
    book.save(path)


def write_price(path: Path, price_list: dict, items: list[dict], labels: dict) -> None:
    book = Workbook()
    sheet = book.active
    sheet.title = "Прайс"
    sheet.merge_cells("A1:H1")
    sheet["A1"].value = f"Прайс {price_list.get('name') or ''}"
    sheet["A1"].font = _TITLE_FONT
    _text(sheet["A2"], "Файл", bold=True)
    _text(sheet["B2"], price_list.get("source_filename") or "")
    _text(sheet["C2"], "Импорт", bold=True)
    _text(sheet["D2"], price_list.get("imported_at") or "")
    sheet.merge_cells("D2:H2")
    _text(
        sheet["A3"],
        "Пустая «Моя цена» значит, что позицию не правили: в смете берётся цена файла. Нулевые цены включены.",
    )
    sheet.merge_cells("A3:H3")

    headers = [
        "Код",
        "Имя",
        "Цвет",
        "Ед.",
        "Код единицы",
        "Цена файла",
        "Моя цена",
        "Цена в смете",
    ]
    header_row = 5
    for column, title in enumerate(headers, start=1):
        _header(sheet.cell(header_row, column), title)

    for offset, item in enumerate(items):
        row_index = header_row + 1 + offset
        cells = [
            item.get("code") or "",
            item.get("name") or "",
            item.get("color") or "",
            unit_label(labels, item.get("unit")),
            "" if item.get("unit") is None else item.get("unit"),
        ]
        for column, value in enumerate(cells, start=1):
            cell = sheet.cell(row_index, column, value)
            cell.font = _FONT
            cell.border = _THIN
        file_cell = sheet.cell(row_index, 6)
        file_cell.border = _THIN
        _money(file_cell, item.get("file_price"))
        user_cell = sheet.cell(row_index, 7)
        user_cell.border = _THIN
        if item.get("user_edited"):
            _money(user_cell, item.get("user_price"))
        effective = sheet.cell(row_index, 8)
        effective.border = _THIN
        _money(effective, item.get("price"))

    last = header_row + max(1, len(items))
    sheet.auto_filter.ref = f"A{header_row}:H{last}"
    sheet.freeze_panes = "A6"
    _fit(sheet, [16, 34, 12, 14, 14, 16, 16, 16])
    book.properties.title = f"Прайс {price_list.get('name') or ''}"
    book.properties.creator = "Roll_3d"
    book.save(path)
