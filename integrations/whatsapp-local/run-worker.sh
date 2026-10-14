#!/bin/bash
set -euo pipefail
umask 077
MEL_PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$MEL_PROJECT_ROOT"
exec .whatsapp-local/app/whatsapp-mcp-server/.venv/bin/python integrations/whatsapp-local/worker.py "$@"
