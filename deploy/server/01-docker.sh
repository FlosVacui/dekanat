#!/usr/bin/env bash
# Шаг 4 пакета 2.5: Docker Engine и Compose на сервере. Запускает участник А под пользователем deploy.
# Порядок установки сверен с docs.docker.com/engine/install/ubuntu 13.11.2026: ключ в /etc/apt/keyrings/docker.asc,
# источник в /etc/apt/sources.list.d/docker.sources, пакеты docker-ce, docker-ce-cli, containerd.io и два плагина.
# Скрипт не печатает адрес сервера, логины и значения окружения. Вывод — латиницей: консоль Windows портит кириллицу.
# Повторный запуск безопасен: уже сделанное он не ломает.
set -euo pipefail

main() {
  trap 'echo "STEP4-FAIL line $LINENO"' ERR
  # sudo не передаёт переменные окружения: DEBIAN_FRONTEND ставится в самой команде, иначе debconf пишет предупреждения.

  echo "== system"
  . /etc/os-release
  echo "os: $PRETTY_NAME, arch: $(dpkg --print-architecture), cpu: $(nproc)"
  free -m | awk '/^Mem:/ {print "mem_mb: " $2 ", free_mb: " $7} /^Swap:/ {print "swap_mb: " $2}'
  df -h / | awk 'NR==2 {print "disk: " $2 ", free: " $4}'

  # Находки Z1-Z4 отчёта R-1.4: открываются ли с сервера нужные внешние адреса. Код 000 — нет соединения.
  echo "== reach (http code, seconds)"
  local url
  for url in \
    https://download.docker.com/linux/ubuntu/gpg \
    https://registry-1.docker.io/v2/ \
    https://auth.docker.io/token \
    https://registry.npmjs.org/-/ping \
    https://github.com/ \
    https://acme-v02.api.letsencrypt.org/directory; do
    printf '%s ' "$url"
    curl -4 -s -o /dev/null -m 20 -w '%{http_code} %{time_total}\n' "$url" </dev/null || echo "000 curl-exit-$?"
  done

  echo "== install"
  if ! curl -4 -fsS -m 30 -o /tmp/docker.asc https://download.docker.com/linux/ubuntu/gpg </dev/null; then
    echo "STEP4-STOP docker-repo-unreachable"
    return 0
  fi
  sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=180 -qq update </dev/null
  sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=180 -qq -y install ca-certificates curl </dev/null >/dev/null
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo install -m 0644 /tmp/docker.asc /etc/apt/keyrings/docker.asc
  rm -f /tmp/docker.asc
  sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=180 -qq update </dev/null
  sudo DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=180 -qq -y install \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin </dev/null >/dev/null
  sudo systemctl enable --now docker >/dev/null 2>&1
  # У deploy уже есть sudo без пароля, поэтому группа docker прав не добавляет, а команды становятся короче.
  sudo usermod -aG docker "$USER"

  echo "== versions"
  sudo docker --version
  sudo docker compose version
  echo "service: $(systemctl is-active docker), enabled: $(systemctl is-enabled docker)"

  # Проверка Docker Hub делом: скачать и запустить самый маленький образ.
  echo "== hub"
  local hello
  hello="$(sudo docker run --rm hello-world </dev/null 2>&1 || true)"
  if [[ "$hello" == *"Hello from Docker"* ]]; then
    echo "hub: pull-and-run ok"
  else
    echo "hub: FAIL"
    echo "STEP4-STOP docker-hub-unreachable"
    return 0
  fi
  sudo docker image rm hello-world >/dev/null 2>&1 || true

  echo "== firewall"
  sudo ufw status | grep -E '^Status|ALLOW' | sed 's/  */ /g'

  echo "STEP4-OK"
}

main "$@"
