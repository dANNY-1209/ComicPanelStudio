# Comic Panel Studio — 線上版（雲端專案 + 多人即時編輯）
# 單機版不需要這個：直接開 index.html 即可。
FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev && npm cache clean --force
COPY index.html cloud.html LICENSE ./
COPY js js
COPY css css
COPY assets assets
COPY server/server.js server/
ENV NODE_ENV=production PORT=3003 CPS_DATA=/data
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3003/api/health >/dev/null || exit 1
CMD ["node", "server/server.js"]
