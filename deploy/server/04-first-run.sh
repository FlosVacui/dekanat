#!/usr/bin/env bash
# Шаги 7 и 8 пакета 2.5: сборка образа, база, миграции, вымышленные данные, приложение и прокси, проверка HTTPS.
# Запускает участник А под deploy после 03-env.sh. Порядок — из шапки compose.yaml.
# Значения окружения не печатаются (ADR-0004). Имя сайта и адрес сервера в выводе заменяются словами SITE и ADDR.
# Вывод — латиницей: консоль Windows портит кириллицу. Повторный запуск безопасен: миграции и данные идемпотентны.
# Заодно закрывает пункты IMP-016: сборка без папки tests, запись в .next/cache, проверка состояния приложения.
set -euo pipefail

main() {
  trap 'echo "STEP7-FAIL line $LINENO"' ERR
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
    tail -n 40 "$log" | cut -c1-220 | mask
    echo "STEP7-STOP build"
    exit 1
  fi

  echo "== db"
  $dk compose up -d db >/dev/null 2>&1
  local i health=""
  for i in $(seq 1 40); do
    health="$($dk inspect --format '{{.State.Health.Status}}' "$($dk compose ps -q db)" 2>/dev/null || true)"
    [[ "$health" == healthy ]] && break
    sleep 3
  done
  echo "db: $health"
  if [[ "$health" != healthy ]]; then
    $dk compose logs --no-color --tail 30 db 2>&1 | grep -vi password | cut -c1-220 || true
    echo "STEP7-STOP db"
    exit 1
  fi
  echo "db role dekanat_app (superuser|createdb|createrole): $($dk compose exec -T db psql -U dekanat_owner -d dekanat -Atc \
    "select rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = 'dekanat_app'" </dev/null)"

  echo "== migrate and seed"
  if $dk compose run --rm -T migrate </dev/null >"$HOME/dekanat-migrate.log" 2>&1; then
    echo "migrate: ok"
  else
    echo "migrate: FAILED"
    tail -n 25 "$HOME/dekanat-migrate.log" | LC_ALL=C tr -cd '\11\12\40-\176' | cut -c1-220
    echo "STEP7-STOP migrate"
    exit 1
  fi
  if $dk compose run --rm -T migrate node ./node_modules/tsx/dist/cli.mjs db/seed.ts </dev/null >"$HOME/dekanat-seed.log" 2>&1; then
    echo "seed: ok"
  else
    echo "seed: FAILED"
    tail -n 25 "$HOME/dekanat-seed.log" | LC_ALL=C tr -cd '\11\12\40-\176' | cut -c1-220
    echo "STEP7-STOP seed"
    exit 1
  fi

  echo "== up"
  if ! $dk compose up -d >"$HOME/dekanat-up.log" 2>&1; then
    echo "up: FAILED"
    tail -n 15 "$HOME/dekanat-up.log" | cut -c1-220 | mask
    $dk compose logs --no-color --tail 25 app 2>&1 | LC_ALL=C tr -cd '\11\12\40-\176' | cut -c1-220 | mask
    echo "STEP7-STOP up"
    exit 1
  fi
  $dk compose ps -a --format 'table {{.Service}}\t{{.State}}\t{{.Status}}\t{{.Ports}}' | mask || true

  echo "== checks inside"
  echo "app user: $($dk compose exec -T app id -un </dev/null)"
  $dk compose exec -T app sh -c 'touch .next/cache/.probe && rm .next/cache/.probe && echo "cache write: ok"' </dev/null \
    || echo "cache write: FAIL"
  echo "tests dir in image: $($dk compose exec -T app sh -c 'ls -d tests 2>/dev/null || echo absent' </dev/null)"
  echo "env file in image: $($dk compose exec -T app sh -c 'ls -a | grep -c "^\.env" || true' </dev/null)"

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
    echo "STEP7-STOP https"
    exit 1
  fi
  echo | openssl s_client -connect 127.0.0.1:443 -servername "$first" 2>/dev/null | openssl x509 -noout -issuer -enddate | mask
  echo "response headers:"
  curl -s -o /dev/null -D - -m 10 --resolve "$first:443:127.0.0.1" "https://$first/login" </dev/null \
    | grep -iE '^(HTTP|strict-transport|server|x-powered-by|x-content-type|referrer-policy|x-frame|content-security-policy|cache-control)' \
    | cut -c1-110 | mask

  echo "== resources"
  free -m | awk '/^Mem:/ {print "mem_mb used: " $3 ", available: " $7}'
  df -h / | awk 'NR==2 {print "disk free: " $4}'
  echo "STEP7-OK"
}

main "$@"
