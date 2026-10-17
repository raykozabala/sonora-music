# ☁️ Guía: Desplegar Sonora Music en Render (paso a paso)

Esta guía asume que **aún no tienes cuenta en Render**. Sigue los pasos en orden.

Tiempo estimado: **10–15 minutos**. Coste: **gratis** (plan Free de Render).

---

## Paso 0 — Antes de empezar

- Necesitas una cuenta de **GitHub** (ya tienes: `raykozabala`).
- El repositorio con el proyecto debe estar subido a GitHub.
  Si aún no lo está, mira el **[README](README.md)** sección 1.

---

## Paso 1 — Crear la cuenta en Render

1. Entra a 👉 https://render.com
2. Pulsa **Get Started** / **Sign Up**.
3. Elige **"Sign up with GitHub"** (lo más fácil) y autoriza a Render.
4. Confirma tu correo si te lo pide.

No hace falta tarjeta para el plan **Free**, aunque Render puede pedirte un
método de pago para verificar identidad. Si lo pide y no quieres usarlo, mira la
sección "Alternativas" al final.

---

## Paso 2 — Desplegar con el Blueprint (1 clic)

El proyecto ya incluye el archivo **`render.yaml`**, que describe todo el
servicio. Render lo lee automáticamente.

1. Entra a 👉 https://dashboard.render.com/select-repo?type=blueprint
2. Si es la primera vez, **conecta GitHub** y da acceso al repositorio
   `sonora-music` (o el nombre que le hayas puesto).
3. Render detecta `render.yaml` y te muestra el servicio **`sonora-music`**.
4. Pulsa **Apply** / **Create Resources**.
5. Espera a que termine el build (la primera vez tarda ~3–6 min mientras
   instala FFmpeg, yt-dlp y las dependencias).

Cuando el estado sea **Live**, arriba verás tu URL:

```
https://sonora-music.onrender.com
```

> Puede salir con un sufijo aleatorio, p. ej.
> `https://sonora-music-a1b2.onrender.com`. Copia la tuya exacta.

---

## Paso 3 — Comprobar que funciona

Abre en el navegador:

```
https://TU-URL.onrender.com/api/health
```

Debe responder algo así:

```json
{ "status": "ok", "server": "render", "version": "7.6.0" }
```

---

## Paso 4 — Conectar la app a Render

En la app Sonora Music (o en la versión web):

1. **Ajustes → Servidores → Servidor Render**
2. Pega tu URL: `https://TU-URL.onrender.com`
3. Pulsa **⚡ Probar conexión** (debe salir en verde).
4. Activa el interruptor de **Servidor Render**.

La app usa: **Local → Render → Offline**. Si estás fuera de casa, usará Render.

---

## (Opcional) Paso 5 — Datos permanentes

En el **plan Free**, el disco de Render es *efímero*: si el servicio se reinicia,
la base de datos `sonora.db` se reinicia. Para datos persistentes necesitas un
**Render Disk** (de pago) o usar una base de datos externa.

> **No es crítico**: la biblioteca, descargas y ajustes de la app se guardan en
> el propio teléfono (IndexedDB). El servidor solo aporta búsqueda/streaming.

---

## Cambiar variables de entorno

En Render → tu servicio → **Environment**:

| Variable      | Valor      | Para qué                     |
| ------------- | ---------- | ---------------------------- |
| `SERVER_MODE` | `render`   | Marca el servidor como nube  |
| `NODE_ENV`    | `production` | Optimización                 |

---

## Redespliegue automático

Con `autoDeploy: true`, cada vez que hagas `git push` a la rama principal,
Render reconstruye y publica la nueva versión solo. 🎉

---

## Alternativas gratis a Render

Si Render te pide tarjeta y prefieres otra opción:

| Plataforma   | Pros                                        | Contras                       |
| ------------ | ------------------------------------------- | ----------------------------- |
| **Render**   | El más simple, usa `render.yaml`            | Se "duerme" a los 15 min      |
| **Railway**  | Muy rápido de configurar                    | Créditos limitados al mes     |
| **Fly.io**   | Buen rendimiento                            | Requiere CLI y tarjeta        |
| **Koyeb**    | Plan gratis decente                          | Menos conocido                |
| **Tu PC**    | Gratis, rápido, sin límites                  | Solo mismo WiFi (o túnel)     |

> ¿Solo necesitas usarla en casa? **No necesitas Render**: usa el servidor local
> de tu computadora → **[GUIA_SERVIDOR_LOCAL.md](GUIA_SERVIDOR_LOCAL.md)**.

---

## Problemas típicos

| Síntoma                              | Causa / solución                                                      |
| ------------------------------------ | --------------------------------------------------------------------- |
| Build falla en `npm install`         | Revisa los logs; mejor-sqlite3 puede necesitar recompilar (el Docker ya trae `build-essential`) |
| "Not Found" en la URL                | El servicio aún no está *Live*, o usaste el nombre equivocado          |
| Primera visita lenta (~50 s)         | El plan gratis se duerme; es normal, luego va rápido                   |
| La app no conecta                    | Revisa que la URL empiece con `https://` y no lleve `/` al final       |
| YouTube no descarga                  | El Docker ya instala `yt-dlp` + `ffmpeg`; si usas otro runtime, instálalos |
