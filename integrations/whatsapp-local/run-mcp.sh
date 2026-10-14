#!/bin/bash
set -euo pipefail
umask 077
MEL_PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MEL_RUNTIME="$MEL_PROJECT_ROOT/.whatsapp-local"
export MEL_WHATSAPP_BRIDGE_TOKEN="$(cat "$MEL_RUNTIME/state/bridge-token")"
cd "$MEL_RUNTIME/app/whatsapp-mcp-server"
exec .venv/bin/python main.py
