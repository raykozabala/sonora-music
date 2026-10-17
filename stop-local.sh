#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Sonora Music — Detiene el servidor local (libera el puerto 3000)
# ---------------------------------------------------------------------------
PORT="${PORT:-3000}"
PIDS="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"

if [ -z "$PIDS" ]; then
  echo "ℹ️  No hay ningún servidor Sonora corriendo en el puerto $PORT."
  exit 0
fi

echo "🛑 Deteniendo servidor en el puerto $PORT (PID: $PIDS)..."
kill $PIDS 2>/dev/null || true
sleep 1

if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
  echo "⚠️  Aún sigue activo, forzando cierre..."
  kill -9 $(lsof -ti tcp:"$PORT") 2>/dev/null || true
fi

echo "✅ Servidor detenido."
