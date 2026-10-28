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
      unzip \
      ca-certificates \
      build-essential \
    && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

# Deno: runtime de JavaScript que yt-dlp necesita para resolver los desafíos de
# YouTube (nsig / PO token). Sin él, YouTube no entrega ningún formato
# descargable y todo falla con "Requested format is not available".
# Es el runtime recomendado y se habilita solo (no hace falta --js-runtimes).
# El zipapp oficial de yt-dlp ya incluye los scripts yt-dlp-ejs.
RUN curl -fsSL https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip \
      -o /tmp/deno.zip \
    && unzip -o /tmp/deno.zip -d /usr/local/bin \
    && chmod +x /usr/local/bin/deno \
    && rm -f /tmp/deno.zip \
    && deno --version

# Carpeta de caché de Deno (evita escrituras fallidas en el home del contenedor)
ENV DENO_DIR=/tmp/deno-cache
ENV HOME=/tmp

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

# Northflank/Render inyectan PORT; el servidor la respeta.
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
