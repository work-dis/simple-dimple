# syntax=docker/dockerfile:1
#
# Multi-stage build frontend (Шаг 4, PRIORITY_PLAN.md). Контекст сборки —
# КОРЕНЬ репозитория (npm workspaces монорепо):
#
#   docker build -f frontend/Dockerfile -t simple-dimple-frontend .
#
# Раздача статики — nginx, `/api` и `/health` реверс-проксируются на backend
# (см. deploy/nginx/frontend.conf) — тот же прокси-контракт, что и dev-proxy
# в frontend/vite.config.ts, просто через nginx вместо Vite dev server.
#
# ВАЖНО: не собирался и не запускался ни разу в этой сессии — в dev-песочнице
# нет Docker (см. docs/CHANGELOG.md, Шаг 4). Нужен smoke-test перед реальным
# деплоем.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY frontend frontend
RUN npm run build --workspace frontend

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY deploy/nginx/frontend.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
