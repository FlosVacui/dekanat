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
"""

from __future__ import annotations

import os
import shutil
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


def run(argv: list[str]) -> tuple[int, str]:
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    try:
        r = subprocess.run(
            argv,
            cwd=ROOT,
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


CHECKS = {
    LINKS: links,
    CLEAN: clean,
    TESTS: tool_tests,
    DUE: due,
    PS1: ps1,
    SH: sh,
    MODES: modes_and_bom,
    LEAKS: leaks,
}


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    results = []
    for name in STEP_NAMES:
        print(f"→ {name}", flush=True)
        start = time.monotonic()
        code, out = CHECKS[name]()
        status = "пропущено" if code is None else "ок" if code == 0 else "ошибка"
        if status == "ошибка":
            print("\n".join(out.splitlines()[-25:]), flush=True)
        results.append((name, status, time.monotonic() - start))
    print("\nИтог:")
    for name, status, spent in results:
        print(f"  {status:<9} {name} ({spent:.0f} с)")
    failed = [name for name, status, _ in results if status == "ошибка"]
    if failed:
        print("Не прошло: " + ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
