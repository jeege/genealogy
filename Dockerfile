# 前端用 Vite 构建为静态 SPA，随后嵌入 Go 二进制；最终镜像只包含一个可执行文件。
FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM golang:1.24-bookworm AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
COPY --from=web /app/dist ./internal/web/dist
RUN mkdir -p /out && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/genealogy-server ./cmd/server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata \
  && addgroup -S genealogy \
  && adduser -S -G genealogy genealogy
COPY --from=build /out/genealogy-server /usr/local/bin/genealogy-server
USER genealogy
ENV API_HOST=0.0.0.0 API_PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["genealogy-server", "healthcheck"]
ENTRYPOINT ["genealogy-server", "serve"]
