#!/usr/bin/env bash
# Bootstrap: only this script installs host prerequisites. It never removes Docker data.
# Docker repository procedure: https://docs.docker.com/engine/install/ubuntu/
# and https://docs.docker.com/engine/install/debian/
set -Eeuo pipefail
umask 077

readonly repository='https://github.com/saintcrimes/NarxPilot.git'
readonly node_image='node:22.22.0-bookworm-slim'
readonly caddy_image='caddy:2.11.7-alpine'
domain='narxpilot.software-engineer.online'
install_dir='/opt/narxpilot'
revision='main'
dry_run=false
temporary_key=''
temporary_hash=''

say() { printf '%s\n' "$*"; }
fail() { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }
cleanup() { if [[ -n "$temporary_key" ]]; then rm -f -- "$temporary_key"; fi; if [[ -n "$temporary_hash" ]]; then rm -f -- "$temporary_hash"; fi; }
trap cleanup EXIT
trap 'status=$?; printf "Установка остановлена (код %s, строка %s). Существующие .env и тома не удалялись.\n" "$status" "$LINENO" >&2; exit "$status"' ERR

usage() {
  cat <<'HELP'
Установка NarxPilot на Linux-сервере:
  sudo bash deploy/install.sh [--domain ДОМЕН] [--dir /opt/narxpilot] [--ref main]
  bash deploy/install.sh --dry-run

По умолчанию: narxpilot.software-engineer.online, /opt/narxpilot, ветка main.
--ref принимает имя ветки/тега или полный SHA коммита.
--dry-run проверяет аргументы и выводит план без сети и изменения файлов.
--help выводит эту справку.

При отсутствии Docker установка поддерживает Ubuntu/Debian через официальный apt-репозиторий.
Другой Linux поддерживается при уже установленных Docker Engine, Compose v2, Git, curl и flock.
Существующая установка Docker, .env и тома сохраняются. Незакоммиченные изменения
или другая история Git останавливают обновление; reset/force/удаление файлов не используются.
HELP
}

