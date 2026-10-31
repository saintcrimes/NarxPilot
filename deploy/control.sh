#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
COMPOSE=(docker compose --project-name narxpilot-server --project-directory "$ROOT" --env-file "$ROOT/.env" -f "$ROOT/deploy/compose.yml")
EXPECTED_REMOTE='https://github.com/saintcrimes/NarxPilot.git'
CURRENT_STAGE='arguments'

report_failure() {
  local code="$1" line="$2"
  printf 'Остановка: этап=%s; код=%s; строка=%s. Секреты и текст команды не выводятся.\n' "$CURRENT_STAGE" "$code" "$line" >&2
}
on_error() {
  local code="$1" line="$2"
  trap - ERR
  report_failure "$code" "$line"
  exit "$code"
}
trap 'on_error "$?" "$LINENO"' ERR
die() { printf 'Ошибка: %s\n' "$*" >&2; report_failure 1 "${BASH_LINENO[0]:-0}"; exit 1; }
note() { printf '%s\n' "$*"; }
stage() { CURRENT_STAGE="$1"; printf '\n[%s] %s\n' "$CURRENT_STAGE" "$2"; }
dc() { "${COMPOSE[@]}" "$@"; }

usage() {
  cat <<'HELP'
Управление сервером NarxPilot:
  bash deploy/control.sh deploy  — сборка, резервная копия, миграции и запуск
  bash deploy/control.sh update  — fast-forward main, затем deploy
  bash deploy/control.sh backup  — проверенный pg_dump в .local/backups/
  bash deploy/control.sh check-chat — один запрос Bro24 и безопасная проверка схемы
  bash deploy/control.sh telegram — настроить кнопку Mini App
  bash deploy/control.sh telegram-bot — дополнительно запустить ответы /start
  bash deploy/control.sh status  — все контейнеры, включая остановленные, и отсутствующие сервисы
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
  present="$(timeout 45 "${COMPOSE[@]}" exec -T --interactive=false db sh -ec 'exec psql -X --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -v ON_ERROR_STOP=1 -Atc "$1"' sh "SELECT to_regclass('public.database_identity') IS NOT NULL" </dev/null)" || die 'Не удалось проверить схему PostgreSQL за отведённое время; миграции не запущены.'
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
  if ! timeout 300 "${COMPOSE[@]}" exec -T --interactive=false db sh -ec 'exec pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --no-owner --no-acl' </dev/null >"$file"; then
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

has_service() {
  local wanted="$1" name
  while IFS= read -r name; do [[ "${name%$'\r'}" == "$wanted" ]] && return 0; done <<<"$2"
  return 1
}

status_report() {
  local all_services running_services service
  local -a missing=() stopped=()
  dc ps --all
  all_services="$(dc ps --all --services)" || die 'Не удалось получить полный список контейнеров.'
  running_services="$(dc ps --services --status running)" || die 'Не удалось получить список запущенных контейнеров.'
  for service in db web worker caddy; do
    if ! has_service "$service" "$all_services"; then missing+=("$service")
    elif ! has_service "$service" "$running_services"; then stopped+=("$service"); fi
  done
  if ((${#missing[@]})); then note "Не созданы сервисы: ${missing[*]}"; fi
  if ((${#stopped[@]})); then note "Не запущены сервисы: ${stopped[*]}"; fi
  if ! has_service caddy "$running_services"; then note 'Прокси Caddy не работает; домен пока не обслуживается этим стеком.'; fi
  if ((${#missing[@]}==0 && ${#stopped[@]}==0)); then note 'Все четыре сервиса запущены; состояние healthchecks показано в таблице.'; fi
}

deploy_stack() {
  [[ -s "$ROOT/package-lock.json" ]] || die 'Нет package-lock.json. Используйте коммит с проверенным lockfile; установка незакреплённых зависимостей на сервере не выполняется.'
  stage pull-images 'Загружаем runtime-образы. Работающие контейнеры пока сохраняются.'
  timeout 600 "${COMPOSE[@]}" pull db caddy </dev/null
  stage build-images 'Собираем web, миграции и worker.'
  timeout 1800 "${COMPOSE[@]}" build --pull web migrate worker </dev/null
  stage validate-caddy 'Проверяем конфигурацию Caddy отдельным одноразовым контейнером.'
  timeout 90 "${COMPOSE[@]}" run --rm --no-deps -T --interactive=false caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile </dev/null
  stage start-db 'Запускаем PostgreSQL и ожидаем его healthcheck.'
  dc up -d --no-deps --wait --wait-timeout 120 db
  stage inspect-db 'Проверяем наличие схемы приложения.'
  if database_initialized; then stage backup-db 'Сохраняем и проверяем резервную копию перед миграцией.'; backup_database; else note 'Новая пустая схема: первая миграция без резервной копии.'; fi
  stage migrate 'Применяем миграции, права ролей и условный demo seed.'
  timeout 600 "${COMPOSE[@]}" run --rm --no-deps -T --interactive=false migrate </dev/null
  stage start-app 'Запускаем web и worker; ожидаем healthchecks.'
  dc up -d --no-build --no-deps --wait --wait-timeout 180 web worker
  stage start-proxy 'Пересоздаём HTTPS-прокси с актуальным Caddyfile; тома сертификатов сохраняются.'
  # Git may replace the mounted file's inode; recreation mounts the current version.
  dc up -d --no-build --no-deps --force-recreate --wait --wait-timeout 120 caddy
  stage verify-app 'Проверяем готовность API и heartbeat worker.'
  timeout 30 "${COMPOSE[@]}" exec -T --interactive=false web node -e "fetch('http://localhost:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" </dev/null
  timeout 30 "${COMPOSE[@]}" exec -T --interactive=false worker python -m worker.health </dev/null
  stage status 'Итоговое состояние сервисов.'
  status_report
  note 'Контейнеры и внутренние healthchecks готовы. Внешний HTTPS зависит от DNS и доступности портов 80/443.'
  note 'Синтетический демостенд открыт для всех без HTTP-пароля. Права бизнес-операций проверяются API.'
}

update_checkout() {
  stage update-code 'Проверяем локальный checkout и получаем продолжение ветки main.'
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
  case "$action" in deploy|update|backup|status|logs|check-chat|telegram|telegram-bot) ;; *) die 'Неизвестная команда; используйте help.' ;; esac
  [[ $# -le 1 || "$action" == logs ]] || die 'Эта команда не принимает дополнительных аргументов.'
  stage preflight 'Проверяем Docker, Compose и конфигурацию без вывода секретов.'
  preflight
  case "$action" in
    deploy) lock_changes; deploy_stack ;;
    update) lock_changes; update_checkout ;;
    backup) lock_changes; stage backup-db 'Сохраняем и проверяем резервную копию.'; backup_database ;;
    status) stage status 'Все контейнеры и состав серверного стека.'; status_report ;;
    telegram) stage telegram 'Настраиваем и проверяем кнопку Telegram без вывода токена.'; timeout 60 "${COMPOSE[@]}" run --rm --no-deps -T --interactive=false telegram </dev/null ;;
    telegram-bot) stage telegram-bot 'Запускаем дополнительный обработчик /start.'; dc up -d --no-build --no-deps --wait --wait-timeout 120 telegram-bot ;;
    check-chat) stage check-chat 'Выполняем безопасную проверку контракта чата.'; timeout 45 "${COMPOSE[@]}" run --rm --no-deps -T --interactive=false web node deploy/check-chat.mjs </dev/null ;;
    logs)
      stage logs 'Последние сообщения выбранных сервисов.'
      if [[ $# == 2 ]]; then
        case "$2" in web|worker|db|caddy|telegram-bot) dc logs --tail=100 "$2" ;; *) die 'Допустимы web, worker, db, caddy, telegram-bot.' ;; esac
      else dc logs --tail=100 web worker caddy; fi
      ;;
  esac
}

main "$@"
