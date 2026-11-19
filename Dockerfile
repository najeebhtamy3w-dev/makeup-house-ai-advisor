# Backend + static web in one container (Node 22 built-in SQLite; no native deps).
# Reproducible: exact versions from package-lock.json (npm ci). Runs as the unprivileged "node" user.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 MH_DB_PATH=/data/makeup-house.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY web ./web
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
CMD ["node", "--no-warnings", "--import", "tsx", "server/src/server.ts"]
