#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Sonora Music — Runner para arranque automático (launchd / servicio)
# Arranca el servidor local SIN abrir el navegador.
# ---------------------------------------------------------------------------
cd "$(dirname "$0")/server" || exit 1

# Asegura que node esté en el PATH aunque launchd arranque sin entorno
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"

export PORT="${PORT:-3000}"
export SERVER_MODE=local

echo "[$(date)] Iniciando Sonora Music Server en el puerto $PORT"
exec node server.js
