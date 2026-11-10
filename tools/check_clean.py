#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Чистота репозитория: личные пути, адреса почты и пути к соседним папкам.

Репозиторий увидит жюри. В файлах под git не должно быть личных путей, адресов почты
и путей наружу. Проверяются отслеживаемые и новые неигнорируемые файлы (`git ls-files`).
Исключения перечислены в ALLOW вместе с причиной.

Запуск: uv run tools/check_clean.py
Код возврата: 0 — чисто, 1 — есть находки.
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Файлы, которые не проверяются, и почему.
ALLOW = {
    "prompts/P-001-plan.md": "настоящий стартовый промпт; хранится как был, со ссылкой на образец среды",
    "tools/check_clean.py": "сами правила проверки",
    "tools/tests/test_check_clean.py": "образцы для тестов проверки",
}
BINARY = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".xlsx", ".docx", ".woff", ".woff2", ".mp4"}
SAFE_MAIL = re.compile(r"@(users\.noreply\.github\.com|anthropic\.com|example\.(com|org)|[\w.-]+\.(example|test|invalid))$")

RULES = [
    ("личный путь Windows", re.compile(r"[A-Za-z]:\\+Users\\+(?![<{$%])[^\\\s<>\"'`]+", re.I)),
    ("личный путь macOS или Linux", re.compile(r"(?<![\w.])/(?:Users|home)/(?![<{$])[A-Za-z0-9._-]+")),
    ("адрес почты", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")),
    ("путь к соседней папке", re.compile(r"\.\.\\[^\s`'\")]+")),
]


def findings(text: str) -> list[tuple[int, str, str]]:
    """Находки в тексте: (строка, правило, совпадение)."""
    out = []
    for number, line in enumerate(text.splitlines(), 1):
        for name, pattern in RULES:
            for m in pattern.finditer(line):
                if name == "адрес почты" and SAFE_MAIL.search(m.group(0)):
                    continue
                out.append((number, name, m.group(0)))
    return out


def files() -> list[str]:
    r = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
        capture_output=True,
        check=True,
    )
    return [f for f in r.stdout.decode("utf-8").split("\0") if f]


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    bad = 0
    checked = 0
    for rel in sorted(files()):
        path = ROOT / rel
        if rel in ALLOW or path.suffix.lower() in BINARY or not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError:
            continue
        checked += 1
        for number, name, match in findings(text):
            print(f"{rel}:{number}: {name}: {match}")
            bad += 1
    print(f"Проверено файлов: {checked}, находок: {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
