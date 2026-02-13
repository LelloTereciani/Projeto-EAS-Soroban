FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @eas/web build

FROM nginx:alpine
COPY apps/web/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html/EAS
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
