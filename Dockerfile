# Backend + static web in one container (Node 22 built-in SQLite; no native deps).
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 MH_DB_PATH=/data/makeup-house.db
COPY package.json ./
RUN npm install --omit=dev && npm install tsx
COPY server ./server
COPY web ./web
VOLUME /data
EXPOSE 8080
CMD ["node", "--no-warnings", "--import", "tsx", "server/src/server.ts"]
