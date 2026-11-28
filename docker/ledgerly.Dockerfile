# The Ledgerly demo (a Morph customer). Build from the repo root: docker build -f docker/ledgerly.Dockerfile .
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/sdk/package.json packages/sdk/
COPY packages/cli/package.json packages/cli/
COPY examples/ledgerly/package.json examples/ledgerly/
RUN npm ci -w ledgerly -w @morph/react -w @morph/shared -w @morph/cli --include-workspace-root=false
COPY packages/shared packages/shared
COPY packages/sdk packages/sdk
COPY examples/ledgerly examples/ledgerly
RUN npm run build -w ledgerly

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/examples/ledgerly
USER node
EXPOSE 8788
CMD ["npx", "tsx", "server/main.ts"]
