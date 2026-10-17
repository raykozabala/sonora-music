# 💻 Guía: Usar tu computadora como servidor local (Sonora Music)

Con esto la app funciona **sin internet**, al instante, usando tu PC/Mac como
servidor. Solo hay que estar en la **misma red WiFi**.

---

## 1 — Arrancar el servidor

**macOS / Linux**

```bash
cd ~/SonoraMusic
chmod +x start-local.sh stop-local.sh   # solo la primera vez
./start-local.sh
```

**Windows**

```bat
cd C:\ruta\a\SonoraMusic
start-local.bat
```

Verás un cartel como este:

```
🎵  SONORA MUSIC — Servidor Local
💻  Computadora : MacBook-de-Rayko
📡  IP en la red: 192.168.1.132
🔌  Puerto      : 3000
🔗  En esta compu   : http://localhost:3000
📱  En el celular   : http://192.168.1.132:3000
📥  Descargar la app: http://192.168.1.132:3000/SonoraMusic_v7_4.apk
```

> 📌 **Apunta la IP** (`192.168.1.132`). Es la que usarás en el teléfono.

Para detenerlo: `./stop-local.sh` o `Ctrl + C`.

---

## 2 — Conectar el teléfono

1. Teléfono y computadora en la **misma WiFi**.
2. En la app: **Ajustes → Servidores → Servidor Local** →
   `http://192.168.1.132:3000`
3. **⚡ Probar conexión** → debe salir en verde.

Prueba rápida desde el navegador del teléfono: `http://192.168.1.132:3000/api/health`

---

## 3 — Que la IP NO cambie (recomendado)

Por defecto el router da IPs dinámicas (cambian y rompen la conexión).
Hay dos formas de fijarla:

### Opción A — Reserva de DHCP en el router (la más simple) ⭐

1. Entra al panel del router (suele ser `http://192.168.1.1`).
2. Busca **DHCP → Reserva de dirección / MAC binding**.
3. Reserva la IP `192.168.1.132` para tu computadora.
4. Guarda. Listo.

### Opción B — IP manual en la Mac

1. **Ajustes del Sistema → Red → WiFi → Detalles → TCP/IP**
2. Configurar IPv4: **Manualmente**
   - IP: `192.168.1.132`
   - Máscara: `255.255.255.0`
   - Router: `192.168.1.1`
   - DNS: `1.1.1.1`, `8.8.8.8`
3. Aplicar.

> ⚠️ Elige una IP **fuera** del rango que reparte el router (p. ej. .132 si el
> router reparte solo hasta .100) para evitar conflictos.

---

## 4 — Permitir el puerto en el firewall

Si el teléfono no conecta, probablemente el firewall bloquea el puerto 3000.

**macOS**

- **Ajustes del Sistema → Red → Firewall → Opciones**
- Permite **Node** / `node` para conexiones entrantes.

O temporalmente, para probar:

```bash
# Ver si el firewall está activo
/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate
# Permitir node
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add $(which node)
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp $(which node)
```

**Windows**

- Panel de control → Firewall de Windows → Permitir una aplicación →
  marca **Node.js** en redes **privadas**.

---

## 5 — Arranque automático al encender la Mac (ya incluido)

El proyecto incluye el archivo `com.sonora.server.plist`, que hace que el
servidor arranque **solo** al iniciar sesión y se **reinicie** si se cae.

> ⚠️ **Importante:** macOS protege la carpeta `~/Documents` y **bloquea** a los
> servicios automáticos. Por eso el proyecto vive en `~/SonoraMusic` (fuera de
> Documentos). Si lo mueves a Documentos, el auto-arranque dejará de funcionar.

### Instalar

```bash
cd ~/SonoraMusic
cp com.sonora.server.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.sonora.server.plist
```

### Comprobar que está activo

```bash
launchctl list | grep sonora      # debe mostrar com.sonora.server
curl http://localhost:3000/api/health
```

### Gestionarlo

```bash
# Ver los logs
tail -f /tmp/sonora-server.log

# Detenerlo (hasta el próximo reinicio)
launchctl unload ~/Library/LaunchAgents/com.sonora.server.plist

# Volver a activarlo
launchctl load -w ~/Library/LaunchAgents/com.sonora.server.plist

# Quitarlo del todo
launchctl unload ~/Library/LaunchAgents/com.sonora.server.plist
rm ~/Library/LaunchAgents/com.sonora.server.plist
```

> Si el puerto 3000 lo ocupa otro programa, launchd reintentará cada 10 s.
> Cambia el puerto editando `service-local.sh` (`export PORT=3001`).

---

## 6 — Mantener la computadora despierta

Si la PC se suspende, el servidor deja de responder.

- **macOS:** `Ajustes → Pantalla y brillo → Avanzado → Evitar que la Mac se
  duerma automáticamente cuando la pantalla esté apagada`.
- O en la terminal: `caffeinate -i` mientras lo usas.

---

## Solución de problemas

| Síntoma                        | Solución                                                        |
| ------------------------------ | --------------------------------------------------------------- |
| "No se puede conectar"         | Misma WiFi, IP correcta, firewall permite Node                  |
| Conecta y luego falla           | La IP cambió → fija la IP (sección 3)                           |
| Va lento                        | Aleja el teléfono del router / usa 5 GHz                        |
| Puerto 3000 ocupado             | `./stop-local.sh` o cambia `PORT=3001 ./start-local.sh`         |
| CORS / errores raros en el navegador | Recarga fuerte: `Cmd + Shift + R`                          |

---

## ¿Y si quiero usarla también fuera de casa?

Despliega el mismo proyecto en la nube → **[GUIA_RENDER.md](GUIA_RENDER.md)**.
La app usará **Local** en casa y **Render** fuera, automáticamente.
