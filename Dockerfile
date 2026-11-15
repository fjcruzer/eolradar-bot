# Self-hosted EOL Radar bot. The runtime image has Node.js and the bundled
# server. It does not include Wrangler or any Cloudflare package.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY scripts/build-node.mjs ./scripts/build-node.mjs
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    HOME=/tmp \
    STORE=memory \
    DIGEST_CRON="0 14 * * MON"
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
LABEL org.opencontainers.image.source="https://github.com/fjcruzer/eolradar-bot" \
      org.opencontainers.image.title="eolradar-bot" \
      org.opencontainers.image.description="Self-hosted EOL Radar Slack bot" \
      org.opencontainers.image.licenses="MIT"
