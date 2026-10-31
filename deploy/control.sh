#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
COMPOSE=(docker compose --project-name narxpilot-server --project-directory "$ROOT" --env-file "$ROOT/.env" -f "$ROOT/deploy/compose.yml")
EXPECTED_REMOTE='https://github.com/saintcrimes/NarxPilot.git'

die() { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }
note() { printf '%s\n' "$*"; }
dc() { "${COMPOSE[@]}" "$@"; }

usage() {
  cat <<'HELP'
Управление сервером NarxPilot:
  bash deploy/control.sh deploy  — сборка, резервная копия, миграции и запуск
  bash deploy/control.sh update  — fast-forward main, затем deploy
  bash deploy/control.sh backup  — проверенный pg_dump в .local/backups/
  bash deploy/control.sh check-chat — один запрос Bro24 и безопасная проверка схемы
  bash deploy/control.sh status  — состояние контейнеров
  bash deploy/control.sh logs [web|worker|db|caddy] — последние 100 строк

deploy/update сохраняют .env и Docker volumes. Автоматического отката схемы нет.
Перед первым запуском выполните installer или deploy/configure.mjs.
HELP
}

preflight() {
  command -v docker >/dev/null || die 'Нужен Docker Engine и Compose v2.'
  command -v timeout >/dev/null || die 'Не найдена команда timeout (coreutils).'
  [[ -r "$ROOT/.env" ]] || die 'Нет читаемого .env. Сначала выполните installer/configure.'
  [[ -f "$ROOT/deploy/compose.yml" ]] || die 'Нет deploy/compose.yml.'
  local version major minor
  version="$(docker compose version --short)" || die 'Недоступен Docker Compose.'
  [[ "$version" =~ ^v?([0-9]+)\.([0-9]+) ]] || die 'Не удалось определить версию Compose.'
  major="${BASH_REMATCH[1]}"; minor="${BASH_REMATCH[2]}"
  (( major > 2 || (major == 2 && minor >= 24) )) || die 'Требуется Docker Compose 2.24 или новее.'
  timeout 30 docker info >/dev/null 2>&1 || die 'Docker daemon недоступен текущему пользователю.'
  # Не выводить раскрытую конфигурацию: она содержит серверные секреты.
  dc config --quiet || die 'Проверьте серверный .env и deploy/compose.yml.'
}

lock_changes() {
  command -v flock >/dev/null || die 'Не найдена команда flock (util-linux).'
  [[ -d "$ROOT/.local" ]] || mkdir -- "$ROOT/.local"
  exec 9>"$ROOT/.local/deploy-control.lock"
  flock --nonblock 9 || die 'Другой deploy/update/backup уже выполняется.'
}

database_initialized() {
  local present
  present="$(dc exec -T db sh -ec 'exec psql -X --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -v ON_ERROR_STOP=1 -Atc "$1"' sh "SELECT to_regclass('public.database_identity') IS NOT NULL")" || die 'Не удалось проверить схему PostgreSQL; миграции не запущены.'
  present="${present//$'\r'/}"
  case "$present" in
    t) return 0 ;;
    f) return 1 ;;
    *) die 'Неожиданный ответ PostgreSQL при проверке схемы.' ;;
  esac
}

backup_database() {
  local directory file
  directory="$ROOT/.local/backups"
  [[ -d "$directory" ]] || mkdir -- "$directory"
  file="$(mktemp "$directory/narxpilot-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.dump")" || die 'Не удалось создать файл резервной копии.'
  if ! timeout 300 "${COMPOSE[@]}" exec -T db sh -ec 'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --no-owner --no-acl' >"$file"; then
    rm -f -- "$file"
    die 'pg_dump завершился ошибкой; миграции не запущены.'
  fi
  if [[ ! -s "$file" ]] || ! timeout 60 "${COMPOSE[@]}" exec -T db pg_restore --list <"$file" >/dev/null; then
    rm -f -- "$file"
    die 'Резервная копия не прошла проверку pg_restore --list.'
  fi
  note "Резервная копия: $file"
  note 'Формат проверен; полное восстановление в отдельную базу этой командой не тестировалось.'
}

