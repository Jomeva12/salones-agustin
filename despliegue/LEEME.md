# Poner el panel en línea — Easypanel

El panel va como una app más del proyecto `automatizaciones`, al lado de n8n.
Easypanel construye la imagen con el `Dockerfile` de la raíz y su Traefik saca
y renueva el certificado solo. **No hace falta Caddy ni systemd.**

---

## 0. El proyecto necesita Git

Hoy no está bajo control de versiones y Easypanel construye desde un
repositorio. Aparte, esto va a producción: conviene poder volver atrás.

```bash
git init && git add -A && git commit -m "Panel de salones, primera versión"
```

El repositorio tiene que ser **privado**. `.gitignore` ya deja fuera la base
(`salones.db`), que es donde viven los hashes de contraseña y los precios.

## 1. Crear la app

En Easypanel, proyecto `automatizaciones` → **+ Service** → **App**.

| Campo | Valor |
|---|---|
| Nombre | `salones-panel` |
| Source | El repositorio privado, rama `main` |
| Build method | **Dockerfile** |

## 2. El volumen — esto es lo que no se puede olvidar

**Mounts** → **Volume**:

| Campo | Valor |
|---|---|
| Name | `salones-datos` |
| Mount path | `/datos` |

Sin el volumen, la base vive dentro del contenedor y **cada redespliegue la
borra**: tarifas, agenda, usuarios, todo. Con volumen, la imagen se reemplaza
y los datos se quedan.

## 3. Variables

**Environment**:

```
API_TOKEN=<pegar el generado abajo>
```

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

`HOST`, `PORT` y `DB_PATH` ya vienen en el Dockerfile. Sin `API_TOKEN` el API
queda **abierta** y el panel lo grita al arrancar.

## 4. Dominio

**Domains** → agregar el subdominio, puerto interno **4300**, HTTPS activado.
Traefik pide el certificado solo; solo hace falta que el DNS ya apunte a la IP.

## 5. Subir la base

Al primer arranque el contenedor se va a detener diciendo que no encuentra la
base. Es correcto: arrancar con una base vacía se vería como que funcionó, y
el agente cotizaría sobre un negocio sin precios.

Sacar una copia limpia y subirla:

```bash
node backend/db/respaldar.mjs ./para-subir
```

Ese archivo (`salones-AAAA-MM-DD.db`) se sube al volumen **como
`/datos/salones.db`**, por el explorador de archivos de Easypanel o por SSH:

```bash
scp para-subir/salones-*.db root@2.25.143.27:/etc/easypanel/projects/automatizaciones/salones-panel/volumes/salones-datos/salones.db
```

Usa `respaldar.mjs` y no una copia del archivo: copiar `salones.db` a secas se
lleva la base **sin el WAL**, o sea sin lo último que se escribió.

Después, **Restart**.

## 6. Respaldo diario

En Easypanel, la app → **Scheduled tasks**:

| Campo | Valor |
|---|---|
| Schedule | `0 3 * * *` |
| Command | `node backend/db/respaldar.mjs /datos/respaldos` |

Guarda 30 días y rota solo. Van dentro del volumen, así que sobreviven a los
redespliegues — pero **no a que se borre el volumen**. Vale la pena bajarlos
de vez en cuando.

---

## Comprobar que quedó

```bash
curl -s https://TU-DOMINIO/api/salud
curl -s -o /dev/null -w '%{http_code}\n' https://TU-DOMINIO/api/salones
# 401 = el token está haciendo su trabajo

curl -s -H "Authorization: Bearer TU_TOKEN" https://TU-DOMINIO/api/salones | head -c 200
```

Y entrar al panel por el navegador para confirmar que las pantallas cargan: la
CSP es estricta, así que si algo se rompiera se vería en la consola.

## Cómo lo llama n8n

n8n vive en el mismo proyecto de Easypanel, así que lo alcanza **por la red
interna**, sin salir a internet:

```
http://salones-panel:4300/api/cotizar
```

Más rápido y sin exponer nada. El dominio público queda para que las
encargadas entren desde su teléfono.

El `API_TOKEN` va en n8n **como credencial**, nunca escrito dentro de un nodo.

---

## Dos cosas para después

**El token entra con rol admin.** Puede borrar políticas y cambiar tarifas. El
agente solo necesita leer y crear compromisos. Conviene acotarlo antes de
conectar el primer WhatsApp.

**Easypanel está en `http://2.25.143.27:3000`, sin HTTPS.** Las contraseñas
del panel que administra todo el servidor viajan en claro. Easypanel puede
servirse en un dominio con certificado desde su propia configuración; vale la
pena hacerlo antes de meterle más cosas.
