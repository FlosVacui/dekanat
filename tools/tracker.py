#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0", "openpyxl>=3.1"]
# ///
"""Учёт проекта: tracker.yaml -> Excel-график (дневная сетка) и зеркало в GitHub Projects.

Источник правды - docs/tracker/tracker.yaml. Excel генерируется командой build;
доску GitHub Projects (v2) и Issues обновляет gh-sync (одностороннее зеркало YAML -> GitHub).
Команды: build, sync, add, mark, log, review, review-status, decision, due, gh-sync.
Подробности: uv run tools/tracker.py --help, docs/tracker/README.md.
"""

import argparse
import datetime as dt
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import yaml
from openpyxl import Workbook, load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parent.parent
DEF_YAML = ROOT / "docs" / "tracker" / "tracker.yaml"
DEF_XLSX = ROOT / "docs" / "tracker" / "График_работ.xlsx"

# ----------------------------------------------------------------- константы
# статус -> (цвет заливки, цвет текста, пояснение)
STATUSES = {
    "План": ("7B5CB8", "FFFFFF", "Запланировано на этот день."),
    "В работе": ("2F6FB5", "FFFFFF", "Исполнитель работает над пунктом."),
    "Выполнено": ("2F6B2F", "FFFFFF", "Принято оркестратором (после ревью)."),
    "Доработка": ("F4C542", "333333", "После ревью есть блокирующие или существенные замечания."),
    "Ждёт решения": ("C0392B", "FFFFFF", "Нужен ответ пользователя (развилка), срок наступил."),
}
SEVERITIES = ["блокирующее", "существенное", "незначительное", "предложение"]
REVIEW_STATUSES = ["открыто", "исправлено", "отложено", "отклонено"]

HEAD_FILL = "2E5E1E"
STAGE_FILL = "D9D9D9"
MARK_FILL = "FCE4D6"  # пустые клетки в дни-отметки
MARK_HEAD_FILL = "C55A11"  # шапка дня-отметки
WEEKEND_FILL = "F2F2F2"
TODAY_COLOR = "C00000"
BORDER_COLOR = "BFBFBF"
MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Нояб", "Дек"]
WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
MAX_DAYS = 400  # предел разумной сетки (у Excel не более 16384 колонок)
SHEET_MAIN = "График"
SNAP_SHEET = "_snapshot"
HEAD_ROWS = 3  # строк шапки в «Графике»: месяц, дата, день недели

DEFAULT_HEADER = """\
# ============================================================================
# «Цифровой деканат» - учёт проекта. ИСТОЧНИК ПРАВДЫ для Excel-графика и доски GitHub Projects.
# Excel (docs/tracker/График_работ.xlsx, в git не хранится) собирается командой:
#     uv run tools/tracker.py build
# Доска GitHub Projects обновляется командой:
#     uv run tools/tracker.py gh-sync
# Правьте этот файл (руками или командами tracker.py add/mark/log/...), а не Excel и не доску.
# Исключение: колонка «Комментарий» листа «График» и колонки «Решение пользователя» /
# «Дата решения» листа «Решения» - их можно писать в Excel; `tracker.py sync` (и любая сборка) вернёт их сюда.
#
# Структура файла (ключи верхнего уровня):
#   project        название проекта (строка)
#   start_date     первый день сетки (дата; 2026-11-10)
#   grid_end       последний день сетки (дата; 2026-11-22). Сетка сама расширяется, если план или факт выходят за неё.
#   calendar       marks - отметки дней: список {date, text}; дни подсвечиваются в «Графике»
#   people         участники: {id, name, account, github}
#   github         зеркало: {owner, project_title, repo} - куда gh-sync пишет Issues и карточки
#   items          пункты графика (см. ниже)
#   history        записи листа «История»
#   reviews        замечания ревью (лист «Ревью»)
#   decisions      развилки Р-x (лист «Решения»)
#   roles          таблица ролей (лист «Легенда»)
#   external_requests  запросы во внешние нейросети ВН-xx (лист «Легенда»)
#
# items - список пунктов в порядке показа:
#   id         номер: "0" (этап), "1.2" (подэтап), "9.2.1" (глубже); всегда в кавычках
#   title      короткое название (до ~90 символов)
#   stage      true для строки этапа (жирная, серая; план и сроки берутся из подэтапов)
#   person     участник: "А", "Б", "В" или несколько через запятую ("Б, В")
#   owner      исполнитель: роль (модель / effort)
#   review     ревью: кто проверяет
#   plan       {start: дата, end: дата} - плановые даты; end - это срок (дедлайн) пункта
#   fact       {дата: статус} - факт по дням. Статусы: План, В работе, Выполнено, Доработка, Ждёт решения
#   comment    заметка (синхронизируется с колонкой «Комментарий» Excel)
#   issue      номер Issue на GitHub (пишет gh-sync, руками не менять)
#   Правило клетки дня: есть факт - показываем его; иначе день внутри плана - «План»; иначе пусто.
# Пустые поля в файле не пишутся. Комментарии внутри данных при перезаписи командами
# не сохраняются (этот заголовок сохраняется) - пишите заметки в поле comment.
#
# history:   {date, item, what, who, commit, rounds, tokens, link}
# reviews:   {id, item, round, severity, text, repro, by, status, comment}
#            severity: блокирующее | существенное | незначительное | предложение
#            status:   открыто | исправлено | отложено | отклонено
# decisions: {id, question, options, recommendation, deadline, default, answer, answer_date}
# ============================================================================
"""  # noqa: E501

KNOWN_KEYS = {
    "project",
    "start_date",
    "grid_end",
    "calendar",
    "people",
    "github",
    "items",
    "history",
    "reviews",
    "decisions",
    "roles",
    "external_requests",
}
ITEM_ORDER = ["id", "title", "stage", "person", "owner", "review", "plan", "fact", "comment", "issue"]
HISTORY_ORDER = ["date", "item", "what", "who", "commit", "rounds", "tokens", "link"]
REVIEW_ORDER = ["id", "item", "round", "severity", "text", "repro", "by", "status", "comment"]
DECISION_ORDER = [
    "id",
    "question",
    "options",
    "recommendation",
    "deadline",
    "default",
    "answer",
    "answer_date",
]
ROLE_ORDER = ["role", "model", "task"]
EXT_ORDER = ["id", "item", "what"]


class TrackerError(Exception):
    """Ошибка данных или аргументов (код выхода 1)."""


class LockedError(Exception):
    """Excel-файл занят (код выхода 2)."""


class GhError(Exception):
    """Ошибка вызова gh (код выхода 1)."""


# ----------------------------------------------------------------- YAML
def to_date(v):
    if v is None or v == "":
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d.%m.%y"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    raise TrackerError(f"Не удалось разобрать дату: {v!r} (нужно ГГГГ-ММ-ДД или ДД.ММ.ГГГГ)")


def extract_header(text):
    lines = []
    for ln in text.splitlines():
        if ln.startswith("#") or not ln.strip():
            lines.append(ln)
        else:
            break
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines) + "\n" if lines else ""


def normalize(data):
    if not isinstance(data, dict):
        raise TrackerError("tracker.yaml: корень должен быть словарём")
    data.setdefault("project", "Цифровой деканат")
    data["start_date"] = to_date(data.get("start_date"))
    if data["start_date"] is None:
        raise TrackerError("tracker.yaml: не задан start_date")
    data["grid_end"] = to_date(data.get("grid_end"))
    if data["grid_end"] and data["grid_end"] < data["start_date"]:
        raise TrackerError("tracker.yaml: grid_end раньше start_date")
    cal = data.get("calendar") or {}
    marks = []
    for m in cal.get("marks") or []:
        m["date"] = to_date(m.get("date"))
        if m["date"] is None:
            raise TrackerError(f"calendar.marks: у отметки {m} нет даты")
        m["text"] = str(m.get("text", ""))
        marks.append(m)
    cal["marks"] = marks
    data["calendar"] = cal
    for p in data.get("people") or []:
        p["id"] = str(p["id"])
    data["people"] = data.get("people") or []
    data["github"] = data.get("github") or {}
    for key in ("items", "history", "reviews", "decisions", "roles", "external_requests"):
        data[key] = data.get(key) or []
    seen = set()
    for it in data["items"]:
        if "id" not in it or not it.get("title"):
            raise TrackerError(f"У пункта {it.get('id', it)} нет обязательных полей id/title")
        it["id"] = str(it["id"])
        if it["id"] in seen:
            raise TrackerError(f"Повтор номера пункта: {it['id']}")
        seen.add(it["id"])
        if it.get("person") is not None:
            it["person"] = str(it["person"])
        if it.get("plan"):
            p = it["plan"]
            p["start"], p["end"] = to_date(p.get("start")), to_date(p.get("end"))
            if p["start"] is None or p["end"] is None or p["start"] > p["end"]:
                raise TrackerError(f"Пункт {it['id']}: некорректный plan {p}")
        fact = {}
        for k, v in (it.get("fact") or {}).items():
            if v not in STATUSES:
                raise TrackerError(
                    f"Пункт {it['id']}: неизвестный статус {v!r} (допустимо: {', '.join(STATUSES)})"
                )
            fact[to_date(k)] = v
        it["fact"] = dict(sorted(fact.items()))
        if it.get("issue") in (None, ""):
            it.pop("issue", None)
        else:
            it["issue"] = int(it["issue"])
    for h in data["history"]:
        h["date"] = to_date(h.get("date"))
        if "item" in h:
            h["item"] = str(h["item"])
    for r in data["reviews"]:
        r["item"] = str(r.get("item", ""))
    for d in data["decisions"]:
        d["id"] = str(d["id"])
        d["deadline"] = to_date(d.get("deadline"))
        d["answer_date"] = to_date(d.get("answer_date"))
    return data


def load_data(path):
    text = Path(path).read_text(encoding="utf-8-sig")
    data = yaml.safe_load(text)
    return normalize(data), extract_header(text)


_ESCAPES = {"\u0085": "\\u0085", "\u2028": "\\u2028", "\u2029": "\\u2029"}


