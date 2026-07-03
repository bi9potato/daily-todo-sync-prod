FROM node:22-alpine AS build

WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
# The root manifest declares a pnpm patch for a mobile-only dependency. This
# filtered install never adds that package, and pnpm hard-fails on patches
# that are declared but not applied - so strip the declaration inside the
# web image. Mobile CI still installs the package and enforces the patch.
RUN node -e "const fs=require('fs');const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));if(pkg.pnpm)delete pkg.pnpm.patchedDependencies;fs.writeFileSync('package.json',JSON.stringify(pkg,null,2));"
RUN corepack enable && pnpm install --filter @daily-todo-sync/web --frozen-lockfile=false

COPY apps/web apps/web
RUN pnpm --filter @daily-todo-sync/web build

FROM nginx:1.27-alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
