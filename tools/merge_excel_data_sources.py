#!/usr/bin/env python3
"""Merge extracted Excel drug data into the app's two JavaScript databases."""

from __future__ import annotations

import json
import re
import subprocess
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
EXCEL_FILE = ROOT / "extracted_drug_data.xlsx"
DRUGS_FILE = ROOT / "drugs-data.js"
TOPICS_FILE = ROOT / "drug-topics-data.js"
REPORT_FILE = ROOT / "merge_report.json"

XLSX_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
BIDI_MARKS = "\u200e\u200f\u202a\u202b\u202c\u202d\u202e"
PLACEHOLDERS = {"", "-", "--", "---", "----", "-----", "------", "/", "//", "+", "ثبت نشده", "ندارد", "n/a", "na"}
VALID_TIMING_LABELS = {"با غذا", "بدون غذا", "فرقی نمی‌کند", "وضعیت ثابت"}
BRAND_STOPWORDS = {
    "and",
    "apo",
    "co",
    "for",
    "hour",
    "hours",
    "iran",
    "last",
    "six",
    "the",
    "with",
    "ایران",
    "در",
    "قدیمی",
    "موجود",
    "نیست",
    "پر",
    "پرمصرف",
    "ترین",
}

ARABIC_TRANSLATION = str.maketrans(
    {
        "ي": "ی",
        "ى": "ی",
        "ك": "ک",
        "ۀ": "ه",
        "ة": "ه",
        "ؤ": "و",
        "إ": "ا",
        "أ": "ا",
        "ٱ": "ا",
        "آ": "ا",
        "‌": " ",
        "۰": "0",
        "۱": "1",
        "۲": "2",
        "۳": "3",
        "۴": "4",
        "۵": "5",
        "۶": "6",
        "۷": "7",
        "۸": "8",
        "۹": "9",
        "٠": "0",
        "١": "1",
        "٢": "2",
        "٣": "3",
        "٤": "4",
        "٥": "5",
        "٦": "6",
        "٧": "7",
        "٨": "8",
        "٩": "9",
    }
)


def clean_text(value: object) -> str:
    text = "" if value is None else str(value)
    for mark in BIDI_MARKS:
        text = text.replace(mark, "")
    text = text.replace("\xa0", " ").replace("\r", "\n").translate(ARABIC_TRANSLATION)
    lines = []
    for line in text.split("\n"):
        line = re.sub(r"[ \t]+", " ", line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines).strip()


def compact_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", clean_text(value)).strip()


def is_meaningful(value: object) -> bool:
    text = compact_spaces(value).lower()
    text = text.replace("ـ", "")
    if not re.search(r"[0-9a-zA-Zآ-ی]", text):
        return False
    return text not in PLACEHOLDERS


def normalize_key(value: object) -> str:
    text = compact_spaces(value).lower()
    text = text.replace("ـ", "")
    text = re.sub(r"[\u064b-\u065f\u0670]", "", text)
    text = re.sub(r"\b(tab|tablet|cap|capsule|inj|injection|susp|syrup|drop|vial|amp|mg|ml|iv|im|po)\b", "", text)
    return re.sub(r"[^0-9a-zA-Zآ-ی]+", "", text)


def normalize_latin(value: object) -> str:
    text = compact_spaces(value).lower()
    return re.sub(r"[^0-9a-z]+", "", text)


def latin_phrases(value: str) -> List[str]:
    text = clean_text(value)
    phrases = re.findall(r"\(([A-Za-z][A-Za-z0-9 .,+/'’-]{1,80})\)", text)
    if not phrases:
        phrases = re.findall(r"\b[A-Za-z][A-Za-z0-9 .,+/'’-]{2,80}\b", text)
    output: List[str] = []
    for phrase in phrases:
        phrase = compact_spaces(phrase).strip(" -–—,؛;:/")
        if phrase and phrase.lower() not in {"iv", "im", "po", "ec", "sr", "xr"} and phrase not in output:
            output.append(phrase)
    return output


