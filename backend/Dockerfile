# syntax=docker/dockerfile:1
#
# Многостадийный build backend (Шаг 4, PRIORITY_PLAN.md). Контекст сборки —
# КОРЕНЬ репозитория, не backend/, потому что это npm workspaces монорепо с
# одним package-lock.json:
#
#   docker build -f backend/Dockerfile -t simple-dimple-backend .
#
# ВАЖНО: не собирался и не запускался ни разу в этой сессии — в dev-песочнице
# нет Docker (см. docs/CHANGELOG.md, Шаг 4). Нужен smoke-test build+run перед
# тем, как полагаться на этот образ в реальном деплое.
#
# Тот же образ используется и для API-процесса, и для route-reprobe worker'а
# (backend/src/worker.ts) — они делят runtime и генерируемый Prisma client,
# отличается только CMD при запуске контейнера, см. compose.yaml.

FROM node:22-alpine AS build
WORKDIR /app

# Сначала только manifests + lockfile — слой кешируется, пока зависимости не
# меняются, даже если меняется код.
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

COPY backend backend

# Тот же порядок шагов, что и в .github/workflows/ci.yml (Decision 019) —
# generate отдельным шагом, чтобы не гонять его дважды параллельно с чем-то
# ещё внутри одного слоя.
RUN npm run prisma:generate --workspace backend
RUN npm run build:ci --workspace backend

# Отдельный слой с только production-зависимостями — так `prisma` CLI,
# `typescript`, `vitest`, `tsx` и другие devDependencies backend'а не
# попадают в runtime-образ.
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/package.json ./backend/package.json

EXPOSE 8080

# По умолчанию — API-процесс. Для worker'а деплой-скрипт/compose переопределяет
# команду: `node backend/dist/worker.js`.
CMD ["node", "backend/dist/server.js"]
