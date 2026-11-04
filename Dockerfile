# syntax=docker/dockerfile:1

# The build only produces static files, which are identical on every CPU, so it runs
# natively on the build machine. Only the tiny runtime stage is per-platform, which
# keeps multi-arch CI builds from crawling through arm64 emulation.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# The server has zero dependencies, so the runtime image is just Node + the built app. The
# groups live in one SQLite file on the /data volume (node:sqlite), deleted 30 days after each party.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 TZ=Europe/Berlin WICHTLE_DATA=/data
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY vendor/ewo/elements/config-server.js vendor/ewo/elements/config-core.js ./vendor/ewo/elements/
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8080
# Every ~14 minutes at Wichtle's own slot, so no two containers line up (plans/nas-load.md).
# Shell form so $PORT expands: the NAS stack runs on a different port than the default.
HEALTHCHECK --interval=845s --timeout=10s --start-period=60s --retries=3 CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "server/server.mjs"]