def jstr(s):
    """Строка в двойных кавычках; U+0085/U+2028/U+2029 YAML считает концами строк - пишем их экранами."""
    out = json.dumps(s, ensure_ascii=False)
    for ch, esc in _ESCAPES.items():
        out = out.replace(ch, esc)
    return out


def _qkey(k):
    if isinstance(k, (dt.datetime, dt.date)):
        return (k.date() if isinstance(k, dt.datetime) else k).isoformat()
    if isinstance(k, int):
        return str(k)
    return k if re.fullmatch(r"[\w.\-]+", k) else jstr(k)


def flow(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (dt.datetime, dt.date)):
        return (v.date() if isinstance(v, dt.datetime) else v).isoformat()
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, dict):
        return "{" + ", ".join(f"{_qkey(k)}: {flow(x)}" for k, x in v.items()) + "}"
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(flow(x) for x in v) + "]"
    return jstr(str(v))


def _empty(v):
    return v is None or v == "" or v == {} or v == []


def emit_list(name, rows, order, always=("id",)):
    if not rows:
        return [f"{name}: []"]
    out = [f"{name}:"]
    for row in rows:
        keys = [k for k in order if k in row] + [k for k in row if k not in order]
        keys = [k for k in keys if k in always or not _empty(row[k])]
        for i, k in enumerate(keys):
            out.append(f"  {'- ' if i == 0 else '  '}{k}: {flow(row[k])}")
    return out


def dump_yaml(data, header):
    out = []
    out.append((header or DEFAULT_HEADER).rstrip("\n"))
    out.append("")
    out.append(f"project: {flow(data['project'])}")
    out.append(f"start_date: {flow(data['start_date'])}")
    if data.get("grid_end"):
        out.append(f"grid_end: {flow(data['grid_end'])}")
    out.append("")
    out.append("calendar:")
    cal = data.get("calendar") or {}
    if cal.get("marks"):
        out.append("  marks:")
        for m in cal["marks"]:
            out.append(f"    - {flow(m)}")
    else:
        out.append("  marks: []")
    for k in cal:
        if k != "marks":
            out.append(f"  {_qkey(k)}: {flow(cal[k])}")
    out.append("")
    if data.get("people"):
        out.append("people:")
        for p in data["people"]:
            out.append(f"  - {flow(p)}")
    else:
        out.append("people: []")
    out.append("")
    if data.get("github"):
        out.append("github:")
        for k, v in data["github"].items():
            out.append(f"  {_qkey(k)}: {flow(v)}")
        out.append("")
    out.append("items:")
    for it in data["items"]:
        if it.get("stage"):
            out.append("")
        row = dict(it)
        keys = [k for k in ITEM_ORDER if k in row] + [k for k in row if k not in ITEM_ORDER]
        keys = [k for k in keys if k in ("id", "title") or not _empty(row[k])]
        for i, k in enumerate(keys):
            out.append(f"  {'- ' if i == 0 else '  '}{k}: {flow(row[k])}")
    out.append("")
    out += emit_list("history", data["history"], HISTORY_ORDER, always=("date",))
    out.append("")
    out += emit_list("reviews", data["reviews"], REVIEW_ORDER)
    out.append("")
    out += emit_list("decisions", data["decisions"], DECISION_ORDER)
    out.append("")
    out += emit_list("roles", data["roles"], ROLE_ORDER, always=("role",))
    out.append("")
    out += emit_list("external_requests", data["external_requests"], EXT_ORDER)
    for k in data:
        if k not in KNOWN_KEYS:
            out.append("")
            out.append(f"{_qkey(k)}: {flow(data[k])}")
    return "\n".join(out) + "\n"


def atomic_write_text(path, text):
    path = Path(path)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp_", suffix=".yaml")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def save_data(path, data, header):
    atomic_write_text(path, dump_yaml(data, header))


# ----------------------------------------------------------------- модель: дни и сроки
def fmt_date(d):
    return d.strftime("%d.%m.%Y") if d else ""


def fmt_dm(d):
    return d.strftime("%d.%m") if d else ""


def id_key(iid):
    return tuple(int(x) if x.isdigit() else 0 for x in iid.split("."))


def persons_of(it):
    """Буквы участников пункта: "Б, В" -> ["Б", "В"]."""
    return [x.strip() for x in str(it.get("person") or "").split(",") if x.strip()]


def descendants(items, it):
    pref = it["id"] + "."
    return [x for x in items if x["id"].startswith(pref)]


def eff_plan(items, it):
    """(start, end) или None; для этапа - объединение планов подэтапов."""
    if it.get("stage"):
        ds = [x["plan"] for x in descendants(items, it) if x.get("plan")]
        if ds:
            return min(p["start"] for p in ds), max(p["end"] for p in ds)
    p = it.get("plan")
    return (p["start"], p["end"]) if p else None


def own_fact_range(it):
    """(fact_start, fact_end) по собственному факту пункта."""
    fact = it.get("fact") or {}
    if not fact:
        return None, None
    last = max(fact)
    return min(fact), (last if fact[last] == "Выполнено" else None)


def eff_fact(items, it):
    if it.get("stage"):
        ds = [x for x in descendants(items, it) if not x.get("stage")]
        ranges = [own_fact_range(x) for x in ds]
        starts = [r[0] for r in ranges if r[0]]
        fs = min(starts) if starts else None
        fe = None
        if ds and all(r[1] for r in ranges):
            fe = max(r[1] for r in ranges)
        o = own_fact_range(it)
        return o[0] or fs, o[1] or fe
    return own_fact_range(it)


def eff_status(items, it):
    """Текущий статус: последний по дате факт, иначе «План» (для этапа - по подэтапам)."""
    fact = it.get("fact") or {}
    if fact:
        return fact[max(fact)]
    if it.get("stage"):
        ds = [x for x in descendants(items, it) if not x.get("stage")]
        if ds and all(eff_status(items, x) == "Выполнено" for x in ds):
            return "Выполнено"
        if any(x.get("fact") for x in ds):
            return "В работе"
    return "План"


PRIORITY = ["Ждёт решения", "Доработка", "В работе"]


def day_status(items, it, d):
    """Статус клетки дня d у пункта (None - пусто)."""
    fact = it.get("fact") or {}
    if d in fact:
        return fact[d]
    if not it.get("stage"):
        p = it.get("plan")
        return "План" if p and p["start"] <= d <= p["end"] else None
    sts = []
    for x in descendants(items, it):
        if x.get("stage"):
            continue
        st = day_status(items, x, d)
        if st:
            sts.append(st)
    for name in PRIORITY:
        if name in sts:
            return name
    if sts and all(st == "Выполнено" for st in sts):
        return "Выполнено"
    if sts:
        return "План"
    p = eff_plan(items, it)
    return "План" if p and p[0] <= d <= p[1] else None


def grid_days(data):
    """Список дней сетки: start_date..grid_end (расширяется планом и фактом)."""
    start = data["start_date"]
    end = data.get("grid_end") or start
    for it in data["items"]:
        p = eff_plan(data["items"], it)
        if p:
            end = max(end, p[1])
        if it.get("fact"):
            end = max(end, max(it["fact"]))
    n = (end - start).days + 1
    if n > MAX_DAYS:
        raise TrackerError(f"Сетка получилась в {n} дней (больше {MAX_DAYS}): проверьте даты плана и факта.")
    return [start + dt.timedelta(days=i) for i in range(n)]


def is_overdue(items, it, today):
    p = eff_plan(items, it)
    return bool(p and p[1] < today and eff_status(items, it) != "Выполнено")


# ----------------------------------------------------------------- Excel: стили
thin = Side(style="thin", color=BORDER_COLOR)
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
HEAD_BORDER = Border(*(Side(style="thin", color="FFFFFF"),) * 4)


def fill(hex_):
    return PatternFill("solid", start_color=hex_, end_color=hex_)


def style_head(c, size=10):
    c.fill = fill(HEAD_FILL)
    c.font = Font(name="Calibri", size=size, bold=True, color="FFFFFF")
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c.border = HEAD_BORDER


def setup_print(ws, title_rows, a3=False):
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A3 if a3 else ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = title_rows
    ws.page_margins.left = ws.page_margins.right = 0.4


# колонки листа «График»
C_ID, C_TITLE, C_PERSON, C_OWNER, C_REVIEW, C_START, C_END, C_COMMENT = range(1, 9)
D0 = C_COMMENT + 1  # первая колонка дней
MAIN_HEADS = ["№", "Название", "Участник", "Исполнитель", "Ревью", "Начало", "Срок", "Комментарий"]
MAIN_WIDTHS = [7, 55, 9, 30, 28, 11, 11, 40]
DAY_WIDTH = 9


