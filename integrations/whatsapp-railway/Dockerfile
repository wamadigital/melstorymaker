# Build context: isolated source_context.py output; never the working checkout.
ARG PYTHON_IMAGE=python:3.12.15-slim-bookworm
ARG GO_IMAGE=golang:1.27.2-bookworm
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.12.7

FROM ${UV_IMAGE} AS uv

FROM ${PYTHON_IMAGE} AS prepared
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=uv /uv /usr/local/bin/uv
COPY integrations/whatsapp-local/prepare.py integrations/whatsapp-local/compat.py integrations/whatsapp-local/local_server.go integrations/whatsapp-local/local_server_test.go integrations/whatsapp-local/local_activity.go integrations/whatsapp-local/local_activity_test.go /app/integrations/whatsapp-local/
COPY integrations/whatsapp-local/dependencies/ /app/integrations/whatsapp-local/dependencies/
COPY integrations/whatsapp-railway/prepare_build.py /app/integrations/whatsapp-railway/prepare_build.py
# The fixed upstream archive is checked before extraction; the approved local
# patches and dependency locks are then applied by the existing prepare.py.
RUN python /app/integrations/whatsapp-railway/prepare_build.py
WORKDIR /app/.whatsapp-local/app/whatsapp-mcp-server
RUN uv sync --frozen --no-dev --no-editable --python /usr/local/bin/python \
    && rm -rf /root/.cache/uv

FROM ${GO_IMAGE} AS bridge
ENV CGO_ENABLED=1 \
    GOTOOLCHAIN=local \
    GOFLAGS=-mod=readonly
WORKDIR /build
COPY --from=prepared /app/.whatsapp-local/app/whatsapp-bridge/ /build/
RUN mkdir -p /out \
    && go test ./... \
    && go build -trimpath -ldflags="-s -w" -o /out/whatsapp-bridge .

FROM ${PYTHON_IMAGE} AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.whatsapp-local/app/whatsapp-mcp-server/.venv/bin:$PATH" \
    GOMEMLIMIT=64MiB
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libsqlite3-0 tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/.whatsapp-local/bin \
    && ln -s /data/state /app/.whatsapp-local/state
COPY --from=bridge /out/whatsapp-bridge /app/.whatsapp-local/bin/whatsapp-bridge
COPY --from=prepared /app/.whatsapp-local/app/whatsapp-mcp-server/ /app/.whatsapp-local/app/whatsapp-mcp-server/
COPY integrations/whatsapp-local/worker.py integrations/whatsapp-local/run-mcp.sh integrations/whatsapp-local/run-bridge.sh integrations/whatsapp-local/run-worker.sh /app/integrations/whatsapp-local/
COPY integrations/whatsapp-railway/cloud.py /app/integrations/whatsapp-railway/cloud.py
# A single persistent Railway volume must be mounted at /data. Session state,
# tokens, interaction metadata and the deduplication ledger never enter the image.
# The bridge's REST API stays bound to loopback; only cloud.py may expose health.
CMD ["python", "/app/integrations/whatsapp-railway/cloud.py"]
