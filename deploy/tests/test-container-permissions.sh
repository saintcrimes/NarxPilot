#!/usr/bin/env bash
# Linux regression for the installer's umask 077: COPY retains 0600/0700 modes.
# No source .env is read, copied or passed into the test containers.
set -Eeuo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
mode="${1:-all}"
if [[ "$mode" == --help ]]; then
  printf 'Usage: bash deploy/tests/test-container-permissions.sh [web|worker|all]\n'
  printf 'Linux + Docker required. Builds restrictive-context images and tests their non-root runtime.\n'
  exit 0
fi
[[ $# -le 1 && "$mode" =~ ^(web|worker|all)$ ]] || { printf 'Expected web, worker or all.\n' >&2; exit 1; }
[[ $(uname -s) == Linux ]] || { printf 'This Docker regression requires Linux; no host files changed.\n' >&2; exit 1; }
for executable in docker tar find stat realpath timeout; do command -v "$executable" >/dev/null || { printf 'Missing executable: %s\n' "$executable" >&2; exit 1; }; done
[[ -s "$ROOT/package-lock.json" ]] || { printf 'A committed package-lock.json is required.\n' >&2; exit 1; }
docker info >/dev/null

base="$ROOT/.local/container-permissions"
mkdir -p -- "$base"
base="$(realpath -- "$base")"
[[ "$base" == "$ROOT/.local/container-permissions" ]] || { printf 'Fixture base must stay inside the workspace without symlinks.\n' >&2; exit 1; }
context="$(mktemp -d "$base/case.XXXXXX")"
web_container=''
cleanup() {
  local status=$? resolved
  if [[ -n "$web_container" ]]; then docker rm --force "$web_container" >/dev/null 2>&1 || true; fi
  resolved="$(realpath -- "$context")"
  if [[ "$(dirname -- "$resolved")" == "$base" && "$(basename -- "$resolved")" == case.* ]]; then
    rm -rf -- "$resolved"
  else
    printf 'Refused unsafe fixture cleanup.\n' >&2
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT

# GNU tar evaluates exclusions before opening file contents. .env.example is safe,
# intentionally copied separately; real .env and .env.* are excluded at any depth.
tar --directory "$ROOT" --exclude-vcs \
  --exclude='.env*' --exclude='.local' --exclude='.cache' --exclude='node_modules' \
  --exclude='.next' --exclude='.venv' --exclude='__pycache__' --exclude='.pytest_cache' \
  --exclude='*.log' --exclude='test-results' --exclude='playwright-report' \
  --create --file - . | tar --directory "$context" --extract --file -
cp -- "$ROOT/.env.example" "$context/.env.example"
[[ ! -e "$context/.env" ]] || { printf 'Secret exclusion failed.\n' >&2; exit 1; }
find "$context" -type d -exec chmod 0700 {} +
find "$context" -type f -exec chmod 0600 {} +
[[ $(stat -c '%a' "$context/package.json") == 600 && $(stat -c '%a' "$context/scripts") == 700 && $(stat -c '%a' "$context/worker/main.py") == 600 && $(stat -c '%a' "$context/worker") == 700 ]] || { printf 'Restrictive checkout fixture was not created.\n' >&2; exit 1; }

if [[ "$mode" == web || "$mode" == all ]]; then
  # Old Dockerfile copies these files as root:root and npm fails with EACCES.
  timeout 1200 docker build --tag narxpilot-web:ci --file "$context/Dockerfile" "$context"
  docker run --rm --network none --entrypoint sh narxpilot-web:ci -ec '
    [ "$(id -u)" -ne 0 ]
    node -e '\''const fs=require("node:fs"); for (const p of ["package.json","package-lock.json","scripts/migrate.ts","scripts/grants.ts","scripts/seed.ts","db/migrations/001_core.sql","src/server/config.ts"]) fs.accessSync(p,fs.constants.R_OK); console.log("Non-root web UID:",process.getuid());'\''
    npm run test:unit
  '
  web_container="narxpilot-permissions-$(basename -- "$context" | tr '[:upper:]' '[:lower:]')"
  docker run --detach --rm --network none --name "$web_container" narxpilot-web:ci >/dev/null
  ready=false
  for attempt in {1..30}; do
    if docker exec "$web_container" node -e 'if(process.getuid()===0)process.exit(2);fetch("http://127.0.0.1:3000/api/health/live").then(async r=>{if(!r.ok||(await r.json()).status!=="ok")process.exit(1)}).catch(()=>process.exit(1))' >/dev/null 2>&1; then ready=true; break; fi
    sleep 1
  done
  if ! "$ready"; then docker logs --tail 60 "$web_container" >&2; printf 'Restrictive-context web did not become live.\n' >&2; exit 1; fi
  docker rm --force "$web_container" >/dev/null; web_container=''
  printf 'Non-root web startup/unit checks passed with source modes 0600/0700.\n'
fi

if [[ "$mode" == worker || "$mode" == all ]]; then
  timeout 600 docker build --tag narxpilot-worker:ci --file "$context/worker/Dockerfile" "$context"
  docker run --rm --network none --entrypoint sh narxpilot-worker:ci -ec '
    [ "$(id -u)" -ne 0 ]
    python -c '\''import os; assert os.getuid() != 0; import worker.main; print("Non-root worker UID:", os.getuid())'\''
    python -m unittest discover -s worker/tests -p test_analytics.py -v
  '
  printf 'Non-root worker import/unit checks passed with source modes 0600/0700.\n'
fi
