#!/usr/bin/env bash
# Подготовка рабочего места (macOS / Linux). Запуск из корня репозитория:  bash tools/bootstrap.sh
# Скрипт можно запускать повторно: уже сделанное он пропускает.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DONE=()

fail() {
  echo "" >&2
  echo "ОШИБКА: $1" >&2
  exit 1
}
warn() { echo "ВНИМАНИЕ: $1" >&2; }

echo "Репозиторий: $ROOT"

# 0. Что должно быть до запуска: git, gh, uv.
for tool in git gh uv; do
  command -v "$tool" >/dev/null 2>&1 \
    || fail "не найден $tool. Установите: brew install $tool - затем откройте новый терминал и запустите скрипт снова."
done
command -v node >/dev/null 2>&1 || warn "не найден Node.js. Он нужен с этапа 2: brew install node"

# 1. Папка под облачной синхронизацией ломает .git; чужой CLAUDE.md выше по дереву меняет правила сессий.
case "$ROOT" in
  *OneDrive*|*iCloud*|*"Mobile Documents"*) warn "репозиторий лежит в синхронизируемой папке. Перенесите его, например в домашнюю папку." ;;
esac
d="$(dirname "$ROOT")"
while [ "$d" != "/" ]; do
  [ -f "$d/CLAUDE.md" ] && warn "найден $d/CLAUDE.md - его правила попадут в сессии проекта. Перенесите репозиторий или уберите файл."
  d="$(dirname "$d")"
done

# 2. Вход в GitHub.
gh auth status >/dev/null 2>&1 || fail "нет входа в GitHub. Выполните: gh auth login - затем запустите скрипт снова."
DONE+=("вход в GitHub проверен")

# 3. Адрес для коммитов: служебный адрес GitHub, чтобы личная почта не попала в историю.
GIT_EMAIL="$(git -C "$ROOT" config user.email || true)"
case "$GIT_EMAIL" in
  *@users.noreply.github.com) DONE+=("адрес коммитов служебный") ;;
  *) warn "адрес для коммитов не задан или не служебный ('$GIT_EMAIL'). Задайте его по docs/ONBOARDING.md, раздел 1." ;;
esac

# 4. gitleaks нужен хуку pre-commit как системная программа.
if command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks уже есть"
else
  command -v brew >/dev/null 2>&1 \
    || fail "не найден brew, поэтому gitleaks не поставить. Установите Homebrew: https://brew.sh - или скачайте gitleaks: https://github.com/gitleaks/gitleaks/releases"
  brew install gitleaks || fail "не удалось: brew install gitleaks"
  DONE+=("установлен gitleaks")
fi

# 5. pre-commit через uv. Python для него uv берёт сам.
uv tool install pre-commit || fail "не удалось поставить pre-commit. Проверьте сеть и повторите запуск."
uv tool update-shell || warn "uv tool update-shell не сработал. Добавьте папку из «uv tool dir --bin» в PATH вручную."
BIN="$(uv tool dir --bin)" || fail "не удалось узнать папку программ uv (uv tool dir --bin)."
PRECOMMIT="$BIN/pre-commit"
[ -x "$PRECOMMIT" ] || fail "не найден $PRECOMMIT после установки pre-commit."
cd "$ROOT"
"$PRECOMMIT" install || fail "pre-commit install не удался. Запустите вручную: $PRECOMMIT install"
DONE+=("хуки pre-commit установлены")

# 6. Файл .env из образца. Значения секретов передаёт владелец зоны А (docs/ONBOARDING.md, раздел 5).
if [ -f .env.example ] && [ ! -f .env ]; then
  cp .env.example .env
  DONE+=("создан .env из образца - заполните значения")
fi

# 7. Зависимости продукта (с этапа 2).
if [ -f app/package.json ]; then
  command -v npm >/dev/null 2>&1 || fail "не найден npm, а продукт уже есть. Установите Node.js и запустите скрипт снова."
  (cd app && npm ci) || fail "npm ci в app/ не удался. Проверьте сеть и повторите запуск."
  DONE+=("зависимости продукта установлены")
fi

# 8. Учёт читается.
uv run tools/tracker.py due || fail "tracker.py due не сработал."

echo ""
echo "Готово. Сделано:"
for item in "${DONE[@]}"; do echo "  - $item"; done
echo ""
echo "Закройте терминал и откройте новый: иначе gitleaks и pre-commit не найдутся в PATH."
echo "Затем:  cd \"$ROOT\" && claude    и первой командой наберите /start"