def persian_primary_name(value: str) -> str:
    text = clean_text(value)
    first_line = next((line for line in text.split("\n") if line.strip()), text)
    first_line = re.sub(r"\([A-Za-z][^)]*\)", "", first_line)
    first_line = re.sub(r"\b[A-Za-z][A-Za-z0-9 .,+/'’-]{1,80}\b", "", first_line)
    first_line = first_line.replace("®", "").replace("™", "")
    first_line = first_line.split("/")[0]
    first_line = re.sub(r"\((.*?)\)", r"\1", first_line)
    first_line = re.sub(r"\b(قدیمی ترین|پرمصرف ترین|در ایران موجود نیست)\b", "", first_line)
    return compact_spaces(first_line.strip(" -–—,،؛;:/"))


def display_name_parts(value: str) -> Tuple[str, str]:
    persian = persian_primary_name(value)
    latin = latin_phrases(value)
    english = latin[0] if latin else ""
    if not persian and not english:
        persian = compact_spaces(value)
    return persian, english


def name_keys(*values: object) -> List[str]:
    keys: List[str] = []

    def add(key: str) -> None:
        if key and key not in keys:
            keys.append(key)

    for value in values:
        text = clean_text(value)
        if not text:
            continue
        add(normalize_key(text))
        persian, english = display_name_parts(text)
        add(normalize_key(persian))
        add(normalize_latin(english))
        for phrase in latin_phrases(text):
            add(normalize_latin(phrase))
        for part in re.split(r"[/،,؛;]|\n", text):
            part = compact_spaces(part)
            if len(part) >= 3:
                add(normalize_key(part))
                add(normalize_latin(part))
    return [key for key in keys if key]


def cell_column_index(ref: str) -> int:
    letters = "".join(ch for ch in ref if ch.isalpha())
    index = 0
    for ch in letters:
        index = index * 26 + ord(ch.upper()) - 64
    return index - 1


def read_xlsx_rows(path: Path) -> List[Dict[str, str]]:
    with zipfile.ZipFile(path) as workbook:
        root = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))

    rows: List[List[str]] = []
    for row in root.findall(".//m:row", XLSX_NS):
        cells: Dict[int, str] = {}
        for cell in row.findall("m:c", XLSX_NS):
            text_node = cell.find(".//m:t", XLSX_NS)
            cells[cell_column_index(cell.attrib["r"])] = clean_text(text_node.text if text_node is not None else "")
        width = max(cells) + 1 if cells else 0
        rows.append([cells.get(index, "") for index in range(width)])

    if not rows:
        return []

    headers = rows[0]
    records: List[Dict[str, str]] = []
    for row in rows[1:]:
        record = {header: row[index] if index < len(row) else "" for index, header in enumerate(headers)}
        if is_meaningful(record.get("Drug Name")):
            persian, english = display_name_parts(record["Drug Name"])
            record["_generic_persian"] = persian
            record["_generic_english"] = english
            record["_keys"] = name_keys(record["Drug Name"], persian, english)
            records.append(record)
    return records


def parse_js_array(text: str, variable: str, path: Path) -> List[Dict[str, object]]:
    match = re.search(rf"window\.{re.escape(variable)}\s*=\s*(\[.*\])\s*;\s*$", text, re.S)
    if not match:
        raise ValueError(f"Could not parse {variable} from {path}")
    return json.loads(match.group(1))


def read_js_array(path: Path, variable: str) -> List[Dict[str, object]]:
    text = path.read_text(encoding="utf-8")
    return parse_js_array(text, variable, path)


def read_git_baseline_array(path: Path, variable: str) -> List[Dict[str, object]]:
    try:
        text = subprocess.check_output(
            ["git", "show", f"HEAD:{path.name}"],
            cwd=ROOT,
            stderr=subprocess.DEVNULL,
        ).decode("utf-8")
    except Exception:
        text = path.read_text(encoding="utf-8")
    return parse_js_array(text, variable, path)


def write_js_array(path: Path, variable: str, data: List[Dict[str, object]]) -> None:
    encoded = json.dumps(data, ensure_ascii=False, indent=2)
    path.write_text(f"window.{variable} = {encoded};\n", encoding="utf-8")


def first_meaningful(*values: object) -> str:
    for value in values:
        if is_meaningful(value):
            return clean_text(value)
    return ""


