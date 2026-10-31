#!/usr/bin/env bash
# Проверки порядка и отказов со stub-командами; Docker/сервер не запускаются.
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
[[ -d "$ROOT/.local" ]] || mkdir "$ROOT/.local"
[[ -d "$ROOT/.local/control-tests" ]] || mkdir "$ROOT/.local/control-tests"
WORK="$(mktemp -d "$ROOT/.local/control-tests/run-XXXXXX")"
BIN="$WORK/bin"
mkdir "$BIN"
cat >"$BIN/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%q ' "$@" >>"$MOCK_LOG"; printf '\n' >>"$MOCK_LOG"
case "$*" in
  'compose version --short') printf '%s\n' "${MOCK_COMPOSE_VERSION:-2.24.7}" ;;
  *'config --quiet'*) exit 0 ;;
  *'build --pull'*) [[ "${MOCK_BUILD_FAIL:-0}" == 0 ]] ;;
  *'run --rm --no-deps -T --interactive=false caddy caddy validate'*)
    if [[ "${MOCK_PROBE_STDIN:-0}" == 1 ]] && IFS= read -r unexpected_input; then exit 72; fi
    printf 'Valid configuration\n'; exit "${MOCK_CADDY_EXIT:-0}" ;;
  *'up -d --no-deps --wait --wait-timeout 120 db') exit "${MOCK_START_DB_EXIT:-0}" ;;
  *"SELECT to_regclass"*) printf '%s\n' "${MOCK_DB_PRESENT:-t}" ;;
  *'pg_dump '*) printf 'PGDMPmock-dump'; [[ "${MOCK_DUMP_FAIL:-0}" == 0 ]] ;;
  *'pg_restore --list'*) grep -q '^PGDMPmock-dump'; [[ "${MOCK_RESTORE_FAIL:-0}" == 0 ]] ;;
  *'run --rm --no-deps -T --interactive=false migrate') [[ "${MOCK_MIGRATE_FAIL:-0}" == 0 ]] ;;
  *'ps --all --services') printf '%s\n' "${MOCK_ALL_SERVICES-$'db\nweb\nworker\ncaddy'}" ;;
  *'ps --services --status running') printf '%s\n' "${MOCK_RUNNING_SERVICES-$'db\nweb\nworker\ncaddy'}" ;;
  *'ps --all') printf 'NAME STATE\nmock-db running\n' ;;
esac
MOCK
cat >"$BIN/git" <<'MOCK'
#!/usr/bin/env bash
set -eu
{ printf 'git '; printf '%q ' "$@"; printf '\n'; } >>"$MOCK_LOG"
case "$*" in
  *'remote get-url origin') printf '%s\n' "${MOCK_REMOTE:-https://github.com/saintcrimes/NarxPilot.git}" ;;
  *'symbolic-ref --quiet --short HEAD') if [[ "${MOCK_DETACHED:-0}" == 1 ]]; then exit 1; fi; printf '%s\n' "${MOCK_BRANCH:-main}" ;;
  *'status --porcelain --untracked-files=normal') [[ "${MOCK_STATUS_FAIL:-0}" == 0 ]] || exit 1; printf '%s' "${MOCK_DIRTY:-}" ;;
  *'fetch --no-tags origin main') [[ "${MOCK_FETCH_FAIL:-0}" == 0 ]] ;;
  *'merge --ff-only FETCH_HEAD') [[ "${MOCK_MERGE_FAIL:-0}" == 0 ]] ;;
  *'merge-base --is-ancestor HEAD FETCH_HEAD') [[ "${MOCK_DIVERGED:-0}" == 0 ]] ;;
esac
MOCK
# Lock и timeout здесь проверяют протокол вызова, а не Linux-системные реализации.
printf '#!/usr/bin/env bash\nexit 0\n' >"$BIN/flock"
printf '#!/usr/bin/env bash\nshift\nexec "$@"\n' >"$BIN/timeout"
chmod +x "$BIN/"*
export PATH="$BIN:$PATH"
case_no=0
new_case() {
  case_no=$((case_no+1)); CASE="$WORK/case-$case_no"; mkdir "$CASE"; mkdir "$CASE/deploy"
  cp "$ROOT/deploy/control.sh" "$CASE/deploy/control.sh"
  printf 'services: {}\n' >"$CASE/deploy/compose.yml"
  printf '{}\n' >"$CASE/package-lock.json"
  # Если скрипт начнёт source .env, тест создаст marker и завершится ошибкой.
  printf 'MUST_NOT_EXECUTE=$(touch "%s")\n' "$CASE/env-was-executed" >"$CASE/.env"
  export MOCK_LOG="$CASE/calls.log"; : >"$MOCK_LOG"
  unset MOCK_COMPOSE_VERSION MOCK_BUILD_FAIL MOCK_DB_PRESENT MOCK_DUMP_FAIL MOCK_RESTORE_FAIL MOCK_MIGRATE_FAIL MOCK_REMOTE MOCK_BRANCH MOCK_DIRTY MOCK_FETCH_FAIL MOCK_MERGE_FAIL MOCK_DETACHED MOCK_DIVERGED MOCK_STATUS_FAIL MOCK_CADDY_EXIT MOCK_START_DB_EXIT MOCK_ALL_SERVICES MOCK_RUNNING_SERVICES MOCK_PROBE_STDIN || true
}
run_ok() { bash "$CASE/deploy/control.sh" "$@" >"$CASE/stdout" 2>"$CASE/stderr" || { cat "$CASE/stderr" >&2; exit 1; }; [[ ! -e "$CASE/env-was-executed" ]]; }
run_fail() { if bash "$CASE/deploy/control.sh" "$@" >"$CASE/stdout" 2>"$CASE/stderr"; then printf 'Ожидался отказ: %s\n' "$*" >&2; exit 1; fi; [[ ! -e "$CASE/env-was-executed" ]]; }
has() { grep -q -- "$1" "$MOCK_LOG"; }
not_has() { ! has "$1"; }

