#!/usr/bin/env bash
# Шаг 5 пакета 2.5: ключ только на чтение для репозитория и копия ветки на сервере. Запускает участник А под deploy.
# Запускается дважды одной и той же командой:
#   первый раз — создаёт ключ и печатает его открытую половину; участник А добавляет её в Deploy keys на GitHub
#                без галочки «Allow write access»;
#   второй раз — проверяет доступ и берёт ветку в папку ~/dekanat.
# Адрес репозитория и ветка приходят аргументами: в файле их нет. Закрытая половина ключа не печатается.
# Вывод — латиницей: консоль Windows портит кириллицу.
set -euo pipefail

main() {
  trap 'echo "STEP5-FAIL line $LINENO"' ERR
  local repo="${1:?arg 1: repo address}" branch="${2:?arg 2: branch}"
  local dir="$HOME/dekanat" key="$HOME/.ssh/dekanat_repo_ed25519"
  umask 077
  mkdir -p "$HOME/.ssh"

  command -v git >/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get -qq -y install git </dev/null >/dev/null

  # Ключи узла github.com — из https://api.github.com/meta, поле ssh_keys, 13.11.2026.
  # Отпечатки там же: ED25519 SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU.
  if ! grep -q '^github.com ' "$HOME/.ssh/known_hosts" 2>/dev/null; then
    cat >>"$HOME/.ssh/known_hosts" <<'EOF'
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=
EOF
  fi

  if [[ ! -f "$key" ]]; then
    ssh-keygen -q -t ed25519 -N '' -C dekanat-server-read-only -f "$key" </dev/null
    echo "key: created"
  else
    echo "key: exists"
  fi

  if ! grep -q '^Host github.com$' "$HOME/.ssh/config" 2>/dev/null; then
    cat >>"$HOME/.ssh/config" <<EOF
Host github.com
  User git
  IdentityFile $key
  IdentitiesOnly yes
EOF
  fi

  # Доступ проверяется делом. BatchMode здесь уместен: у этого ключа пароля нет, а вопросов задавать некому.
  export GIT_SSH_COMMAND='ssh -o BatchMode=yes'
  if ! git ls-remote --heads "$repo" "$branch" </dev/null >/tmp/dekanat-lsr 2>/tmp/dekanat-lsr.err; then
    echo "access: not yet ($(head -n 1 /tmp/dekanat-lsr.err | cut -c1-80))"
    echo "== public key: add it on GitHub, repo Settings - Deploy keys - Add deploy key, WITHOUT write access"
    cat "$key.pub"
    echo "STEP5-KEY-READY run the same command again after adding the key"
    rm -f /tmp/dekanat-lsr /tmp/dekanat-lsr.err
    return 0
  fi
  if [[ ! -s /tmp/dekanat-lsr ]]; then
    echo "access: ok, but branch not found: $branch"
    echo "STEP5-STOP no-branch"
    return 0
  fi
  rm -f /tmp/dekanat-lsr /tmp/dekanat-lsr.err
  echo "access: ok"

  # Закрытые права нужны только ключу и настройкам SSH. Файлы копии берутся с обычными правами: образ собирается
  # от root, а работает от node, и скрипт роли базы читает пользователь postgres. Сама папка остаётся закрытой: 700.
  umask 022
  if [[ ! -d "$dir/.git" ]]; then
    git clone -q --branch "$branch" "$repo" "$dir" </dev/null
    echo "repo: cloned"
  else
    git -C "$dir" fetch -q origin </dev/null
    git -C "$dir" checkout -q "$branch"
    git -C "$dir" merge -q --ff-only "origin/$branch"
    echo "repo: updated"
  fi
  chmod 700 "$dir"

  echo "branch: $(git -C "$dir" rev-parse --abbrev-ref HEAD), commit: $(git -C "$dir" log -1 --format='%h %ci')"
  echo "tree: $(git -C "$dir" status --porcelain | wc -l) changed files"
  local f
  for f in compose.yaml compose.proxy.yaml deploy/Caddyfile app/Dockerfile app/package-lock.json app/db/docker-init/10-app-role.sh .dockerignore; do
    [[ -f "$dir/$f" ]] && echo "file ok: $f" || echo "file MISSING: $f"
  done
  echo "STEP5-OK"
}

main "$@"
