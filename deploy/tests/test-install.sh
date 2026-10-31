#!/usr/bin/env bash
set -Eeuo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
script="$root/deploy/install.sh"
bash -n "$script"
bash "$script" --help >/dev/null
bash "$script" --dry-run | grep -Fq 'narxpilot.software-engineer.online'
bash "$script" --dry-run --domain EXAMPLE.COM --dir /srv/narxpilot --ref release/v1 | grep -Fq 'https://example.com'
checks=4
for invalid_domain in 'https://example.com' 'example.com:443' 'example..com' '-example.com' 'example.com/' 'example.com.'; do
  if bash "$script" --dry-run --domain "$invalid_domain" >/dev/null 2>&1; then printf 'Unexpected domain acceptance: %s\n' "$invalid_domain" >&2; exit 1; fi
  checks=$((checks+1))
done
for invalid_path in '/' '/opt' '/etc' '/srv/../etc' '/srv/example:bad' 'relative/path'; do
  if bash "$script" --dry-run --dir "$invalid_path" >/dev/null 2>&1; then printf 'Unexpected directory acceptance: %s\n' "$invalid_path" >&2; exit 1; fi
  checks=$((checks+1))
done
for invalid_ref in '-main' '../main' 'main~1' 'main;exit'; do
  if bash "$script" --dry-run --ref "$invalid_ref" >/dev/null 2>&1; then printf 'Unexpected revision acceptance: %s\n' "$invalid_ref" >&2; exit 1; fi
  checks=$((checks+1))
done
if bash "$script" --domain >/dev/null 2>&1; then printf 'Missing argument accepted\n' >&2; exit 1; fi
checks=$((checks+1))
printf '%s installer argument/syntax checks passed; no host/network changes.\n' "$checks"
