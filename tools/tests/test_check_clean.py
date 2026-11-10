"""Проверка чистоты: что считается находкой, а что нет."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import check_clean  # noqa: E402


def rules(text: str) -> list[str]:
    return [name for _, name, _ in check_clean.findings(text)]


def test_personal_paths_are_found():
    assert rules(r"лежит в C:\Users\ivan\project") == ["личный путь Windows"]
    assert rules("лежит в /Users/ivan/project") == ["личный путь macOS или Linux"]
    assert rules("лежит в /home/ivan/project") == ["личный путь macOS или Linux"]


def test_placeholders_and_urls_are_not_paths():
    assert rules(r"пример: C:\Users\<имя>\project") == []
    assert rules("https://example.com/home/page") == []


def test_mail_is_found_except_service_addresses():
    assert rules("пишите на ivan@mail.ru") == ["адрес почты"]
    assert rules("автор 123+login@users.noreply.github.com") == []
    assert rules("тестовый вход student@dekanat.example") == []


def test_path_to_neighbour_folder_is_found_only_with_backslash():
    assert rules(r"образец в ..\other-project\docs") == ["путь к соседней папке"]
    assert rules("ссылка [шаблон](../templates/brief.md)") == []


def test_every_exception_has_a_reason_and_exists():
    for rel, reason in check_clean.ALLOW.items():
        assert reason.strip(), rel
        assert (check_clean.ROOT / rel).is_file(), rel
