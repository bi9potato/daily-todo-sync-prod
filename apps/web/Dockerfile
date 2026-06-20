FROM node:22-alpine AS build

WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN corepack enable && pnpm install --filter @daily-todo-sync/web --frozen-lockfile=false

COPY apps/web apps/web
RUN pnpm --filter @daily-todo-sync/web build

FROM nginx:1.27-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
