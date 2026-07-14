/**
 * App de Boda - Servidor backend
 * ---------------------------------
 * - Puerta de acceso por código
 * - Subida de fotos y vídeos (guardados en disco)
 * - Galería
 * - Generación de QR
 * - PWA (sirve el frontend estático)
 */

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

// sharp es opcional: si no está instalado, se sirven los originales
let sharp = null;
try { sharp = require('sharp'); } catch (_) {
  console.warn('Aviso: "sharp" no está instalado; no habrá miniaturas de fotos.');
}

// ---------- Configuración ----------
const CONFIG = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  ACCESS_CODE: (process.env.ACCESS_CODE || 'SIEMPREJUNTOS').trim(),
  // Códigos de superusuario (los novios): pueden eliminar cualquier foto/vídeo
  ADMIN_CODES: (process.env.ADMIN_CODES || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  EVENT_TITLE: process.env.EVENT_TITLE || 'Nuestra Boda',
  COUPLE_NAMES: process.env.COUPLE_NAMES || 'Los Novios',
  EVENT_DATE: process.env.EVENT_DATE || '',
  MAX_UPLOAD_MB: parseInt(process.env.MAX_UPLOAD_MB, 10) || 600,
  MAX_STORAGE_GB: parseFloat(process.env.MAX_STORAGE_GB) || 30,
  PUBLIC_URL: (process.env.PUBLIC_URL || '').trim(),
};

const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
const META_FILE = path.join(DATA_DIR, 'media.jsonl');
const PUBLIC_DIR = path.join(ROOT, 'public');
const THUMB_DIR = path.join(ROOT, 'thumbs');

// Asegurar carpetas
for (const dir of [UPLOAD_DIR, DATA_DIR, PUBLIC_DIR, THUMB_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(META_FILE)) fs.writeFileSync(META_FILE, '');

// ---------- Utilidades de almacenamiento ----------
function dirSizeBytes(dir) {
  let total = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      try {
        const st = fs.statSync(path.join(dir, name));
        if (st.isFile()) total += st.size;
      } catch (_) {}
    }
  } catch (_) {}
  return total;
}

// Tamaño usado en cache (se actualiza al subir/borrar para no recalcular siempre)
let usedBytes = dirSizeBytes(UPLOAD_DIR);
const MAX_STORAGE_BYTES = CONFIG.MAX_STORAGE_GB * 1024 * 1024 * 1024;

// ---------- Metadatos (JSONL, sin base de datos) ----------
function appendMeta(record) {
  fs.appendFileSync(META_FILE, JSON.stringify(record) + '\n');
}

function readMeta() {
  const content = fs.readFileSync(META_FILE, 'utf8');
  const out = [];
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch (_) {}
  }
  return out;
}

function rewriteMeta(records) {
  const tmp = META_FILE + '.tmp';
  fs.writeFileSync(tmp, records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
  fs.renameSync(tmp, META_FILE);
}

// ---------- App Express ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Parseo simple de cookies
app.use((req, _res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx > -1) {
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        req.cookies[k] = decodeURIComponent(v);
      }
    }
  }
  next();
});

// ---------- Autenticación por código ----------
const AUTH_COOKIE = 'boda_auth';
const ADMIN_COOKIE = 'boda_admin';
// Tokens derivados de los códigos para no exponerlos tal cual en la cookie
const AUTH_TOKEN = crypto.createHash('sha256').update(CONFIG.ACCESS_CODE).digest('hex').slice(0, 32);
const ADMIN_TOKEN = crypto
  .createHash('sha256')
  .update('admin:' + CONFIG.ACCESS_CODE + ':' + CONFIG.ADMIN_CODES.join(','))
  .digest('hex')
  .slice(0, 32);

function isAuthed(req) {
  return req.cookies[AUTH_COOKIE] === AUTH_TOKEN;
}

function isAdmin(req) {
  return CONFIG.ADMIN_CODES.length > 0 && req.cookies[ADMIN_COOKIE] === ADMIN_TOKEN;
}

function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  return res.status(401).json({ error: 'No autorizado. Introduce el código de acceso.' });
}

// ---------- Multer (subidas a disco) ----------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
    const id = Date.now().toString(36) + '-' + crypto.randomBytes(5).toString('hex');
    cb(null, id + (ext || ''));
  },
});

