/**
 * Genera los iconos PNG de la PWA sin dependencias nativas (pngjs, JS puro).
 * Dibuja un degradado rosa con un corazón blanco.
 * Crea: icon-192, icon-512, maskable-512, apple-touch-icon (180).
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const OUT = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// Colores del degradado (champán/oro) y del corazón
const TOP = [216, 188, 138];   // #d8bc8a
const BOT = [143, 111, 66];    // #8f6f42
const HEART = [255, 253, 249]; // blanco cálido

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

// ¿Está el punto (nx, ny) dentro del corazón? Coordenadas en [-1.4, 1.4]
function insideHeart(nx, ny) {
  const x = nx;
  const y = -ny; // invertir Y para que la punta quede abajo
  const a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y <= 0;
}

function draw(size, opts = {}) {
  const { maskable = false } = opts;
  const png = new PNG({ width: size, height: size });
  // Escala del corazón: más pequeño si es maskable (zona segura)
  const heartScale = maskable ? 0.62 : 0.78;

  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    const r = lerp(TOP[0], BOT[0], t);
    const g = lerp(TOP[1], BOT[1], t);
    const b = lerp(TOP[2], BOT[2], t);
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      // Coordenadas normalizadas centradas
      const nx = ((x / (size - 1)) * 2 - 1) / heartScale;
      const ny = ((y / (size - 1)) * 2 - 1) / heartScale - 0.15;

      // Antialias sencillo por supersampling del borde del corazón
      let inside = 0;
      const s = 2;
      for (let sy = 0; sy < s; sy++) {
        for (let sx = 0; sx < s; sx++) {
          const ox = ((x + (sx + 0.5) / s) / (size - 1) * 2 - 1) / heartScale;
          const oy = ((y + (sy + 0.5) / s) / (size - 1) * 2 - 1) / heartScale - 0.15;
          if (insideHeart(ox, oy)) inside++;
        }
      }
      const frac = inside / (s * s);

      png.data[idx] = lerp(r, HEART[0], frac);
      png.data[idx + 1] = lerp(g, HEART[1], frac);
      png.data[idx + 2] = lerp(b, HEART[2], frac);
      png.data[idx + 3] = 255;
    }
  }
  return png;
}

function save(png, name) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, PNG.sync.write(png));
  console.log('  ✓', name);
}

console.log('Generando iconos…');
save(draw(192), 'icon-192.png');
save(draw(512), 'icon-512.png');
save(draw(512, { maskable: true }), 'maskable-512.png');
save(draw(180), 'apple-touch-icon.png');
console.log('Listo. Iconos en public/icons/');
