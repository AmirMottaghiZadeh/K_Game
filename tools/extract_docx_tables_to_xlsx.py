#!/usr/bin/env python3
"""Extract Word table data from source/*.docx into a usable XLSX workbook.

The script intentionally uses only the Python standard library so it can run in
this static project without installing document-processing dependencies.
"""

from __future__ import annotations

import datetime as _dt
import json
import posixpath
import re
import zipfile
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "source"
OUTPUT_FILE = ROOT / "extracted_drug_data.xlsx"

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = f"{{{W_NS}}}"

STANDARD_COLUMNS = [
    "Source File",
    "Source Topic",
    "Table #",
    "Row #",
    "Drug Category",
    "Drug Name",
    "Brand Name",
    "Dosage Forms",
    "Dosing / Administration",
    "Indication",
    "Food Relation",
    "Pregnancy",
    "Breastfeeding",
    "Pregnancy & Breastfeeding",
    "Dose Adjustment",
    "Side Effects",
    "Notes",
    "Original Headers",
    "Unmapped Data",
]

KEY_TO_OUTPUT = {
    "category": "Drug Category",
    "drug_name": "Drug Name",
    "brand_name": "Brand Name",
    "dosage_form": "Dosage Forms",
    "dosing": "Dosing / Administration",
    "indication": "Indication",
    "food_relation": "Food Relation",
    "pregnancy": "Pregnancy",
    "breastfeeding": "Breastfeeding",
    "pregnancy_breastfeeding": "Pregnancy & Breastfeeding",
    "dose_adjustment": "Dose Adjustment",
    "side_effects": "Side Effects",
    "notes": "Notes",
}


def clean_text(value: str) -> str:
    value = value or ""
    for mark in ("\u200e", "\u200f", "\u202a", "\u202b", "\u202c", "\u202d", "\u202e"):
        value = value.replace(mark, "")
    value = value.replace("\xa0", " ").replace("\r", "\n")
    lines = []
    for line in value.split("\n"):
        line = re.sub(r"[ \t]+", " ", line).strip()
        if line:
            lines.append(line)
    return dedupe_repeated_phrase("\n".join(lines).strip())


def dedupe_repeated_phrase(value: str) -> str:
    parts = value.split()
    if len(parts) >= 2 and len(parts) % 2 == 0:
        midpoint = len(parts) // 2
        if parts[:midpoint] == parts[midpoint:]:
            return " ".join(parts[:midpoint])
    lines = value.split("\n")
    if len(lines) >= 2 and len(lines) % 2 == 0:
        midpoint = len(lines) // 2
        if lines[:midpoint] == lines[midpoint:]:
            return "\n".join(lines[:midpoint])
    return value


def paragraph_text(paragraph: ET.Element) -> str:
    parts: List[str] = []
    for node in paragraph.iter():
        if node.tag == f"{W}t":
            parts.append(node.text or "")
        elif node.tag == f"{W}tab":
            parts.append("\t")
        elif node.tag == f"{W}br":
            parts.append("\n")
    return "".join(parts)


def cell_text(cell: ET.Element) -> str:
    paragraphs = [paragraph_text(p) for p in cell.findall(f"{W}p")]
    if not paragraphs:
        paragraphs = [paragraph_text(p) for p in cell.findall(f".//{W}p")]
    return clean_text("\n".join(paragraphs))


def int_attr(element: Optional[ET.Element], attr: str, default: int = 1) -> int:
    if element is None:
        return default
    raw = element.attrib.get(f"{W}{attr}", "")
    try:
        return max(1, int(raw))
    except ValueError:
        return default


def expand_table(table: ET.Element) -> List[List[str]]:
    rows: List[List[str]] = []
    active_merges: Dict[int, str] = {}

    for tr in table.findall(f"{W}tr"):
        row: List[str] = []
        col_index = 0
        for tc in tr.findall(f"{W}tc"):
            tc_pr = tc.find(f"{W}tcPr")
            grid_span = int_attr(tc_pr.find(f"{W}gridSpan") if tc_pr is not None else None, "val")
            vmerge = tc_pr.find(f"{W}vMerge") if tc_pr is not None else None
            vmerge_val = vmerge.attrib.get(f"{W}val", "continue") if vmerge is not None else None
            text = cell_text(tc)

            if vmerge is not None and vmerge_val != "restart" and not text:
                text = active_merges.get(col_index, "")

            for offset in range(grid_span):
                row.append(text)
                if vmerge is not None:
                    if vmerge_val == "restart":
                        active_merges[col_index + offset] = text
                else:
                    active_merges.pop(col_index + offset, None)
            col_index += grid_span

        rows.append(trim_right_empty(row))

    return rows


