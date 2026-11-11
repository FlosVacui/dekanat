"""Локальный CI: те же шаги, что в `.github/workflows/ci.yml`; проверка прав и BOM."""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import check_all  # noqa: E402

CI = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")


def test_steps_are_the_ci_steps_in_the_same_order():
    names = [n for n in re.findall(r"^\s+- name: (.+)$", CI, re.M) if "${{" not in n]
    assert check_all.STEP_NAMES == names


def test_executable_list_matches_ci():
    line = next(ln for ln in CI.splitlines() if "for f in tools/" in ln)
    assert line.split("for f in ", 1)[1].split("; do")[0].split() == check_all.EXECUTABLE


def test_modes_and_bom():
    index = "\n".join(f"100755 0123abcd 0\t{f}" for f in check_all.EXECUTABLE)
    assert check_all.problems_with_modes_and_bom(index, b"\xef\xbb\xbf") == []
    wrong = index.replace("100755 0123abcd 0\ttools/tracker.py", "100644 0123abcd 0\ttools/tracker.py")
    assert check_all.problems_with_modes_and_bom(wrong, b"#!/") == [
        "не исполняемый в git: tools/tracker.py",
        "bootstrap.ps1 без BOM",
    ]


def test_env_files_in_git_are_found():
    listing = "README.md\n.env.example\napp/.env.example\n.env\napp/.env.local\ndocs/env.md\napp/src/.envrc"
    assert check_all.tracked_env_files(listing) == [".env", "app/.env.local"]
