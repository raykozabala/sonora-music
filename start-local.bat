@echo off
REM ---------------------------------------------------------------------------
REM Sonora Music - Inicia el servidor LOCAL en tu PC (Windows)
REM ---------------------------------------------------------------------------
cd /d "%~dp0"

set PORT=3000
echo ======================================================
echo    SONORA MUSIC - Servidor Local
echo ======================================================

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  if not defined IP set "IP=%%a"
)
set IP=%IP: =%

echo  IP en la red: %IP%
echo  En esta PC  : http://localhost:%PORT%
echo  En el celular: http://%IP%:%PORT%
echo ======================================================

if not exist "server\node_modules" (
  echo Instalando dependencias...
  pushd server
  call npm install
  popd
)

set SERVER_MODE=local
cd server
node server.js
