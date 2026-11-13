#!/usr/bin/env bash
# Шаг 6 пакета 2.5: файл .env на сервере и права на файлы копии. Запускает участник А под deploy.
# Значения паролей создаются на сервере и никуда не печатаются (ADR-0004): на экран идут только имена переменных.
# Адрес сервера на экран не печатается. Вывод — латиницей: консоль Windows портит кириллицу.
#
# Без аргумента: создаёт .env, если его нет; имя сайта — временное, вида «адрес-через-дефисы.nip.io».
# С аргументом: меняет в готовом .env только имя сайта, например: bash -s -- "moy-dekanat.ru, www.moy-dekanat.ru".
# Пароли базы повторный запуск не меняет: они уже записаны в том базы при первом запуске.
set -euo pipefail

main() {
  trap 'echo "STEP6-FAIL line $LINENO"' ERR
  local dir="$HOME/dekanat" new_site="${1:-}"
  cd "$dir"

  # Копия была взята с umask 077: файлы вышли 600. Образ собирается от root, а работает от node; скрипт роли базы
  # читает пользователь postgres. Поэтому файлы открываются на чтение, а сама папка остаётся закрытой: 700.
  chmod -R go+rX "$dir"
  chmod 700 "$dir"
  # Скрипт роли базы должен быть исполняемым: тогда образ PostgreSQL запускает его отдельным процессом.
  chmod +x app/db/docker-init/10-app-role.sh
  git config core.fileMode false

  if [[ -f .env ]]; then
    echo "env: exists, passwords kept"
  else
    local ip suffix site="" resolved
    ip="$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") {print $(i + 1); exit}}')"
    case "$ip" in
      "" | 10.* | 192.168.* | 172.1[6-9].* | 172.2[0-9].* | 172.3[01].* | 100.*)
        ip="$(curl -4 -s -m 10 https://api.ipify.org </dev/null || true)" ;;
    esac
    if [[ ! "$ip" =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
      echo "STEP6-STOP no-public-address"
      exit 1
    fi
    for suffix in nip.io sslip.io; do
      resolved="$(getent ahostsv4 "${ip//./-}.$suffix" | awk 'NR == 1 {print $1}' || true)"
      if [[ "$resolved" == "$ip" ]]; then
        site="${ip//./-}.$suffix"
        echo "temporary name: <server address with dashes>.$suffix - resolves to this server"
        break
      fi
      echo "temporary name: .$suffix does not resolve"
    done
    if [[ -z "$site" ]]; then
      echo "STEP6-STOP no-temporary-name"
      exit 1
    fi
    (
      umask 077
      {
        printf 'POSTGRES_OWNER_PASSWORD=%s\n' "$(openssl rand -hex 24)"
        printf 'POSTGRES_APP_PASSWORD=%s\n' "$(openssl rand -hex 24)"
        printf 'CLIENT_IP_HEADER=x-real-ip\n'
        printf 'SITE_ADDRESS=%s\n' "$site"
        printf 'COMPOSE_FILE=compose.yaml:compose.proxy.yaml\n'
        printf 'APP_TIMEZONE=Europe/Moscow\n'
      } >.env
    )
    echo "env: created"
  fi

  if [[ -n "$new_site" ]]; then
    sed -i "s|^SITE_ADDRESS=.*|SITE_ADDRESS=$new_site|" .env
    echo "env: site name replaced"
  fi

  chmod 600 .env
  echo "env keys: $(cut -d= -f1 .env | tr '\n' ' ')"
  echo "env mode: $(stat -c '%a %U' .env)"
  echo "env password lengths: $(awk -F= '/PASSWORD/ {printf "%d ", length($2)}' .env)"
  git check-ignore -q .env && echo "env ignored by git: yes" || echo "env ignored by git: NO"
  echo "tree: $(git status --porcelain | wc -l) changed files"
  echo "init script mode: $(stat -c '%a' app/db/docker-init/10-app-role.sh), Dockerfile mode: $(stat -c '%a' app/Dockerfile)"

  # Проверка файлов Compose без печати значений: -q только проверяет, --services печатает одни имена сервисов.
  local dk="docker"
  docker info >/dev/null 2>&1 || dk="sudo docker"
  $dk compose config -q
  echo "compose services: $($dk compose config --services | sort | tr '\n' ' ')"
  echo "STEP6-OK"
}

main "$@"
