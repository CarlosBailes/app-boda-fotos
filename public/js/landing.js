/* Landing: acceso por código + detección de SO + instalación PWA */
(function () {
  const $ = (s) => document.querySelector(s);
  const toast = (msg) => {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2600);
  };

  // Registrar service worker (PWA)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // ---- Info del evento + si ya está autorizado ----
  fetch('/api/session')
    .then((r) => r.json())
    .then((data) => {
      const ev = data.event || {};
      if (ev.title) { $('#eventTitle').textContent = ev.title; document.title = ev.title + ' — Acceso'; }
      if (ev.names) {
        $('#coupleNames').textContent = ev.names;
        // Monograma con las iniciales de la pareja: "Sara & Carlos" -> S & C
        const parts = ev.names.split(/&|\by\b/i).map((s) => s.trim()).filter(Boolean);
        if (parts.length === 2 && parts[0][0] && parts[1][0]) {
          $('#monogram').innerHTML =
            parts[0][0].toUpperCase() + '<span class="amp">&amp;</span>' + parts[1][0].toUpperCase();
        }
      }
      if (ev.date) { const d = $('#eventDate'); d.textContent = ev.date; d.style.display = 'block'; }
      if (data.authed) {
        // Ya tiene acceso: botón directo
        const btn = $('#enterBtn');
        btn.textContent = 'Entrar a la app ✓';
        $('#codeInput').style.display = 'none';
        $('#codeMsg').className = 'msg ok center';
        $('#codeMsg').textContent = 'Ya tienes acceso.';
      }
    })
    .catch(() => {});

  // ---- Verificación del código ----
  const form = $('#codeForm');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    const btn = $('#enterBtn');
    const msg = $('#codeMsg');
    const code = $('#codeInput').value.trim();

    // Si el input está oculto (ya autorizado), entra directo
    if ($('#codeInput').style.display === 'none') { location.href = '/app'; return; }

    if (!code) { msg.className = 'msg error center'; msg.textContent = 'Escribe el código.'; return; }

    btn.disabled = true; btn.textContent = 'Comprobando…';
    msg.className = 'msg center'; msg.textContent = '';

    fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (ok && j.ok) {
          msg.className = 'msg ok center';
          msg.textContent = j.admin ? '¡Bienvenidos, novios! 👑 Entrando…' : '¡Correcto! Entrando…';
          setTimeout(() => (location.href = '/app'), j.admin ? 900 : 500);
        } else {
          btn.disabled = false; btn.textContent = 'Entrar';
          msg.className = 'msg error center';
          msg.textContent = (j && j.error) || 'Código incorrecto.';
          $('#codeInput').select();
        }
      })
      .catch(() => {
        btn.disabled = false; btn.textContent = 'Entrar';
        msg.className = 'msg error center';
        msg.textContent = 'Error de conexión. Inténtalo otra vez.';
      });
  });

  // ---- Detección de sistema operativo ----
  function detectOS() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    if (isIOS) return 'ios';
    if (isAndroid) return 'android';
    return 'desktop';
  }

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const os = detectOS();
  const badge = $('#osBadge');
  const body = $('#installBody');

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    renderAndroidInstallable();
  });
  window.addEventListener('appinstalled', () => toast('¡App instalada! 🎉'));

  function stepList(steps) {
    return '<ul class="steps">' + steps.map((s, i) =>
      `<li><span class="n">${i + 1}</span><span>${s}</span></li>`).join('') + '</ul>';
  }

  function renderAndroidInstallable() {
    body.innerHTML = '';
    const b = document.createElement('button');
    b.className = 'btn btn-gold btn-block';
    b.textContent = '⬇️ Instalar la app';
    b.onclick = async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') toast('Instalando…');
      deferredPrompt = null;
    };
    body.appendChild(b);
    const hint = document.createElement('p');
    hint.className = 'muted center';
    hint.style.cssText = 'font-size:.8rem;margin:.6rem 0 0';
    hint.textContent = 'Se añadirá a tu pantalla de inicio como una app.';
    body.appendChild(hint);
  }

  const shareIcon = '<svg class="share-ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a86f5e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M8 8l4-4 4 4"/><path d="M4 12v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6"/></svg>';

  if (isStandalone) {
    badge.textContent = '✅ Ya estás en la app';
    body.innerHTML = '<p class="muted center" style="font-size:.9rem;margin:0">Estás usando la app instalada. ¡Perfecto!</p>';
    $('#browserBtn').style.display = 'none';
  } else if (os === 'ios') {
    badge.textContent = '🍎 iPhone / iPad';
    body.innerHTML = '<p class="muted center" style="font-size:.9rem;margin:.2rem 0 .4rem">Para instalarla como app en tu iPhone:</p>' +
      stepList([
        `Abre esta página en <b>Safari</b>`,
        `Toca el botón <b>Compartir</b> ${shareIcon} (abajo)`,
        `Elige <b>“Añadir a pantalla de inicio”</b>`,
        `Toca <b>Añadir</b> y ábrela desde tu inicio`
      ]);
  } else if (os === 'android') {
    badge.textContent = '🤖 Android';
    // Si el navegador ofrece instalación nativa, aparecerá el botón (beforeinstallprompt).
    body.innerHTML = '<p class="muted center" style="font-size:.9rem;margin:.2rem 0 .4rem">Para instalarla como app en tu Android:</p>' +
      stepList([
        `Abre esta página en <b>Chrome</b>`,
        `Toca el menú <b>⋮</b> (arriba a la derecha)`,
        `Elige <b>“Instalar aplicación”</b> o <b>“Añadir a pantalla de inicio”</b>`,
        `Ábrela desde tu pantalla de inicio`
      ]);
  } else {
    badge.textContent = '💻 Ordenador';
    body.innerHTML = '<p class="muted center" style="font-size:.9rem;margin:0">Puedes usarla directamente en el navegador. En Chrome/Edge también puedes instalarla con el icono ⊕ de la barra de direcciones.</p>';
  }

  $('#browserBtn').addEventListener('click', () => {
    // Requiere código: si ya autorizado va directo, si no enfoca el input
    fetch('/api/session').then(r => r.json()).then(d => {
      if (d.authed) location.href = '/app';
      else { $('#codeInput').focus(); toast('Introduce el código para entrar 👆'); }
    }).catch(() => $('#codeInput').focus());
  });
})();
