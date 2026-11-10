"""Дымовые тесты tools/tracker.py на копии живого docs/tracker/tracker.yaml.

Инструмент перенесён из другого проекта команды. Его полный набор тестов остался там:
образец данных для них — учёт того проекта. Здесь проверяется то, чем пользуется этот репозиторий.

Запуск (из корня репозитория):
    uv run --no-project --with pytest --with pyyaml --with openpyxl python -m pytest tools/tests -q
"""

import shutil
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from openpyxl import load_workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tracker  # noqa: E402

REAL_YAML = Path(__file__).resolve().parents[2] / "docs" / "tracker" / "tracker.yaml"
TODAY = "2026-11-16"


@pytest.fixture()
def env(tmp_path):
    y = tmp_path / "tracker.yaml"
    shutil.copyfile(REAL_YAML, y)
    return SimpleNamespace(yaml=y, xlsx=tmp_path / "график.xlsx", dir=tmp_path)


def run(env, capsys, *argv):
    """Запуск команды на копии; возвращает (код, вывод)."""
    cmd = [*argv, "--yaml", str(env.yaml), "--out", str(env.xlsx), "--today", TODAY]
    code = tracker.main(cmd)
    return code, capsys.readouterr().out


def load(env):
    return tracker.load_data(env.yaml)[0]


def test_roundtrip_is_byte_exact(tmp_path):
    data, header = tracker.load_data(REAL_YAML)
    out = tmp_path / "again.yaml"
    tracker.save_data(out, data, header)
    assert out.read_bytes() == REAL_YAML.read_bytes()


def test_default_header_matches_yaml_header():
    _, header = tracker.load_data(REAL_YAML)
    assert tracker.DEFAULT_HEADER.rstrip("\n") == header.rstrip("\n")


def test_every_item_has_person_and_deadline():
    data, _ = tracker.load_data(REAL_YAML)
    for it in data["items"]:
        if it.get("stage"):
            continue
        assert it.get("person"), it["id"]
        assert it.get("plan", {}).get("end"), it["id"]


def test_due_shows_documents_deadline(env, capsys):
    code, out = run(env, capsys, "due")
    assert code == 0
    assert "6.1" in out  # документы участников: срок 16.11


def test_mark_and_log(env, capsys):
    assert run(env, capsys, "mark", "1.1", "today", "В работе", "--no-build")[0] == 0
    assert "В работе" in tracker.get_item(load(env), "1.1")["fact"].values()
    code, _ = run(
        env, capsys, "log", "--item", "1.1", "--what", "проба", "--who", "тест", "--tokens", "1000", "--no-build"
    )
    assert code == 0
    assert any(h.get("item") == "1.1" and h.get("tokens") == 1000 for h in load(env)["history"])


def test_decision_answer_is_saved(env, capsys):
    assert run(env, capsys, "decision", "Р-2", "--answer", "Вариант 1", "--no-build")[0] == 0
    answers = {d["id"]: d.get("answer") for d in load(env)["decisions"]}
    assert answers["Р-2"] == "Вариант 1"


def test_build_makes_all_sheets(env, capsys):
    assert run(env, capsys, "build")[0] == 0
    sheets = load_workbook(env.xlsx).sheetnames
    for name in ("График", "Сроки", "История", "Ревью", "Решения", "Легенда"):
        assert name in sheets