new_case; run_ok deploy
has 'build --pull web migrate worker'; has 'pg_dump'; has 'pg_restore --list'; has 'run --rm --no-deps -T --interactive=false migrate'; has 'worker python -m worker.health'
build_line=$(grep -n 'build --pull' "$MOCK_LOG" | cut -d: -f1)
dump_line=$(grep -n 'pg_dump' "$MOCK_LOG" | cut -d: -f1)
migrate_line=$(grep -n 'run --rm --no-deps -T --interactive=false migrate' "$MOCK_LOG" | cut -d: -f1)
[[ "$build_line" -lt "$dump_line" && "$dump_line" -lt "$migrate_line" ]]
[[ $(find "$CASE/.local/backups" -name '*.dump' | wc -l) -eq 1 ]]

new_case; export MOCK_BUILD_FAIL=1; run_fail deploy; not_has 'pg_dump'; not_has 'up -d'; not_has 'run --rm --no-deps -T --interactive=false migrate'
new_case; export MOCK_DUMP_FAIL=1; run_fail deploy; not_has 'run --rm --no-deps -T --interactive=false migrate'; [[ $(find "$CASE/.local/backups" -name '*.dump' | wc -l) -eq 0 ]]
new_case; export MOCK_RESTORE_FAIL=1; run_fail backup; [[ $(find "$CASE/.local/backups" -name '*.dump' | wc -l) -eq 0 ]]
new_case; export MOCK_MIGRATE_FAIL=1; run_fail deploy; not_has 'up -d --no-build'
new_case; export MOCK_DB_PRESENT=f; run_ok deploy; not_has 'pg_dump'; has 'run --rm --no-deps -T --interactive=false migrate'
new_case; export MOCK_DB_PRESENT=unexpected; run_fail deploy; not_has 'run --rm --no-deps -T --interactive=false migrate'
new_case; export MOCK_COMPOSE_VERSION=2.20.0; run_fail deploy; not_has 'config --quiet'
new_case; rm -- "$CASE/package-lock.json"; run_fail deploy; not_has 'build --pull'; not_has 'up -d'
new_case; export MOCK_DIRTY=' M README.md'; run_fail update; not_has 'build --pull'
new_case; export MOCK_REMOTE='https://example.invalid/other.git'; run_fail update; not_has 'build --pull'
new_case; run_ok logs web; has 'logs --tail=100 web'; not_has 'build --pull'
new_case; run_fail logs --follow; not_has 'logs --tail'
new_case; run_ok update; has 'fetch --no-tags origin main'; has 'merge --ff-only FETCH_HEAD'; has 'pg_dump'
new_case; export MOCK_DETACHED=1; run_ok update; has 'merge --ff-only FETCH_HEAD'
new_case; export MOCK_DIVERGED=1; run_fail update; not_has 'merge --ff-only FETCH_HEAD'; not_has 'build --pull'
new_case; export MOCK_FETCH_FAIL=1; run_fail update; not_has 'merge --ff-only FETCH_HEAD'; not_has 'build --pull'
new_case; run_ok check-chat; has 'run --rm --no-deps -T --interactive=false web node deploy/check-chat.mjs'; not_has 'build --pull'
new_case; export MOCK_STATUS_FAIL=1; run_fail update; not_has 'fetch --no-tags origin main'; not_has 'build --pull'
new_case; export MOCK_CADDY_EXIT=42; run_fail deploy; grep -q 'этап=validate-caddy; код=42; строка=' "$CASE/stderr"; not_has 'up -d'; not_has 'pg_dump'
new_case; export MOCK_CADDY_EXIT=124; run_fail deploy; grep -q 'Valid configuration' "$CASE/stdout"; grep -q 'этап=validate-caddy; код=124; строка=' "$CASE/stderr"; not_has 'up -d'
new_case; export MOCK_START_DB_EXIT=53; run_fail deploy; grep -q 'этап=start-db; код=53; строка=' "$CASE/stderr"; not_has 'pg_dump'; not_has 'run --rm --no-deps -T --interactive=false migrate'
new_case; export MOCK_ALL_SERVICES=db MOCK_RUNNING_SERVICES=db; run_ok status; has 'ps --all'; grep -q 'Не созданы сервисы: web worker caddy' "$CASE/stdout"; grep -q 'Прокси Caddy не работает' "$CASE/stdout"
new_case; export MOCK_RUNNING_SERVICES=$'db\nworker'; run_ok status; grep -q 'Не запущены сервисы: web caddy' "$CASE/stdout"; ! grep -q 'Не созданы сервисы:' "$CASE/stdout"
new_case; export MOCK_PROBE_STDIN=1
printf 'must-not-reach-container\n' | bash "$CASE/deploy/control.sh" deploy >"$CASE/stdout" 2>"$CASE/stderr"
has 'run --rm --no-deps -T --interactive=false caddy'; has 'exec -T --interactive=false db'; has 'exec -T db pg_restore --list'
new_case; export MOCK_CADDY_EXIT=43 FAKE_SECRET_TOKEN='never-print-this-env-value'; run_fail deploy
! grep -q "$FAKE_SECRET_TOKEN" "$CASE/stderr"; ! grep -q 'docker compose\|X-API-Key\|BASH_COMMAND' "$CASE/stderr"
printf 'Проверено %s сценариев control.sh с mock CLI; Docker и deploy не выполнялись.\n' "$case_no"
