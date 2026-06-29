# syntax=docker/dockerfile:1

# ---------- builder: install + compile native deps (better-sqlite3) ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Build tools needed to compile better-sqlite3 if no prebuilt binary matches
# the target architecture (covers both x86_64 and ARM Synology models).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# ---------- runner: slim runtime image ----------
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    PORT=8092 \
    DATA_DIR=/app/data \
    LOG_DIR=/app/data/logs
WORKDIR /app

# tini = proper PID 1 so SIGTERM from Portainer triggers a clean shutdown.
# python3 + yt-dlp = reliable TikTok new-video detection. The plain `yt-dlp`
# release asset is an arch-independent Python zipapp, so this works on both
# x86_64 and ARM Synology models without per-arch handling.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates python3 curl \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && /usr/local/bin/yt-dlp --version \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public

# Data directory for the SQLite database + rotating log files.
RUN mkdir -p /app/data/logs

EXPOSE 8092

# Container-level health probe (also declared in docker-compose.yml).
HEALTHCHECK --interval=30s --timeout=8s --start-period=25s --retries=3 \
    CMD node src/healthcheck.js

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.js"]
