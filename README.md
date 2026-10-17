# 🎵 Sonora Music v7.6

Reproductor de música para Android + aplicación web **PWA**, con un servidor
**dual** (tu computadora en la misma WiFi **o** la nube en Render).

> Descarga canciones y videos de YouTube (MP3 320 kbps), busca en YouTube
> Music/SoundCloud, muestra letras sincronizadas, lee los MP3 de tu teléfono y
> funciona **offline** con lo ya descargado.

---

## 📁 Estructura del proyecto

```
sonora-music/
├── public/                  # La app (HTML/CSS/JS) — se sirve desde el servidor
│   ├── index.html
│   ├── js/                  # Módulos: api, player, download, library, search…
│   ├── css/  icons/  manifest.json  sw.js
│   └── SonoraMusic_v7_*.apk # APKs listos para instalar
├── server/                  # Backend Node.js + Express + SQLite
│   ├── server.js            # API + streaming + conversión YouTube→MP3
│   └── package.json
├── android-build/           # Fuentes y script para compilar el APK
├── Dockerfile               # Imagen para Render (incluye FFmpeg + yt-dlp)
├── render.yaml              # Blueprint automático de Render
├── start-local.sh           # ▶️  Arranca el servidor en Mac/Linux
├── stop-local.sh            # ⏹️  Detiene el servidor
└── start-local.bat          # ▶️  Arranca el servidor en Windows
```

---

## 🚀 1. Usar la computadora como servidor local (WiFi)

**Requisitos:** Node.js 18+ instalado.

```bash
# macOS / Linux
chmod +x start-local.sh stop-local.sh
./start-local.sh
```

```bat
:: Windows
start-local.bat
```

El script detecta tu IP, instala las dependencias la primera vez y muestra algo así:

```
🔗  En esta compu   : http://localhost:3000
📱  En el celular   : http://192.168.1.132:3000
📥  Descargar la app: http://192.168.1.132:3000/SonoraMusic_v7_4.apk
```

Para detenerlo: `./stop-local.sh` (o `Ctrl + C`).

> La IP cambia según la red. Si quieres que **siempre** sea la misma, mira
> **[GUIA_SERVIDOR_LOCAL.md](GUIA_SERVIDOR_LOCAL.md)**.

---

## 📱 2. Instalar la app en el teléfono

1. Conecta el teléfono a la **misma WiFi** que la computadora.
2. Abre el navegador y entra a `http://<IP-de-tu-PC>:3000/SonoraMusic_v7_4.apk`.
3. Descarga e instala el APK (activa "Instalar apps de origen desconocido").
4. Abre Sonora Music. Se conectará sola al servidor local.

---

## ☁️ 3. Desplegar en la nube (Render)

Para usar la app **desde cualquier lugar** (no solo en tu WiFi), despliega el
servidor en **Render** (gratis). Render construye la imagen con `Dockerfile`,
que ya incluye **FFmpeg + yt-dlp**, así que la conversión de YouTube a MP3
funciona también en la nube.

**Guía completa paso a paso → [GUIA_RENDER.md](GUIA_RENDER.md)**

Resumen:

1. Sube este repositorio a GitHub.
2. En Render: **New → Blueprint** → elige el repositorio (lee `render.yaml`).
3. Render te da una URL tipo `https://sonora-music.onrender.com`.
4. Pega esa URL en la app: **Ajustes → Servidor → Servidor Render**.

---

## ⚙️ 4. Configurar el servidor dentro de la app

En la app ve a **Ajustes → Servidores**:

| Opción              | Qué poner                                              |
| ------------------- | ------------------------------------------------------ |
| **Servidor Local**  | `http://192.168.1.132:3000` (la IP de tu PC)           |
| **Servidor Render** | `https://sonora-music.onrender.com` (la URL de Render) |

La app intenta, en este orden: **Local → Render → Offline**.

---

## 🔌 API del servidor (resumen)

| Método | Ruta                          | Descripción                          |
| ------ | ----------------------------- | ------------------------------------ |
| GET    | `/api/health`                 | Estado del servidor                  |
| GET    | `/api/tracks`                 | Lista de pistas                      |
| GET    | `/api/tracks/search?q=`       | Busca en la biblioteca del servidor  |
| GET    | `/api/search/external?q=`     | Busca en YouTube / YouTube Music     |
| GET    | `/api/stream/:id`             | Streaming de audio (HTTP 206)        |
| GET    | `/api/stream/external?url=`   | Streaming desde YouTube              |
| GET    | `/api/download/external?url=` | Descarga y convierte a MP3 (320 kbps)|
| GET    | `/api/recommendations`        | Recomendaciones para autoplay        |
| GET    | `/api/charts` · `/api/genres` | Tendencias y géneros                 |

> Las **letras** las obtiene la app directamente de [LRCLIB](https://lrclib.net)
> desde el teléfono, no pasan por este servidor.

---

## 🛠️ Compilar el APK

```bash
cd android-build
VERSION=7.6 ./build_apk.sh   # requiere Android SDK + JDK
```

Genera `SonoraMusic_v7.6.apk` en la raíz y lo copia a `public/`.

---

## ❓ Problemas comunes

| Problema                            | Solución                                                            |
| ----------------------------------- | ------------------------------------------------------------------- |
| El celular no conecta al servidor   | Misma WiFi, firewall de la PC permite el puerto 3000, IP correcta   |
| Render "se duerme" (plan gratis)    | La primera petición tarda ~50 s en despertar; luego va rápido        |
| YouTube no convierte a MP3          | Revisa que `yt-dlp` y `ffmpeg` estén instalados (el Docker ya los trae) |
| La IP de la PC cambió               | Vuelve a mirar `./start-local.sh` o fija la IP (ver guía)            |

---

## 📄 Licencia

MIT — Sonora Team.