def join_unique(values: Iterable[object], separator: str = "\n") -> str:
    output: List[str] = []
    for value in values:
        text = clean_text(value)
        if not is_meaningful(text):
            continue
        parts = text.split("\n") if separator == "\n" else [text]
        for part in parts:
            part = compact_spaces(part)
            if part and part not in output:
                output.append(part)
    return separator.join(output)


def split_brands(value: object) -> List[str]:
    text = clean_text(value)
    if not is_meaningful(text):
        return []
    text = text.replace("®", " ").replace("™", " ")
    pieces = re.split(r"[\n،,;؛/]+|[-–—]+|\s+", text)
    brands: List[str] = []
    for piece in pieces:
        piece = compact_spaces(piece).strip(" -–—,،؛;:/()[]{}")
        if normalize_latin(piece) in BRAND_STOPWORDS or normalize_key(piece) in BRAND_STOPWORDS:
            continue
        if len(normalize_key(piece)) < 2:
            continue
        if is_meaningful(piece) and piece not in brands:
            brands.append(piece)
    return brands


def remove_generic_from_brand(brand: object, generic: object, english_generic: object = "") -> str:
    brand_text = compact_spaces(brand).replace("®", "").replace("™", "").strip(" -–—,،؛;:/")
    if not is_meaningful(brand_text):
        return ""

    generic_variants = [
        compact_spaces(generic),
        compact_spaces(english_generic),
        *latin_phrases(str(generic)),
    ]
    generic_keys = {normalize_key(item) for item in generic_variants if item}
    generic_latin_keys = {normalize_latin(item) for item in generic_variants if item}
    brand_key = normalize_key(brand_text)
    brand_latin_key = normalize_latin(brand_text)

    if brand_key in generic_keys or brand_latin_key in generic_latin_keys:
        return ""

    cleaned = brand_text
    for variant in sorted(generic_variants, key=len, reverse=True):
        variant = compact_spaces(variant)
        if not variant:
            continue
        cleaned = re.sub(rf"(?i)(^|[\\s,،؛;/\\-–—()+]){re.escape(variant)}(?=$|[\\s,،؛;/\\-–—()+])", " ", cleaned)

    cleaned = compact_spaces(cleaned).strip(" -–—,،؛;:/()+")
    for variant in sorted(generic_variants, key=len, reverse=True):
        variant_key = normalize_key(variant)
        variant_latin_key = normalize_latin(variant)
        if not variant_key and not variant_latin_key:
            continue
        if variant_latin_key and variant_latin_key in normalize_latin(cleaned):
            return ""
        if variant_key and re.search(r"[آ-ی]", variant_key) and variant_key in normalize_key(cleaned):
            cleaned = compact_spaces(re.split(re.escape(variant), cleaned, maxsplit=1)[0]).strip(" -–—,،؛;:/()+")
    if normalize_key(cleaned) in generic_keys or normalize_latin(cleaned) in generic_latin_keys:
        return ""
    return cleaned if is_meaningful(cleaned) else ""


def split_clean_brands(value: object, generic: object, english_generic: object = "") -> List[str]:
    output: List[str] = []
    for brand in split_brands(value):
        cleaned = remove_generic_from_brand(brand, generic, english_generic)
        if cleaned and cleaned not in output:
            output.append(cleaned)
    return output


