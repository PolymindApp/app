FROM node:22-bookworm-slim

ARG CODEX_VERSION=0.147.0

RUN npm install --global "@openai/codex@${CODEX_VERSION}" \
    && mkdir -p /var/lib/polymind-codex \
    && chown node:node /var/lib/polymind-codex

WORKDIR /app
COPY --chown=node:node codex-bridge /app/codex-bridge

ENV HOST=0.0.0.0 \
    PORT=8091 \
    MOM_CODEX_EXECUTABLE=/usr/local/bin/codex \
    MOM_CODEX_BRIDGE_DATA=/var/lib/polymind-codex

USER node
EXPOSE 8091
VOLUME ["/var/lib/polymind-codex"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8091/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "codex-bridge/server.mjs"]
