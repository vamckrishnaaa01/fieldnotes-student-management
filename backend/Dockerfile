FROM node:26-bookworm-slim AS dependencies
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev

FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --chown=node:node backend/package*.json ./backend/
COPY --chown=node:node backend/src ./backend/src
COPY --chown=node:node backend/migrations ./backend/migrations
COPY --chown=node:node *.html *.css *.js *.md ./
USER node
WORKDIR /app/backend
EXPOSE 3000
CMD ["node", "src/server.js"]

