#!/usr/bin/env bash
# Real server orchestration on an otherwise empty Linux CI runner, including a TTY.
# https://caddyserver.com/docs/automatic-https: .localhost uses a local CA, no ACME.
set -Eeuo pipefail
umask 077

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
[[ ${1:-} != --help ]] || { printf 'CI=true RUN_SERVER_DEPLOY_TESTS=true bash deploy/tests/test-server-deploy.sh\nUses isolated fixtures and the real narxpilot-server project on an empty Linux runner.\n'; exit 0; }
[[ $# == 0 && ${CI:-} == true && ${RUN_SERVER_DEPLOY_TESTS:-} == true && $(uname -s) == Linux ]] || { printf 'This destructive fixture cleanup is restricted to an explicitly enabled, empty Linux CI runner.\n' >&2; exit 1; }
for executable in docker node python3 tar find stat realpath timeout curl; do command -v "$executable" >/dev/null || { printf 'Missing executable: %s\n' "$executable" >&2; exit 1; }; done
docker info >/dev/null

# Never adopt or remove an existing server project, even when stopped.
[[ -z $(docker ps -aq --filter name=narxpilot-server) ]] || { printf 'Refusing existing containers with the server project name.\n' >&2; exit 1; }
for kind in container volume network; do
  case "$kind" in
    container) existing=$(docker ps -aq --filter label=com.docker.compose.project=narxpilot-server) ;;
    volume) existing=$(docker volume ls -q --filter label=com.docker.compose.project=narxpilot-server) ;;
    network) existing=$(docker network ls -q --filter label=com.docker.compose.project=narxpilot-server) ;;
  esac
  [[ -z "$existing" ]] || { printf 'Refusing existing narxpilot-server %s resources.\n' "$kind" >&2; exit 1; }
done
for name in narxpilot-server_database narxpilot-server_caddy_data narxpilot-server_caddy_config; do
  ! docker volume inspect "$name" >/dev/null 2>&1 || { printf 'Refusing existing named server volume.\n' >&2; exit 1; }
done
! docker network inspect narxpilot-server_default >/dev/null 2>&1 || { printf 'Refusing existing named server network.\n' >&2; exit 1; }

