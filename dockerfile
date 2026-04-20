FROM node:trixie-slim AS base

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

FROM base AS node-deps

COPY package.json ./
RUN npm install --no-audit --no-fund

FROM base AS python-deps

COPY requirements.txt ./
RUN pip3 install --break-system-packages -r requirements.txt

FROM base AS builder

ENV NODE_ENV=production

COPY --from=node-deps /app/node_modules ./node_modules
COPY . .
RUN npm run build \
    && npm prune --omit=dev

FROM base AS runner

ENV NODE_ENV=production \
    PORT=3000 \
    BACKEND_PORT=8000

COPY --from=python-deps /usr/local /usr/local
COPY --from=builder /app ./
RUN chmod +x /app/start.sh

EXPOSE 3000

CMD ["sh", "./start.sh"]
