# syntax=docker/dockerfile:1

FROM node:22.23.4-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./

FROM base AS development-dependencies
RUN npm ci

FROM development-dependencies AS development
ENV NODE_ENV=development
COPY src ./src
USER node
EXPOSE 3000
CMD ["node", "src/api/server.js"]

FROM base AS production-dependencies
RUN npm ci --omit=dev

FROM base AS production
ENV NODE_ENV=production
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node src ./src
USER node
EXPOSE 3000
CMD ["node", "src/api/server.js"]