function fileFilter(_req, file, cb) {
  if (/^image\//.test(file.mimetype) || /^video\//.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten imágenes o vídeos.'));
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: CONFIG.MAX_UPLOAD_MB * 1024 * 1024 },
});

// ---------- Rutas API ----------

// Info pública del evento + estado de sesión
app.get('/api/session', (req, res) => {
  res.json({
    authed: isAuthed(req),
    admin: isAdmin(req),
    event: {
      title: CONFIG.EVENT_TITLE,
      names: CONFIG.COUPLE_NAMES,
      date: CONFIG.EVENT_DATE,
    },
  });
});

// Verificar código de acceso (código de invitado o código de novios)
app.post('/api/verify', (req, res) => {
  const code = (req.body && req.body.code ? String(req.body.code) : '').trim();
  if (!code) return res.status(400).json({ error: 'Escribe el código.' });

  const upper = code.toUpperCase();
  const admin = CONFIG.ADMIN_CODES.includes(upper);
  if (!admin && upper !== CONFIG.ACCESS_CODE.toUpperCase()) {
    return res.status(403).json({ error: 'Código incorrecto. Inténtalo de nuevo.' });
  }

  // Cookies válidas 30 días
  const maxAge = 60 * 60 * 24 * 30;
  const cookies = [`${AUTH_COOKIE}=${AUTH_TOKEN}; Path=/; Max-Age=${maxAge}; SameSite=Lax; HttpOnly`];
  if (admin) {
    cookies.push(`${ADMIN_COOKIE}=${ADMIN_TOKEN}; Path=/; Max-Age=${maxAge}; SameSite=Lax; HttpOnly`);
  }
  res.setHeader('Set-Cookie', cookies);
  res.json({ ok: true, admin });
});

// Cerrar sesión
app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', [
    `${AUTH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`,
    `${ADMIN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly`,
  ]);
  res.json({ ok: true });
});

// Estado de almacenamiento
app.get('/api/storage', requireAuth, (_req, res) => {
  res.json({
    usedBytes,
    maxBytes: MAX_STORAGE_BYTES,
    usedGB: +(usedBytes / (1024 ** 3)).toFixed(2),
    maxGB: CONFIG.MAX_STORAGE_GB,
    percent: Math.min(100, +((usedBytes / MAX_STORAGE_BYTES) * 100).toFixed(1)),
  });
});

// Subir archivos (fotos/vídeos)
app.post('/api/upload', requireAuth, (req, res) => {
  // Comprobar espacio antes de aceptar
  if (usedBytes >= MAX_STORAGE_BYTES) {
    return res.status(507).json({ error: 'El almacenamiento está lleno. Avisa a los novios.' });
  }

  upload.array('files', 30)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `Archivo demasiado grande. Máximo ${CONFIG.MAX_UPLOAD_MB} MB.` });
      }
      return res.status(400).json({ error: err.message || 'Error al subir.' });
    }

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No se recibió ningún archivo.' });

    const uploader = (req.body && req.body.uploader ? String(req.body.uploader) : '').trim().slice(0, 60) || 'Invitado';
    const device = (req.body && req.body.device ? String(req.body.device) : '').trim().slice(0, 64);
    const now = Date.now();
    const saved = [];

    for (const f of files) {
      const type = /^video\//.test(f.mimetype) ? 'video' : 'photo';
      const record = {
        id: f.filename,
        filename: f.filename,
        originalName: f.originalname,
        mime: f.mimetype,
        type,
        size: f.size,
        uploader,
        device,
        uploadedAt: now,
      };
      appendMeta(record);
      usedBytes += f.size;
      saved.push(publicMedia(record, device, uploader));
    }

    res.json({ ok: true, count: saved.length, files: saved });
  });
});

// ¿Es este medio del invitado que pregunta?
// - Subidas nuevas: coincide el identificador del dispositivo.
// - Subidas antiguas (sin dispositivo): coincide el nombre del invitado.
function isMine(r, deviceId, guestName) {
  if (r.device) return !!deviceId && r.device === deviceId;
  return !!guestName && r.uploader === guestName;
}