def build_main(wb, data, today):
    ws = wb.active
    ws.title = SHEET_MAIN
    items = data["items"]
    days = grid_days(data)
    n = len(days)
    cl = D0 + n - 1
    marks = {}
    for m in data["calendar"]["marks"]:
        marks.setdefault(m["date"], []).append(m["text"])

    for c, h in enumerate(MAIN_HEADS, 1):
        ws.merge_cells(start_row=1, start_column=c, end_row=HEAD_ROWS, end_column=c)
        ws.cell(1, c, h)
        ws.column_dimensions[get_column_letter(c)].width = MAIN_WIDTHS[c - 1]
    # месяцы
    col = D0
    while col <= cl:
        d = days[col - D0]
        e = col
        while e + 1 <= cl and (days[e + 1 - D0].year, days[e + 1 - D0].month) == (d.year, d.month):
            e += 1
        ws.cell(1, col, f"{MONTHS[d.month - 1]} {d.year}")
        if e > col:
            ws.merge_cells(start_row=1, start_column=col, end_row=1, end_column=e)
        col = e + 1
    for i, d in enumerate(days):
        c = D0 + i
        ws.cell(2, c, fmt_dm(d))
        ws.cell(3, c, WEEKDAYS[d.weekday()])
        ws.column_dimensions[get_column_letter(c)].width = DAY_WIDTH
    for r in range(1, HEAD_ROWS + 1):
        for c in range(1, cl + 1):
            style_head(ws.cell(r, c), size=10 if r == 1 else 9)
    for i, d in enumerate(days):
        if d in marks:
            c = D0 + i
            for r in (2, 3):
                ws.cell(r, c).fill = fill(MARK_HEAD_FILL)
            note = Comment("\n".join(marks[d]), "tracker.py")
            note.width, note.height = 260, 90
            ws.cell(2, c).comment = note
    ws.row_dimensions[1].height = 18
    ws.row_dimensions[2].height = 15
    ws.row_dimensions[3].height = 15

    r = HEAD_ROWS + 1
    for it in items:
        stage = bool(it.get("stage"))
        p = eff_plan(items, it)
        base_font = Font(name="Calibri", size=10, bold=stage)
        row_fill = fill(STAGE_FILL) if stage else None
        values = {
            C_ID: it["id"],
            C_TITLE: it["title"],
            C_PERSON: it.get("person") or None,
            C_OWNER: it.get("owner") or None,
            C_REVIEW: it.get("review") or None,
            C_START: p[0] if p else None,
            C_END: p[1] if p else None,
            C_COMMENT: it.get("comment") or None,
        }
        for c in range(1, D0):
            cell = ws.cell(r, c, values[c])
            cell.border = BORDER
            cell.font = base_font
            if row_fill:
                cell.fill = row_fill
            cell.alignment = Alignment(
                vertical="center",
                wrap_text=True,
                horizontal="center" if c in (C_ID, C_PERSON, C_START, C_END) else None,
            )
            if c in (C_ID, C_COMMENT):
                cell.number_format = "@"
            if c in (C_START, C_END):
                cell.number_format = "DD.MM.YYYY"
        ws.cell(r, C_COMMENT).font = Font(name="Calibri", size=9, bold=False)
        ws.cell(r, C_OWNER).font = Font(name="Calibri", size=9, bold=stage)
        ws.cell(r, C_REVIEW).font = Font(name="Calibri", size=9, bold=stage)
        if is_overdue(items, it, today):
            ws.cell(r, C_END).font = Font(name="Calibri", size=10, bold=True, color=TODAY_COLOR)
        tall = False
        for i, d in enumerate(days):
            cell = ws.cell(r, D0 + i)
            cell.border = BORDER
            if row_fill:
                cell.fill = row_fill
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            st = day_status(items, it, d)
            if st:
                f_, fc, _ = STATUSES[st]
                cell.value = st
                cell.fill = fill(f_)
                cell.font = Font(name="Calibri", size=8, color=fc)
                if st == "Ждёт решения":
                    tall = True
            elif not stage:
                if d in marks:
                    cell.fill = fill(MARK_FILL)
                elif d.weekday() >= 5:
                    cell.fill = fill(WEEKEND_FILL)
        lines = max(1, math.ceil(len(it["title"]) / (47 if stage else 52)))
        h = max(15.0, 13.5 * lines + 2)
        if tall:
            h = max(h, 24.0)
        ws.row_dimensions[r].height = h
        r += 1
    last = r - 1
    # сегодняшний день - рамка по колонке
    if today in days:
        c = D0 + days.index(today)
        side = Side(style="medium", color=TODAY_COLOR)
        for rr in range(1, last + 1):
            cell = ws.cell(rr, c)
            cell.border = Border(
                left=side,
                right=side,
                top=side if rr == 1 else cell.border.top,
                bottom=side if rr == last else cell.border.bottom,
            )
    ws.freeze_panes = ws.cell(HEAD_ROWS + 1, C_PERSON).coordinate
    ws.sheet_view.zoomScale = 90
    setup_print(ws, f"1:{HEAD_ROWS}", a3=True)
    ws.print_title_cols = "A:B"


def simple_sheet(wb, title, headers, widths, rows, date_cols=(), bold_rows=(), note=None):
    ws = wb.create_sheet(title)
    for i, (h, w) in enumerate(zip(headers, widths, strict=True), 1):
        c = ws.cell(1, i, h)
        style_head(c)
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[1].height = 32
    r = 2
    for idx, row in enumerate(rows):
        for i, v in enumerate(row, 1):
            c = ws.cell(r, i, v)
            c.border = BORDER
            c.alignment = Alignment(vertical="top", wrap_text=True)
            c.font = Font(name="Calibri", size=10, bold=idx in bold_rows)
            if i in date_cols and v is not None and not isinstance(v, str):
                c.number_format = "DD.MM.YYYY"
                c.alignment = Alignment(horizontal="center", vertical="top")
            if idx in bold_rows:
                c.fill = fill(STAGE_FILL)
        r += 1
    if note:
        ws.cell(r, 1, note).font = Font(name="Calibri", size=10, italic=True)
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=len(headers))
        ws.cell(r, 1).alignment = Alignment(wrap_text=True, vertical="top")
        ws.row_dimensions[r].height = 30
    ws.freeze_panes = "A2"
    setup_print(ws, "1:1")
    ws.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{max(r - (1 if note else 0), 2)}"
    return ws


def build_schedule(wb, data):
    items = data["items"]
    rows, bold = [], set()
    for i, it in enumerate(items):
        p = eff_plan(items, it)
        fs, fe = eff_fact(items, it)
        dev = (fe - p[1]).days if (fe and p) else None
        if it.get("stage"):
            bold.add(i)
        rows.append(
            [
                it["id"],
                it["title"],
                it.get("person") or "",
                it.get("owner") or "",
                it.get("review") or "",
                p[0] if p else None,
                p[1] if p else None,
                fs,
                fe,
                dev,
                eff_status(items, it),
            ]
        )
    ws = simple_sheet(
        wb,
        "Сроки",
        [
            "№",
            "Название",
            "Участник",
            "Исполнитель (роль, модель/effort)",
            "Ревью",
            "План начало",
            "План конец",
            "Факт начало",
            "Факт конец",
            "Отклонение, дн.",
            "Статус",
        ],
        [8, 55, 10, 28, 30, 13, 13, 13, 13, 13, 15],
        rows,
        date_cols=(6, 7, 8, 9),
        bold_rows=bold,
    )
    for r in range(2, len(rows) + 2):
        ws.cell(r, 1).number_format = "@"
        ws.cell(r, 1).alignment = Alignment(horizontal="center", vertical="top")
        ws.cell(r, 3).alignment = Alignment(horizontal="center", vertical="top")
        ws.cell(r, 10).alignment = Alignment(horizontal="center", vertical="top")
        c = ws.cell(r, 11)
        st = c.value
        if st in STATUSES:
            c.fill = fill(STATUSES[st][0])
            c.font = Font(name="Calibri", size=10, color=STATUSES[st][1])
        c.alignment = Alignment(horizontal="center", vertical="top")


def build_history(wb, data):
    rows = [
        [
            h.get("date"),
            h.get("item", ""),
            h.get("what", ""),
            h.get("who", ""),
            h.get("commit", ""),
            h.get("rounds"),
            h.get("tokens"),
            h.get("link", ""),
        ]
        for h in data["history"]
    ]
    simple_sheet(
        wb,
        "История",
        [
            "Дата",
            "Пункт",
            "Что сделано",
            "Кто (роль, модель, effort или «пользователь»)",
            "Коммит",
            "Раунды ревью",
            "Токены",
            "Ссылка",
        ],
        [12, 9, 60, 32, 24, 10, 12, 30],
        rows,
        date_cols=(1,),
    )


def build_reviews(wb, data):
    rows = [
        [
            r.get("id", ""),
            r.get("item", ""),
            r.get("round"),
            r.get("severity", ""),
            r.get("text", ""),
            r.get("repro", ""),
            r.get("by", ""),
            r.get("status", ""),
            r.get("comment", ""),
        ]
        for r in data["reviews"]
    ]
    simple_sheet(
        wb,
        "Ревью",
        [
            "ID",
            "Пункт",
            "Раунд",
            "Серьёзность",
            "Суть",
            "Воспроизведение",
            "Кто нашёл",
            "Статус",
            "Комментарий",
        ],
        [14, 9, 8, 16, 55, 45, 24, 13, 35],
        rows,
    )


def build_decisions(wb, data):
    rows = [
        [
            d["id"],
            d.get("question", ""),
            d.get("options", ""),
            d.get("recommendation", ""),
            d.get("deadline"),
            d.get("default", ""),
            d.get("answer", ""),
            d.get("answer_date"),
        ]
        for d in data["decisions"]
    ]
    ws = simple_sheet(
        wb,
        "Решения",
        [
            "ID",
            "Вопрос",
            "Варианты",
            "Рекомендация",
            "Срок",
            "Если ответа нет",
            "Решение пользователя",
            "Дата решения",
        ],
        [10, 40, 45, 40, 12, 35, 40, 13],
        rows,
        date_cols=(5, 8),
    )
    for r in range(2, len(rows) + 2):
        for c in (7, 8):
            ws.cell(r, c).fill = fill("FFFBE6")
            ws.cell(r, c).number_format = "@" if c == 7 else "DD.MM.YYYY"


