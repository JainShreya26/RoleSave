FROM mcr.microsoft.com/playwright:v1.65.1-noble

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/converter/package.json ./apps/converter/package.json

RUN corepack enable \
  && pnpm install --frozen-lockfile --prod --filter @rolesave/converter... \
  && browser_path="$(find /ms-playwright -type f -name chrome | head -n 1)" \
  && test -n "$browser_path" \
  && ln -s "$browser_path" /usr/local/bin/rolesave-chromium

COPY apps/converter/src/convert.mjs ./apps/converter/src/convert.mjs

ENV HOME=/tmp \
  MHTML_CHROME_PATH=/usr/local/bin/rolesave-chromium \
  MHTML_CONTAINERIZED=1 \
  NODE_ENV=production

USER pwuser
ENTRYPOINT ["node", "/workspace/apps/converter/src/convert.mjs"]