def normalize_answer_item(value: object) -> str:
    item = compact_spaces(value).strip(" -–—,،؛;:/()[]{}")
    if not is_meaningful(item):
        return ""
    if ">" in item:
        return ""
    item = re.sub(r"^\d+[.)-]\s*", "", item)
    item = re.sub(r"^[+•*]+\s*", "", item)
    if ":" in item or "：" in item:
        parts = re.split(r":|：", item, maxsplit=1)
        prefix = compact_spaces(parts[0])
        suffix = compact_spaces(parts[1] if len(parts) > 1 else "")
        prefix_key = normalize_key(prefix)
        if any(token in prefix_key for token in ("مشکلاتگوارشی", "عوارضگوارشی", "گوارشی")):
            item = prefix
        elif is_meaningful(suffix):
            item = suffix
        else:
            item = prefix
    item = re.sub(r"\((?:[^)]{18,}|به دلیل[^)]*)\)", "", item).strip()
    item = re.sub(r"\b(?:بسته به دارو|برای برخی|در برخی|وابسته به دارو)\b", "", item).strip()
    key = normalize_key(item)
    latin_key = normalize_latin(item)

    if any(
        token in key
        for token in (
            "استفادهازer",
            "استفادهازh2blocker",
            "کاهشدوز",
            "نیازبهمانیتورینگ",
            "مانیتورینگ",
            "ترتیبعوارض",
            "درمانبا",
            "مصرفبیشاز",
            "بیشتردرمصرف",
            "اثراتاینوتروپ",
            "اثراینوتروپ",
            "nsaidها",
            "تنگکنندهعروق",
            "کاهشخونرسانی",
        )
    ):
        return ""
    if "paresthesia" in latin_key or "گزگز" in key:
        return "گزگز"
    if latin_key in {"gi", "git"} or "عوارضgi" in key or "مشکلاتگوارشی" in key:
        return "مشکلات گوارشی"
    if key in {"گوارشی", "عوارضگوارشی", "اختلالاتگوارشی"}:
        return "مشکلات گوارشی"
    if "sedation" in latin_key or "خوابالو" in key or "خوابالود" in key:
        return "خواب‌آلودگی"
    if "سرگیجه" in key:
        return "سرگیجه"
    if "گیجی" in key:
        return "گیجی"
    if "تهوع" in key and "استفراغ" in key:
        return "تهوع/استفراغ"
    if "تهوع" in key:
        return "تهوع"
    if "استفراغ" in key:
        return "استفراغ"
    if "اسهال" in key:
        return "اسهال"
    if "یبوست" in key:
        return "یبوست"
    if "انژیوادم" in key or "انژیوادم" in key:
        return "آنژیوادم"
    if "ادموباد" in key or ("ادم" in key and len(key) <= 18):
        return "ادم"
    if "عفونتگوارشی" in key:
        return "عفونت گوارشی"
    if "کاهشجذب" in key:
        return item
    if "راش" in key:
        return "راش"
    if "افتفشار" in key or "هیپوتانسیون" in key:
        return "افت فشار"
    if "هایپرکالمی" in key:
        return "هایپرکالمی"
    if "هیپوکالمی" in key:
        return "هیپوکالمی"
    if "سردرد" in key:
        return "سردرد"
    if "خشکیدهان" in key:
        return "خشکی دهان"
    if "الرژی" in key or "حساسیت" in key:
        return "واکنش حساسیتی"
    if "عفونت" in key and len(key) <= 18:
        return "عفونت"
    if "درد" in key and len(key) <= 12:
        return "درد"
    if len(item) > 70:
        item = re.split(r"\b(?:که|در صورت|به دلیل|بسته به|برای|وابسته|ریسک)\b", item)[0]
        item = compact_spaces(item)
    return item[:70].rstrip(" ،,؛;")


def answer_concept_key(value: object) -> str:
    item = normalize_answer_item(value)
    key = normalize_key(item)
    if key in {"مشکلاتگوارشی", "گوارشی", "عوارضگوارشی"}:
        return "gi"
    if key in {"تهوع", "استفراغ", "تهوعاستفراغ"}:
        return key
    return key


def concise_answer(value: object, limit: int = 120) -> str:
    text = clean_text(value)
    if not is_meaningful(text):
        return ""
    pieces = re.split(r"\n|؛|;|،|,|/|\s+-\s+", text)
    selected: List[str] = []
    seen: set[str] = set()
    for piece in pieces:
        piece = normalize_answer_item(piece)
        concept = answer_concept_key(piece)
        if piece and concept and concept not in seen:
            selected.append(piece)
            seen.add(concept)
        if len("، ".join(selected)) >= limit or len(selected) >= 3:
            break
    answer = "، ".join(selected)
    return answer[:limit].rstrip(" ،,؛;")