def build_legend(wb, data):
    ws = wb.create_sheet("Легенда")
    ws.column_dimensions["A"].width = 26
    ws.column_dimensions["B"].width = 46
    ws.column_dimensions["C"].width = 70
    r = 1

    def title(text):
        nonlocal r
        c = ws.cell(r, 1, text)
        c.font = Font(name="Calibri", size=12, bold=True, color=HEAD_FILL)
        r += 1

    def head(cols):
        nonlocal r
        for i, h in enumerate(cols, 1):
            style_head(ws.cell(r, i, h))
        r += 1

    def row(vals, bold=False):
        nonlocal r
        for i, v in enumerate(vals, 1):
            c = ws.cell(r, i, v)
            c.border = BORDER
            c.alignment = Alignment(vertical="top", wrap_text=True)
            c.font = Font(name="Calibri", size=10, bold=bold)
        r += 1

    title("Статусы в клетках дней")
    head(["Статус", "Образец", "Значение"])
    for name, (f_, fc, desc) in STATUSES.items():
        row([name, name, desc])
        s = ws.cell(r - 1, 2)
        s.fill = fill(f_)
        s.font = Font(name="Calibri", size=8, color=fc)
        s.alignment = Alignment(horizontal="center", vertical="center")
    row(
        [
            "День-отметка",
            "",
            "Оранжевая шапка дня (текст — в примечании к клетке с датой) и светлая подсветка пустых клеток.",
        ]
    )
    ws.cell(r - 1, 2).fill = fill(MARK_FILL)
    row(["Выходной", "", "Светло-серая подсветка пустых клеток."])
    ws.cell(r - 1, 2).fill = fill(WEEKEND_FILL)
    row(["Сегодня", "", "Красная рамка вокруг колонки сегодняшнего дня (на момент сборки)."])
    ws.cell(r - 1, 2).border = Border(
        left=Side(style="medium", color=TODAY_COLOR), right=Side(style="medium", color=TODAY_COLOR)
    )
    row(["Срок красным", "", "Срок прошёл, а пункт не «Выполнено»."])
    ws.cell(r - 1, 2).value = "01.01.2026"
    ws.cell(r - 1, 2).font = Font(name="Calibri", size=10, bold=True, color=TODAY_COLOR)
    row(
        [
            "Правило клетки",
            "",
            "Есть факт - показан факт; иначе день в плане - «План»; иначе пусто. "
            "Строка этапа: «Ждёт решения» > «Доработка» > «В работе» > «Выполнено» (все активные подэтапы "
            "дня выполнены) > «План».",
        ]
    )
    r += 1
    title("Правила учёта")
    rules = [
        "Источник правды - docs/tracker/tracker.yaml. Excel собирается командой «uv run tools/tracker.py "
        "build»; правки в Excel, кроме указанных ниже, при пересборке теряются. Доска GitHub Projects — "
        "зеркало YAML («uv run tools/tracker.py gh-sync»), на доске ничего не правят.",
        "tracker.yaml меняется только командами tracker.py: статусы своих пакетов отмечает участник, "
        "остальное — оркестратор. Коммит учёта «chore(tracker)» идёт прямо в main после git pull --rebase. "
        "Субагенты учёт не правят.",
        "Заметки пользователя - в колонку «Комментарий» листа «График» и в колонки «Решение пользователя» "
        "/ «Дата решения» листа «Решения». Команда «tracker.py sync» (и любая сборка) вернёт их в "
        "tracker.yaml.",
        "Чтобы стереть заметку, очистите ячейку. Строки, добавленные в Excel вручную, при пересборке "
        "исчезают: новые пункты добавляйте командой add.",
        "Если файл открыт в Excel (есть «~$…») или занят OneDrive, Excel не перезаписывается, команда "
        "сообщает об этом (код выхода 2); изменения команд add/mark/log/… при этом уже сохранены в "
        "tracker.yaml. Закройте файл и запустите build.",
        "Перед каждой записью Excel заметки пользователя автоматически считываются в YAML (sync). Если "
        "правка есть и в YAML, и в Excel, сохраняются обе версии («… | Excel: …»).",
        "Срок пункта — plan.end. Ближайшие сроки показывает «uv run tools/tracker.py due».",
    ]
    for t in rules:
        c = ws.cell(r, 1, t)
        c.alignment = Alignment(wrap_text=True, vertical="top")
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=3)
        ws.row_dimensions[r].height = 30
        r += 1
    r += 1
    title("Участники")
    head(["Буква", "Участник", "Аккаунт"])
    for p in data["people"]:
        row([p.get("id", ""), p.get("name", ""), p.get("account", "")])
    r += 1
    title("Отметки календаря")
    head(["Дата", "Отметка", ""])
    for m in data["calendar"]["marks"]:
        row([fmt_date(m["date"]), m["text"], ""])
    r += 1
    title("Роли субагентов (модель / effort)")
    head(["Роль", "Модель / effort", "Что делает"])
    for ro in data["roles"]:
        row([ro.get("role", ""), ro.get("model", ""), ro.get("task", "")])
    r += 1
    title("Запросы во внешние нейросети (ВН-xx)")
    head(["Запрос", "Подэтап", "Что"])
    for e in data["external_requests"]:
        row([e.get("id", ""), e.get("item", ""), e.get("what", "")])
    ws.freeze_panes = "A2"
    setup_print(ws, "1:1")


def build_snapshot(wb, data):
    """Скрытый лист: что записано в редактируемые пользователем ячейки (для трёхсторонней склейки в sync)."""
    ws = wb.create_sheet(SNAP_SHEET)
    for it in data["items"]:
        ws.append(["comment", it["id"], it.get("comment") or ""])
    for d in data["decisions"]:
        ws.append(["answer", d["id"], d.get("answer") or ""])
        ws.append(["answer_date", d["id"], d["answer_date"].isoformat() if d.get("answer_date") else ""])
    ws.sheet_state = "veryHidden"


def build_workbook(data, today=None):
    today = today or today_msk()
    wb = Workbook()
    wb.properties.creator = "tools/tracker.py"
    wb.properties.title = data.get("project", "")
    build_main(wb, data, today)
    build_schedule(wb, data)
    build_history(wb, data)
    build_reviews(wb, data)
    build_decisions(wb, data)
    build_legend(wb, data)
    build_snapshot(wb, data)
    wb.active = 0
    return wb


# ----------------------------------------------------------------- сборка файла
def check_lock(target):
    target = Path(target)
    locks = sorted(target.parent.glob("~$*")) if target.parent.exists() else []
    if locks:
        raise LockedError(
            f"Файл {target.name} открыт в Excel (найден {locks[0].name}). "
            f"Закройте его и повторите команду. Ничего не записано."
        )
    if target.exists():
        try:
            with open(target, "ab"):
                pass
        except PermissionError:
            raise LockedError(
                f"Файл {target.name} занят (Excel или синхронизация OneDrive). "
                f"Закройте его/дождитесь синхронизации и повторите. Ничего не записано."
            ) from None


def build_xlsx(data, target, today=None):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    check_lock(target)
    wb = build_workbook(data, today)
    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".tmp_", suffix=".xlsx")
    os.close(fd)
    try:
        wb.save(tmp)
        try:
            os.replace(tmp, target)
        except PermissionError:
            raise LockedError(f"Не удалось заменить {target.name}: файл занят. Ничего не записано.") from None
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return target


# ----------------------------------------------------------------- sync
def _cell_text(v):
    """Текст ячейки (числа и даты -> строка); пусто -> ''."""
    if v is None:
        return ""
    if isinstance(v, (dt.datetime, dt.date)):
        return to_date(v).isoformat()
    return str(v).strip()


def _find_col(ws, names, rows=(1, 2, 3)):
    for r in rows:
        for c in range(1, ws.max_column + 1):
            if ws.cell(r, c).value in names:
                return c
    return None


def merge3(label, y, e, s, warnings):
    """Трёхсторонняя склейка: y - YAML, e - Excel, s - снимок при сборке (None - снимка нет)."""
    y, e = (y or "").strip(), (e or "").strip()
    if e == "-":
        e = ""
    if s is None:  # старый файл без снимка: пустое = без изменений
        return y if e == "" else e
    s = s.strip()
    if e == s:  # пользователь не трогал - верен YAML
        return y
    if y == s or y == e:  # YAML не менялся (или совпал) - берём Excel
        return e
    if not y:
        return e
    if not e:
        return y
    warnings.append(f"конфликт {label}: правка и в YAML, и в Excel; сохранены обе версии")
    return f"{y} | Excel: {e}"


def read_snapshot(wb):
    if SNAP_SHEET not in wb.sheetnames:
        return None
    snap = {}
    for row in wb[SNAP_SHEET].iter_rows(values_only=True):
        row = list(row) + [None] * 3
        if row[0]:
            snap[(row[0], str(row[1]))] = "" if row[2] is None else str(row[2])
    return snap


def sync_from_xlsx(data, xlsx):
    """Читает заметки пользователя из Excel в data (трёхсторонняя склейка со снимком)."""
    if not Path(xlsx).exists():
        raise TrackerError(f"Нет файла Excel для sync: {xlsx}. Запустите build, чтобы создать его.")
    locks = list(Path(xlsx).parent.glob("~$*"))
    if locks:
        print(
            f"Предупреждение: файл открыт в Excel ({locks[0].name}); будут прочитаны только сохранённые "
            f"данные."
        )
    try:
        wb = load_workbook(xlsx, data_only=True)
    except PermissionError:
        raise LockedError(
            f"Файл {Path(xlsx).name} занят (Excel или синхронизация OneDrive): прочитать нельзя. "
            f"Закройте его/дождитесь синхронизации и повторите."
        ) from None
    except Exception as ex:
        raise TrackerError(
            f"Не удалось прочитать Excel {Path(xlsx).name} ({type(ex).__name__}: {ex}). "
            f"Ничего не записано; исправьте или удалите файл и запустите build."
        ) from None
    snap = read_snapshot(wb)
    changes, warnings = [], []

    def S(kind, key):
        return None if snap is None else snap.get((kind, key), "")

    by_id = {it["id"]: it for it in data["items"]}
    if SHEET_MAIN in wb.sheetnames:
        ws = wb[SHEET_MAIN]
        cc = _find_col(ws, ("Комментарий",))
        extra = []
        if cc:
            for r in range(HEAD_ROWS + 1, ws.max_row + 1):
                iid = _cell_text(ws.cell(r, 1).value)
                if not iid:
                    continue
                if iid not in by_id:
                    extra.append(iid)
                    continue
                it = by_id[iid]
                old = it.get("comment") or ""
                new = merge3(
                    f"комментария {iid}", old, _cell_text(ws.cell(r, cc).value), S("comment", iid), warnings
                )
                if new != old.strip():
                    it["comment"] = new
                    changes.append(f"комментарий к {iid}")
        if extra:
            warnings.append(
                "строки " + ", ".join(extra) + " есть в Excel, но не в YAML: пропущены "
                "(при пересборке исчезнут; добавляйте пункты командой add)"
            )
    if "Решения" in wb.sheetnames:
        ws = wb["Решения"]
        cols = {ws.cell(1, c).value: c for c in range(1, ws.max_column + 1)}
        ca, cd = cols.get("Решение пользователя"), cols.get("Дата решения")
        dec = {d["id"]: d for d in data["decisions"]}
        if ca:
            for r in range(2, ws.max_row + 1):
                did = _cell_text(ws.cell(r, 1).value)
                if not did or did not in dec:
                    continue
                d = dec[did]
                y_ans = d.get("answer") or ""
                e_ans = _cell_text(ws.cell(r, ca).value)
                new_ans = merge3(f"решения {did}", y_ans, e_ans, S("answer", did), warnings)
                ans_changed = new_ans != y_ans.strip()
                if ans_changed:
                    d["answer"] = new_ans
                    changes.append(f"решение {did}")
                # дата
                y_date = d["answer_date"].isoformat() if d.get("answer_date") else ""
                s_date = S("answer_date", did)
                e_date = s_date or ""
                if cd:
                    raw = ws.cell(r, cd).value
                    try:
                        e_date = _cell_text(to_date(raw)) if raw not in (None, "", "-") else ""
                    except TrackerError:
                        warnings.append(f"дата решения {did} не распознана ({raw!r}): пропущена")
                new_date = merge3(f"даты решения {did}", y_date, e_date, s_date, warnings)
                if "| Excel:" in new_date:
                    new_date = y_date
                date_touched = (e_date != "") if s_date is None else (e_date != s_date)
                if ans_changed and not date_touched:
                    new_date = today_msk().isoformat() if new_ans else ""
                if new_ans and not new_date:
                    new_date = today_msk().isoformat()
                if new_date != y_date:
                    d["answer_date"] = to_date(new_date) if new_date else None
                    changes.append(f"дата решения {did}")
    for w in warnings:
        print(f"Предупреждение: {w}")
    return changes


