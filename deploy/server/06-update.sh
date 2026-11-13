#!/usr/bin/env bash
# Обновление кабинета на сервере без потери заявок: пакет 2.5. Запускает участник А под deploy.
#
# Что делает: копия базы -> свежие коммиты ветки -> сборка образа -> миграции -> docker compose up -d -> проверки.
# Чего НЕ делает: не запускает db/seed.ts. Вымышленные данные стирают заявки основного набора, поэтому
# 04-first-run.sh повторно на сервере не запускается, а обновление идёт этим скриптом.
#
# Аргумент — ветка: bash -s -- main. Без аргумента берётся ветка, на которой уже стоит копия на сервере.
# Пока идёт сборка, работает прежнее приложение. Перерыв — только на перезапуск контейнера приложения.
# Значения окружения не печатаются (ADR-0004). Имя сайта и адрес сервера в выводе заменяются словами SITE и ADDR.
# Вывод — латиницей: консоль Windows портит кириллицу. Повторный запуск безопасен.
# Отметки в конце: UPDATE-OK — всё прошло; UPDATE-STOP <шаг> — остановка с причиной; UPDATE-FAIL — ошибка в строке.
set -euo pipefail

main() {
  trap 'echo "UPDATE-FAIL line $LINENO"' ERR
  local dir="$HOME/dekanat" log="$HOME/dekanat-build.log"
  cd "$dir"

  local dk="docker"
  docker info >/dev/null 2>&1 || dk="sudo docker"

  # Имя сайта — не секрет, но в нём адрес сервера: читается из .env и на экран не выводится.
  local site first ip
  site="$(grep '^SITE_ADDRESS=' .env | cut -d= -f2-)"
  first="${site%%[, ]*}"
  ip="$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") {print $(i + 1); exit}}')"
  ip="${ip:-0.0.0.0}"
  mask() { sed -e "s/${first//./\\.}/SITE/g" -e "s/${ip//./\\.}/ADDR/g" -e "s/${ip//./-}/ADDR/g"; }
  # Журналы миграций и сборки: только латиница, без строк подключения.
  clean() { LC_ALL=C tr -cd '\11\12\40-\176' | sed -E 's#(postgres(ql)?://)[^@ ]*@#\1***@#g' | cut -c1-220 | mask; }
  sql() { $dk compose exec -T db psql -U dekanat_owner -d dekanat -At -F ' ' -c "$1" </dev/null; }
  # Счётчики строк: по ним видно, что обновление не тронуло данные.
  counts() { sql "select 'users=' || (select count(*) from users) || ' requests=' || (select count(*) from requests) || ' sessions=' || (select count(*) from sessions)"; }

  echo "== before"
  local branch="${1:-$(git rev-parse --abbrev-ref HEAD)}" old new
  old="$(git rev-parse HEAD)"
  echo "branch now: $(git rev-parse --abbrev-ref HEAD), commit: $(git log -1 --format='%h %ci'), target branch: $branch"
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "tree: changed files on the server:"
    git status --porcelain | cut -c1-120 | clean
    echo "UPDATE-STOP dirty-tree"
    exit 1
  fi
  local health
  health="$($dk inspect --format '{{.State.Health.Status}}' "$($dk compose ps -q db)" 2>/dev/null || true)"
  echo "db: ${health:-not running}"
  if [[ "$health" != healthy ]]; then
    echo "UPDATE-STOP db-not-healthy"
    exit 1
  fi
  local before
  before="$(counts)"
  echo "rows before: $before"

  echo "== backup"
  # Имя не начинается с «dekanat-»: суточная задача из 05-backup-check.sh такие файлы не считает и не удаляет.
  mkdir -p "$HOME/backups"
  chmod 700 "$HOME/backups"
  local dump="$HOME/backups/pre-update-$(date +%F-%H%M%S).sql.gz"
  if ! (umask 077; $dk compose exec -T db pg_dump -U dekanat_owner -d dekanat </dev/null | gzip >"$dump.tmp"); then
    rm -f "$dump.tmp"
    echo "UPDATE-STOP backup"
    exit 1
  fi
  mv "$dump.tmp" "$dump"
  local tables
  tables="$(gzip -dc "$dump" | grep -c '^COPY ' || true)"
  echo "backup: $(basename "$dump"), bytes: $(stat -c %s "$dump"), tables with data: $tables"
  if [[ "$tables" -lt 1 ]]; then
    echo "UPDATE-STOP backup-empty"
    exit 1
  fi
  ls -1t "$HOME"/backups/pre-update-*.sql.gz | tail -n +6 | xargs -r rm -f

  echo "== repo"
  # Обычные права на файлы копии: образ собирается от root, а работает от node (ошибка 66 смены 16).
  umask 022
  # У ключа репозитория на сервере пароля нет, вопросов задавать некому: BatchMode здесь уместен, как в 02-repo.sh.
  export GIT_SSH_COMMAND='ssh -o BatchMode=yes'
  if ! git fetch -q origin </dev/null 2>/tmp/dekanat-fetch.err; then
    echo "fetch: FAILED ($(head -n 1 /tmp/dekanat-fetch.err | clean))"
    rm -f /tmp/dekanat-fetch.err
    echo "UPDATE-STOP fetch"
    exit 1
  fi
  rm -f /tmp/dekanat-fetch.err
  if ! git rev-parse -q --verify "refs/remotes/origin/$branch" >/dev/null; then
    echo "UPDATE-STOP no-branch $branch"
    exit 1
  fi
  git checkout -q "$branch"
  if ! git merge -q --ff-only "origin/$branch" 2>/dev/null; then
    echo "UPDATE-STOP not-fast-forward"
    exit 1
  fi
  chmod +x app/db/docker-init/10-app-role.sh
  chmod 600 .env
  new="$(git rev-parse HEAD)"
  echo "commit: $(git rev-parse --short "$old") -> $(git log -1 --format='%h %ci'), commits taken: $(git rev-list --count "$old..$new")"
  local changed proxy_changed=no
  changed="$(git diff --name-only "$old" "$new")"
  echo "changed files: total $(printf '%s' "$changed" | grep -c . || true), app $(printf '%s\n' "$changed" | grep -c '^app/' || true), migrations $(printf '%s\n' "$changed" | grep -c '^app/db/migrations/' || true), compose and proxy $(printf '%s\n' "$changed" | grep -cE '^(compose.*\.yaml|deploy/Caddyfile|app/Dockerfile|\.dockerignore)$' || true)"
  printf '%s\n' "$changed" | grep -q '^deploy/Caddyfile$' && proxy_changed=yes
  echo "tree: $(git status --porcelain | wc -l) changed files"
  $dk compose config -q

  echo "== build"
  local t0=$SECONDS pid
  $dk compose build --progress=plain >"$log" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    sleep 20
    echo "build: $(grep -cE '^#[0-9]+ DONE' "$log" || true) steps done, $((SECONDS - t0))s"
  done
  if wait "$pid"; then
    echo "build: ok, $((SECONDS - t0))s"
  else
    echo "build: FAILED, last lines:"
    tail -n 40 "$log" | clean
    echo "old app keeps running; nothing was changed in the database"
    echo "UPDATE-STOP build"
    exit 1
  fi

  echo "== migrate, no seed"
  if $dk compose run --rm -T migrate </dev/null >"$HOME/dekanat-migrate.log" 2>&1; then
    echo "migrate: ok"
  else
    echo "migrate: FAILED"
    tail -n 25 "$HOME/dekanat-migrate.log" | clean
    echo "old app keeps running; backup: $(basename "$dump")"
    echo "UPDATE-STOP migrate"
    exit 1
  fi

  echo "== up"
  if ! $dk compose up -d >"$HOME/dekanat-up.log" 2>&1; then
    echo "up: FAILED"
    tail -n 15 "$HOME/dekanat-up.log" | clean
    $dk compose logs --no-color --tail 25 app 2>&1 | clean
    echo "UPDATE-STOP up"
    exit 1
  fi
  # Caddyfile подключён в контейнер одним файлом: после git в контейнере остаётся прежний. Новый берётся пересозданием.
  if [[ "$proxy_changed" == yes ]]; then
    $dk compose up -d --force-recreate proxy >>"$HOME/dekanat-up.log" 2>&1
    echo "proxy: recreated, Caddyfile changed"
  fi
  local i app_health=""
  for i in $(seq 1 40); do
    app_health="$($dk inspect --format '{{.State.Health.Status}}' "$($dk compose ps -q app)" 2>/dev/null || true)"
    [[ "$app_health" == healthy ]] && break
    sleep 3
  done
  echo "app: $app_health"
  $dk compose ps -a --format 'table {{.Service}}\t{{.State}}\t{{.Status}}\t{{.Ports}}' | mask || true
  if [[ "$app_health" != healthy ]]; then
    $dk compose logs --no-color --tail 25 app 2>&1 | clean
    echo "UPDATE-STOP app-not-healthy"
    exit 1
  fi

  echo "== checks inside"
  echo "app user: $($dk compose exec -T app id -un </dev/null)"
  $dk compose exec -T app sh -c 'touch .next/cache/.probe && rm .next/cache/.probe && echo "cache write: ok"' </dev/null \
    || echo "cache write: FAIL"
  echo "tests dir in image: $($dk compose exec -T app sh -c 'ls -d tests 2>/dev/null || echo absent' </dev/null)"
  echo "env file in image: $($dk compose exec -T app sh -c 'ls -a | grep -c "^\.env" || true' </dev/null)"
  echo "app container started: $($dk inspect --format '{{.State.StartedAt}}' "$($dk compose ps -q app)" | cut -c1-19)"
  echo "db container started: $($dk inspect --format '{{.State.StartedAt}}' "$($dk compose ps -q db)" | cut -c1-19)"

  echo "== data kept"
  local after
  after="$(counts)"
  echo "rows before: $before"
  echo "rows after:  $after"
  # Сессий может стать больше или меньше: люди входят и выходят. Пользователи и заявки исчезать не должны.
  if [[ "${after% sessions=*}" == "${before% sessions=*}" ]]; then
    echo "users and requests: same"
  else
    echo "users and requests: DIFFER - compare by hand; backup: $(basename "$dump")"
  fi

  echo "== label of request kind 16 in the running image (R-3.4-7)"
  # Ожидается одна подпись — «Вызов в вуз». Сами подписи на экран не идут: только счётчики.
  # Поиск идёт по байтам: после слов «Вызов в » берутся пробелы и все не-латинские байты, то есть подпись до кавычки.
  # В сборку попадает и комментарий из requests.ts, где подпись стоит в кавычках-ёлочках: такой вариант начинается
  # с тех же слов и считается новым. Первый запуск 13.11 считал его отдельной подписью и показал «2» — ошибка ИИ 70.
  local label='Вызов в вуз' src_ok list expected other
  src_ok="$($dk compose exec -T app sh -c "grep \"key: 'summons'\" src/lib/requests.ts | grep -c \"label: '$label'\" || true" </dev/null || true)"
  list="$($dk compose exec -T app sh -c "LC_ALL=C grep -rhoaE 'Вызов в ( |[^ -~])*' .next/server 2>/dev/null | sed 's/ *\$//' | sort -u" </dev/null || true)"
  expected="$(printf '%s\n' "$list" | grep -cF "$label" || true)"
  other="$(printf '%s\n' "$list" | grep . | grep -cvF "$label" || true)"
  echo "source line with the new label: ${src_ok:-?} (need 1)"
  echo "build: texts with the new label: $expected (need 1 or more; 0 = text is encoded, check in the browser), other labels of this kind: $other (need 0)"

  echo "== listening ports on the host"
  sudo ss -tlnH | awk '{print $4}' | sort -u | mask | tr '\n' ' '
  echo

  echo "== http and https"
  echo "http -> $(curl -s -o /dev/null -m 10 -w '%{http_code} %{redirect_url}' -H "Host: $first" http://127.0.0.1/ </dev/null | mask || true)"
  local code=000
  for i in $(seq 1 36); do
    code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' --resolve "$first:443:127.0.0.1" "https://$first/login" </dev/null || true)"
    [[ "$code" == 200 ]] && break
    sleep 5
  done
  echo "https /login: $code"
  if [[ "$code" != 200 ]]; then
    echo "proxy log, filtered:"
    $dk compose logs --no-color --tail 300 proxy 2>&1 | grep -iE 'error|obtain|challenge|rate|certificate' | tail -n 12 | cut -c1-420 | mask || true
    echo "UPDATE-STOP https"
    exit 1
  fi
  echo | openssl s_client -connect 127.0.0.1:443 -servername "$first" 2>/dev/null | openssl x509 -noout -issuer -enddate | mask
  echo "response headers:"
  curl -s -o /dev/null -D - -m 10 --resolve "$first:443:127.0.0.1" "https://$first/login" </dev/null \
    | grep -iE '^(HTTP|strict-transport|server|x-powered-by|x-content-type|referrer-policy|x-frame|content-security-policy|cache-control)' \
    | cut -c1-110 | mask
  echo "https /login via public name: $(curl -4 -s -o /dev/null -m 15 -w '%{http_code} in %{time_total}s' "https://$first/login" </dev/null || true)"
  echo "app log lines with 'error' since start: $($dk compose logs --no-color app 2>&1 | grep -ci 'error' || true)"

  echo "== resources"
  # Прежний образ после сборки остаётся без имени и занимает диск: такие образы удаляются. Тома и данные не трогаются.
  $dk image prune -f >/dev/null 2>&1 || true
  free -m | awk '/^Mem:/ {print "mem_mb used: " $3 ", available: " $7}'
  df -h / | awk 'NR==2 {print "disk free: " $4}'
  echo "pre-update backups kept: $(ls -1 "$HOME"/backups/pre-update-*.sql.gz | wc -l)"
  echo "UPDATE-OK $(git rev-parse --abbrev-ref HEAD) $(git rev-parse --short HEAD)"
}

main "$@"
