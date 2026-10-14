#!/bin/bash
set -euo pipefail
umask 077
MEL_PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MEL_RUNTIME="$MEL_PROJECT_ROOT/.whatsapp-local"
export MEL_WHATSAPP_BRIDGE_TOKEN="$(cat "$MEL_RUNTIME/state/bridge-token")"
case "${1:-}" in
  --pair) export MEL_WHATSAPP_PAIRING=1 ;;
  --simulate) export MEL_WHATSAPP_SIMULATION=1 ;;
  "") ;;
  *) echo "Uso: run-bridge.sh [--pair|--simulate]" >&2; exit 1 ;;
esac
cd "$MEL_RUNTIME/state"
exec "$MEL_RUNTIME/bin/whatsapp-bridge"
