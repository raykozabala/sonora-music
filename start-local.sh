#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Sonora Music — Inicia el servidor LOCAL en tu computadora (Mac/Linux)
# Deja el servidor accesible en tu WiFi para que la app Android se conecte.
# ---------------------------------------------------------------------------
set -e
cd "$(dirname "$0")"

PORT="${PORT:-3000}"
# Detecta la IP local (WiFi/Ethernet)
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo 127.0.0.1)"

echo "======================================================"
echo "🎵  SONORA MUSIC — Servidor Local"
echo "======================================================"
echo "💻  Computadora : $(hostname)"
echo "📡  IP en la red: $IP"
echo "🔌  Puerto      : $PORT"
echo "------------------------------------------------------"
echo "🔗  En esta compu   : http://localhost:$PORT"
echo "📱  En el celular   : http://$IP:$PORT"
echo "📥  Descargar la app: http://$IP:$PORT/SonoraMusic_v7_4.apk"
echo "======================================================"
echo ""

# Instala dependencias la primera vez
if [ ! -d "server/node_modules" ]; then
  echo "📦 Instalando dependencias (solo la primera vez)..."
  (cd server && npm install)
fi

# Abre el navegador (opcional, comenta si no lo quieres)
if command -v open >/dev/null 2>&1; then
  (sleep 2 && open "http://localhost:$PORT") >/dev/null 2>&1 || true
fi

export PORT SERVER_MODE=local
cd server
echo "▶️  Servidor iniciado. Pulsa Ctrl+C para detenerlo."
exec node server.js
