# Local CI image: the Linux lanes of `npm run ci:local` run inside it on Docker Desktop or a Linux
# Docker Engine. It mirrors the GitHub ubuntu-24.04 lanes: Node.js from the same pinned archive that
# release packages ship, rpm/postgresql for native packaging, Playwright Chromium for the browser
# gate and systemd for the disposable service-install lane. Nothing here is a production image.
FROM ubuntu:24.04@sha256:008173c23f95b170204355c12626cb5a965d779a7e1283b09e9cffbb1bf33ca3

ARG NODE_SHA256
ARG POWERSHELL_SHA256
ARG PLAYWRIGHT_VERSION
ENV DEBIAN_FRONTEND=noninteractive \
    container=docker \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright \
    ARKVORY_CI_IMAGE=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git git-lfs sudo systemd systemd-sysv dbus rpm postgresql xz-utils procps \
      iproute2 docker.io libicu74 \
 && rm -rf /var/lib/apt/lists/*

# The archive is downloaded and hash-checked by scripts/native-dependencies.mjs on the host;
# the build verifies it again so a stale build context cannot substitute another runtime.
COPY node.tar.xz /tmp/node.tar.xz
RUN test -n "${NODE_SHA256}" \
 && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
 && rm /tmp/node.tar.xz \
 && node --version

# PowerShell 7 as on GitHub ubuntu runners: deployment gates parse install.ps1 on Linux too.
COPY powershell.tar.gz /tmp/powershell.tar.gz
RUN test -n "${POWERSHELL_SHA256}" \
 && echo "${POWERSHELL_SHA256}  /tmp/powershell.tar.gz" | sha256sum -c - \
 && mkdir -p /opt/microsoft/powershell/7 \
 && tar -xzf /tmp/powershell.tar.gz -C /opt/microsoft/powershell/7 \
 && chmod +x /opt/microsoft/powershell/7/pwsh \
 && ln -s /opt/microsoft/powershell/7/pwsh /usr/local/bin/pwsh \
 && rm /tmp/powershell.tar.gz \
 && pwsh -NoLogo -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'

RUN test -n "${PLAYWRIGHT_VERSION}" \
 && npx --yes "playwright@${PLAYWRIGHT_VERSION}" install --with-deps chromium \
 && chmod -R a+rX /opt/ms-playwright \
 && rm -rf /root/.npm /var/lib/apt/lists/*

# Tests call sudo for package installs and systemd units, exactly as on GitHub runners. The
# container's own Docker daemon stays masked: sibling containers use the host engine socket.
RUN useradd --create-home --shell /bin/bash runner \
 && echo 'runner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/runner \
 && chmod 0440 /etc/sudoers.d/runner \
 && systemctl mask docker.service docker.socket containerd.service getty@tty1.service \
 && systemctl set-default multi-user.target

WORKDIR /home/runner
STOPSIGNAL SIGRTMIN+3
CMD ["sleep", "infinity"]
