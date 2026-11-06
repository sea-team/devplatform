ARG NODE_BASE=node:22-bookworm-slim
FROM ${NODE_BASE}

# 平台运行 + 本地构建所需的基础工具链。
# Go / Rust / PHP 等建议使用 BUILD_EXECUTOR=docker 走各语言官方镜像，避免镜像体积膨胀。
RUN apt-get update && apt-get install -y --no-install-recommends \
      git openssh-client ca-certificates curl bash tar gzip make g++ \
      python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY public ./public

ENV PORT=9000 \
    WORKSPACE_DIR=/workspace \
    DATA_DIR=/app/data \
    NODE_ENV=production

RUN mkdir -p /app/data /workspace
EXPOSE 9000
CMD ["node", "src/server.js"]