def classify_food_relation(value: object) -> str:
    text = compact_spaces(value)
    key = normalize_key(text)
    if not is_meaningful(text):
        return ""
    if any(token in key for token in ("فرقیندارد", "فرقینمیکند", "بایابدون", "باتوجهبهغذانیست", "غذاتاثیریندارد")):
        return "فرقی نمی‌کند"
    if any(token in key for token in ("وضعیتثابت", "ثابت")):
        return "وضعیت ثابت"
    if any(token in key for token in ("معدهخالی", "ناشتا", "قبلازغذا", "قبلازوعده")):
        return "بدون غذا"
    if any(token in key for token in ("بعدازغذا", "همراهباغذا", "باغذا", "باصبحانه", "باشیر", "بعدازوعده")):
        return "با غذا"
    if "بدونغذا" in key:
        return "بدون غذا"
    return "فرقی نمی‌کند"


def normalize_sorted_food_label(value: object) -> str:
    text = clean_text(value)
    key = normalize_key(text)
    if not is_meaningful(text):
        return ""
    if "فرقینمیکند" in key or "فرقیندارد" in key:
        return "فرقی نمی‌کند"
    if "همراهیابعدازغذا" in key or "بعدازغذا" in key or "باغذا" in key:
        return "با غذا"
    if "قبلازغذاناشتا" in key or "قبلازغذا" in key or "ناشتا" in key or "بدونغذا" in key:
        return "بدون غذا"
    if "وضعیتثابت" in key:
        return "وضعیت ثابت"
    return classify_food_relation(text)


def build_key_index(records: List[Dict[str, object]], fields: Iterable[str]) -> Dict[str, List[int]]:
    index: Dict[str, List[int]] = defaultdict(list)
    for row_index, record in enumerate(records):
        keys = name_keys(*(record.get(field, "") for field in fields))
        for key in keys:
            if row_index not in index[key]:
                index[key].append(row_index)
    return index


def find_first_match(keys: Iterable[str], index: Dict[str, List[int]], used: Optional[set[int]] = None) -> Optional[int]:
    for key in keys:
        for row_index in index.get(key, []):
            if used is None or row_index not in used:
                return row_index
    return None


def best_excel_by_generic(excel_rows: List[Dict[str, str]]) -> Dict[str, Dict[str, str]]:
    best: Dict[str, Dict[str, str]] = {}
    for row in excel_rows:
        for key in row["_keys"]:
            if key and key not in best:
                best[key] = row
    return best


