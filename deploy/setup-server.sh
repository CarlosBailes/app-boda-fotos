#!/usr/bin/env bash
# ============================================================
# Configuración completa del servidor para la App de Boda
# Sistema: Ubuntu 24.04 LTS (DigitalOcean droplet)
# Uso:     DOMAIN=tudominio.es bash setup-server.sh
# Requiere: el código de la app ya subido a /opt/boda
# Es idempotente: se puede ejecutar varias veces sin romper nada.
# ============================================================
set -euo pipefail

DOMAIN="${DOMAIN:-${1:-}}"
if [ -z "$DOMAIN" ]; then
  echo "Uso: DOMAIN=tudominio.es bash $0"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Actualizando el sistema…"
apt-get update -y
apt-get install -y curl ca-certificates gnupg ufw

echo "==> Instalando Node.js 22…"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Instalando Caddy (HTTPS automático)…"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Usuario de servicio y permisos…"
id -u boda >/dev/null 2>&1 || useradd --system --home /opt/boda --shell /usr/sbin/nologin boda
mkdir -p /opt/boda/uploads /opt/boda/data
chown -R boda:boda /opt/boda

echo "==> Instalando dependencias de la app…"
cd /opt/boda
sudo -u boda npm install --omit=dev --no-audit --no-fund

echo "==> Servicio systemd…"
cp /opt/boda/deploy/boda.service /etc/systemd/system/boda.service
systemctl daemon-reload
systemctl enable boda
systemctl restart boda

echo "==> Configurando Caddy para ${DOMAIN}…"
cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
    reverse_proxy 127.0.0.1:3000
    encode zstd gzip
}
EOF
systemctl enable caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo "==> Firewall (solo SSH, HTTP y HTTPS)…"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo
echo "============================================"
systemctl is-active boda && echo "App:   ACTIVA"
systemctl is-active caddy && echo "Caddy: ACTIVO"
echo "URL:   https://${DOMAIN}"
echo "============================================"
