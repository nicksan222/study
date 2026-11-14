# One image for Study development, the agent team, CI and releases.
# Trixie provides the glibc needed by the prebuilt onnxruntime.
FROM mcr.microsoft.com/devcontainers/rust:1-trixie

ARG GRAPHIFY_VERSION=0.9.73
ARG COZEMPIC_VERSION=1.8.39
# Cozempic's plugin starts its MCP server with uv.
ARG UV_VERSION=0.12.22

# Build, rendering, PDF and development tools, and the virtual desktop (`bun run desktop`).
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config clang lldb \
      libfontconfig-dev libwayland-dev libxkbcommon-x11-dev libx11-xcb-dev \
      libssl-dev libzstd-dev libvulkan1 libasound2-dev \
      libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
      dbus dbus-x11 libsoup-3.0-dev \
      mesa-vulkan-drivers vulkan-tools libgl1-mesa-dri libegl-mesa0 poppler-utils ffmpeg \
      ca-certificates curl git gh python3 python3-pip python3-venv \
      ripgrep fd-find shellcheck jq patchelf file libfuse2 minisign \
      sway grim wtype wlrctl wf-recorder wayvnc novnc websockify \
      chromium chromium-sandbox xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Install the same toolchain used by native development. The global config also
# makes Bun and cargo-deny available to container hooks outside the checkout.
COPY --from=ghcr.io/jdx/mise:2026.10.4 /usr/local/bin/mise /usr/local/bin/mise
ENV MISE_DATA_DIR=/opt/mise
ENV MISE_CONFIG_DIR=/etc/mise
ENV PATH=/home/vscode/.local/bin:/opt/mise/shims:$PATH
COPY mise.toml /etc/mise/config.toml
COPY rust-toolchain.toml /opt/study-toolchain/rust-toolchain.toml
RUN install -d -o vscode -g vscode /opt/mise
USER vscode
RUN cd /opt/study-toolchain \
    && mise trust \
    && mise install

RUN mkdir -p /home/vscode/.local/bin \
    && python3 -m venv /home/vscode/.local/share/agent-tools \
    && /home/vscode/.local/share/agent-tools/bin/pip install --no-cache-dir "graphifyy[sql]==${GRAPHIFY_VERSION}" cozempic==${COZEMPIC_VERSION} uv==${UV_VERSION} \
    && ln -s /home/vscode/.local/share/agent-tools/bin/graphify /home/vscode/.local/bin/graphify \
    && ln -s /home/vscode/.local/share/agent-tools/bin/cozempic /home/vscode/.local/bin/cozempic \
    && ln -s /home/vscode/.local/share/agent-tools/bin/uv /home/vscode/.local/bin/uv
USER root

ARG GH_VERSION=2.102.0
ARG HERDR_VERSION=0.9.3
ARG CLAUDE_VERSION=2.1.287
ARG CODEX_VERSION=0.159.3
ARG BASEDPYRIGHT_VERSION=1.40.0
ARG REVIEWR_VERSION=0.39.0

# The distro gh is too old for inline PR media (--attach). Pin the official package.
# Keep downloads checked for both supported container architectures.
RUN <<'SH'
set -eu
arch=$(dpkg --print-architecture)
case "$arch" in
  amd64) checksum=7e54a307f90afdc59796c325ec0c49fb09e6c18537727207a8ac7513584ea5b0 ;;
  arm64) checksum=5006962696f01e1624b3fcf1f9d8e1a11547f24bf067dd2a0371b7b421945237 ;;
  *) echo "Unsupported GitHub CLI architecture: $arch" >&2; exit 1 ;;
esac
curl -fsSL -o /tmp/gh.deb "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${arch}.deb"
printf '%s  /tmp/gh.deb\n' "$checksum" | sha256sum --check
dpkg -i /tmp/gh.deb
rm /tmp/gh.deb
gh pr create --help | grep -q -- --attach
SH

COPY tooling/scripts/devcontainer/install-patchelf.sh /usr/local/share/study/install-patchelf.sh
RUN bash /usr/local/share/study/install-patchelf.sh /usr/local
ENV PATCHELF=/usr/local/bin/patchelf

# Third-party CLI launchers use Bun even when their package shebang names Node.
RUN BUN_INSTALL=/usr/local bun add --global @openai/codex@${CODEX_VERSION} basedpyright@${BASEDPYRIGHT_VERSION} \
    && for tool in codex basedpyright basedpyright-langserver; do \
         entry=$(readlink -f "/usr/local/bin/$tool"); \
         rm "/usr/local/bin/$tool"; \
         printf '#!/bin/sh\nexec bun --bun "%s" "$@"\n' "$entry" > "/usr/local/bin/$tool"; \
         chmod +x "/usr/local/bin/$tool"; \
       done

USER vscode
ENV DISABLE_AUTOUPDATER=1
ENV COZEMPIC_NO_AUTO_UPDATE=1
ENV COZEMPIC_NO_GLOBAL_INIT=1
RUN curl -fsSL https://claude.ai/install.sh | bash -s -- ${CLAUDE_VERSION} \
    && case "$(uname -m)" in aarch64) arch=aarch64 ;; *) arch=x86_64 ;; esac \
    && curl -fsSL -o /home/vscode/.local/bin/herdr \
       "https://github.com/herdrdev/herdr/releases/download/v${HERDR_VERSION}/herdr-linux-${arch}" \
    && chmod +x /home/vscode/.local/bin/herdr \
    && herdr plugin install persiyanov/herdr-reviewr --ref v${REVIEWR_VERSION} --yes
USER root

# Stable font set shared by local browser captures and CI. Playwright itself comes from bun.lock.
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-liberation fonts-dejavu-core fonts-noto-color-emoji fonts-noto-cjk fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*