def trim_right_empty(row: List[str]) -> List[str]:
    output = list(row)
    while output and not output[-1]:
        output.pop()
    return output


def compact(value: str) -> str:
    value = clean_text(value).lower()
    replacements = {
        "ي": "ی",
        "ك": "ک",
        "ۀ": "ه",
        "ة": "ه",
        "أ": "ا",
        "إ": "ا",
        "آ": "ا",
    }
    for src, dst in replacements.items():
        value = value.replace(src, dst)
    return re.sub(r"[\s\W_]+", "", value, flags=re.UNICODE)


def column_key(header: str, index: int, headers: List[str]) -> Optional[str]:
    token = compact(header)
    if not token:
        return None
    if "دسته" in token or token in {"class", "category", "drugcategory"}:
        return "category"
    if "نامتجاری" in token or "برند" in token or "brand" in token:
        return "brand_name"
    if "نامدارو" in token or token in {"drug", "drugname", "generic"}:
        return "drug_name"
    if "اشکال" in token or "شکل" in token or "فرمدارویی" in token or "dosageform" in token:
        return "dosage_form"
    if "اندیکاسیون" in token or "کاربرد" in token or "indication" in token:
        if "دوز" in token or "مصرف" in token:
            return "dosing"
        return "indication"
    if "دوزینگ" in token or "دستورمصرف" in token or "دوز" in token or "administration" in token:
        if "تنظیم" in token:
            return "dose_adjustment"
        return "dosing"
    if "رابطهباغذا" in token or "فاصلهباغذا" in token or "غذا" in token or "food" in token:
        return "food_relation"
    if "بارداریوشیردهی" in token:
        return "pregnancy_breastfeeding"
    if "بارداری" in token or "pregnancy" in token:
        return "pregnancy"
    if "شیردهی" in token or "breastfeeding" in token or "lactation" in token:
        return "breastfeeding"
    if "تنظیمدوز" in token or "نارسایی" in token or "renal" in token or "hepatic" in token:
        return "dose_adjustment"
    if "عوارض" in token or "sideeffects" in token or "adverse" in token:
        return "side_effects"
    if "سایرنکات" in token or "نکات" in token or "توضیحات" in token or "note" in token:
        return "notes"
    return None


def header_score(row: List[str]) -> int:
    return sum(1 for index, value in enumerate(row) if column_key(value, index, row))


def detect_header_index(rows: List[List[str]]) -> Optional[int]:
    for index, row in enumerate(rows[:8]):
        score = header_score(row)
        joined = compact(" ".join(row))
        if score >= 3:
            return index
        if score >= 2 and ("نامدارو" in joined or "دسته" in joined):
            return index
    return None


def make_unique_headers(headers: List[str], width: int) -> List[str]:
    output: List[str] = []
    seen: Dict[str, int] = {}
    has_known_headers = header_score(headers) >= 2
    for index in range(width):
        label = headers[index] if index < len(headers) and headers[index] else f"Column {index + 1:02d}"
        if index == 0 and has_known_headers and (index >= len(headers) or not headers[index]):
            label = "Drug Category"
        label = clean_text(label)
        count = seen.get(label, 0) + 1
        seen[label] = count
        if count > 1:
            label = f"{label} ({count})"
        output.append(label)
    return output


def append_value(target: Dict[str, List[str]], key: str, value: str) -> None:
    value = clean_text(value)
    if not value:
        return
    bucket = target.setdefault(key, [])
    if value not in bucket:
        bucket.append(value)