// Representación pública de un medio
// `mine` marca lo que el solicitante puede eliminar (lo suyo, o todo si es novio/a)
function publicMedia(r, deviceId, guestName, admin) {
  return {
    id: r.id,
    url: '/media/' + r.filename,
    type: r.type,
    mime: r.mime,
    uploader: r.uploader,
    uploadedAt: r.uploadedAt,
    size: r.size,
    originalName: r.originalName,
    mine: !!admin || isMine(r, deviceId, guestName),
  };
}

function requesterIdentity(req) {
  const deviceId = (req.headers['x-device'] || '').toString().slice(0, 64);
  let guestName = '';
  try { guestName = decodeURIComponent((req.headers['x-guest'] || '').toString()).slice(0, 60); } catch (_) {}
  return { deviceId, guestName };
}

// Listar galería (más recientes primero), con paginación opcional (?limit=&offset=)
app.get('/api/media', requireAuth, (req, res) => {
  const filter = (req.query.type || 'all').toString();
  const { deviceId, guestName } = requesterIdentity(req);
  const admin = isAdmin(req);
  const all = readMeta()
    .filter((r) => fs.existsSync(path.join(UPLOAD_DIR, r.filename)))
    .map((r) => publicMedia(r, deviceId, guestName, admin));

  const photos = all.filter((i) => i.type === 'photo').length;
  const videos = all.length - photos;

  let items = all;
  if (filter === 'photo' || filter === 'video') {
    items = items.filter((i) => i.type === filter);
  }
  items.sort((a, b) => b.uploadedAt - a.uploadedAt);

  const total = items.length;
  const limit = Math.min(200, Math.max(0, parseInt(req.query.limit, 10) || 0));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  if (limit) items = items.slice(offset, offset + limit);

  res.json({ count: total, total, photos, videos, offset, items });
});

// ---------- Miniaturas (galería rápida) ----------
const THUMB_SIZE = 480;
const thumbJobs = new Map(); // evita generar la misma miniatura dos veces a la vez

function thumbFile(filename) {
  return path.join(THUMB_DIR, filename + '.webp');
}

function ensureThumb(record) {
  const dest = thumbFile(record.filename);
  if (fs.existsSync(dest)) return Promise.resolve(dest);
  if (thumbJobs.has(record.filename)) return thumbJobs.get(record.filename);

  const src = path.join(UPLOAD_DIR, record.filename);
  let job;

  if (record.type === 'photo') {
    if (!sharp) return Promise.reject(new Error('sharp no disponible'));
    job = sharp(src)
      .rotate() // respeta la orientación EXIF del móvil
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
      .webp({ quality: 72 })
      .toFile(dest)
      .then(() => dest);
  } else {
    // Vídeo: extraer un fotograma con ffmpeg y comprimirlo
    job = new Promise((resolve, reject) => {
      const tmp = path.join(THUMB_DIR, record.filename + '.tmp.jpg');
      execFile(
        'ffmpeg',
        ['-y', '-ss', '0.5', '-i', src, '-frames:v', '1', '-vf', `scale=${THUMB_SIZE}:-2`, tmp],
        { timeout: 60000 },
        (err) => {
          if (err) return reject(err);
          if (!sharp) return reject(new Error('sharp no disponible'));
          sharp(tmp)
            .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
            .webp({ quality: 72 })
            .toFile(dest)
            .then(() => { fs.unlink(tmp, () => {}); resolve(dest); })
            .catch(reject);
        }
      );
    });
  }

  job = job.finally(() => thumbJobs.delete(record.filename));
  thumbJobs.set(record.filename, job);
  return job;
}

// Miniatura de un medio (se genera la primera vez y queda cacheada en disco)
app.get('/media/:file/thumb', requireAuth, async (req, res) => {
  const name = path.basename(req.params.file);
  const record = readMeta().find((r) => r.filename === name);
  if (!record) return res.status(404).send('No encontrado');
  try {
    const p = await ensureThumb(record);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.sendFile(p);
  } catch (_) {
    // Respaldo: para fotos se sirve el original; para vídeos, 404 (el cliente pone fondo)
    if (record.type === 'photo') {
      return res.sendFile(path.join(UPLOAD_DIR, name), { maxAge: '7d' });
    }
    res.status(404).send('Sin miniatura');
  }
});

