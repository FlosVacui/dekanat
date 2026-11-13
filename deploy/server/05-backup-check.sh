#!/usr/bin/env bash
# Шаг 9 пакета 2.5: копия базы раз в сутки и проверка после первого входа руками. Запускает участник А под deploy.
#  - ставит ежедневный pg_dump: ~/bin/dekanat-backup.sh и /etc/cron.d/dekanat-backup, копии — в ~/backups, хранится 7 штук;
#  - делает одну копию сразу и показывает её размер;
#  - проверяет, какой адрес посетителя записало приложение: настоящий внешний или внутренний адрес Docker (ADR-0003, В-04);
#  - показывает состояние контейнеров и число ошибок в журнале приложения.
# Адреса и значения окружения не печатаются: только вид адреса и счётчики. Вывод — латиницей.
# Повторный запуск безопасен.
set -euo pipefail

main() {
  trap 'echo "STEP9-FAIL line $LINENO"' ERR
  local dir="$HOME/dekanat"
  cd "$dir"
  local dk="docker"
  docker info >/dev/null 2>&1 || dk="sudo docker"

  local site first ip
  site="$(grep '^SITE_ADDRESS=' .env | cut -d= -f2-)"
  first="${site%%[, ]*}"
  ip="$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") {print $(i + 1); exit}}')"
  ip="${ip:-0.0.0.0}"
  mask() { sed -e "s/${first//./\\.}/SITE/g" -e "s/${ip//./\\.}/ADDR/g" -e "s/${ip//./-}/ADDR/g"; }
  sql() { $dk compose exec -T db psql -U dekanat_owner -d dekanat -At -F ' ' -c "$1" </dev/null; }

  echo "== backup"
  mkdir -p "$HOME/bin" "$HOME/backups"
  chmod 700 "$HOME/backups"
  cat >"$HOME/bin/dekanat-backup.sh" <<'EOF'
#!/usr/bin/env bash
# Копия базы кабинета: pg_dump внутри контейнера базы, файл — на диске сервера. Ставится скриптом 05-backup-check.sh.
set -euo pipefail
umask 077
cd "$HOME/dekanat"
out="$HOME/backups/dekanat-$(date +%F).sql.gz"
docker compose exec -T db pg_dump -U dekanat_owner -d dekanat </dev/null | gzip >"$out.tmp"
mv "$out.tmp" "$out"
ls -1t "$HOME"/backups/dekanat-*.sql.gz | tail -n +8 | xargs -r rm -f
EOF
  chmod 700 "$HOME/bin/dekanat-backup.sh"
  # 03:17 по часам сервера. Задача идёт от deploy: он в группе docker.
  printf 'SHELL=/bin/bash\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n17 3 * * * %s %s >>%s 2>&1\n' \
    "$USER" "$HOME/bin/dekanat-backup.sh" "$HOME/backups/backup.log" | sudo tee /etc/cron.d/dekanat-backup >/dev/null
  sudo chmod 644 /etc/cron.d/dekanat-backup
  echo "cron: $(systemctl is-active cron), job lines: $(grep -c dekanat-backup /etc/cron.d/dekanat-backup), server time: $(date '+%H:%M %Z')"
  if sg docker -c "$HOME/bin/dekanat-backup.sh" 2>/dev/null || sudo -u "$USER" -g docker "$HOME/bin/dekanat-backup.sh"; then
    local f
    f="$(ls -1t "$HOME"/backups/dekanat-*.sql.gz | head -n 1)"
    echo "backup now: ok, bytes: $(stat -c %s "$f"), tables with data: $(gzip -dc "$f" | grep -c '^COPY ' || true), copies kept: $(ls -1 "$HOME"/backups/dekanat-*.sql.gz | wc -l)"
  else
    echo "backup now: FAILED"
  fi

  echo "== state"
  $dk compose ps -a --format 'table {{.Service}}\t{{.State}}\t{{.Status}}' | mask || true
  echo "restart policy: $($dk inspect --format '{{.Name}}={{.HostConfig.RestartPolicy.Name}}' $($dk compose ps -q) | tr '\n' ' ')"
  echo "docker on boot: $(systemctl is-enabled docker)"

  echo "== visitor address as the app saw it (kind and count, no addresses)"
  local kind="case when ip = 'unknown' then 'unknown' when ip = '$ip' then 'server-own' \
when ip ~ '^(10\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|192\\.168\\.|127\\.)' then 'private-docker' \
when ip ~ '^[0-9]+(\\.[0-9]+){3}\$' then 'public-ipv4' else 'other' end"
  echo "sessions: $(sql "select coalesce(string_agg(k || '=' || n, ', '), 'none') from (select $kind as k, count(*) as n from sessions group by 1) t")"
  echo "login attempts: $(sql "select coalesce(string_agg(k || '=' || n, ', '), 'none') from (select $kind as k, count(*) as n from login_attempts group by 1) t")"
  echo "distinct visitor addresses in sessions: $(sql "select count(distinct ip) from sessions")"
  echo "users: $(sql "select count(*) from users"), requests: $(sql "select count(*) from requests")"

  echo "== site from outside path"
  echo "https /login via public name: $(curl -4 -s -o /dev/null -m 15 -w '%{http_code} in %{time_total}s' "https://$first/login" </dev/null || true)"
  echo "app log lines with 'error', last hour: $($dk compose logs --no-color --since 1h app 2>&1 | grep -ci 'error' || true)"
  echo "proxy log lines with level error, last hour: $($dk compose logs --no-color --since 1h proxy 2>&1 | grep -c '"level":"error"' || true)"
  echo "STEP9-OK"
}

main "$@"
