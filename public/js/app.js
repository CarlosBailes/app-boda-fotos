/* App principal: subir fotos/vídeos + galería */
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const toast = (msg) => {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
  };

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  // ---- Sesión / nombre ----
  let guestName = localStorage.getItem('boda_guest') || '';
  let eventTitle = document.title;

  // Identificador estable de este dispositivo (para poder borrar solo lo propio)
  let deviceId = localStorage.getItem('boda_device');
  if (!deviceId) {
    deviceId = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    localStorage.setItem('boda_device', deviceId);
  }

  // Cabeceras que identifican al invitado en las peticiones a la API
  function idHeaders() {
    return { 'x-device': deviceId, 'x-guest': encodeURIComponent(guestName || '') };
  }

  let isAdminMode = false;

  fetch('/api/session').then((r) => r.json()).then((d) => {
    if (!d.authed) { location.href = '/'; return; }
    isAdminMode = !!d.admin;
    const ev = d.event || {};
    if (ev.title) { $('#appTitle').childNodes[0].nodeValue = ev.title; document.title = ev.title; eventTitle = ev.title; }
    if (ev.names) $('#appNames').textContent = ev.names;
    updateWelcome();
    if (!guestName) openNameModal(true);
  }).catch(() => {});

  function updateWelcome() {
    const el = $('#welcomeTitle');
    if (!el) return;
    el.textContent = guestName && guestName !== 'Invitado'
      ? `Gracias por compartir, ${guestName.split(' ')[0]}`
      : 'Gracias por compartir';
  }

  // ---- Modal nombre ----
  function openNameModal(first) {
    $('#nameInput').value = guestName || '';
    $('#nameModal').classList.add('open');
    $('#nameSkip').style.display = first ? 'inline-flex' : 'none';
    setTimeout(() => $('#nameInput').focus(), 100);
  }
  function closeNameModal() { $('#nameModal').classList.remove('open'); }
  $('#nameSave').onclick = () => {
    const v = $('#nameInput').value.trim();
    if (v) { guestName = v; localStorage.setItem('boda_guest', v); }
    updateWelcome();
    closeNameModal();
  };
  $('#nameSkip').onclick = () => {
    guestName = 'Invitado'; localStorage.setItem('boda_guest', 'Invitado'); closeNameModal();
  };
  $('#nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#nameSave').click(); });

  // ---- Tabs ----
  function showTab(name) {
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $('#panelUpload').style.display = name === 'upload' ? 'block' : 'none';
    $('#panelGallery').style.display = name === 'gallery' ? 'block' : 'none';
    if (name === 'gallery') loadGallery();
  }
  $$('.tab').forEach((t) => (t.onclick = () => showTab(t.dataset.tab)));
  $('#goGallery').onclick = () => showTab('gallery');

  // ---- Botones subir ----
  $('#btnPhoto').onclick = () => $('#filePhoto').click();
  $('#btnVideo').onclick = () => $('#fileVideo').click();
  $('#filePhoto').addEventListener('change', (e) => handleFiles(e.target.files, 'foto'));
  $('#fileVideo').addEventListener('change', (e) => handleFiles(e.target.files, 'vídeo'));

  function handleFiles(fileList, kind) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (!guestName) { openNameModal(true); toast('Dinos tu nombre y vuelve a intentarlo 🙂'); return; }
    uploadFiles(files, kind);
    // limpiar inputs para permitir re-subir el mismo archivo
    $('#filePhoto').value = ''; $('#fileVideo').value = '';
  }

  // ---- Subida con progreso (XHR) ----
  function uploadFiles(files, kind) {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    form.append('uploader', guestName || 'Invitado');
    form.append('device', deviceId);

    const up = $('#uploader');
    $('#upLabel').textContent = `Subiendo ${kind}${files.length > 1 ? 's' : ''}…`;
    $('#upCount').textContent = `${files.length} archivo${files.length > 1 ? 's' : ''}`;
    $('#upBar').style.width = '0%';
    up.classList.add('show');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        $('#upBar').style.width = pct + '%';
        if (pct >= 100) $('#upLabel').textContent = 'Procesando…';
      }
    };
    xhr.onload = () => {
      up.classList.remove('show');
      let res = {};
      try { res = JSON.parse(xhr.responseText); } catch (_) {}
      if (xhr.status >= 200 && xhr.status < 300 && res.ok) {
        toast(`¡Subido! ${res.count} recuerdo${res.count > 1 ? 's' : ''} guardado${res.count > 1 ? 's' : ''} ✨`);
        celebrate();
        prependRecent(res.files || []);
        lastTotal += res.count; // que el sondeo no lo cuente como "nuevo de otros"
        // refrescar galería si está visible
        if ($('#panelGallery').style.display !== 'none') loadGallery();
      } else if (xhr.status === 401) {
        toast('Tu sesión ha caducado.'); setTimeout(() => (location.href = '/'), 1200);
      } else {
        toast((res && res.error) || 'No se pudo subir. Inténtalo otra vez.');
      }
    };
    xhr.onerror = () => { up.classList.remove('show'); toast('Error de conexión al subir.'); };
    xhr.send(form);
  }

  // ---- Render de items ----
  // list + index permiten navegar con flechas dentro del visor
  function mediaTile(item, list, index) {
    const div = document.createElement('div');
    div.className = 'grid-item';
    if (item.type === 'video') {
      div.innerHTML =
        `<video src="${item.url}#t=0.1" preload="metadata" muted playsinline></video>` +
        `<div class="play">▶</div>` +
        (item.uploader ? `<div class="tag">${escapeHtml(item.uploader)}</div>` : '');
    } else {
      div.innerHTML =
        `<img src="${item.url}" loading="lazy" alt="" />` +
        (item.uploader ? `<div class="tag">${escapeHtml(item.uploader)}</div>` : '');
    }
    div.onclick = () => openLightbox(list, index);
    return div;
  }

  function prependRecent(items) {
    const grid = $('#recentGrid');
    items.forEach((it, i) => grid.insertBefore(mediaTile(it, items, i), grid.firstChild));
  }

  // ---- Galería ----
  let currentFilter = 'all';
  let lastTotal = 0; // total conocido (para detectar recuerdos nuevos de otros)
  $$('.chip').forEach((c) => (c.onclick = () => {
    $$('.chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    currentFilter = c.dataset.filter;
    loadGallery();
  }));
  $('#refreshBtn').onclick = () => { loadGallery(); toast('Actualizando…'); };

  function showSkeletons(grid, n) {
    if (grid.children.length) return; // solo si está vacía (primera carga)
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div');
      s.className = 'grid-item skeleton';
      grid.appendChild(s);
    }
  }

  function updateCount(items) {
    const el = $('#galleryCount');
    if (!el) return;
    if (!items.length) { el.textContent = ''; return; }
    if (currentFilter === 'all') {
      const p = items.filter((i) => i.type === 'photo').length;
      const v = items.length - p;
      el.textContent = `${p} foto${p !== 1 ? 's' : ''} · ${v} vídeo${v !== 1 ? 's' : ''}`;
    } else {
      el.textContent = `${items.length} ${currentFilter === 'photo' ? 'foto' : 'vídeo'}${items.length !== 1 ? 's' : ''}`;
    }
  }

  function loadGallery() {
    const grid = $('#galleryGrid');
    showSkeletons(grid, 9);
    fetch('/api/media?type=' + currentFilter, { headers: idHeaders() })
      .then((r) => { if (r.status === 401) { location.href = '/'; throw new Error('401'); } return r.json(); })
      .then((data) => {
        grid.innerHTML = '';
        const items = data.items || [];
        $('#galleryEmpty').style.display = items.length ? 'none' : 'block';
        updateCount(items);
        if (currentFilter === 'all') lastTotal = items.length;
        items.forEach((it, i) => {
          const tile = mediaTile(it, items, i);
          tile.style.animationDelay = Math.min(i * 35, 500) + 'ms';
          grid.appendChild(tile);
        });
        // también refresca "recién subidas" con las 9 más nuevas
        if (currentFilter === 'all') {
          const recent = $('#recentGrid');
          recent.innerHTML = '';
          items.slice(0, 9).forEach((it, i) => {
            const tile = mediaTile(it, items, i);
            tile.style.animationDelay = (i * 45) + 'ms';
            recent.appendChild(tile);
          });
        }
      })
      .catch(() => {});
  }
  // cargar recientes al abrir
  loadGallery();

  // ---- Galería en vivo: sondeo cada 45 s ----
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    fetch('/api/media?type=all')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const total = (data.items || []).length;
        if (total > lastTotal) {
          const nuevos = total - lastTotal;
          lastTotal = total;
          toast(`✨ ${nuevos} recuerdo${nuevos > 1 ? 's' : ''} nuevo${nuevos > 1 ? 's' : ''} de otros invitados`);
          loadGallery();
        }
      })
      .catch(() => {});
  }, 45000);

  // ---- Lightbox con navegación ----
  const lb = $('#lightbox');
  let lbList = [];
  let lbIdx = 0;

  function openLightbox(list, index) {
    lbList = list || [];
    lbIdx = index || 0;
    renderLightbox();
    lb.classList.add('open');
  }

  function renderLightbox() {
    const item = lbList[lbIdx];
    if (!item) return;
    const wrap = $('#lbMedia');
    wrap.innerHTML = item.type === 'video'
      ? `<video src="${item.url}" controls autoplay playsinline></video>`
      : `<img src="${item.url}" alt="" />`;
    const date = new Date(item.uploadedAt);
    $('#lbInfo').textContent = `${item.uploader || 'Invitado'} · ${date.toLocaleString('es-ES', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}`;
    $('#lbCounter').textContent = lbList.length > 1 ? `${lbIdx + 1} / ${lbList.length}` : '';
    $('#lbDownload').href = item.url + '/download';
    $('#lbDelete').style.display = item.mine ? 'inline-flex' : 'none';
    $('#lbPrev').style.visibility = lbIdx > 0 ? 'visible' : 'hidden';
    $('#lbNext').style.visibility = lbIdx < lbList.length - 1 ? 'visible' : 'hidden';
    // precargar la siguiente imagen para que el pase sea instantáneo
    const next = lbList[lbIdx + 1];
    if (next && next.type === 'photo') { const im = new Image(); im.src = next.url; }
  }

  function lbGo(delta) {
    const n = lbIdx + delta;
    if (n < 0 || n >= lbList.length) return;
    lbIdx = n;
    renderLightbox();
  }

  function closeLightbox() {
    lb.classList.remove('open');
    $('#lbMedia').innerHTML = '';
  }

  $('#lbClose').onclick = closeLightbox;
  $('#lbPrev').onclick = (e) => { e.stopPropagation(); lbGo(-1); };
  $('#lbNext').onclick = (e) => { e.stopPropagation(); lbGo(1); };
  lb.addEventListener('click', (e) => { if (e.target === lb) closeLightbox(); });
  document.addEventListener('keydown', (e) => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') lbGo(-1);
    if (e.key === 'ArrowRight') lbGo(1);
  });

  // Deslizar en móvil para pasar de recuerdo
  let touchX = null, touchY = null;
  lb.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    touchX = e.touches[0].clientX; touchY = e.touches[0].clientY;
  }, { passive: true });
  lb.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    touchX = touchY = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) lbGo(dx < 0 ? 1 : -1);
  }, { passive: true });

  // Eliminar un recuerdo propio
  $('#lbDelete').onclick = async () => {
    const item = lbList[lbIdx];
    if (!item || !item.mine) return;
    const aviso = isAdminMode && item.uploader && item.uploader !== guestName
      ? `¿Eliminar este recuerdo de ${item.uploader}? Esta acción no se puede deshacer.`
      : '¿Eliminar este recuerdo? Esta acción no se puede deshacer.';
    if (!confirm(aviso)) return;
    try {
      const r = await fetch('/api/media/' + encodeURIComponent(item.id), {
        method: 'DELETE',
        headers: idHeaders(),
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) { toast(res.error || 'No se pudo eliminar.'); return; }
      toast('Recuerdo eliminado 🗑️');
      lbList.splice(lbIdx, 1);
      lastTotal = Math.max(0, lastTotal - 1);
      if (!lbList.length) {
        closeLightbox();
      } else {
        if (lbIdx >= lbList.length) lbIdx = lbList.length - 1;
        renderLightbox();
      }
      loadGallery();
    } catch (_) {
      toast('Error de conexión al eliminar.');
    }
  };

  // Compartir (Web Share API con respaldo de copiar enlace)
  $('#lbShare').onclick = async () => {
    const item = lbList[lbIdx];
    if (!item) return;
    const url = location.origin + item.url;
    try {
      if (navigator.share) {
        await navigator.share({ title: eventTitle, text: 'Un recuerdo de la boda 💛', url });
        return;
      }
      throw new Error('no-share');
    } catch (err) {
      if (err && err.name === 'AbortError') return; // el usuario canceló
      try {
        await navigator.clipboard.writeText(url);
        toast('Enlace copiado 📋');
      } catch (_) {
        toast('No se pudo compartir en este dispositivo.');
      }
    }
  };

  // ---- Menú ----
  $('#menuBtn').onclick = () => {
    $('#menuName').textContent =
      (guestName ? `Estás como: ${guestName}` : '') + (isAdminMode ? ' · Modo novios 👑' : '');
    $('#menuModal').classList.add('open');
    fetch('/api/storage').then((r) => r.json()).then((s) => {
      $('#storageInfo').textContent = `Almacenamiento: ${s.usedGB} GB de ${s.maxGB} GB usados (${s.percent}%)`;
    }).catch(() => {});
  };
  $('#menuClose').onclick = () => $('#menuModal').classList.remove('open');
  $('#menuModal').addEventListener('click', (e) => { if (e.target === $('#menuModal')) $('#menuModal').classList.remove('open'); });
  $('#changeName').onclick = () => { $('#menuModal').classList.remove('open'); openNameModal(false); };
  $('#logoutBtn').onclick = () => {
    fetch('/api/logout', { method: 'POST' }).finally(() => (location.href = '/'));
  };

  // ---- Celebración: corazones flotando al subir ----
  function celebrate() {
    const symbols = ['♥', '✦', '♥', '✧', '♥'];
    for (let i = 0; i < 14; i++) {
      const h = document.createElement('span');
      h.className = 'heart-float';
      h.textContent = symbols[i % symbols.length];
      h.style.left = (18 + Math.random() * 64) + 'vw';
      h.style.color = i % 2 ? '#b08d57' : '#c48b7a';
      h.style.fontSize = (14 + Math.random() * 14) + 'px';
      h.style.animationDelay = (Math.random() * 0.5) + 's';
      document.body.appendChild(h);
      setTimeout(() => h.remove(), 2400);
    }
  }

  // ---- utils ----
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
})();
