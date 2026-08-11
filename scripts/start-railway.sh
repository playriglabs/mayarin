#!/usr/bin/env bash
set -euo pipefail

case "${RAILWAY_SERVICE_NAME:-}" in
  core-api)
    exec bun run --cwd apps/api start
    ;;
  dashboard-api)
    exec bun run --cwd apps/dashboard-api start
    ;;
  chain-worker)
    exec bun run --cwd apps/api start:worker
    ;;
  *)
    echo "Unsupported Railway service: ${RAILWAY_SERVICE_NAME:-<unset>}" >&2
    exit 1
    ;;
esac
