# Morph's service. Build from the repo root: docker build -f docker/service.Dockerfile .
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/service/package.json packages/service/
RUN npm ci -w @morph/service -w @morph/shared --include-workspace-root=false --omit=dev && npm cache clean --force
COPY packages/shared packages/shared
COPY packages/service packages/service
WORKDIR /app/packages/service
USER node
EXPOSE 8787
CMD ["npx", "tsx", "src/main.ts"]
