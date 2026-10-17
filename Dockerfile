# ---------------------------------------------------------------------------
# Sonora Music — Imagen de producción para Render (Docker)
# Incluye FFmpeg + yt-dlp para convertir YouTube a MP3 (320 kbps)
# ---------------------------------------------------------------------------
FROM node:20-slim

# Herramientas de sistema: FFmpeg (conversión de audio), Python y curl (yt-dlp)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      curl \
      ca-certificates \
      build-essential \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) Dependencias del servidor (capa cacheada)
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# 2) Código del servidor + frontend web completo
COPY server/ ./server/
COPY public/ ./public/

ENV SERVER_MODE=render
ENV NODE_ENV=production

WORKDIR /app/server

# Render inyecta la variable PORT; el servidor la respeta.
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||10000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