def autosync(data, xpath):
    """Перед записью Excel подтягивает заметки пользователя (sync). Возвращает список изменений."""
    xpath = Path(xpath)
    if not xpath.exists():
        return []
    if list(xpath.parent.glob("~$*")):
        return []  # файл занят: сборка всё равно откажет с кодом 2
    changes = sync_from_xlsx(data, xpath)
    if changes:
        print("Из Excel подтянуто: " + "; ".join(changes))
    return changes


# ----------------------------------------------------------------- разбор аргументов
def norm_status(s):
    key = s.strip().lower().replace("ё", "е")
    for name in STATUSES:
        if name.lower().replace("ё", "е") == key:
            return name
    if key in ("-", "нет", "очистить", "clear"):
        return None
    raise TrackerError(f"Неизвестный статус {s!r}. Допустимо: {', '.join(STATUSES)} (или «-» - убрать факт).")


_ISO = r"\d{4}-\d{2}-\d{2}"
_DMY = r"\d{1,2}\.\d{1,2}(?:\.\d{2,4})?"


MSK = dt.timezone(dt.timedelta(hours=3))  # фиксированное смещение UTC+3 (без zoneinfo)


def now_utc():
    return dt.datetime.now(dt.UTC)


def today_msk():
    """Сегодняшняя дата по Москве - одна на due, mark today, рамку в Excel и даты решений."""
    return now_utc().astimezone(MSK).date()


def get_today(args):
    t = getattr(args, "today", None)
    return to_date(t) if t else today_msk()


def parse_day(s, start, today):
    """Один день: today | ГГГГ-ММ-ДД | ДД.ММ.ГГГГ | ДД.ММ (год - от start_date)."""
    s = s.strip()
    if s.lower() in ("today", "сегодня"):
        return today
    try:
        if re.fullmatch(_ISO, s) or re.fullmatch(r"\d{1,2}\.\d{1,2}\.\d{2,4}", s):
            return to_date(s)
        m = re.fullmatch(r"(\d{1,2})\.(\d{1,2})", s)
        if m:
            d = dt.date(start.year, int(m.group(2)), int(m.group(1)))
            if d < start and d.month < start.month:  # сетка через Новый год
                d = dt.date(start.year + 1, d.month, d.day)
            return d
    except ValueError:
        raise TrackerError(f"Нет такой даты: {s!r}") from None
    raise TrackerError(f"Не понял дату {s!r}: нужен today, ГГГГ-ММ-ДД, ДД.ММ или ДД.ММ.ГГГГ.")


def parse_days(arg, start, today):
    """День или диапазон (ДД.ММ-ДД.ММ, ГГГГ-ММ-ДД-ГГГГ-ММ-ДД, а также A..B) -> список дат."""
    s = arg.strip()
    parts = None
    if ".." in s:
        parts = s.split("..", 1)
    else:
        m = re.fullmatch(rf"({_ISO})-({_ISO})", s) or re.fullmatch(rf"({_DMY})-({_DMY})", s)
        if m:
            parts = [m.group(1), m.group(2)]
    if parts is None:
        days = [parse_day(s, start, today)]
    else:
        a, b = parse_day(parts[0], start, today), parse_day(parts[1], start, today)
        if b < a:
            raise TrackerError(f"Диапазон {arg!r}: конец раньше начала.")
        if (b - a).days + 1 > MAX_DAYS:
            raise TrackerError(f"Диапазон {arg!r} длиннее {MAX_DAYS} дней.")
        days = [a + dt.timedelta(days=i) for i in range((b - a).days + 1)]
    if days[0] < start:
        raise TrackerError(f"Дата {fmt_date(days[0])} раньше начала сетки ({fmt_date(start)}).")
    if (days[-1] - start).days + 1 > MAX_DAYS:
        raise TrackerError(
            f"Дата {fmt_date(days[-1])} слишком далеко от начала сетки (предел {MAX_DAYS} дней)."
        )
    return days


def get_item(data, iid):
    for it in data["items"]:
        if it["id"] == iid:
            return it
    raise TrackerError(f"Нет пункта с номером {iid}")


def paths(args):
    y = Path(args.yaml or os.environ.get("TRACKER_YAML") or DEF_YAML)
    x = Path(args.out or os.environ.get("TRACKER_XLSX") or DEF_XLSX)
    return y, x


def finish(args, data, header, ypath, xpath, msg):
    locked = None
    if not getattr(args, "no_build", False):
        try:
            autosync(data, xpath)  # заметки пользователя из Excel не теряются; при ошибке ничего не пишется
        except LockedError as e:  # Excel занят: YAML всё равно сохраняем
            locked = e
    save_data(ypath, data, header)
    print(msg)
    if locked:
        print(f"ОШИБКА: {locked}")
        print("tracker.yaml сохранён; Excel не обновлён - запустите «build» позже.")
        return 2
    if getattr(args, "no_build", False):
        return 0
    return do_build(data, xpath, get_today(args), after_save=True)


def do_build(data, xpath, today=None, after_save=False):
    try:
        out = build_xlsx(data, xpath, today)
    except LockedError as e:
        print(f"ОШИБКА: {e}")
        if after_save:
            print("tracker.yaml сохранён; Excel не обновлён - запустите «build» позже.")
        return 2
    print(f"Excel собран: {out}")
    return 0


# ----------------------------------------------------------------- команды
def cmd_build(args):
    ypath, xpath = paths(args)
    data, header = load_data(ypath)
    if autosync(data, xpath):
        save_data(ypath, data, header)
    return do_build(data, xpath, get_today(args))


def cmd_sync(args):
    ypath, xpath = paths(args)
    data, header = load_data(ypath)
    changes = sync_from_xlsx(data, xpath)
    if changes:
        save_data(ypath, data, header)
        print("Прочитано из Excel: " + "; ".join(changes))
    else:
        print("В Excel нет новых заметок - tracker.yaml без изменений.")
    if args.no_build:
        return 0
    return do_build(data, xpath, get_today(args), after_save=True)


def cmd_add(args):
    ypath, xpath = paths(args)
    data, header = load_data(ypath)
    items = data["items"]
    if any(it["id"] == args.id for it in items):
        raise TrackerError(f"Пункт {args.id} уже есть")
    new = {"id": args.id, "title": args.title}
    if args.person:
        new["person"] = args.person
    if args.owner:
        new["owner"] = args.owner
    if args.review:
        new["review"] = args.review
    if bool(args.start) != bool(args.end):
        raise TrackerError("Укажите вместе --start и --end")
    if args.start:
        s, e = to_date(args.start), to_date(args.end)
        if s > e:
            raise TrackerError("--start позже --end")
        if s < data["start_date"]:
            raise TrackerError(f"--start раньше начала сетки ({fmt_date(data['start_date'])})")
        new["plan"] = {"start": s, "end": e}
    new["fact"] = {}
    parent_id = args.parent
    if not parent_id and "." in args.id:
        parent_id = args.id.rsplit(".", 1)[0]
        print(f"Родитель определён по номеру: {parent_id}")
    if parent_id:
        parent = get_item(data, parent_id)
        if not args.id.startswith(parent_id + "."):
            raise TrackerError(f"Номер {args.id} должен начинаться с «{parent_id}.»")
        last = max(
            i
            for i, it in enumerate(items)
            if it["id"] == parent["id"] or it["id"].startswith(parent["id"] + ".")
        )
        items.insert(last + 1, new)
    else:
        new["stage"] = True
        items.append(new)
    return finish(args, data, header, ypath, xpath, f"Добавлен пункт {args.id}: {args.title}")


def cmd_mark(args):
    ypath, xpath = paths(args)
    data, header = load_data(ypath)
    it = get_item(data, args.id)
    days = parse_days(args.day, data["start_date"], get_today(args))
    status = norm_status(args.status)
    for d in days:
        if status is None:
            it["fact"].pop(d, None)
        else:
            it["fact"][d] = status
    it["fact"] = dict(sorted(it["fact"].items()))
    what = status or "факт убран"
    span = fmt_dm(days[0]) if len(days) == 1 else f"{fmt_dm(days[0])}-{fmt_dm(days[-1])}"
    return finish(args, data, header, ypath, xpath, f"Пункт {args.id}: {span} -> {what}")


def cmd_log(args):
    ypath, xpath = paths(args)
    data, header = load_data(ypath)
    get_item(data, args.item)
    rec = {
        "date": to_date(args.date) if args.date else get_today(args),
        "item": args.item,
        "what": args.what,
        "who": args.who,
    }
    if args.commit:
        rec["commit"] = args.commit
    if args.rounds is not None:
        rec["rounds"] = args.rounds
    if args.tokens is not None:
        rec["tokens"] = args.tokens
    if args.link:
        rec["link"] = args.link
    data["history"].append(rec)
    return finish(args, data, header, ypath, xpath, f"В историю добавлено ({args.item}): {args.what}")