base="$ROOT/.local/server-deploy-tests"
mkdir -p -- "$base"
base="$(realpath -- "$base")"
[[ "$base" == "$ROOT/.local/server-deploy-tests" ]] || { printf 'Fixture directory must remain inside the workspace.\n' >&2; exit 1; }
fixture="$(mktemp -d "$base/case.XXXXXX")"
started=false
COMPOSE=(docker compose --project-name narxpilot-server --project-directory "$fixture" --env-file "$fixture/.env" -f "$fixture/deploy/compose.yml")
dc() { "${COMPOSE[@]}" "$@"; }
cleanup() {
  local status=$? resolved id owner
  trap - EXIT INT TERM
  if "$started"; then
    if (( status != 0 )); then dc ps --all || true; dc logs --no-color --tail=30 web worker caddy || true; fi
    # The initial guard established that this project was absent. Additionally
    # refuse cleanup if another checkout has since created a project container.
    for id in $(docker ps -aq --filter label=com.docker.compose.project=narxpilot-server); do
      owner=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$id")
      if [[ "$owner" != "$fixture" ]]; then printf 'Refused cleanup of a container from another checkout.\n' >&2; exit 1; fi
    done
    dc down --volumes --remove-orphans --timeout 10 || status=1
  fi
  resolved="$(realpath -- "$fixture")"
  if [[ "$(dirname -- "$resolved")" == "$base" && "$(basename -- "$resolved")" == case.* ]]; then rm -rf -- "$resolved"; else printf 'Refused unsafe fixture cleanup.\n' >&2; status=1; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# No actual .env is opened. Preserve exact source bytes/modes used by the earlier
# restrictive-checkout image tests so Docker can reuse their build cache.
tar --directory "$ROOT" --exclude-vcs \
  --exclude='.env*' --exclude='.local' --exclude='.cache' --exclude='node_modules' \
  --exclude='.next' --exclude='.venv' --exclude='__pycache__' --exclude='.pytest_cache' \
  --exclude='*.log' --exclude='test-results' --exclude='playwright-report' \
  --create --file - . | tar --directory "$fixture" --extract --file -
cp -- "$ROOT/.env.example" "$fixture/.env.example"
[[ ! -e "$fixture/.env" ]] || { printf 'Secret exclusion failed.\n' >&2; exit 1; }
find "$fixture" -type d -exec chmod 0700 {} +
find "$fixture" -type f -exec chmod 0600 {} +

# Host configuration must not override the generated isolated fixture.
while IFS= read -r key; do unset "$key"; done < <(node --input-type=module - "$fixture/.env.example" <<'JS'
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
for(const key of [...Object.keys(parseEnv(readFileSync(process.argv[2],'utf8'))),'NARXPILOT_DOMAIN','DEPLOY_BASIC_USER','DEPLOY_BASIC_HASH','COMPOSE_FILE','COMPOSE_PROJECT_NAME','COMPOSE_ENV_FILES','COMPOSE_PROFILES']){
  if(!/^[A-Z][A-Z0-9_]*$/.test(key))throw new Error('Unexpected environment key');
  console.log(key);
}
JS
)
export COMPOSE_DISABLE_ENV_FILE=1
(cd -- "$fixture" && node deploy/configure.mjs --domain narxpilot.localhost)
docker run --rm --network none --mount "type=bind,source=$fixture/.local/deploy,target=/run/narxpilot,readonly" --entrypoint sh caddy:2.11.7-alpine -c 'caddy hash-password < /run/narxpilot/basic-auth-password' > "$fixture/.local/deploy/auth-hash"
(cd -- "$fixture" && node deploy/configure.mjs --domain narxpilot.localhost --finalize)
node --input-type=module - "$fixture" <<'JS'
import {readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
const root=process.argv[2],env=parseEnv(readFileSync(root+'/.env','utf8'));
if(env.BRO24_API_KEY||env.OPENAI_API_KEY||env.CHATBOT_ENABLED!=='false'||env.CHATBOT_PROVIDER!=='local'||env.LLM_PROVIDER!=='disabled')throw new Error('Only a fixture with disabled external providers is allowed');
const access=JSON.parse(readFileSync(root+'/.local/deploy/access.json','utf8'));
if(!/^[A-Za-z0-9_-]+$/.test(access.username)||!/^[A-Za-z0-9_-]+$/.test(access.password))throw new Error('Unexpected generated access format');
writeFileSync(root+'/.local/deploy/curl-auth.conf',`user = "${access.username}:${access.password}"\n`,{mode:0o600});
JS
[[ $(stat -c '%a' "$fixture/.env") == 600 ]] || { printf 'Fixture .env must remain private.\n' >&2; exit 1; }
dc config --quiet

# pty.fork gives the command a controlling terminal and foreground process group.
# Merely redirecting subprocess output to a PTY does not reproduce job control.
run_in_pty() {
  local log=$1 seconds=$2; shift 2
  python3 - "$log" "$seconds" "$@" <<'PY'
import errno,os,pty,select,signal,sys,time
log,seconds,command=sys.argv[1],int(sys.argv[2]),sys.argv[3:]
pid,master=pty.fork()
if pid==0:
    os.execvp(command[0],command)
deadline=time.monotonic()+seconds
timed_out=False
with open(log,'wb') as output:
    while True:
        if time.monotonic()>deadline:
            timed_out=True
            os.killpg(pid,signal.SIGKILL)
            break
        if not select.select([master],[],[],0.2)[0]:continue
        try:chunk=os.read(master,65536)
        except OSError as error:
            if error.errno==errno.EIO:break
            raise
        if not chunk:break
        output.write(chunk);output.flush()
        sys.stdout.buffer.write(chunk);sys.stdout.buffer.flush()
os.close(master)
_,status=os.waitpid(pid,0)
if timed_out:print('Controlling-PTY command exceeded its bounded deadline.',file=sys.stderr)
raise SystemExit(124 if timed_out else os.waitstatus_to_exitcode(status))
PY
}

started=true
# Diagnostic only: the old interactive default may stall under GNU timeout with
# a controlling terminal. Its exit status is evidence, not an assumed cause.
if run_in_pty "$fixture/.local/tty-old.log" 20 bash -c 'timeout 8 "$@"; code=$?; exit "$code"' bash "${COMPOSE[@]}" run --rm --no-deps -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then old_status=0; else old_status=$?; fi
printf 'Caddy validation with legacy interactive default under PTY: exit %s.\n' "$old_status"
run_in_pty "$fixture/.local/tty-redirected.log" 25 bash -c 'timeout 15 "$@" < /dev/null; code=$?; exit "$code"' bash "${COMPOSE[@]}" run --rm --no-deps -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
printf 'Caddy validation with legacy arguments and stdin redirected under PTY passed.\n'
run_in_pty "$fixture/.local/tty-fixed.log" 25 bash -c 'timeout 15 "$@" < /dev/null; code=$?; exit "$code"' bash "${COMPOSE[@]}" run --rm --no-deps --interactive=false -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
printf 'Caddy validation with explicit non-interactive stdin under PTY passed.\n'

run_in_pty "$fixture/.local/deploy-first.log" 900 bash "$fixture/deploy/control.sh" deploy
assert_healthy() {
  local service id
  for service in db web worker caddy; do
    id=$(dc ps --quiet "$service")
    [[ -n "$id" && $(docker inspect --format '{{.State.Status}}/{{.State.Health.Status}}' "$id") == running/healthy ]] || { printf 'Server service %s is not healthy.\n' "$service" >&2; exit 1; }
  done
}
database_counts() {
  dc exec -T db sh -ec 'exec psql -X --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -v ON_ERROR_STOP=1 -Atc "$1"' sh "SELECT json_build_object('origin',(SELECT data_origin FROM database_identity WHERE singleton),'migrations',(SELECT count(*) FROM schema_migrations),'events',(SELECT count(*) FROM business_events),'users',(SELECT count(*) FROM users))" </dev/null
}
assert_healthy
database_counts > "$fixture/.local/counts-first.json"
dc exec -T caddy cat /data/caddy/pki/authorities/local/root.crt > "$fixture/.local/caddy-root.crt" </dev/null
CURL=(curl --silent --show-error --max-time 20 --noproxy '*' --resolve narxpilot.localhost:443:127.0.0.1 --cacert "$fixture/.local/caddy-root.crt")
[[ $("${CURL[@]}" --output /dev/null --write-out '%{http_code}' https://narxpilot.localhost/api/health/ready) == 401 ]] || { printf 'Server must reject access without basic authentication.\n' >&2; exit 1; }
"${CURL[@]}" --fail --config "$fixture/.local/deploy/curl-auth.conf" https://narxpilot.localhost/api/health/ready > "$fixture/.local/ready.json"
"${CURL[@]}" --fail --config "$fixture/.local/deploy/curl-auth.conf" https://narxpilot.localhost/catalog > "$fixture/.local/catalog.html"
node --input-type=module - "$fixture" <<'JS'
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(process.argv[2]+'/.local/'+name,'utf8');
const ready=JSON.parse(read('ready.json')),counts=JSON.parse(read('counts-first.json'));
if(ready.status!=='ready'||ready.data_origin!=='synthetic'||counts.origin!=='synthetic'||counts.migrations<3||counts.events<1||counts.users<1)throw new Error('The real server did not migrate and seed its synthetic database');
if(!read('catalog.html').includes('NarxPilot'))throw new Error('Caddy did not serve the application page');
JS
printf 'Real server deploy passed: migrations, seed, four healthy services, trusted local HTTPS, basic auth 401/200 and catalog.\n'

[[ ! -d "$fixture/.local/backups" ]] || { printf 'An empty first deployment must not create a backup.\n' >&2; exit 1; }
run_in_pty "$fixture/.local/deploy-second.log" 900 bash "$fixture/deploy/control.sh" deploy
assert_healthy
database_counts > "$fixture/.local/counts-second.json"
node --input-type=module - "$fixture" <<'JS'
import {readFileSync,readdirSync,statSync} from 'node:fs';
const root=process.argv[2]+'/.local/',read=name=>readFileSync(root+name,'utf8');
if(read('counts-first.json')!==read('counts-second.json'))throw new Error('Repeat deployment changed seed/event counts');
const dumps=readdirSync(root+'backups').filter(name=>name.endsWith('.dump'));
if(dumps.length!==1||statSync(root+'backups/'+dumps[0]).size===0||readFileSync(root+'backups/'+dumps[0]).subarray(0,5).toString()!=='PGDMP')throw new Error('Repeat deployment must create one real PostgreSQL custom dump');
const log=read('deploy-second.log'),backup=log.indexOf('[backup-db]'),migration=log.indexOf('[migrate]');
if(backup<0||migration<backup)throw new Error('Backup must precede migration on repeat deploy');
JS
"${CURL[@]}" --fail --config "$fixture/.local/deploy/curl-auth.conf" https://narxpilot.localhost/api/health/ready >/dev/null
printf 'Repeat server deploy passed: verified pg_dump before migration, unchanged seed/events, healthy services and HTTPS.\n'
