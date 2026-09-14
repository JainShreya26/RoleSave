FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY spikes/mhtml-capture/package.json ./spikes/mhtml-capture/package.json

RUN corepack enable \
  && pnpm install --frozen-lockfile --filter @rolesave/mhtml-capture-spike... \
  && browser_path="$(find /ms-playwright -type f -name chrome | head -n 1)" \
  && test -n "$browser_path" \
  && ln -s "$browser_path" /usr/local/bin/rolesave-chromium

COPY spikes/mhtml-capture/scripts/convert.mjs ./spikes/mhtml-capture/scripts/convert.mjs

ENV HOME=/tmp \
  MHTML_CHROME_PATH=/usr/local/bin/rolesave-chromium \
  MHTML_CONTAINERIZED=1 \
  NODE_ENV=production

USER pwuser
ENTRYPOINT ["node", "/workspace/spikes/mhtml-capture/scripts/convert.mjs"]