def cmd_review(args):
    ypath, xpath = paths(args)
    data, header = load_data(ypath)
    get_item(data, args.item)
    pref = f"R-{args.item}-"
    nums = [
        int(r["id"][len(pref) :])
        for r in data["reviews"]
        if str(r.get("id", "")).startswith(pref) and r["id"][len(pref) :].isdigit()
    ]
    if args.id:
        # второй ревьюер раунда нумерует замечания со 101
        rid = args.id
        if not (rid.startswith(pref) and rid[len(pref) :].isdigit()):
            raise TrackerError(f"ID замечания должен иметь вид {pref}<n>")
        if any(r.get("id") == rid for r in data["reviews"]):
            raise TrackerError(f"Замечание {rid} уже есть")
    else:
        n = max((x for x in nums if x < 101), default=0) + 1
        rid = f"R-{args.item}-{n}"
    rec = {
        "id": rid,
        "item": args.item,
        "round": args.round,
        "severity": args.severity,
        "text": args.text,
        "status": "открыто",
    }
    if args.repro:
        rec["repro"] = args.repro
    if args.by:
        rec["by"] = args.by
    data["reviews"].append(rec)
    return finish(args, data, header, ypath, xpath, f"Замечание {rid} ({args.severity}) добавлено")


def cmd_review_status(args):
    ypath, xpath = paths(args)
    data, header = load_data(ypath)
    st = args.status.strip().lower()
    if st not in REVIEW_STATUSES:
        raise TrackerError(f"Статус замечания: {', '.join(REVIEW_STATUSES)}")
    for r in data["reviews"]:
        if r.get("id") == args.id:
            r["status"] = st
            if args.comment:
                r["comment"] = args.comment
            return finish(args, data, header, ypath, xpath, f"Замечание {args.id}: {st}")
    raise TrackerError(f"Нет замечания {args.id}")


def cmd_decision(args):
    ypath, xpath = paths(args)
    data, header = load_data(ypath)
    for d in data["decisions"]:
        if d["id"].lower() == args.id.lower():
            d["answer"] = args.answer
            d["answer_date"] = to_date(args.date) if args.date else get_today(args)
            return finish(args, data, header, ypath, xpath, f"Решение {d['id']} записано: {args.answer}")
    raise TrackerError(f"Нет развилки {args.id}. Есть: {', '.join(d['id'] for d in data['decisions'])}")


# ----------------------------------------------------------------- due
def plural_days(n):
    if n % 100 in range(11, 15):
        return "дней"
    return {1: "день", 2: "дня", 3: "дня", 4: "дня"}.get(n % 10, "дней")


def due_report(data, today, days=7, person=None):
    """Возвращает [(заголовок, [строки])] - только непустые группы."""
    items = data["items"]
    horizon = today + dt.timedelta(days=days)
    groups = [
        ("Просрочено", []),
        ("Сегодня", []),
        ("Завтра", []),
        (f"Ближайшие {days} {plural_days(days)}", []),
    ]

    def bucket(end):
        if end < today:
            return 0
        if end == today:
            return 1
        if end == today + dt.timedelta(days=1):
            return 2 if days >= 1 else None
        return 3 if end <= horizon else None

    rows = [[], [], [], []]
    for it in items:
        if it.get("stage") or not it.get("plan"):
            continue
        if person and person.strip().casefold() not in [x.casefold() for x in persons_of(it)]:
            continue
        st = eff_status(items, it)
        if st == "Выполнено":
            continue
        end = it["plan"]["end"]
        b = bucket(end)
        if b is None:
            continue
        line = (
            f"{it['id']} {it['title']} — срок {fmt_dm(end)}, участник {it.get('person') or '—'}, статус {st}"
        )
        rows[b].append((end, 0, id_key(it["id"]), line))
    captain = data["people"][0]["id"] if data.get("people") else "А"
    if not person or person.strip().casefold() == captain.casefold():
        for d in data["decisions"]:
            if d.get("answer") or not d.get("deadline"):
                continue
            b = bucket(d["deadline"])
            if b is None:
                continue
            line = f"{d['id']} {d.get('question', '')} — срок {fmt_dm(d['deadline'])}, развилка без ответа"
            rows[b].append((d["deadline"], 1, (0,), line))
    out = []
    for (title, _), rs in zip(groups, rows, strict=True):
        if rs:
            out.append((title, [x[3] for x in sorted(rs, key=lambda x: x[:3])]))
    return out


def cmd_due(args):
    ypath, _ = paths(args)
    data, _ = load_data(ypath)
    today = get_today(args)
    if args.days < 0:
        raise TrackerError("--days не может быть отрицательным")
    report = due_report(data, today, args.days, args.person)
    who = f", участник {args.person}" if args.person else ""
    if not report:
        print(
            f"Сроки на {fmt_date(today)}{who}: просроченных нет, в ближайшие {args.days} "
            f"{plural_days(args.days)} ничего не горит."
        )
        return 0
    print(f"Сроки на {fmt_date(today)}{who}:")
    for title, lines in report:
        print(f"{title}:")
        for ln in lines:
            print(f"  {ln}")
    return 0


# ----------------------------------------------------------------- gh-sync
GH_STATUS_ORDER = ["План", "В работе", "Доработка", "Ждёт решения", "Выполнено"]
GH_STATUS_COLORS = {
    "План": "GRAY",
    "В работе": "BLUE",
    "Доработка": "YELLOW",
    "Ждёт решения": "RED",
    "Выполнено": "GREEN",
}
GH_EXTRA_FIELDS = [("Участник", "TEXT"), ("Начало", "DATE"), ("Срок", "DATE"), ("Этап", "TEXT")]
GH_NOTE = "Зеркало tracker.yaml — правки только через tools/tracker.py."
RATE_PAUSE = 7  # пауза перед повтором при лимите GitHub, сек
RATE_MARKERS = ("rate limit", "http 403", "http 429", "secondary rate")
MANAGED_LABEL_PREFIXES = ("этап-", "участник-")

# значения полей карточек читаем через GraphQL и сопоставляем по id поля: ключи `gh project item-list`
# для кириллических имён полей приходят с испорченным первым символом
BOARD_QUERY = (
    "query{repositoryOwner(login:@OWNER@){... on ProjectV2Owner{projectV2(number:@NUM@){"
    "items(first:100@AFTER@){pageInfo{hasNextPage endCursor} nodes{id "
    "content{... on Issue{number repository{nameWithOwner}}} "
    "fieldValues(first:30){nodes{"
    "... on ProjectV2ItemFieldTextValue{text field{... on ProjectV2FieldCommon{id name}}} "
    "... on ProjectV2ItemFieldDateValue{date field{... on ProjectV2FieldCommon{id name}}} "
    "... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2FieldCommon{id name}}}"
    "}}}}}}}}"
)


def issue_title(it):
    return f"[{it['id']}] {it['title']}"


def issue_body(it):
    lines = []
    if it.get("person"):
        lines.append(f"- **Участник:** {it['person']}")
    if it.get("owner"):
        lines.append(f"- **Исполнитель:** {it['owner']}")
    if it.get("review"):
        lines.append(f"- **Ревью:** {it['review']}")
    p = it.get("plan")
    if p:
        lines.append(f"- **План:** {fmt_date(p['start'])} — {fmt_date(p['end'])}")
    if it.get("comment"):
        lines.append(f"- **Комментарий:** {it['comment']}")
    lines += ["", "---", f"_{GH_NOTE}_"]
    return "\n".join(lines)


def issue_labels(it):
    return [f"этап-{it['id'].split('.')[0]}"] + [f"участник-{p}" for p in persons_of(it)]


def _norm_body(s):
    return (s or "").replace("\r\n", "\n").strip()


def write_issue_numbers(ypath, numbers):
    """Перечитывает YAML с диска и переносит в него только поле issue (параллельные правки не теряются)."""
    data, header = load_data(ypath)
    for it in data["items"]:
        if it["id"] in numbers:
            it["issue"] = numbers[it["id"]]
    save_data(ypath, data, header)