def make_drugs_data(excel_rows: List[Dict[str, str]], old_drugs: List[Dict[str, object]]) -> Tuple[List[Dict[str, object]], Dict[str, int]]:
    old_index = build_key_index(old_drugs, ["name", "pname"])
    used_old: set[int] = set()
    matched_old_indices: set[int] = set()
    final_by_key: Dict[str, Dict[str, object]] = {}
    final_order: List[str] = []
    stats = {"matched": 0, "new": 0, "old_unmatched_kept": 0, "excel_rows_used": 0, "excel_rows_skipped_no_food": 0}

    for row in excel_rows:
        keys = row["_keys"]
        old_index_match = find_first_match(keys, old_index)
        has_food = is_meaningful(row.get("Food Relation"))
        if old_index_match is None and not has_food:
            stats["excel_rows_skipped_no_food"] += 1
            continue

        old = old_drugs[old_index_match] if old_index_match is not None else {}
        if old_index_match is not None:
            used_old.add(old_index_match)
            matched_old_indices.add(old_index_match)
        else:
            pass

        persian = first_meaningful(row.get("_generic_persian"), old.get("pname"), row.get("_generic_english"), old.get("name"))
        english = first_meaningful(row.get("_generic_english"), old.get("name"), persian)
        primary_key = normalize_latin(english) or normalize_key(persian) or (keys[0] if keys else normalize_key(row.get("Drug Name")))
        if not primary_key:
            continue
        food = first_meaningful(row.get("Food Relation"), old.get("consumptionTime"), "ثبت نشده")
        food_label = classify_food_relation(food)
        if not food_label:
            stats["excel_rows_skipped_no_food"] += 1
            continue
        dosage = first_meaningful(row.get("Dosage Forms"), old.get("dosageForm"), "ثبت نشده")

        existing = final_by_key.get(primary_key)
        if existing:
            existing["dosageForm"] = join_unique([existing.get("dosageForm", ""), dosage])
            if has_food:
                existing["consumptionTime"] = join_unique([existing.get("consumptionTime", ""), food])
                existing["consumptionTimeSorted"] = classify_food_relation(existing["consumptionTime"])
            continue

        final_by_key[primary_key] = {
            "id": "",
            "name": english,
            "pname": persian,
            "dosageForm": dosage,
            "consumptionTime": food,
            "consumptionTimeSorted": food_label,
        }
        if old_index_match is None:
            stats["new"] += 1
        if is_meaningful(row.get("Drug Category")):
            final_by_key[primary_key]["drugClassification"] = clean_text(row["Drug Category"])
        if is_meaningful(row.get("Brand Name")):
            final_by_key[primary_key]["brandName"] = clean_text(row["Brand Name"])
        final_order.append(primary_key)
        stats["excel_rows_used"] += 1

    for old_index_value, old in enumerate(old_drugs):
        if old_index_value in used_old:
            continue
        key = name_keys(old.get("name", ""), old.get("pname", ""))
        primary_key = key[0] if key else f"old-{old_index_value}"
        if primary_key in final_by_key:
            continue
        old_sorted = normalize_sorted_food_label(old.get("consumptionTimeSorted", ""))
        if old_sorted not in VALID_TIMING_LABELS:
            continue
        final_by_key[primary_key] = {
            "id": "",
            "name": clean_text(old.get("name", "")),
            "pname": clean_text(old.get("pname", "")),
            "dosageForm": clean_text(old.get("dosageForm", "")),
            "consumptionTime": clean_text(old.get("consumptionTime", "")),
            "consumptionTimeSorted": old_sorted,
        }
        final_order.append(primary_key)
        stats["old_unmatched_kept"] += 1

    final = [final_by_key[key] for key in final_order]
    final = [record for record in final if normalize_sorted_food_label(record.get("consumptionTimeSorted", "")) in VALID_TIMING_LABELS]
    for index, record in enumerate(final, start=1):
        record["id"] = f"drug-{index:03d}"
        record["consumptionTimeSorted"] = normalize_sorted_food_label(record.get("consumptionTimeSorted", ""))
    stats["matched"] = len(matched_old_indices)
    return final, stats


def topic_record_from_excel(
    row: Dict[str, str],
    brand: str,
    old: Optional[Dict[str, object]] = None,
    preserve_old_brand: bool = False,
) -> Dict[str, object]:
    old = old or {}
    generic = first_meaningful(row.get("_generic_persian"), old.get("genericName"), row.get("_generic_english"))
    raw_brand = first_meaningful(old.get("brandName") if preserve_old_brand else "", brand, old.get("brandName"))
    brand_name = remove_generic_from_brand(raw_brand, generic, row.get("_generic_english"))
    if not brand_name:
        return {}
    indication = first_meaningful(row.get("Indication"), old.get("indication"))
    side_effects = first_meaningful(row.get("Side Effects"), old.get("sideEffects"))

    record: Dict[str, object] = {
        "id": "",
        "brandName": brand_name,
        "genericName": generic,
        "sideEffects": side_effects,
        "sideEffectsAnswer": concise_answer(side_effects) or clean_text(old.get("sideEffectsAnswer", "")),
        "indication": indication,
        "indicationAnswer": concise_answer(indication) or clean_text(old.get("indicationAnswer", "")),
        "dosageForm": first_meaningful(row.get("Dosage Forms"), old.get("dosageForm"), "ثبت نشده"),
        "drugClassification": first_meaningful(row.get("Drug Category"), old.get("drugClassification"), "ثبت نشده"),
    }

    extras = {
        "dosing": row.get("Dosing / Administration"),
        "foodRelation": row.get("Food Relation"),
        "pregnancy": row.get("Pregnancy"),
        "breastfeeding": row.get("Breastfeeding"),
        "pregnancyBreastfeeding": row.get("Pregnancy & Breastfeeding"),
        "doseAdjustment": row.get("Dose Adjustment"),
        "notes": row.get("Notes"),
        "sourceTopic": row.get("Source Topic"),
        "sourceFile": row.get("Source File"),
    }
    for key, value in extras.items():
        if is_meaningful(value):
            record[key] = clean_text(value)
    return record


