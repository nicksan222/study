FROM debian:trixie-slim AS integration-base
COPY --from=oven/bun:1.4.2 /usr/local/bin/bun /usr/local/bin/bun
RUN useradd --create-home --uid 1000 bun

# This image is private test infrastructure; no host desktop or user vault is mounted.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl dbus-x11 xvfb xauth zlib1g-dev \
    libgtk-3-0t64 libnss3 libasound2t64 libgbm1 libdrm2 libxss1 \
    libatk-bridge2.0-0t64 libcups2t64 libx11-xcb1 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

FROM integration-base AS integration-obsidian
ARG OBSIDIAN_VERSION=1.15.0
RUN architecture="$(dpkg --print-architecture)"; \
    case "$architecture" in \
      arm64) asset="Obsidian-${OBSIDIAN_VERSION}-arm64.AppImage"; digest="fb350986a6083f1a26330c297ba2bef8191d60f00f982d4b420c821aceaf04f5" ;; \
      amd64) asset="Obsidian-${OBSIDIAN_VERSION}.AppImage"; digest="1dd8cfb593deaa644101bdb4df65b159ed7985993b6572dd25fd1363459e91cc" ;; \
      *) exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/obsidianmd/obsidian-releases/releases/download/v${OBSIDIAN_VERSION}/${asset}" -o /tmp/obsidian.AppImage \
    && echo "$digest  /tmp/obsidian.AppImage" | sha256sum --check - \
    && chmod +x /tmp/obsidian.AppImage \
    && cd /opt && /tmp/obsidian.AppImage --appimage-extract >/dev/null \
    && mv squashfs-root obsidian && chmod -R a+rX /opt/obsidian && rm /tmp/obsidian.AppImage

FROM integration-base AS integrations
COPY --from=integration-obsidian /opt/obsidian /opt/obsidian

RUN mkdir /workspace && chown bun:bun /workspace
WORKDIR /workspace
COPY --chown=bun:bun package.json bun.lock ./
COPY --chown=bun:bun apps/server/package.json apps/server/package.json
COPY --chown=bun:bun apps/web/package.json apps/web/package.json
COPY --chown=bun:bun apps/desktop/package.json apps/desktop/package.json
COPY --chown=bun:bun packages/contracts/package.json packages/contracts/package.json
COPY --chown=bun:bun packages/db/package.json packages/db/package.json
COPY --chown=bun:bun packages/integrations/package.json packages/integrations/package.json
COPY --chown=bun:bun packages/localization/package.json packages/localization/package.json
COPY --chown=bun:bun packages/testing/package.json packages/testing/package.json
COPY --chown=bun:bun packages/theme/package.json packages/theme/package.json
COPY --chown=bun:bun packages/ui/package.json packages/ui/package.json
COPY --chown=bun:bun tooling/package.json tooling/package.json
USER bun
ENV ONNXRUNTIME_NODE_INSTALL=skip
RUN bun install --frozen-lockfile --ignore-scripts
COPY --chown=bun:bun . .
CMD ["sleep", "infinity"]
