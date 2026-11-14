#!/usr/bin/env bash
# Остаток пакета 2.5 после пакета 3.8: вымышленные данные на сервере остаются свежими (риск РС-25).
# Запускает участник А под deploy после 06-update.sh main, когда пакет 3.8 уже в main.
#  - ставит ~/bin/dekanat-refresh.sh и /etc/cron.d/dekanat-refresh: режим «освежить» дважды за ночь, в 00:07 и 04:07 по Москве;
#  - с аргументом seed-once сначала ОДИН раз заполняет базу новым набором: db/seed.ts стирает заявки основного набора.
#    Это разрешил пользователь 14.11.2026, один раз. Без аргумента заявки не трогаются;
#  - запускает «освежить» сразу и проверяет: дата отсчёта в выводе — сегодняшняя по Москве, пары есть на сегодня и вперёд.
# Команда в контейнере — та же, какой 04-first-run.sh запускает db/seed.ts: сервис migrate, прямой вызов tsx.
# Резервные наборы таймер не освежает, пока у сервиса migrate нет переменных RESERVE_* (R-3.8-20).
# Адреса и значения окружения не печатаются. Вывод — латиницей. Повторный запуск без аргумента безопасен.
set -euo pipefail

main() {
  trap 'echo "STEP10-FAIL line $LINENO"' ERR
  local mode="${1:-}"
  if [ -n "$mode" ] && [ "$mode" != "seed-once" ]; then
    echo "STEP10-STOP unknown argument: only 'seed-once' or nothing"
    exit 1
  fi
  local dir="$HOME/dekanat"
  cd "$dir"
  local dk="docker"
  docker info >/dev/null 2>&1 || dk="sudo docker"
  sql() { $dk compose exec -T db psql -U dekanat_owner -d dekanat -At -F ' ' -c "$1" </dev/null; }
  clean() { LC_ALL=C tr -cd '\11\12\40-\176' | cut -c1-220; }
  # Москва — постоянное смещение +3: запись пояса числом работает и там, где нет базы поясов.
  local msk='<+03>-3' msk_today
  msk_today="$(TZ="$msk" date +%F)"
  local tsx="node ./node_modules/tsx/dist/cli.mjs"

  echo "== before"
  echo "lessons (count, first, last): $(sql "select count(*), min(lesson_date), max(lesson_date) from lessons")"
  echo "requests: $(sql "select count(*) from requests"), groups: $(sql "select count(*) from groups"), moscow today: $msk_today"
  if ! $dk compose run --rm -T migrate sh -c 'test -f db/seed-refresh.ts' </dev/null >/dev/null 2>&1; then
    echo "STEP10-STOP no db/seed-refresh.ts in the image: run 06-update.sh main first"
    exit 1
  fi

  if [ "$mode" = "seed-once" ]; then
    echo "== seed once: new data set, requests of the main set are wiped"
    if $dk compose run --rm -T migrate $tsx db/seed.ts </dev/null >"$HOME/dekanat-seed.log" 2>&1; then
      echo "seed: ok"
    else
      echo "seed: FAILED"
      tail -n 25 "$HOME/dekanat-seed.log" | clean
      echo "STEP10-STOP seed"
      exit 1
    fi
  fi

  echo "== timer"
  mkdir -p "$HOME/bin" "$HOME/logs"
  cat >"$HOME/bin/dekanat-refresh.sh" <<'EOF'
#!/usr/bin/env bash
# Режим «освежить»: сдвигает даты вымышленного набора на сегодня, заявки посетителей не трогает. Ставится скриптом 07-refresh.sh.
# Строка журнала: время сервера, код возврата, дата отсчёта из вывода команды. При ошибке — хвост вывода.
set -uo pipefail
cd "$HOME/dekanat"
log="$HOME/logs/dekanat-refresh.log"
out="$(docker compose run --rm -T migrate node ./node_modules/tsx/dist/cli.mjs db/seed-refresh.ts </dev/null 2>&1)"
code=$?
plan="$(printf '%s\n' "$out" | grep -aoE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -n 1 || true)"
printf '%s code=%s plan=%s\n' "$(date '+%F %T %Z')" "$code" "${plan:-none}" >>"$log"
if [ "$code" -ne 0 ]; then printf '%s\n' "$out" | tail -n 8 | cut -c1-300 >>"$log"; fi
tail -n 400 "$log" >"$log.tmp" && mv "$log.tmp" "$log"
exit "$code"
EOF
  chmod 700 "$HOME/bin/dekanat-refresh.sh"
  # 00:07 и 04:07 по Москве, пересчитанные в часы сервера. Задача идёт от deploy: он в группе docker.
  local t1 t2
  t1="$(date -d "TZ=\"$msk\" 00:07" '+%-M %-H')"
  t2="$(date -d "TZ=\"$msk\" 04:07" '+%-M %-H')"
  printf 'SHELL=/bin/bash\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n%s * * * %s %s >/dev/null 2>&1\n%s * * * %s %s >/dev/null 2>&1\n' \
    "$t1" "$USER" "$HOME/bin/dekanat-refresh.sh" "$t2" "$USER" "$HOME/bin/dekanat-refresh.sh" | sudo tee /etc/cron.d/dekanat-refresh >/dev/null
  sudo chmod 644 /etc/cron.d/dekanat-refresh
  echo "cron: $(systemctl is-active cron), job lines: $(grep -c 'dekanat-refresh.sh' /etc/cron.d/dekanat-refresh), runs at server time (min hour): $t1 and $t2, server time now: $(date '+%H:%M %Z')"

  echo "== refresh now"
  local ran="no"
  if sg docker -c "$HOME/bin/dekanat-refresh.sh" 2>/dev/null || sudo -u "$USER" -g docker "$HOME/bin/dekanat-refresh.sh"; then ran="yes"; fi
  local last plan
  last="$(tail -n 1 "$HOME/logs/dekanat-refresh.log" 2>/dev/null || true)"
  plan="$(printf '%s' "$last" | sed -n 's/.* plan=\([0-9-]*\).*/\1/p')"
  if [ "$ran" = "yes" ] && [ "$plan" = "$msk_today" ]; then
    echo "refresh now: ok, plan date $plan = moscow today"
  else
    echo "refresh now: FAILED (ran: $ran, plan date: ${plan:-none}, moscow today: $msk_today)"
    tail -n 9 "$HOME/logs/dekanat-refresh.log" | clean
    echo "STEP10-STOP refresh"
    exit 1
  fi

  echo "== after"
  echo "lessons (count, first, last): $(sql "select count(*), min(lesson_date), max(lesson_date) from lessons")"
  echo "lessons today and later: $(sql "select count(*) from lessons where lesson_date >= '$msk_today'"), lessons today: $(sql "select count(*) from lessons where lesson_date = '$msk_today'")"
  echo "requests: $(sql "select count(*) from requests"), groups: $(sql "select count(*) from groups"), users: $(sql "select count(*) from users")"
  echo "refresh log lines: $(wc -l <"$HOME/logs/dekanat-refresh.log")"
  echo "STEP10-OK"
}

main "$@"
