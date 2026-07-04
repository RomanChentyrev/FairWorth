FROM node:20-alpine AS dependencies
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app/server
RUN apk add --no-cache curl && addgroup -S fairworth && adduser -S fairworth -G fairworth
COPY --from=dependencies /app/server/node_modules ./node_modules
COPY --chown=fairworth:fairworth server/ ./
USER fairworth
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://127.0.0.1:3001/api/ready || exit 1
CMD ["node", "index.js"]
