#!/bin/bash
# Instalação reprodutível, privada ao projeto; nenhum pareamento ou envio.
set -euo pipefail
umask 077
MEL_PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$MEL_PROJECT_ROOT"
MEL_RUNTIME="$MEL_PROJECT_ROOT/.whatsapp-local"
mkdir -p "$MEL_RUNTIME/downloads" "$MEL_RUNTIME/toolchain" "$MEL_RUNTIME/cache" "$MEL_RUNTIME/state" "$MEL_RUNTIME/bin"
chmod 700 "$MEL_RUNTIME" "$MEL_RUNTIME/state"
if [[ ! -f "$MEL_RUNTIME/downloads/upstream.tar.gz" ]]; then
  curl --fail --location --silent --show-error --max-time 180 \
    https://codeload.github.com/lharries/whatsapp-mcp/tar.gz/7d6a06dcdce1f01dfb24f60e1030d5efba9f3b88 \
    --output "$MEL_RUNTIME/downloads/upstream.tar.gz"
fi
printf '%s\n' 'ade0361916ed9f3ab4251537808e9c47f2916b202019f58e6bf1c9dea704755a  .whatsapp-local/downloads/upstream.tar.gz' | shasum -a 256 -c -
if [[ ! -d "$MEL_RUNTIME/upstream" ]]; then
  tar -xzf "$MEL_RUNTIME/downloads/upstream.tar.gz" -C "$MEL_RUNTIME"
  mv "$MEL_RUNTIME/whatsapp-mcp-7d6a06dcdce1f01dfb24f60e1030d5efba9f3b88" "$MEL_RUNTIME/upstream"
fi
if [[ ! -f "$MEL_RUNTIME/downloads/go.tar.gz" ]]; then
  curl --fail --location --silent --show-error --max-time 180 \
    https://go.dev/dl/go1.27.2.darwin-arm64.tar.gz --output "$MEL_RUNTIME/downloads/go.tar.gz"
fi
printf '%s\n' '76812b213b1b2302c978d28fa52fa92d541704b9e7d9d5db8002c50e4018c4c5  .whatsapp-local/downloads/go.tar.gz' | shasum -a 256 -c -
if [[ ! -x "$MEL_RUNTIME/toolchain/go/bin/go" ]]; then
  tar -xzf "$MEL_RUNTIME/downloads/go.tar.gz" -C "$MEL_RUNTIME/toolchain"
fi
if [[ ! -d "$MEL_RUNTIME/app" ]]; then
  python3 integrations/whatsapp-local/prepare.py
fi
# Existência não comprova preparo completo: sempre conferir antes de compilar.
python3 integrations/whatsapp-local/prepare.py --verify "$MEL_RUNTIME/app"
export GOTOOLCHAIN=local
export GOPATH="$MEL_RUNTIME/cache/go-path"
export GOCACHE="$MEL_RUNTIME/cache/go-build"
export UV_CACHE_DIR="$MEL_RUNTIME/cache/uv"
export UV_PYTHON_INSTALL_DIR="$MEL_RUNTIME/toolchain/python"
cd "$MEL_RUNTIME/app/whatsapp-bridge"
"$MEL_RUNTIME/toolchain/go/bin/go" test ./...
"$MEL_RUNTIME/toolchain/go/bin/go" build -o "$MEL_RUNTIME/bin/whatsapp-bridge" .
cd "$MEL_RUNTIME/app/whatsapp-mcp-server"
uv sync --frozen --python 3.12
echo "Instalação local concluída; pareamento e automações ainda não ativados."
