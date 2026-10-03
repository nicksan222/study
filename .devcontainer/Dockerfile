# One image for Study development, the agent team, CI and releases.
# Trixie provides the glibc needed by the prebuilt onnxruntime.
FROM mcr.microsoft.com/devcontainers/rust:1-trixie

ARG JUST_VERSION=1.40.0
ARG CARGO_DENY_VERSION=0.20.2
ARG CARGO_PACKAGER_VERSION=0.11.8
ARG GRAPHIFY_VERSION=0.9.73
ARG COZEMPIC_VERSION=1.8.39
# Cozempic's plugin starts its MCP server with uv.
ARG UV_VERSION=0.12.22

# Build, rendering, PDF and development tools, and the virtual desktop (`just desktop`).
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config clang lldb \
      libfontconfig-dev libwayland-dev libxkbcommon-x11-dev libx11-xcb-dev \
      libssl-dev libzstd-dev libvulkan1 libasound2-dev \
      mesa-vulkan-drivers vulkan-tools libgl1-mesa-dri libegl-mesa0 poppler-utils ffmpeg \
      ca-certificates curl git gh python3 python3-pip python3-venv \
      ripgrep fd-find shellcheck jq patchelf file libfuse2 \
      sway grim wtype wlrctl wf-recorder wayvnc novnc websockify \
      chromium chromium-sandbox xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# just, and cargo-deny for `just check`.
RUN arch=$(uname -m) \
    && curl -fsSL "https://github.com/casey/just/releases/download/${JUST_VERSION}/just-${JUST_VERSION}-${arch}-unknown-linux-musl.tar.gz" \
       | tar -xz -C /usr/local/bin just \
    && curl -fsSL "https://github.com/EmbarkStudios/cargo-deny/releases/download/${CARGO_DENY_VERSION}/cargo-deny-${CARGO_DENY_VERSION}-${arch}-unknown-linux-musl.tar.gz" \
       | tar -xz -C /usr/local/bin --strip-components=1 "cargo-deny-${CARGO_DENY_VERSION}-${arch}-unknown-linux-musl/cargo-deny"

USER vscode
ENV PATH=/home/vscode/.local/bin:$PATH
RUN rustup component add clippy rustfmt rust-src rust-analyzer \
    && cargo install cargo-packager --version ${CARGO_PACKAGER_VERSION} --locked
RUN mkdir -p /home/vscode/.local/bin \
    && python3 -m venv /home/vscode/.local/share/agent-tools \
    && /home/vscode/.local/share/agent-tools/bin/pip install --no-cache-dir "graphifyy[sql]==${GRAPHIFY_VERSION}" cozempic==${COZEMPIC_VERSION} uv==${UV_VERSION} \
    && ln -s /home/vscode/.local/share/agent-tools/bin/graphify /home/vscode/.local/bin/graphify \
    && ln -s /home/vscode/.local/share/agent-tools/bin/cozempic /home/vscode/.local/bin/cozempic \
    && ln -s /home/vscode/.local/share/agent-tools/bin/uv /home/vscode/.local/bin/uv
USER root

ARG GH_VERSION=2.102.0
ARG NODE_VERSION=22.23.3
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

# Node for the npm-installed agents.
RUN case "$(uname -m)" in aarch64) node_arch=arm64 ;; *) node_arch=x64 ;; esac \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
       | tar -xJ -C /usr/local --strip-components=1 \
    && npm install --global @openai/codex@${CODEX_VERSION} basedpyright@${BASEDPYRIGHT_VERSION}

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