def normalize_record(
    source_file: str,
    source_topic: str,
    table_index: int,
    row_index: int,
    headers: List[str],
    row: List[str],
    current_category: str,
) -> Tuple[Optional[List[str]], str]:
    mapped: Dict[str, List[str]] = {}
    unmapped: Dict[str, str] = {}

    for index, header in enumerate(headers):
        value = row[index] if index < len(row) else ""
        key = column_key(header, index, headers)
        if key:
            append_value(mapped, key, value)
        elif value:
            unmapped[header] = value

    category = "\n".join(mapped.get("category", []))
    if category:
        current_category = category
    elif current_category:
        mapped["category"] = [current_category]

    has_useful_data = any(
        mapped.get(key)
        for key in (
            "drug_name",
            "brand_name",
            "dosage_form",
            "dosing",
            "indication",
            "food_relation",
            "side_effects",
            "notes",
        )
    )
    if not has_useful_data:
        return None, current_category

    out = {column: "" for column in STANDARD_COLUMNS}
    out["Source File"] = source_file
    out["Source Topic"] = source_topic
    out["Table #"] = str(table_index)
    out["Row #"] = str(row_index)
    out["Original Headers"] = " | ".join(headers)
    out["Unmapped Data"] = json.dumps(unmapped, ensure_ascii=False, sort_keys=True) if unmapped else ""

    for key, column in KEY_TO_OUTPUT.items():
        out[column] = "\n".join(mapped.get(key, []))

    return [out[column] for column in STANDARD_COLUMNS], current_category


def read_docx_tables(path: Path) -> List[List[List[str]]]:
    with zipfile.ZipFile(path) as docx:
        document = ET.fromstring(docx.read("word/document.xml"))
    return [expand_table(table) for table in document.findall(f".//{W}tbl")]


def extract_workbook_data() -> Tuple[List[List[str]], Dict[str, List[List[str]]], List[List[str]]]:
    docx_files = sorted(SOURCE_DIR.glob("*.docx"), key=lambda item: item.name.casefold())
    all_data: List[List[str]] = [STANDARD_COLUMNS]
    raw_sheets: Dict[str, List[List[str]]] = {}
    summary: List[List[str]] = [["Source File", "Tables", "Raw Rows", "Normalized Rows"]]

    for path in docx_files:
        source_file = path.name
        source_topic = path.stem
        tables = read_docx_tables(path)
        max_width = max((len(row) for table in tables for row in table), default=0)
        raw_rows: List[List[str]] = [["Table #", "Row #", *[f"C{index + 1:02d}" for index in range(max_width)]]]
        normalized_before = len(all_data)
        current_category = ""
        previous_headers: Optional[List[str]] = None

        for table_number, table in enumerate(tables, start=1):
            header_index = detect_header_index(table)
            if header_index is not None:
                width = max(len(row) for row in table) if table else 0
                headers = make_unique_headers(table[header_index], width)
                previous_headers = headers
                data_start = header_index + 1
            elif previous_headers:
                headers = previous_headers
                data_start = 0
            else:
                headers = []
                data_start = len(table)

            for row_number, row in enumerate(table, start=1):
                raw_rows.append([str(table_number), str(row_number), *row, *[""] * (max_width - len(row))])

                if header_index is not None and row_number <= header_index + 1:
                    continue
                if row_number <= data_start:
                    continue
                if not any(row):
                    continue
                if headers:
                    record, current_category = normalize_record(
                        source_file,
                        source_topic,
                        table_number,
                        row_number,
                        headers,
                        row,
                        current_category,
                    )
                    if record:
                        all_data.append(record)

        raw_sheets[source_topic] = raw_rows
        summary.append([source_file, str(len(tables)), str(len(raw_rows) - 1), str(len(all_data) - normalized_before)])

    return all_data, raw_sheets, summary


def column_name(index: int) -> str:
    name = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def valid_xml_text(value: object) -> str:
    text = "" if value is None else str(value)
    return re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", text)


def sheet_xml(rows: List[List[object]]) -> str:
    max_cols = max((len(row) for row in rows), default=1)
    max_rows = max(len(rows), 1)
    dimension = f"A1:{column_name(max_cols - 1)}{max_rows}"
    xml_rows: List[str] = []

    for row_index, row in enumerate(rows, start=1):
        cells: List[str] = []
        for col_index, value in enumerate(row, start=1):
            text = valid_xml_text(value)
            if not text:
                continue
            ref = f"{column_name(col_index - 1)}{row_index}"
            style = ' s="1"' if row_index == 1 else ' s="2"'
            cells.append(
                f'<c r="{ref}" t="inlineStr"{style}><is><t xml:space="preserve">'
                f"{escape(text)}"
                "</t></is></c>"
            )
        xml_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')

    col_widths = "".join(f'<col min="{i}" max="{i}" width="24" customWidth="1"/>' for i in range(1, max_cols + 1))
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<dimension ref="{dimension}"/>'
        "<sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" "
        "activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews>"
        "<sheetFormatPr defaultRowHeight=\"18\"/>"
        f"<cols>{col_widths}</cols>"
        f"<sheetData>{''.join(xml_rows)}</sheetData>"
        "</worksheet>"
    )