def make_topics_data(excel_rows: List[Dict[str, str]], old_topics: List[Dict[str, object]]) -> Tuple[List[Dict[str, object]], Dict[str, int]]:
    old_generic_index = build_key_index(old_topics, ["genericName"])
    used_old: set[int] = set()
    final: List[Dict[str, object]] = []
    final_pairs: set[Tuple[str, str]] = set()
    stats = {"matched_brand": 0, "matched_generic": 0, "new": 0, "old_unmatched_kept": 0}

    def add_record(record: Dict[str, object]) -> bool:
        pair = (normalize_key(record.get("genericName", "")), normalize_key(record.get("brandName", "")))
        if not pair[0] or pair in final_pairs:
            return False
        final_pairs.add(pair)
        final.append(record)
        return True

    for row in excel_rows:
        brands = split_clean_brands(row.get("Brand Name"), row.get("_generic_persian"), row.get("_generic_english"))
        generic_old_indices: List[int] = []
        for key in row["_keys"]:
            for old_index in old_generic_index.get(key, []):
                if old_index not in generic_old_indices:
                    generic_old_indices.append(old_index)

        for brand in brands:
            exact_old: Optional[int] = None
            brand_key = normalize_key(brand)
            for old_index in generic_old_indices:
                if normalize_key(old_topics[old_index].get("brandName", "")) == brand_key:
                    exact_old = old_index
                    break
            if exact_old is not None:
                used_old.add(exact_old)
                record = topic_record_from_excel(row, brand, old_topics[exact_old])
                if record and add_record(record):
                    stats["matched_brand"] += 1
            else:
                record = topic_record_from_excel(row, brand)
                if record and add_record(record):
                    stats["new"] += 1

        for old_index in generic_old_indices:
            if old_index in used_old:
                continue
            old = old_topics[old_index]
            record = topic_record_from_excel(row, clean_text(old.get("brandName", "")), old, preserve_old_brand=True)
            if record and add_record(record):
                used_old.add(old_index)
                stats["matched_generic"] += 1

    for old_index, old in enumerate(old_topics):
        if old_index in used_old:
            continue
        old_brand = remove_generic_from_brand(old.get("brandName", ""), old.get("genericName", ""))
        if not old_brand:
            continue
        if add_record(
            {
                "id": "",
                "brandName": old_brand,
                "genericName": clean_text(old.get("genericName", "")),
                "sideEffects": clean_text(old.get("sideEffects", "")),
                "sideEffectsAnswer": concise_answer(first_meaningful(old.get("sideEffects", ""), old.get("sideEffectsAnswer", ""))),
                "indication": clean_text(old.get("indication", "")),
                "indicationAnswer": concise_answer(first_meaningful(old.get("indication", ""), old.get("indicationAnswer", ""))),
                "dosageForm": clean_text(old.get("dosageForm", "")),
                "drugClassification": clean_text(old.get("drugClassification", "")),
            }
        ):
            stats["old_unmatched_kept"] += 1

    for index, record in enumerate(final, start=1):
        record["id"] = f"topic-drug-{index:03d}"
    return final, stats


def main() -> None:
    excel_rows = read_xlsx_rows(EXCEL_FILE)
    old_drugs = read_git_baseline_array(DRUGS_FILE, "DRUGS_DATA")
    old_topics = read_git_baseline_array(TOPICS_FILE, "DRUG_TOPIC_DATA")

    new_drugs, drug_stats = make_drugs_data(excel_rows, old_drugs)
    new_topics, topic_stats = make_topics_data(excel_rows, old_topics)

    write_js_array(DRUGS_FILE, "DRUGS_DATA", new_drugs)
    write_js_array(TOPICS_FILE, "DRUG_TOPIC_DATA", new_topics)

    report = {
        "excelRows": len(excel_rows),
        "drugsData": {
            "before": len(old_drugs),
            "after": len(new_drugs),
            **drug_stats,
        },
        "drugTopicData": {
            "before": len(old_topics),
            "after": len(new_topics),
            **topic_stats,
        },
    }
    REPORT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
