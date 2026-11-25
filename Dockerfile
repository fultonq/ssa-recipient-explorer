# SSA Recipient Explorer: one image for the web UI + C++ server (ssa_server) + seeding tools.
#   docker compose up --build            (see compose.yaml)
#   docker build -t ssa-recipient-explorer .
#
# Behind a TLS-inspecting corporate proxy, pass its CA so npm can verify the registry:
#   docker build --secret id=corp_ca,src=/path/to/corp-ca.pem -t ssa-recipient-explorer .
# (HTTP_PROXY / HTTPS_PROXY build args are honoured automatically by Docker.)
ARG BASE=ubuntu:24.04

# ---------------------------------------------------------------- web UI (React + Vite)
FROM ${BASE} AS web
RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=secret,id=corp_ca,required=false \
    if [ -s /run/secrets/corp_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/corp_ca; fi; \
    npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---------------------------------------------------------------- C++ engine + server
FROM ${BASE} AS build
RUN apt-get update && apt-get install -y --no-install-recommends g++ cmake make libpq-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt ./
COPY engine/ engine/
COPY server/ server/
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
 && cmake --build build -j"$(nproc)" \
 && ctest --test-dir build --output-on-failure \
 && cmake --install build --prefix /opt/ssa

# ---------------------------------------------------------------- runtime
FROM ${BASE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 postgresql-client curl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin ssa
COPY --from=build /opt/ssa/bin/ /usr/local/bin/
COPY --from=web /src/web/dist/ /srv/web/
COPY db/ /opt/ssa/db/
ENV SSA_STATIC_DIR=/srv/web \
    SSA_PORT=8080 \
    SSA_EXPORT=/usr/local/bin/ssa_export
USER ssa
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=180s --retries=3 \
  CMD curl -fsS http://localhost:8080/api/health || exit 1
ENTRYPOINT ["ssa_server"]
