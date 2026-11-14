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


def test_product_steps_are_local_only_and_have_checks():
    assert not set(check_all.PRODUCT_STEP_NAMES) & set(check_all.STEP_NAMES)
    assert all(name not in CI for name in check_all.PRODUCT_STEP_NAMES)
    assert set(check_all.CHECKS) == set(check_all.STEP_NAMES + check_all.PRODUCT_STEP_NAMES)


def test_product_step_is_skipped_without_stand():
    reason = check_all.product_skip_reason
    assert "нет npm" in reason(False, True)
    assert "не установлены" in reason(True, False)
    assert reason(True, True) is None
    assert reason(True, True, needs_stand=False, has_env=False, db_up=False) is None
    assert "нет файла окружения" in reason(True, True, needs_stand=True, has_env=False, db_up=True)
    assert "база не отвечает" in reason(True, True, needs_stand=True, has_env=True, db_up=False)
    assert reason(True, True, needs_stand=True, has_env=True, db_up=True) is None
    assert all(r.endswith("пропущено") for r in (reason(False, True), reason(True, False)))


# Строки — из настоящих журналов прогонов 14.11.2026: docs/research/R-node-crashes.md.
WORKER_CRASH = (
    "Error: [vitest-pool]: Worker forks emitted error.\n"
    "Caused by: Error: Worker exited unexpectedly with exit code 3221225477 during started state "
    "while running test file tests/unit/seed-cohort.test.ts\n"
    " Test Files  21 passed (22)\n      Tests  420 passed (427)\n     Errors  1 error\n"
)
REAL_FAILURES = " Test Files  4 failed | 18 passed (22)\n      Tests  20 failed | 407 passed (427)\n"
CRASH_WITH_FAILURES = (
    "Caused by: Error: Worker exited unexpectedly with exit code 3221225794 during starting state\n"
    " Test Files  2 failed (2)\n      Tests  19 failed | 15 passed | 10 skipped (44)\n"
)


def test_crash_reason_tells_a_dead_process_from_a_failed_check():
    reason = check_all.crash_reason
    assert "3221225477" in reason(1, WORKER_CRASH)
    assert "3221225477" in reason(1, "\x1b[31m" + WORKER_CRASH + "\x1b[39m")
    assert "3221225622" in reason(3221225622, "")
    assert "0xc0000005" in reason(1, "browser process exited with 0xc0000005").lower()
    assert reason(0, WORKER_CRASH) is None
    assert reason(None, "нет npm — пропущено") is None
    assert reason(1, REAL_FAILURES) is None
    assert reason(1, CRASH_WITH_FAILURES) is None
    assert reason(1, "error TS2322: Type 'string' is not assignable to type 'number'.") is None
    assert reason(1, "Error: read ECONNRESET\n  1 failed\n") is None


def run_main(monkeypatch, capsys, answers: dict):
    """`answers` — имя шага → список ответов по порядку вызовов; остальные шаги зелёные."""
    calls: dict[str, int] = {}

    def check(name):
        def call():
            calls[name] = calls.get(name, 0) + 1
            queue = answers.get(name, [(0, "")])
            return queue[min(calls[name], len(queue)) - 1]

        return call

    monkeypatch.setattr(check_all, "CHECKS", {n: check(n) for n in check_all.STEP_NAMES + check_all.PRODUCT_STEP_NAMES})
    monkeypatch.setattr(sys.stdout, "reconfigure", lambda **_: None, raising=False)
    code = check_all.main()
    return code, calls, capsys.readouterr().out


def test_crashed_product_step_is_retried_once_and_named(monkeypatch, capsys):
    code, calls, out = run_main(monkeypatch, capsys, {check_all.APP_UNIT: [(1, WORKER_CRASH), (0, "")]})
    assert code == 0 and calls[check_all.APP_UNIT] == 2
    assert "Повтор после падения процесса" in out and check_all.APP_UNIT + ": рабочий процесс" in out
    assert out.count("  ок ") == len(check_all.STEP_NAMES + check_all.PRODUCT_STEP_NAMES)


def test_second_crash_is_an_error_and_there_is_no_third_run(monkeypatch, capsys):
    code, calls, out = run_main(monkeypatch, capsys, {check_all.APP_UNIT: [(1, WORKER_CRASH)]})
    assert code == 1 and calls[check_all.APP_UNIT] == 2
    assert "Не прошло: " + check_all.APP_UNIT in out
    assert "повтор тоже упал: рабочий процесс тестов вышел с кодом 3221225477" in out


def test_failed_check_and_ci_step_are_not_retried(monkeypatch, capsys):
    code, calls, out = run_main(
        monkeypatch, capsys, {check_all.APP_UNIT: [(1, REAL_FAILURES)], check_all.TESTS: [(3221225477, "")]}
    )
    assert code == 1 and calls[check_all.APP_UNIT] == 1 and calls[check_all.TESTS] == 1
    assert "Повтор после падения процесса" not in out
