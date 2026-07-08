# 💍 App de Boda — Fotos y Vídeos de los Invitados

App web + PWA (instalable en Android e iPhone) para que los invitados suban fotos y vídeos del evento. Acceso con un código, galería para verlo todo, y un QR para repartir en las mesas.

---

## 🚀 Cómo arrancar (en tu ordenador)

```bash
npm install        # solo la primera vez
npm run icons      # genera los iconos (solo la primera vez)
npm start          # arranca el servidor
```

Luego abre en el navegador: **http://localhost:3000**

Al arrancar, la consola muestra también una dirección tipo `http://192.168.1.145:3000`.
Esa es la que pueden usar los invitados **conectados a tu mismo WiFi** (útil para pruebas).

- Página principal (acceso): `http://localhost:3000`
- Página del QR para imprimir: `http://localhost:3000/qr`

---

## ⚙️ Configuración

Todo se cambia en el archivo **`.env`**:

| Variable          | Qué hace                                                        |
|-------------------|----------------------------------------------------------------|
| `ACCESS_CODE`     | El código que escriben los invitados (ej. `SIEMPREJUNTOS`)      |
| `EVENT_TITLE`     | Título que se muestra (ej. `Boda de Ana y Luis`)               |
| `COUPLE_NAMES`    | Nombres de la pareja (ej. `Ana & Luis`)                        |
| `EVENT_DATE`      | Fecha a mostrar (opcional, ej. `20 · 09 · 2026`)              |
| `MAX_UPLOAD_MB`   | Tamaño máximo por archivo (por defecto 600 MB)                 |
| `MAX_STORAGE_GB`  | Capacidad total (por defecto 30 GB)                            |
| `PORT`            | Puerto del servidor (por defecto 3000)                        |
| `PUBLIC_URL`      | URL pública para el QR (se autodetecta si lo dejas vacío)      |

> Después de cambiar el `.env`, para y vuelve a arrancar el servidor.

---

## 📁 Dónde se guardan las fotos y vídeos

- Los archivos se guardan en la carpeta **`uploads/`**.
- Los datos (quién subió qué y cuándo) en **`data/media.jsonl`**.
- El límite real de capacidad es el espacio libre de tu disco; `MAX_STORAGE_GB` es un tope de seguridad.

Para descargar todo después de la boda, simplemente copia la carpeta `uploads/`.

---

## 📱 Cómo lo instalan los invitados (PWA)

La app detecta el sistema operativo y muestra las instrucciones automáticamente:

- **Android (Chrome):** menú ⋮ → «Instalar aplicación». O el botón «Instalar la app» si aparece.
- **iPhone (Safari):** botón Compartir → «Añadir a pantalla de inicio».
- **Ordenador:** se usa en el navegador (o se instala con el icono ⊕ en Chrome/Edge).

En todos los casos también pueden **seguir en el navegador** sin instalar nada.

---

## 🌐 Publicar en internet (para la boda real)

Para que los invitados accedan desde sus datos móviles (no solo el WiFi de casa), necesitas
que el servidor sea accesible desde internet. **La PWA requiere HTTPS** para instalarse.

### Opción A — Rápida para probar (túnel)
Con la app corriendo en local, en otra terminal:

```bash
npx localtunnel --port 3000
# o, si tienes cuenta de Cloudflare:  cloudflared tunnel --url http://localhost:3000
```

Te da una URL `https://...` que puedes poner en `PUBLIC_URL` del `.env` y regenerar el QR.
⚠️ Tu ordenador debe estar encendido todo el evento.

### Opción B — Alojamiento permanente (recomendado para el día)
Sube el proyecto a un servidor con Node.js y disco suficiente (30 GB+). Buenas opciones:
- Un **VPS** (Hetzner, DigitalOcean, Contabo…) con un dominio y HTTPS (Caddy o Nginx).
- Plataformas tipo **Render / Railway / Fly.io** (revisa que el almacenamiento sea persistente y suficiente).

Pasos generales en un VPS:
1. Instala Node.js 18+.
2. Copia el proyecto y ejecuta `npm install && npm run icons`.
3. Configura el `.env` (incluido `PUBLIC_URL=https://tudominio.com`).
4. Arranca con un gestor de procesos: `npx pm2 start server.js --name boda`.
5. Pon HTTPS delante (Caddy hace esto casi solo con un dominio).

Cuando tengas la URL pública final, ponla en `PUBLIC_URL`, reinicia, abre `/qr` e imprime.

---

## 🖨️ El QR para las mesas

Abre `http://localhost:3000/qr` (o tu URL pública `/qr`), pulsa **Imprimir** y colócalo en las mesas.
Muestra el QR, el nombre del evento y el código de acceso.

---

## ❓ Preguntas frecuentes

**¿Puedo cambiar los colores o el icono?**
Sí: los colores están en `public/css/style.css` (variables al inicio) y el icono se genera en
`scripts/generate-icons.js` (ejecuta `npm run icons` tras cambiarlo).

**¿Es seguro?**
El acceso por código evita curiosos, apropiado para una boda. No guardes datos sensibles.
Para un evento grande y público, considera medidas adicionales.

**¿Y si se llena el almacenamiento?**
La app avisa y deja de aceptar subidas al llegar al tope de `MAX_STORAGE_GB`. Sube el valor si tu disco lo permite.