def unique_sheet_name(name: str, used: set[str]) -> str:
    cleaned = re.sub(r"[\[\]:*?/\\]", " ", name).strip() or "Sheet"
    cleaned = re.sub(r"\s+", " ", cleaned)[:31]
    candidate = cleaned
    suffix = 2
    while candidate in used:
        tail = f" {suffix}"
        candidate = f"{cleaned[:31 - len(tail)]}{tail}"
        suffix += 1
    used.add(candidate)
    return candidate


def content_types(sheet_count: int) -> str:
    sheet_overrides = "".join(
        f'<Override PartName="/xl/worksheets/sheet{i}.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for i in range(1, sheet_count + 1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/styles.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        '<Override PartName="/docProps/core.xml" '
        'ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        '<Override PartName="/docProps/app.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        f"{sheet_overrides}</Types>"
    )


def workbook_xml(sheet_names: List[str]) -> str:
    sheets = "".join(
        f'<sheet name="{escape(name)}" sheetId="{index}" r:id="rId{index}"/>'
        for index, name in enumerate(sheet_names, start=1)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f"<sheets>{sheets}</sheets>"
        "</workbook>"
    )


def workbook_rels(sheet_count: int) -> str:
    rels = [
        f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        f'Target="worksheets/sheet{i}.xml"/>'
        for i in range(1, sheet_count + 1)
    ]
    rels.append(
        f'<Relationship Id="rId{sheet_count + 1}" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f"{''.join(rels)}</Relationships>"
    )


def root_rels() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" '
        'Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" '
        'Target="docProps/app.xml"/>'
        "</Relationships>"
    )


def styles_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="3">'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1">'
        '<alignment wrapText="1"/></xf>'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0">'
        '<alignment vertical="top" wrapText="1"/></xf>'
        '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        "</styleSheet>"
    )


def core_props() -> str:
    now = _dt.datetime.now(_dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:dcmitype="http://purl.org/dc/dcmitype/" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        "<dc:title>Extracted Drug Data</dc:title>"
        "<dc:creator>Codex</dc:creator>"
        f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>'
        f'<dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>'
        "</cp:coreProperties>"
    )


def app_props(sheet_names: List[str]) -> str:
    names = "".join(f"<vt:lpstr>{escape(name)}</vt:lpstr>" for name in sheet_names)
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
        'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
        "<Application>Python</Application>"
        f"<DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs>"
        '<vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>'
        f'<vt:variant><vt:i4>{len(sheet_names)}</vt:i4></vt:variant></vt:vector></HeadingPairs>'
        f'<TitlesOfParts><vt:vector size="{len(sheet_names)}" baseType="lpstr">{names}</vt:vector></TitlesOfParts>'
        "</Properties>"
    )


def write_xlsx(sheets: Dict[str, List[List[object]]], output_path: Path) -> None:
    used_names: set[str] = set()
    sheet_names = [unique_sheet_name(name, used_names) for name in sheets]
    items = list(zip(sheet_names, sheets.values()))

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as workbook:
        workbook.writestr("[Content_Types].xml", content_types(len(items)))
        workbook.writestr("_rels/.rels", root_rels())
        workbook.writestr("xl/workbook.xml", workbook_xml(sheet_names))
        workbook.writestr("xl/_rels/workbook.xml.rels", workbook_rels(len(items)))
        workbook.writestr("xl/styles.xml", styles_xml())
        workbook.writestr("docProps/core.xml", core_props())
        workbook.writestr("docProps/app.xml", app_props(sheet_names))
        for index, (_sheet_name, rows) in enumerate(items, start=1):
            workbook.writestr(posixpath.join("xl/worksheets", f"sheet{index}.xml"), sheet_xml(rows))


def main() -> None:
    all_data, _raw_sheets, _summary = extract_workbook_data()
    sheets: Dict[str, List[List[object]]] = {
        "All_Data": all_data,
    }

    write_xlsx(sheets, OUTPUT_FILE)
    print(f"Created {OUTPUT_FILE}")
    print(f"Normalized rows: {len(all_data) - 1}")
    print(f"Sheets: {len(sheets)}")


if __name__ == "__main__":
    main()
