# Despliegue de la App de Boda

## Arquitectura en producción

- **Servidor**: droplet de DigitalOcean (Ubuntu 24.04, 50 GB SSD)
- **App**: Node.js 22 + Express en `/opt/boda`, corriendo como servicio
  systemd (`boda.service`) con reinicio automático
- **HTTPS**: Caddy como proxy inverso con certificado automático de
  Let's Encrypt (se renueva solo)
- **Almacenamiento**: fotos/vídeos en `/opt/boda/uploads`, metadatos en
  `/opt/boda/data/media.jsonl` (límite configurado en `.env`: 30 GB)
- **Firewall**: solo puertos 22 (SSH), 80 y 443

## Primer despliegue (resumen)

1. Crear droplet Ubuntu 24.04 con la clave SSH de despliegue.
2. Apuntar el dominio al droplet (registro DNS tipo A).
3. Subir el código:
   ```
   scp -i ~/.ssh/boda_deploy -r server.js package.json package-lock.json public scripts deploy root@IP:/opt/boda/
   ```
4. Crear `/opt/boda/.env` (copia del local + `PUBLIC_URL=https://dominio`).
5. Ejecutar en el servidor:
   ```
   DOMAIN=tudominio.es bash /opt/boda/deploy/setup-server.sh
   ```

## Actualizar la app (tras cambios de código)

```
scp -i ~/.ssh/boda_deploy -r server.js public root@IP:/opt/boda/
ssh -i ~/.ssh/boda_deploy root@IP "chown -R boda:boda /opt/boda && systemctl restart boda"
```

## Comandos útiles en el servidor

```
systemctl status boda        # estado de la app
journalctl -u boda -f        # logs en directo
df -h /                      # espacio en disco
du -sh /opt/boda/uploads     # espacio ocupado por las fotos/vídeos
```

## Copia de seguridad de los recuerdos (tras la boda)

Desde el ordenador de casa:
```
scp -i ~/.ssh/boda_deploy -r root@IP:/opt/boda/uploads ./RECUERDOS-BODA
scp -i ~/.ssh/boda_deploy root@IP:/opt/boda/data/media.jsonl ./RECUERDOS-BODA/
```
