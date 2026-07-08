/* Pétalos flotando — decoración sutil de fondo */
(function () {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  canvas.id = 'petals';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let W, H, petals = [];
  const COLORS = [
    [233, 215, 205], // blush
    [216, 188, 138], // gold
    [236, 223, 200], // champagne
    [222, 190, 176], // rose
  ];

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  const COUNT = Math.min(20, Math.max(10, Math.floor(W / 46)));

  function newPetal(initial) {
    const c = COLORS[Math.floor(Math.random() * COLORS.length)];
    return {
      x: Math.random() * W,
      y: initial ? Math.random() * H : -20,
      size: 4 + Math.random() * 7,
      vy: 0.25 + Math.random() * 0.55,
      swayAmp: 30 + Math.random() * 50,
      swayFreq: 0.0006 + Math.random() * 0.0009,
      phase: Math.random() * Math.PI * 2,
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.012,
      alpha: 0.28 + Math.random() * 0.35,
      color: c,
    };
  }

  for (let i = 0; i < COUNT; i++) petals.push(newPetal(true));

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < petals.length; i++) {
      const p = petals[i];
      p.y += p.vy;
      p.angle += p.spin;
      const x = p.x + Math.sin(t * p.swayFreq + p.phase) * p.swayAmp;

      if (p.y > H + 24) { petals[i] = newPetal(false); continue; }

      ctx.save();
      ctx.translate(x, p.y);
      ctx.rotate(p.angle);
      ctx.globalAlpha = p.alpha;
      const [r, g, b] = p.color;
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
      grad.addColorStop(0, `rgba(${r},${g},${b},0.95)`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0.55)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.58, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
})();
