FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
ENV NPM_CONFIG_ENGINE_STRICT=true
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
# This public URL is compiled into the browser bundle, not read by Nginx.
ARG VITE_API_BASE_URL=/backend
RUN VITE_API_BASE_URL="$VITE_API_BASE_URL" npm run build

FROM nginx/nginx-unprivileged:1.30.6-alpine-slim AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "-T", "3", "http://127.0.0.1:8080/"]
# No runtime env substitution: the static Nginx configuration needs no entrypoint scripts.
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
