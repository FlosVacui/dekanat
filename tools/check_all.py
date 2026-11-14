#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Все проверки CI одной командой, локально: те же шаги, что в `.github/workflows/ci.yml`.

Запуск из корня репозитория:  uv run tools/check_all.py

Каждый шаг идёт до конца, даже если предыдущий упал; итог — таблица и код 1 при любой ошибке.
Шаги, которым нужна другая ОС или программа (PowerShell 5.1, bash, gitleaks), без неё пропускаются
с пометкой.

После шагов CI идут четыре шага продукта — проверка типов, линтер, модульные и сквозной тесты
в `app/`. В CI на GitHub их нет: там нет базы. Стенд не поднят — шаг получает «пропущено»,
общий итог остаётся зелёным: ADR-0005, «Пропущено — не пройдено». Пакет с кодом продукта
принимается только при «ок» у каждого шага; пропущенные шаги названы в итоге поимённо.

Шаг продукта повторяется один раз, если упал сам процесс, а проваленных проверок нет:
код сбоя Windows или вылет рабочего процесса Vitest. Причина таких падений не найдена:
docs/research/R-node-crashes.md. Повтор виден в итоге и назван отдельной строкой.
Проваленная проверка не повторяется. Решение пользователя 14.11.2026.
"""

from __future__ import annotations

import os
import re
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Имена шагов — как в ci.yml (это сверяет тест).
LINKS = "Ссылки в документах"
CLEAN = "Чистота — личные пути и почта"
TESTS = "Тесты инструментов"
DUE = "Учёт — сроки читаются"
PS1 = "Разбор bootstrap.ps1 (Windows PowerShell 5.1)"
SH = "Синтаксис bootstrap.sh"
MODES = "Права на запуск и BOM скриптов"
LEAKS = "Секреты (gitleaks)"
STEP_NAMES = [LINKS, CLEAN, TESTS, DUE, PS1, SH, MODES, LEAKS]

# Шаги продукта — только локально, в ci.yml их нет: ADR-0005.
APP_TYPES = "Продукт — проверка типов"
APP_LINT = "Продукт — линтер"
APP_UNIT = "Продукт — модульные тесты"
APP_E2E = "Продукт — сквозной тест на 360 пикселях"
PRODUCT_STEP_NAMES = [APP_TYPES, APP_LINT, APP_UNIT, APP_E2E]
APP = ROOT / "app"
DB_ADDRESS = ("127.0.0.1", 5432)

EXECUTABLE = [
    "tools/bootstrap.sh",
    "tools/tracker.py",
    "tools/check_links.py",
    "tools/check_clean.py",
    "tools/check_all.py",
]
PS1_PARSE = (
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8; $t = $null; $e = $null; "
    "[void][System.Management.Automation.Language.Parser]::ParseFile("
    "'{path}', [ref]$t, [ref]$e); "
    "if ($e.Count -ne 0) {{ $e | ForEach-Object {{ Write-Host $_.Message }}; exit 1 }}"
)


def run(argv: list[str], cwd: Path = ROOT) -> tuple[int, str]:
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    try:
        r = subprocess.run(
            argv,
            cwd=cwd,
            env=env,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError:
        return 127, f"команда не найдена: {argv[0]}"
    return r.returncode, (r.stdout + r.stderr).strip()


def links() -> tuple[int | None, str]:
    return run(["uv", "run", "tools/check_links.py"])


def clean() -> tuple[int | None, str]:
    return run(["uv", "run", "tools/check_clean.py"])


def tool_tests() -> tuple[int | None, str]:
    return run(
        ["uv", "run", "--no-project", "--with", "pytest", "--with", "pyyaml", "--with", "openpyxl",
         "python", "-m", "pytest", "tools/tests", "-q"]
    )


def due() -> tuple[int | None, str]:
    return run(["uv", "run", "tools/tracker.py", "due"])


def ps1() -> tuple[int | None, str]:
    shell = shutil.which("powershell")
    if shell is None:
        return None, "нет Windows PowerShell — пропущено"
    return run([shell, "-NoProfile", "-Command", PS1_PARSE.format(path=ROOT / "tools" / "bootstrap.ps1")])


def sh() -> tuple[int | None, str]:
    bash = shutil.which("bash")
    if bash is None:
        return None, "нет bash — пропущено"
    return run([bash, "-n", "tools/bootstrap.sh"])


def problems_with_modes_and_bom(index: str, ps1_head: bytes) -> list[str]:
    """`index` — вывод `git ls-files -s` по скриптам; нужен режим 100755 и BOM у bootstrap.ps1."""
    modes = {line.split("\t", 1)[1]: line.split()[0] for line in index.splitlines() if "\t" in line}
    out = [f"не исполняемый в git: {f}" for f in EXECUTABLE if modes.get(f) != "100755"]
    if not ps1_head.startswith(b"\xef\xbb\xbf"):
        out.append("bootstrap.ps1 без BOM")
    return out


def modes_and_bom() -> tuple[int | None, str]:
    code, index = run(["git", "ls-files", "-s", *EXECUTABLE])
    if code != 0:
        return code, index
    bad = problems_with_modes_and_bom(index, (ROOT / "tools" / "bootstrap.ps1").read_bytes()[:3])
    return (1, "\n".join(bad)) if bad else (0, "права и BOM в порядке")


def tracked_env_files(listing: str) -> list[str]:
    """`listing` — вывод `git ls-files`. Файлы окружения в git; образец `.env.example` разрешён."""
    out = []
    for path in listing.splitlines():
        name = path.rsplit("/", 1)[-1]
        if (name == ".env" or name.startswith(".env.")) and name != ".env.example":
            out.append(path)
    return out


def leaks() -> tuple[int | None, str]:
    # Проверка С-07 из R-1.5: файл окружения не лежит в git. Идёт и без gitleaks.
    code, listing = run(["git", "ls-files"])
    if code != 0:
        return code, listing
    tracked = tracked_env_files(listing)
    if tracked:
        return 1, "файл окружения в git: " + ", ".join(tracked)
    if shutil.which("gitleaks") is None:
        return None, "нет gitleaks — пропущено"
    has_commits = run(["git", "rev-parse", "--verify", "HEAD"])[0] == 0
    scan = ["git"] if has_commits else ["dir", "."]
    return run(["gitleaks", *scan, "--redact", "--no-banner"])


def product_skip_reason(
    has_npm: bool, has_modules: bool, needs_stand: bool = False, has_env: bool = True, db_up: bool = True
) -> str | None:
    """Почему шаг продукта пропускается; `None` — запускать. Стенд — файл окружения и локальная база."""
    if not has_npm:
        return "нет npm — пропущено"
    if not has_modules:
        return "зависимости продукта не установлены (npm ci в app/) — пропущено"
    if needs_stand and not has_env:
        return "нет файла окружения (npm run db:setup в app/) — пропущено"
    if needs_stand and not db_up:
        return f"локальная база не отвечает на {DB_ADDRESS[0]}:{DB_ADDRESS[1]} — пропущено"
    return None


def db_answers() -> bool:
    try:
        with socket.create_connection(DB_ADDRESS, timeout=2):
            return True
    except OSError:
        return False


def product(script: str, needs_stand: bool = False) -> tuple[int | None, str]:
    # Файл окружения не читается: проверяется только, что он есть.
    npm = shutil.which("npm")
    reason = product_skip_reason(
        npm is not None,
        (APP / "node_modules").is_dir(),
        needs_stand,
        (ROOT / ".env").is_file(),
        db_answers() if needs_stand else True,
    )
    if reason is not None:
        return None, reason
    return run([npm, "run", script], cwd=APP)


ANSI = re.compile(r"\x1b\[[0-9;]*m")
# Коды сбоя процесса Windows: 0xC0000005 «обращение к чужой памяти» и соседние; в десятичной записи — 3221…
WINDOWS_CRASH_FLOOR = 0xC0000000
WINDOWS_CRASH_IN_TEXT = re.compile(r"\b(3221\d{6}|0xc0000[0-9a-f]{3})\b", re.IGNORECASE)
WORKER_CRASH_IN_TEXT = re.compile(r"Worker exited unexpectedly with exit code (\d+)")
FAILED_CHECKS_IN_TEXT = re.compile(r"\b\d+ failed\b")


def crash_reason(code: int | None, out: str) -> str | None:
    """Упал сам процесс, а не проверка: вернуть, чем это видно; иначе `None`.

    Проваленная проверка в выводе («N failed») — не падение процесса: такой шаг не повторяется.
    """
    if code is None or code == 0:
        return None
    text = ANSI.sub("", out)
    if FAILED_CHECKS_IN_TEXT.search(text):
        return None
    worker = WORKER_CRASH_IN_TEXT.search(text)
    if worker:
        return f"рабочий процесс тестов вышел с кодом {worker.group(1)}"
    if code >= WINDOWS_CRASH_FLOOR:
        return f"процесс вышел с кодом {code}"
    mark = WINDOWS_CRASH_IN_TEXT.search(text)
    if mark:
        return f"в выводе код сбоя процесса {mark.group(1)}"
    return None


CHECKS = {
    LINKS: links,
    CLEAN: clean,
    TESTS: tool_tests,
    DUE: due,
    PS1: ps1,
    SH: sh,
    MODES: modes_and_bom,
    LEAKS: leaks,
    APP_TYPES: lambda: product("typecheck"),
    APP_LINT: lambda: product("lint"),
    APP_UNIT: lambda: product("test", needs_stand=True),
    APP_E2E: lambda: product("test:e2e", needs_stand=True),
}


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    results = []
    retried: list[str] = []
    for name in STEP_NAMES + PRODUCT_STEP_NAMES:
        print(f"→ {name}", flush=True)
        start = time.monotonic()
        code, out = CHECKS[name]()
        crash = crash_reason(code, out) if name in PRODUCT_STEP_NAMES else None
        if crash is not None:
            print("\n".join(out.splitlines()[-25:]), flush=True)
            print(f"↻ {name}: {crash}, проваленных проверок нет — повтор шага, один раз", flush=True)
            code, out = CHECKS[name]()
            again = crash_reason(code, out)
            retried.append(f"{name}: {crash}" + (f"; повтор тоже упал: {again}" if again else ""))
        status = "пропущено" if code is None else "ок" if code == 0 else "ошибка"
        if status == "ошибка":
            print("\n".join(out.splitlines()[-25:]), flush=True)
        results.append((name, status, time.monotonic() - start, out if code is None else ""))
    print("\nИтог:")
    for name, status, spent, _ in results:
        print(f"  {status:<9} {name} ({spent:.0f} с)")
    if retried:
        print("Повтор после падения процесса — запиши в журнал смены:\n  " + "\n  ".join(retried))
    skipped = [f"{name}: {reason}" for name, status, _, reason in results if status == "пропущено"]
    if skipped:
        print("Пропущено — не пройдено:\n  " + "\n  ".join(skipped))
    failed = [name for name, status, _, _ in results if status == "ошибка"]
    if failed:
        print("Не прошло: " + ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
