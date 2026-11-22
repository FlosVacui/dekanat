#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["markdown>=3.7"]
# ///
"""Собирает PDF описания процесса из docs/submission/process.md.

Цепочка: pandoc (Markdown → HTML) → Chrome без окна (HTML → PDF).
Исходник один, поэтому PDF и Markdown не расходятся.

- Комментарии <!-- src: … --> в PDF не попадают: скрипт убирает их до сборки.
- Ссылки на файлы репозитория становятся адресами GitHub: в PDF файловые пути не работают.
- Снимки берутся из docs/evidence/screenshots/ как есть.
- Шрифт — Nunito из app/node_modules, как в кабинете. Нет пакета — системный шрифт без засечек.

Запуск: uv run tools/build_pdf.py [путь к PDF]   (по умолчанию — build/process.pdf, папки нет в git)
Нужны pandoc и Chrome или Chromium.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "submission" / "process.md"
REPO_URL = "https://github.com/FlosVacui/dekanat/blob/main/"
FONTS = ROOT / "app" / "node_modules" / "@fontsource-variable" / "nunito" / "files"

CSS = """
@font-face { font-family: 'Nunito PDF'; src: url('{cyr}') format('woff2'); font-weight: 200 1000; unicode-range: U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116; }
@font-face { font-family: 'Nunito PDF'; src: url('{lat}') format('woff2'); font-weight: 200 1000; }
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }
html { font-family: 'Nunito PDF', 'Noto Sans', 'DejaVu Sans', sans-serif; font-size: 10.5pt; line-height: 1.45; color: #1F2433; }
h1 { font-size: 20pt; margin: 0 0 6pt; color: #1A4FA8; }
h2 { font-size: 15pt; margin: 18pt 0 6pt; color: #1A4FA8; break-after: avoid; }
h3 { font-size: 12pt; margin: 12pt 0 4pt; break-after: avoid; }
p, li { orphans: 3; widows: 3; }
a { color: #1A4FA8; text-decoration: none; }
code { font-family: 'DejaVu Sans Mono', monospace; font-size: 9pt; background: #F1F3F8; padding: 0 2pt; border-radius: 2pt; }
pre { background: #F1F3F8; padding: 6pt; font-size: 8.5pt; white-space: pre-wrap; }
blockquote { margin: 6pt 0; padding-left: 8pt; border-left: 3pt solid #C9D5EE; color: #3B4256; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0; font-size: 9pt; break-inside: auto; }
tr { break-inside: avoid; }
th, td { border: 0.5pt solid #C9CED9; padding: 3pt 5pt; vertical-align: top; text-align: left; }
th { background: #EEF2FA; }
img { max-width: 100%; max-height: 120mm; display: block; margin: 0 auto; border: 0.5pt solid #C9CED9; }
td img { max-height: 110mm; }
strong { font-weight: 800; }
"""


def die(msg: str) -> None:
    print(f"ОШИБКА: {msg}", file=sys.stderr)
    sys.exit(1)


def find_chrome() -> str:
    for name in ("google-chrome", "chromium", "chromium-browser", "chrome"):
        path = shutil.which(name)
        if path:
            return path
    mac = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    if mac.exists():
        return str(mac)
    for base in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):  # Windows: Chrome не в PATH
        win = Path(os.environ.get(base, "")) / "Google" / "Chrome" / "Application" / "chrome.exe"
        if os.environ.get(base) and win.exists():
            return str(win)
    die("нет Chrome или Chromium")
    return ""


def repo_links(html: str) -> str:
    """Относительные ссылки на файлы репозитория → адреса GitHub; якоря и внешние адреса не трогаются."""
    base = SRC.parent

    def fix(m: re.Match[str]) -> str:
        href = m.group(1)
        if href.startswith(("http://", "https://", "mailto:", "#")):
            return m.group(0)
        path, _, anchor = href.partition("#")
        target = (base / path).resolve()
        try:
            rel = target.relative_to(ROOT).as_posix()
        except ValueError:
            return m.group(0)
        return f'href="{REPO_URL}{rel}{"#" + anchor if anchor else ""}"'

    return re.sub(r'href="([^"]+)"', fix, html)


def main() -> None:
    out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "build" / "process.pdf"
    # Комментарии-источники убираются до разбора: внутри них бывает «--», и тогда браузер показал бы их текстом.
    text = re.sub(r"[ \t]*<!--.*?-->", "", SRC.read_text(encoding="utf-8"), flags=re.S)
    if shutil.which("pandoc"):
        body = subprocess.run(
            ["pandoc", "-f", "gfm", "-t", "html5"], input=text, check=True, capture_output=True, text=True
        ).stdout
    else:
        # 22.11.2026: на машине участника А pandoc нет. Запасной путь — библиотека markdown; якоря заголовков —
        # с кириллицей, как у GitHub, чтобы ссылки внутри документа работали.
        import markdown
        from markdown.extensions.toc import slugify_unicode

        body = markdown.markdown(
            text, extensions=["tables", "fenced_code", "sane_lists", "toc"],
            extension_configs={"toc": {"slugify": slugify_unicode}},
        )
    body = repo_links(body)
    css = CSS.replace("{cyr}", (FONTS / "nunito-cyrillic-wght-normal.woff2").as_uri()).replace(
        "{lat}", (FONTS / "nunito-latin-wght-normal.woff2").as_uri()
    )
    html = (
        '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">'
        f'<base href="{SRC.parent.as_uri()}/"><title>Описание процесса создания — «Деканат в кармане»</title>'
        f"<style>{css}</style></head><body>{body}</body></html>"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "process.html"
        page.write_text(html, encoding="utf-8")
        subprocess.run(
            [
                find_chrome(), "--headless=new", "--disable-gpu", "--no-sandbox", "--allow-file-access-from-files",
                "--no-pdf-header-footer", f"--print-to-pdf={out}", page.as_uri(),
            ],
            check=True, capture_output=True,
        )
    if not out.exists() or out.stat().st_size == 0:
        die("PDF не создан")
    print(f"PDF: {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out.name}, {out.stat().st_size // 1024} КБ")


if __name__ == "__main__":
    main()