class Mirror:
    """Одностороннее зеркало tracker.yaml -> Issues и доска Projects (v2) через gh."""

    def __init__(self, cfg, dry_run=False, record=None):
        self.owner, self.repo, self.title = cfg["owner"], cfg["repo"], cfg["project_title"]
        self.slug = f"{self.owner}/{self.repo}"
        self.dry = dry_run
        self.record = record  # record({id: номер}) - сразу записать номера Issue в YAML
        self.proj = None  # {"number", "id"} (None - доски ещё нет)
        self.fields = {}
        self.nmut = 0
        self.pending = {}  # номера Issue, ещё не записанные в YAML
        self.saved = 0

    # --- низкий уровень
    def _exec(self, args, retry=False):
        try:
            cp = subprocess.run(
                ["gh", *args], capture_output=True, text=True, encoding="utf-8", errors="replace"
            )
        except FileNotFoundError:
            raise GhError("Не найден gh (GitHub CLI). Установите его и выполните «gh auth login».") from None
        if cp.returncode != 0:
            msg = (cp.stderr or cp.stdout or "").strip() or "нет текста ошибки"
            if retry and any(x in msg.lower() for x in RATE_MARKERS):
                print(f"  (лимит GitHub; пауза {RATE_PAUSE} с и один повтор)")
                time.sleep(RATE_PAUSE)
                return self._exec(args)
            raise GhError(f"gh {' '.join(args[:3])} завершился с кодом {cp.returncode}: {msg}")
        return cp.stdout

    def read_json(self, args, default):
        """Читающий вызов gh с JSON-ответом. В dry-run сбой чтения = «данных нет»."""
        try:
            out = self._exec(args)
            return json.loads(out) if out.strip() else default
        except json.JSONDecodeError as e:
            raise GhError(f"gh {' '.join(args[:3])}: ответ не JSON ({e})") from None
        except GhError as e:
            if self.dry:
                print(f"  (не удалось прочитать: {e}; считаю, что данных нет)")
                return default
            raise

    def mutate(self, args):
        """Мутирующий вызов; в dry-run только считается."""
        self.nmut += 1
        if self.dry:
            return None
        return self._exec(args, retry=True)

    def act(self, plan_text, done_text):
        return plan_text if self.dry else done_text

    def remember(self, it, num):
        """Номер Issue в память и сразу в YAML."""
        it["issue"] = num
        self.pending[it["id"]] = num
        self.flush()

    def flush(self):
        if self.pending and self.record and not self.dry:
            self.record(dict(self.pending))
            self.saved += len(self.pending)
            self.pending.clear()

    # --- доска
    def load_fields(self):
        if not self.proj or self.proj.get("number") is None:
            self.fields = {}
            return
        raw = self.read_json(
            [
                "project",
                "field-list",
                str(self.proj["number"]),
                "--owner",
                self.owner,
                "--limit",
                "100",
                "--format",
                "json",
            ],
            {"fields": []},
        )
        self.fields = {}
        for f in raw.get("fields", []):
            self.fields[f["name"]] = {
                "id": f["id"],
                "type": f.get("type", ""),
                "options": {o["name"]: o["id"] for o in f.get("options", [])},
            }

    def ensure_project(self):
        raw = self.read_json(
            ["project", "list", "--owner", self.owner, "--limit", "100", "--format", "json"], {"projects": []}
        )
        for p in raw.get("projects", []):
            if p.get("title") == self.title:
                self.proj = {"number": p["number"], "id": p["id"]}
                break
        if self.proj:
            print(f"Доска: «{self.title}» (№{self.proj['number']}) найдена")
            return
        print(f"Доска: {self.act('создать', 'создана')} «{self.title}»")
        out = self.mutate(
            ["project", "create", "--owner", self.owner, "--title", self.title, "--format", "json"]
        )
        if out is None:
            self.proj = {"number": None, "id": "<id новой доски>"}
        else:
            try:
                j = json.loads(out)
                self.proj = {"number": j["number"], "id": j["id"]}
            except (json.JSONDecodeError, KeyError):
                raise GhError("gh project create вернул неожиданный ответ; доска не определена.") from None

    def ensure_fields(self):
        self.load_fields()
        num = str(self.proj["number"]) if self.proj["number"] is not None else "<№ доски>"
        changed = []
        st = self.fields.get("Status")
        if st is None:
            self.mutate(
                [
                    "project",
                    "field-create",
                    num,
                    "--owner",
                    self.owner,
                    "--name",
                    "Status",
                    "--data-type",
                    "SINGLE_SELECT",
                    "--single-select-options",
                    ",".join(GH_STATUS_ORDER),
                ]
            )
            changed.append("Status")
        elif any(n not in st["options"] for n in GH_STATUS_ORDER):
            opts = ",".join(
                f'{{name:{jstr(n)},color:{GH_STATUS_COLORS[n]},description:""}}' for n in GH_STATUS_ORDER
            )
            q = (
                f"mutation{{updateProjectV2Field(input:{{fieldId:{jstr(st['id'])},singleSelectOptions:[{opts}]}})"
                "{projectV2Field{... on ProjectV2SingleSelectField{id}}}}"
            )
            try:
                self.mutate(["api", "graphql", "-f", f"query={q}"])
            except GhError as e:
                raise GhError(
                    f"{e}\nНе удалось задать варианты поля Status ({', '.join(GH_STATUS_ORDER)}). "
                    f"Задайте их вручную в настройках доски и повторите команду."
                ) from None
            changed.append("Status (варианты)")
        for name, typ in GH_EXTRA_FIELDS:
            if name not in self.fields:
                self.mutate(
                    [
                        "project",
                        "field-create",
                        num,
                        "--owner",
                        self.owner,
                        "--name",
                        name,
                        "--data-type",
                        typ,
                    ]
                )
                changed.append(name)
        if changed:
            print(f"Поля доски: {self.act('создать/настроить', 'создано/настроено')} {', '.join(changed)}")
            if not self.dry:
                self.load_fields()
                bad = [
                    n for n in GH_STATUS_ORDER if n not in self.fields.get("Status", {}).get("options", {})
                ]
                if bad or any(n not in self.fields for n, _ in GH_EXTRA_FIELDS):
                    raise GhError(
                        "После настройки у доски не хватает полей или вариантов Status ("
                        + ", ".join(bad)
                        + "). Настройте вручную и повторите."
                    )
        else:
            print("Поля доски: все на месте")

    def load_board(self):
        """Карточки доски: {номер Issue: {"id": id карточки, "values": {id поля: значение}}}."""
        board = {}
        if not self.proj or self.proj["number"] is None:
            return board
        cursor = None
        while True:
            after = f",after:{jstr(cursor)}" if cursor else ""
            q = (
                BOARD_QUERY.replace("@OWNER@", jstr(self.owner))
                .replace("@NUM@", str(self.proj["number"]))
                .replace("@AFTER@", after)
            )
            raw = self.read_json(["api", "graphql", "-f", f"query={q}"], None)
            proj = (((raw or {}).get("data") or {}).get("repositoryOwner") or {}).get("projectV2")
            if not proj:
                if raw is not None and not self.dry:
                    raise GhError("GraphQL не вернул карточки доски: проверьте права project у gh.")
                break
            items = proj["items"]
            for node in items.get("nodes", []):
                c = node.get("content") or {}
                if c.get("number") is None or (c.get("repository") or {}).get("nameWithOwner") != self.slug:
                    continue
                values = {}
                for fv in (node.get("fieldValues") or {}).get("nodes", []):
                    f = fv.get("field")
                    if not f:
                        continue
                    for key in ("text", "date", "name"):
                        if key in fv:
                            values[f["id"]] = fv[key]
                            break
                board[c["number"]] = {"id": node["id"], "values": values}
            page = items.get("pageInfo") or {}
            if not page.get("hasNextPage"):
                break
            cursor = page["endCursor"]
        return board

    def set_field(self, item_id, name, value, kind):
        f = self.fields.get(name) or {}
        base = [
            "project",
            "item-edit",
            "--id",
            item_id,
            "--project-id",
            self.proj["id"],
            "--field-id",
            f.get("id", f"<поле {name}>"),
        ]
        if kind == "status":
            base += ["--single-select-option-id", f.get("options", {}).get(value, f"<вариант {value}>")]
        elif kind == "date":
            base += ["--date", value]
        else:
            base += ["--text", value]
        self.mutate(base)

    # --- основной проход
    def sync(self, data):
        items = data["items"]
        leaf = [it for it in items if not it.get("stage")]
        stages = {it["id"]: it["title"] for it in items if it.get("stage")}
        mode = "dry-run" if self.dry else "запись"
        print(f"gh-sync ({mode}): {self.slug}, доска «{self.title}»; пунктов к зеркалу: {len(leaf)}")

        # метки
        need = {}
        for it in leaf:
            for lb in issue_labels(it):
                need[lb] = "1D76DB" if lb.startswith("этап-") else "5319E7"
        have = {
            x["name"].lower()
            for x in self.read_json(
                ["label", "list", "--repo", self.slug, "--limit", "500", "--json", "name"], []
            )
        }

        def label_key(s):
            kind, _, tail = s.partition("-")
            return (kind, id_key(tail) if tail.isdigit() else (0, tail))

        new_labels = [lb for lb in sorted(need, key=label_key) if lb.lower() not in have]
        for lb in new_labels:
            self.mutate(
                [
                    "label",
                    "create",
                    lb,
                    "--repo",
                    self.slug,
                    "--color",
                    need[lb],
                    "--description",
                    "tracker.yaml",
                ]
            )
        if new_labels:
            print(f"Метки: {self.act('создать', 'создано')} {', '.join(new_labels)}")
        else:
            print("Метки: все на месте")

        # issues
        issues_raw = self.read_json(
            [
                "issue",
                "list",
                "--repo",
                self.slug,
                "--state",
                "all",
                "--limit",
                "1000",
                "--json",
                "number,title,body,state,labels",
            ],
            [],
        )
        issues = {i["number"]: i for i in issues_raw}
        by_prefix = {}
        for i in issues_raw:
            m = re.match(r"\[([^\]]+)\] ", i.get("title", ""))
            if m:
                by_prefix.setdefault(m.group(1), i)

        # доска
        self.ensure_project()
        self.ensure_fields()
        board = self.load_board()

        n_changed = 0
        for it in leaf:
            acts = self.sync_item(items, it, stages, issues, by_prefix, board)
            if acts:
                n_changed += 1
                print(f"{it['id']}: " + "; ".join(acts))
        if n_changed == 0 and self.nmut == 0:
            print("Всё актуально: изменений нет.")
        else:
            verb = "потребуется" if self.dry else "выполнено"
            print(f"Итого: пунктов с изменениями {n_changed}, команд gh {verb}: {self.nmut}.")

    def sync_item(self, items, it, stages, issues, by_prefix, board):
        acts = []
        status = eff_status(items, it)
        want_closed = status == "Выполнено"
        title, body = issue_title(it), issue_body(it)
        want_labels = issue_labels(it)
        num = it.get("issue")
        remote = issues.get(num) if num else None
        if num and remote is None:
            acts.append(f"Issue #{num} не найден — создаю заново")
            num = None
        if not num and it["id"] in by_prefix:
            remote = by_prefix[it["id"]]
            num = remote["number"]
            self.remember(it, num)
            acts.append(f"привязан найденный Issue #{num}")
        url = f"https://github.com/{self.slug}/issues/{num}" if num else None
        if remote is None:
            args = ["issue", "create", "--repo", self.slug, "--title", title, "--body", body]
            for lb in want_labels:
                args += ["--label", lb]
            out = self.mutate(args)
            acts.append(self.act("создать Issue", "создан Issue"))
            if out is not None:
                m = re.search(r"/issues/(\d+)", out)
                if not m:
                    raise GhError(f"gh issue create не вернул адрес Issue: {out.strip()!r}")
                num = int(m.group(1))
                self.remember(it, num)
                url = f"https://github.com/{self.slug}/issues/{num}"
                acts[-1] += f" #{num}"
            if want_closed:
                self.mutate(["issue", "close", str(num) if num else "<№ Issue>", "--repo", self.slug])
                acts.append(self.act("закрыть", "закрыт"))
        else:
            args = []
            if remote.get("title") != title:
                args += ["--title", title]
            if _norm_body(remote.get("body")) != _norm_body(body):
                args += ["--body", body]
            have = [x["name"] for x in remote.get("labels", [])]
            want_low = {lb.lower() for lb in want_labels}
            for lb in want_labels:
                if lb.lower() not in {h.lower() for h in have}:
                    args += ["--add-label", lb]
            for h in have:  # устаревшие метки этапа/участника
                if h.lower().startswith(MANAGED_LABEL_PREFIXES) and h.lower() not in want_low:
                    args += ["--remove-label", h]
            if args:
                self.mutate(["issue", "edit", str(num), "--repo", self.slug, *args])
                acts.append(self.act("обновить Issue", "обновлён Issue"))
            is_closed = str(remote.get("state", "")).upper() == "CLOSED"
            if want_closed and not is_closed:
                self.mutate(["issue", "close", str(num), "--repo", self.slug])
                acts.append(self.act("закрыть", "закрыт"))
            elif not want_closed and is_closed:
                self.mutate(["issue", "reopen", str(num), "--repo", self.slug])
                acts.append(self.act("открыть снова", "открыт снова"))
        # доска
        bi = board.get(num) if num else None
        item_id = bi["id"] if bi else "<id карточки>"
        if bi is None:
            pnum = str(self.proj["number"]) if self.proj["number"] is not None else "<№ доски>"
            out = self.mutate(
                [
                    "project",
                    "item-add",
                    pnum,
                    "--owner",
                    self.owner,
                    "--url",
                    url or "<адрес Issue>",
                    "--format",
                    "json",
                ]
            )
            acts.append(self.act("добавить на доску", "добавлен на доску"))
            if out is not None:
                try:
                    item_id = json.loads(out)["id"]
                except (json.JSONDecodeError, KeyError):
                    raise GhError("gh project item-add вернул неожиданный ответ.") from None
        p = it.get("plan")
        top = it["id"].split(".")[0]
        want = [("Status", status, "status")]
        if it.get("person"):
            want.append(("Участник", it["person"], "text"))
        if p:
            want += [("Начало", p["start"].isoformat(), "date"), ("Срок", p["end"].isoformat(), "date")]
        if stages.get(top):
            want.append(("Этап", stages[top], "text"))
        changed = []
        for name, value, kind in want:
            cur = None
            fid = (self.fields.get(name) or {}).get("id")
            if bi and fid:
                cur = bi["values"].get(fid)
            cur_s = "" if cur is None else (str(cur)[:10] if kind == "date" else str(cur).strip())
            if cur_s != value:
                self.set_field(item_id, name, value, kind)
                changed.append(name)
        if changed:
            acts.append("поля: " + ", ".join(changed))
        return acts