deploy_stack() {
  [[ -s "$ROOT/package-lock.json" ]] || die 'Нет package-lock.json. Используйте коммит с проверенным lockfile; установка незакреплённых зависимостей на сервере не выполняется.'
  note 'Загружаем runtime-образы и собираем приложение. Работающие контейнеры пока сохраняются.'
  timeout 600 "${COMPOSE[@]}" pull db caddy
  timeout 1800 "${COMPOSE[@]}" build --pull web migrate worker
  timeout 90 "${COMPOSE[@]}" run --rm --no-deps -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  dc up -d --no-deps --wait --wait-timeout 120 db
  if database_initialized; then backup_database; else note 'Новая пустая схема: первая миграция без резервной копии.'; fi
  note 'Применяем миграции, права ролей и условный demo seed.'
  timeout 600 "${COMPOSE[@]}" run --rm --no-deps -T migrate
  dc up -d --no-build --no-deps --wait --wait-timeout 180 web worker
  dc up -d --no-build --no-deps --wait --wait-timeout 120 caddy
  dc exec -T web node -e "fetch('http://localhost:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  dc exec -T worker python -m worker.health
  dc ps
  note 'Контейнеры и внутренние healthchecks готовы. Внешний HTTPS зависит от DNS и доступности портов 80/443.'
  note 'Доступ к демо закрыт паролем. Данные доступа: .local/deploy/access.json; не публикуйте этот файл.'
}

update_checkout() {
  command -v git >/dev/null || die 'Для update нужен Git.'
  local remote branch changes
  remote="$(git -C "$ROOT" remote get-url origin)" || die 'Не задан origin.'
  [[ "$remote" == "$EXPECTED_REMOTE" || "$remote" == "${EXPECTED_REMOTE%.git}" ]] || die 'origin не совпадает с репозиторием NarxPilot; обновление остановлено.'
  branch="$(git -C "$ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  [[ -z "$branch" || "$branch" == main ]] || die 'Автоматическое update поддерживает main или detached HEAD установщика.'
  changes="$(git -C "$ROOT" status --porcelain --untracked-files=normal)" || die 'Не удалось проверить локальные изменения Git.'
  [[ -z "$changes" ]] || die 'Есть локальные изменения: сохраните их перед update. .env не перезаписывается.'
  timeout 180 git -C "$ROOT" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 fetch --no-tags origin main
  git -C "$ROOT" merge-base --is-ancestor HEAD FETCH_HEAD || die 'История отличается от main; автоматический откат или слияние не выполняются.'
  git -C "$ROOT" merge --ff-only FETCH_HEAD
  deploy_stack
}

main() {
  local action="${1:-help}"
  case "$action" in help|-h|--help) usage; return ;; esac
  [[ $# -le 2 ]] || die 'Слишком много аргументов; используйте help.'
  case "$action" in deploy|update|backup|status|logs|check-chat) ;; *) die 'Неизвестная команда; используйте help.' ;; esac
  [[ $# -le 1 || "$action" == logs ]] || die 'Эта команда не принимает дополнительных аргументов.'
  preflight
  case "$action" in
    deploy) lock_changes; deploy_stack ;;
    update) lock_changes; update_checkout ;;
    backup) lock_changes; backup_database ;;
    status) dc ps ;;
    check-chat) timeout 45 "${COMPOSE[@]}" run --rm --no-deps -T web node deploy/check-chat.mjs ;;
    logs)
      if [[ $# == 2 ]]; then
        case "$2" in web|worker|db|caddy) dc logs --tail=100 "$2" ;; *) die 'Допустимы web, worker, db, caddy.' ;; esac
      else dc logs --tail=100 web worker caddy; fi
      ;;
  esac
}

main "$@"