// Genera en segundo plano las miniaturas que falten (al arrancar, sin prisa)
async function warmThumbs() {
  const records = readMeta().filter((r) => fs.existsSync(path.join(UPLOAD_DIR, r.filename)));
  let done = 0, failed = 0;
  for (const r of records) {
    if (fs.existsSync(thumbFile(r.filename))) continue;
    try { await ensureThumb(r); done++; } catch (_) { failed++; }
  }
  if (done || failed) console.log(`Miniaturas: ${done} generadas, ${failed} fallidas.`);
}
setTimeout(() => warmThumbs().catch(() => {}), 5000);

// Eliminar un medio (solo el propio autor puede)
app.delete('/api/media/:id', requireAuth, (req, res) => {
  const id = path.basename(req.params.id);
  const { deviceId, guestName } = requesterIdentity(req);
  const records = readMeta();
  const record = records.find((r) => r.id === id);
  if (!record) return res.status(404).json({ error: 'No encontrado.' });
  if (!isAdmin(req) && !isMine(record, deviceId, guestName)) {
    return res.status(403).json({ error: 'Solo puedes eliminar tus propios recuerdos.' });
  }
  try { fs.unlinkSync(path.join(UPLOAD_DIR, record.filename)); } catch (_) {}
  try { fs.unlinkSync(thumbFile(record.filename)); } catch (_) {}
  rewriteMeta(records.filter((r) => r.id !== id));
  usedBytes = Math.max(0, usedBytes - (record.size || 0));
  res.json({ ok: true });
});

// Servir un archivo multimedia (con soporte de rango para vídeo)
app.get('/media/:file', requireAuth, (req, res) => {
  const name = path.basename(req.params.file); // evita path traversal
  const filePath = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).send('No encontrado');
  res.sendFile(filePath, { maxAge: '7d' });
});

// Descargar un archivo
app.get('/media/:file/download', requireAuth, (req, res) => {
  const name = path.basename(req.params.file);
  const filePath = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).send('No encontrado');
  const meta = readMeta().find((r) => r.filename === name);
  const dl = meta && meta.originalName ? meta.originalName : name;
  res.download(filePath, dl);
});

// Generar QR (PNG) apuntando a la URL pública de la app
app.get('/api/qr', async (req, res) => {
  const url = (req.query.url && String(req.query.url)) || getPublicUrl(req);
  try {
    const png = await QRCode.toBuffer(url, {
      width: 600,
      margin: 2,
      color: { dark: '#3a2b30', light: '#ffffff' },
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch (e) {
    res.status(500).send('Error generando QR');
  }
});

// Devuelve la URL pública (para mostrar/QR)
app.get('/api/public-url', (req, res) => {
  res.json({ url: getPublicUrl(req) });
});

// Info para la página de QR (URL + código a mostrar/imprimir)
app.get('/api/qr-info', (req, res) => {
  res.json({ url: getPublicUrl(req), code: CONFIG.ACCESS_CODE, title: CONFIG.EVENT_TITLE, names: CONFIG.COUPLE_NAMES });
});

function getPublicUrl(req) {
  if (CONFIG.PUBLIC_URL) return CONFIG.PUBLIC_URL;
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

// ---------- Frontend estático (PWA) ----------
app.use(
  express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders: (res, filePath) => {
      // El service worker no debe cachearse
      if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// /app -> aplicación principal (requiere haber pasado el código en el cliente)
app.get('/app', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'app.html'));
});

// /qr -> página con el código QR para imprimir
app.get('/qr', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'qr.html'));
});

// Fallback: cualquier otra ruta -> landing
app.get('*', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ---------- Arranque ----------
function localIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

app.listen(CONFIG.PORT, '0.0.0.0', () => {
  const ips = localIPs();
  console.log('\n  💍  App de Boda en marcha');
  console.log('  ────────────────────────────────────');
  console.log(`  Evento:   ${CONFIG.EVENT_TITLE} — ${CONFIG.COUPLE_NAMES}`);
  console.log(`  Código:   ${CONFIG.ACCESS_CODE}`);
  console.log(`  Local:    http://localhost:${CONFIG.PORT}`);
  for (const ip of ips) {
    console.log(`  Red:      http://${ip}:${CONFIG.PORT}   (mismo WiFi)`);
  }
  console.log(`  QR:       http://localhost:${CONFIG.PORT}/qr`);
  console.log(`  Almacén:  ${(usedBytes / 1024 ** 3).toFixed(2)} GB / ${CONFIG.MAX_STORAGE_GB} GB`);
  console.log('  ────────────────────────────────────\n');
});