def cmd_gh_sync(args):
    ypath, _ = paths(args)
    data, _ = load_data(ypath)
    cfg = data.get("github") or {}
    missing = [k for k in ("owner", "repo", "project_title") if not cfg.get(k)]
    if missing:
        raise TrackerError("В tracker.yaml, раздел github, не заданы: " + ", ".join(missing))
    m = Mirror(cfg, dry_run=args.dry_run, record=lambda numbers: write_issue_numbers(ypath, numbers))
    err = None
    try:
        m.sync(data)
    except GhError as e:
        err = e
    finally:
        try:
            m.flush()  # номера Issue сохраняются при любом исключении, в т.ч. Ctrl+C
        except Exception as e:  # noqa: BLE001
            print(
                f"ОШИБКА: не удалось записать номера Issue {m.pending} в tracker.yaml ({e}). Впишите их "
                f"вручную."
            )
    if m.saved:
        print(f"tracker.yaml: записаны номера Issue ({m.saved}); остальные поля файла не тронуты.")
    if err:
        print(f"ОШИБКА gh: {err}")
        print(
            "Проверьте, что репозиторий создан, «gh auth status» зелёный (нужны права repo и project), "
            "и повторите команду: она идемпотентна."
        )
        return 1
    if args.dry_run:
        print("dry-run: ничего не изменено.")
    return 0


# ----------------------------------------------------------------- CLI
def make_parser():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--yaml", help="путь к tracker.yaml (по умолчанию docs/tracker/tracker.yaml; env TRACKER_YAML)"
    )
    common.add_argument(
        "--out", help="путь к xlsx (по умолчанию docs/tracker/График_работ.xlsx; env TRACKER_XLSX)"
    )
    common.add_argument("--today", help="считать «сегодня» этой датой (ГГГГ-ММ-ДД) - для проб и тестов")
    chg = argparse.ArgumentParser(add_help=False, parents=[common])
    chg.add_argument("--no-build", action="store_true", help="только записать YAML, Excel не пересобирать")

    p = argparse.ArgumentParser(
        prog="tracker.py",
        description=(
            "Учёт проекта «Цифровой деканат»: tracker.yaml -> Excel-график и доска GitHub Projects. "
            "Источник правды - YAML."
        ),
    )
    sub = p.add_subparsers(dest="cmd", required=True, metavar="команда")

    s = sub.add_parser("build", parents=[common], help="собрать Excel из tracker.yaml (атомарно)")
    s.set_defaults(fn=cmd_build)

    s = sub.add_parser(
        "sync",
        parents=[chg],
        help="считать из Excel «Комментарий» и «Решение пользователя» в YAML, затем собрать",
    )
    s.set_defaults(fn=cmd_sync)

    s = sub.add_parser("add", parents=[chg], help="добавить пункт после последнего потомка родителя")
    s.add_argument("--id", required=True, help="номер, напр. 1.8")
    s.add_argument("--title", required=True, help="название")
    s.add_argument(
        "--parent",
        help="номер родителя (по умолчанию - из номера: 3.7 -> 3; номер без точки создаёт новый этап)",
    )
    s.add_argument("--person", help="участник: А, Б, В или несколько через запятую («Б, В»)")
    s.add_argument("--owner", help="исполнитель")
    s.add_argument("--review", help="ревьюер")
    s.add_argument("--start", help="план: начало (ГГГГ-ММ-ДД или ДД.ММ.ГГГГ)")
    s.add_argument("--end", help="план: конец (срок)")
    s.set_defaults(fn=cmd_add)

    s = sub.add_parser("mark", parents=[chg], help="поставить факт-статус пункту на день или диапазон дней")
    s.add_argument("id", help="номер пункта")
    s.add_argument(
        "day",
        help="today, дата (ГГГГ-ММ-ДД, ДД.ММ, ДД.ММ.ГГГГ) или диапазон (ДД.ММ-ДД.ММ, ГГГГ-ММ-ДД..ГГГГ-ММ-ДД)",
    )
    s.add_argument("status", help="; ".join(STATUSES) + " или «-» (убрать)")
    s.set_defaults(fn=cmd_mark)

    s = sub.add_parser("log", parents=[chg], help="добавить запись в «Историю» (с сегодняшней датой)")
    s.add_argument("--item", required=True)
    s.add_argument("--what", required=True)
    s.add_argument("--who", default="Оркестратор (Opus 5.5)", help="роль, модель, effort или «пользователь»")
    s.add_argument("--commit")
    s.add_argument("--rounds", type=int, help="раунды ревью")
    s.add_argument("--tokens", type=int)
    s.add_argument("--link")
    s.add_argument("--date", help="по умолчанию сегодня")
    s.set_defaults(fn=cmd_log)

    s = sub.add_parser("review", parents=[chg], help="добавить замечание ревью (ID R-<пункт>-<n>)")
    s.add_argument("--item", required=True)
    s.add_argument("--round", type=int, required=True)
    s.add_argument("--severity", required=True, choices=SEVERITIES)
    s.add_argument("--text", required=True)
    s.add_argument("--repro", help="воспроизведение")
    s.add_argument("--by", help="кто нашёл")
    s.add_argument("--id", help="свой номер замечания, напр. R-1.1-101 (второй ревьюер раунда)")
    s.set_defaults(fn=cmd_review)

    s = sub.add_parser("review-status", parents=[chg], help="сменить статус замечания")
    s.add_argument("id")
    s.add_argument("status", help="/".join(REVIEW_STATUSES))
    s.add_argument("--comment")
    s.set_defaults(fn=cmd_review_status)

    s = sub.add_parser("decision", parents=[chg], help="записать решение пользователя по развилке")
    s.add_argument("id", help="напр. Р-0")
    s.add_argument("--answer", required=True)
    s.add_argument("--date", help="по умолчанию сегодня")
    s.set_defaults(fn=cmd_decision)

    s = sub.add_parser(
        "due",
        parents=[common],
        help="что горит: просрочено, сегодня, завтра, ближайшие дни; развилки без ответа",
    )
    s.add_argument("--days", type=int, default=3, help="окно «ближайших» дней (по умолчанию 3)")
    s.add_argument("--person", help="только пункты этого участника (А, Б, В)")
    s.set_defaults(fn=cmd_due)

    s = sub.add_parser(
        "gh-sync",
        parents=[common],
        help="односторонне отразить YAML в Issues и доску GitHub Projects (через gh)",
    )
    s.add_argument("--dry-run", action="store_true", help="только напечатать план, мутирующих вызовов gh нет")
    s.set_defaults(fn=cmd_gh_sync)
    return p


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    args = make_parser().parse_args(argv)
    try:
        return args.fn(args) or 0
    except TrackerError as e:
        print(f"ОШИБКА: {e}")
        return 1
    except LockedError as e:
        print(f"ОШИБКА: {e}")
        return 2
    except GhError as e:
        print(f"ОШИБКА gh: {e}")
        return 1
    except FileNotFoundError as e:
        print(f"ОШИБКА: файл не найден: {e.filename or e}")
        return 1
    except yaml.YAMLError as e:
        print(f"ОШИБКА: tracker.yaml не разобран: {e}")
        return 1
    except OSError as e:
        print(f"ОШИБКА: {e}")
        return 1
    except (KeyError, ValueError, TypeError, AttributeError, IndexError) as e:
        print(f"ОШИБКА: некорректные данные ({type(e).__name__}: {e}). Проверьте tracker.yaml.")
        return 1
    except Exception as e:  # непредвиденное: без трейсбека, но с типом ошибки
        print(
            f"ОШИБКА: непредвиденный сбой ({type(e).__name__}: {e}). Часть изменений могла быть записана "
            f"- проверьте tracker.yaml."
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