need_argument() { [[ $# -ge 2 && -n "$2" ]] || fail "Для $1 требуется значение."; }
while (($#)); do
  case "$1" in
    --domain) need_argument "$@"; domain=$2; shift 2 ;;
    --dir) need_argument "$@"; install_dir=$2; shift 2 ;;
    --ref) need_argument "$@"; revision=$2; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Неизвестный аргумент: $1. См. --help." ;;
  esac
done

# No shell interpolation, URL credentials, paths, wildcards or ports in the public hostname.
[[ ${#domain} -le 253 && "$domain" == *.* && "$domain" =~ ^[a-zA-Z0-9.-]+$ ]] || fail 'Укажите обычное доменное имя без схемы, порта или пути.'
IFS='.' read -r -a domain_labels <<< "$domain"
for label in "${domain_labels[@]}"; do
  [[ ${#label} -ge 1 && ${#label} -le 63 && "$label" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$ ]] || fail 'Некорректная метка доменного имени.'
done
[[ "$domain" != *. ]] || fail 'Домен должен быть без завершающей точки.'
domain=${domain,,}
[[ "$install_dir" =~ ^/[a-zA-Z0-9_./-]+$ && "$install_dir" != *'/../'* && "$install_dir" != */.. && "$install_dir" != *'/./'* && "$install_dir" != */. ]] || fail 'Каталог: абсолютный путь без пробелов, двоеточия и переходов . или ...'
while [[ "$install_dir" == */ ]]; do install_dir=${install_dir%/}; done
case "$install_dir" in ''|/|/opt|/srv|/root|/home|/tmp|/var|/usr|/etc|/bin|/sbin|/lib|/lib64|/boot|/run|/dev|/proc|/sys) fail 'Выберите отдельный каталог проекта, например /opt/narxpilot.' ;; esac
[[ "$revision" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]*$ && "$revision" != *..* && "$revision" != */ && "$revision" != *'//'* ]] || fail 'Некорректное имя ветки, тега или SHA.'

if "$dry_run"; then
  say "Репозиторий: $repository"
  say "Каталог: $install_dir; revision: $revision"
  say "Домен: https://$domain"
  say 'План: проверить Docker/Git → безопасно получить код → настроить .env → deploy/control.sh deploy.'
  say 'Проверка аргументов завершена; сеть, файлы и службы не изменялись.'
  exit 0
fi

[[ $(uname -s) == Linux ]] || fail 'Запустите установщик на Linux-сервере. Локальная Windows-машина не изменяется.'
[[ $(id -u) == 0 ]] || fail 'Запустите через sudo bash: нужны права на установку Docker и /opt/narxpilot.'
[[ -f /etc/os-release ]] || fail 'Не найден /etc/os-release; установите зависимости вручную.'
# This is a trusted OS-owned file, never the application .env.
# shellcheck disable=SC1091
. /etc/os-release
distribution=${ID:-unknown}
codename=${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}

apt_run() { DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o DPkg::Lock::Timeout=120 "$@"; }
prerequisites_missing=false
for command_name in git curl flock realpath; do command -v "$command_name" >/dev/null 2>&1 || prerequisites_missing=true; done
if "$prerequisites_missing"; then
  case "$distribution" in ubuntu|debian) ;; *) fail 'Установите Git, curl, ca-certificates и util-linux (flock/realpath), затем повторите.' ;; esac
  command -v apt-get >/dev/null 2>&1 || fail 'Не найден apt-get.'
  apt_run update
  apt_run install -y --no-install-recommends ca-certificates curl git util-linux coreutils
fi

install -d -m 0755 /run/lock
exec 9>/run/lock/narxpilot-install.lock
flock -n 9 || fail 'Другой установщик NarxPilot уже работает.'
[[ ! -L "$install_dir" ]] || fail 'Каталог проекта не должен быть символической ссылкой.'
resolved_dir=$(realpath -m -- "$install_dir")
[[ "$resolved_dir" == "$install_dir" ]] || fail 'Путь должен быть каноническим и не проходить через символические ссылки.'

if command -v docker >/dev/null 2>&1; then
  docker compose version >/dev/null 2>&1 || fail 'Docker найден, но Compose v2 отсутствует. Установите совместимый compose plugin; существующий Docker не изменён.'
  docker info >/dev/null 2>&1 || fail 'Docker установлен, но daemon недоступен. Запустите его и повторите команду.'
else
  case "$distribution:$codename" in
    ubuntu:jammy|ubuntu:noble|ubuntu:resolute|ubuntu:stonking|debian:bookworm|debian:trixie) ;;
    *) fail 'Автоустановка Docker рассчитана на поддерживаемые Ubuntu/Debian. Установите Docker Engine и Compose v2 вручную.' ;;
  esac
  for package_name in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc; do
    if [[ $(dpkg-query -W -f='${db:Status-Status}' "$package_name" 2>/dev/null || true) == installed ]]; then
      fail "Обнаружен $package_name. Разрешите конфликт пакетов Docker вручную; установщик ничего не удаляет."
    fi
  done
  apt_run update
  apt_run install -y --no-install-recommends ca-certificates curl git util-linux coreutils
  install -d -m 0755 /etc/apt/keyrings
  repository_file='/etc/apt/sources.list.d/narxpilot-docker.sources'
  key_file='/etc/apt/keyrings/narxpilot-docker.asc'
  # Preserve pre-existing repository configuration; a fresh dedicated file avoids overwrites.
  if [[ ! -e "$repository_file" ]]; then
    temporary_key=$(mktemp /tmp/narxpilot-docker-key.XXXXXX)
    curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location --retry 3 --connect-timeout 10 --max-time 120 "https://download.docker.com/linux/$distribution/gpg" -o "$temporary_key"
    [[ -s "$temporary_key" ]] || fail 'Пустой ключ репозитория Docker.'
    [[ ! -e "$key_file" ]] || fail "Ключ $key_file уже существует без соответствующего sources-файла. Проверьте настройку вручную."
    install -m 0644 "$temporary_key" "$key_file"
    architecture=$(dpkg --print-architecture)
    printf 'Types: deb\nURIs: https://download.docker.com/linux/%s\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: %s\n' "$distribution" "$codename" "$architecture" "$key_file" > "$repository_file"
    chmod 0644 "$repository_file"
  else
    [[ -f "$repository_file" && -f "$key_file" && ! -L "$repository_file" && ! -L "$key_file" ]] || fail 'Проверьте существующие файлы репозитория Docker.'
    grep -Fqx "URIs: https://download.docker.com/linux/$distribution" "$repository_file" || fail 'Существующий Docker sources не соответствует ОС; файл не перезаписан.'
    grep -Fqx "Suites: $codename" "$repository_file" || fail 'Существующий Docker sources не соответствует версии ОС; файл не перезаписан.'
    grep -Fqx "Signed-By: $key_file" "$repository_file" || fail 'Неожиданный ключ репозитория Docker; файл не перезаписан.'
  fi
  apt_run update
  apt_run install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  command -v systemctl >/dev/null 2>&1 || fail 'Docker установлен. Запустите daemon средствами своей init-системы и повторите.'
  systemctl enable --now docker
  docker info >/dev/null 2>&1 || fail 'Docker установлен, но daemon недоступен.'
  docker compose version >/dev/null
fi

export GIT_TERMINAL_PROMPT=0
git_safe() { git -c core.hooksPath=/dev/null -c protocol.file.allow=never "$@"; }
if [[ -e "$install_dir" ]]; then
  [[ -d "$install_dir/.git" ]] || fail "Каталог $install_dir уже существует и не является Git checkout. Содержимое сохранено; выберите другой --dir."
  actual_remote=$(git_safe -C "$install_dir" remote get-url origin)
  [[ "$actual_remote" == "$repository" || "$actual_remote" == "${repository%.git}" ]] || fail 'origin не соответствует saintcrimes/NarxPilot; каталог не изменён.'
  checkout_changes=$(git_safe -C "$install_dir" status --porcelain --untracked-files=normal) || fail 'Не удалось проверить изменения checkout; обновление остановлено.'
  [[ -z "$checkout_changes" ]] || fail 'В checkout есть незакоммиченные файлы. Сохраните их перед обновлением; reset не выполняется.'
  git_safe -C "$install_dir" fetch --no-tags origin "$revision"
  target_commit=$(git_safe -C "$install_dir" rev-parse --verify 'FETCH_HEAD^{commit}')
  git_safe -C "$install_dir" merge-base --is-ancestor HEAD "$target_commit" || fail 'Удалённая revision не является продолжением текущей истории. Переключение/откат автоматически не выполняются.'
  git_safe -C "$install_dir" merge --ff-only "$target_commit"
else
  install -d -m 0755 -- "$(dirname -- "$install_dir")"
  git_safe clone --no-checkout --origin origin "$repository" "$install_dir"
  git_safe -C "$install_dir" fetch --no-tags origin "$revision"
  target_commit=$(git_safe -C "$install_dir" rev-parse --verify 'FETCH_HEAD^{commit}')
  git_safe -C "$install_dir" checkout --detach "$target_commit"
fi

cd -- "$install_dir"
[[ -f deploy/configure.mjs && -f deploy/control.sh && -f deploy/compose.yml ]] || fail 'Выбранная revision не содержит полный набор deployment-скриптов.'
say "Код получен: $(git_safe rev-parse --short=12 HEAD). Настройка https://$domain."
configure() { docker run --rm --pull=missing --network none --mount "type=bind,source=$install_dir,target=/workspace" --workdir /workspace "$node_image" node deploy/configure.mjs --domain "$domain" "$@"; }
configure
if [[ -f .local/deploy/basic-auth-password && ! -s .local/deploy/auth-hash ]]; then
  [[ ! -L .local/deploy/auth-hash && ! -L .local/deploy/basic-auth-password ]] || fail 'Файлы доступа не должны быть символическими ссылками.'
  temporary_hash=$(mktemp "$install_dir/.local/deploy/auth-hash.XXXXXX")
  chmod 0600 "$temporary_hash"
  docker run --rm --pull=missing --network none --mount "type=bind,source=$install_dir/.local/deploy,target=/run/narxpilot,readonly" --entrypoint sh "$caddy_image" -c 'caddy hash-password < /run/narxpilot/basic-auth-password' > "$temporary_hash"
  [[ -s "$temporary_hash" ]] || fail 'Caddy не создал хеш доступа.'
  mv -- "$temporary_hash" .local/deploy/auth-hash
  temporary_hash=''
fi
configure --finalize
bash deploy/control.sh deploy
if [[ -f .local/deploy/access.json ]]; then say "Данные входа находятся только на сервере: $install_dir/.local/deploy/access.json"; fi
say 'Установка завершена. Данные и секреты остаются на сервере; команды управления описаны в docs/DEPLOYMENT.md.'
