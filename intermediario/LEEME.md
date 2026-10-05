# El intermediario Kommo → n8n

Un servicio que se pone **en medio** del CRM y n8n. Kommo le habla a él, no a
n8n, y él reenvía.

## Por qué existe

**Kommo corta el webhook a los 2 segundos.** Si el destino no contestó para
entonces, da el intento por fallido. Un flujo de n8n con agentes de IA tarda
entre 10 y 60 segundos en contestar, así que Kommo lo cortaba en seco. En el
proyecto INCAD, de donde viene este diseño, eso pasaba en el **6.7 %** de los
mensajes: uno de cada quince clientes se quedaba sin respuesta, y en el tablero
todo se veía en verde.

El intermediario **guarda el mensaje y contesta 200 de inmediato** —en
milisegundos—, y después se lo pasa a n8n con calma, reintentando si hace
falta. Kommo queda satisfecho; n8n se toma el tiempo que necesite.

De ahí salen los demás servicios que presta:

- **Nada se pierde.** El mensaje está en la base antes de responderle a Kommo.
- **No se duplica.** La clave `msg_id` es única: si Kommo reintenta, se descarta.
- **Orden por conversación.** Un lead no procesa dos mensajes a la vez, así que
  no se pisan las respuestas.
- **Reintentos con espera creciente** cuando n8n falla o está caído.
- **Un tablero** para ver la cola, lo enviado, lo fallido y las latencias.
- **Reconciliación** (opcional): le pregunta a Kommo qué mensajes registró y
  los compara con los que llegaron, para detectar lo que Kommo nunca entregó.

---

## Tecnología

| Pieza | Qué se usó | Por qué |
|---|---|---|
| Lenguaje | **Node.js 22** (ESM, `.mjs`) | Lo que ya corre en el VPS |
| Servidor HTTP | `node:http` de la librería estándar | No hace falta Express para cinco rutas |
| Base de datos | **PostgreSQL** | Necesita `UNIQUE` real y transacciones |
| Cliente de Postgres | **`pg`** (`^8.13.1`) | La única dependencia de todo el proyecto |
| Empaquetado | **Docker** (`node:22-alpine`) | |
| Hosting | **Easypanel** sobre VPS propio | |
| Tablero | HTML y JS planos, servidos por el mismo proceso | Sin build, sin framework |

**Una sola dependencia de npm en todo el servicio.** El tablero no usa React
ni librerías de gráficas: son `<canvas>` y `fetch`. Eso mantiene la imagen
chica y hace que no haya nada que actualizar por seguridad cada mes.

---

## Las direcciones

| Qué | Dónde |
|---|---|
| Intermediario | `https://automatizaciones-salones-intermediario.hpzji3.easypanel.host` |
| └ tablero | `/` o `/panel` |
| └ salud | `/health` |
| └ entrada de Kommo | `POST /kommo` |
| n8n | `https://automatizaciones-n8n.hpzji3.easypanel.host` |
| Panel de Salones | `https://automatizaciones-salones-panel.hpzji3.easypanel.host` |
| Kommo | `https://administracioneventos6.kommo.com` |
| Easypanel | `http://2.25.143.27:3000`, proyecto `automatizaciones` |

Dentro del Docker de Easypanel los servicios se llaman entre sí por
`automatizaciones_<nombre>`, sin pasar por internet. Por ejemplo el panel es
`http://automatizaciones_salones-panel:4300`.

---

## Variables de entorno

Dos son obligatorias. Todas las demás tienen valor por omisión y el servicio
arranca sin ellas.

### Obligatorias

| Variable | Qué es |
|---|---|
| `DATABASE_URL` | Cadena de conexión a PostgreSQL: `postgres://usuario:clave@host:5432/base`. Sin ella el proceso **no arranca** (`Falta DATABASE_URL`). |
| `N8N_WEBHOOK_URL` | La URL completa del webhook de producción del flujo. Sin ella no arranca, **salvo** que `SOLO_REGISTRAR=true`. |

### Básicas

| Variable | Por omisión | Qué hace |
|---|---|---|
| `PORT` | `3000` | Puerto donde escucha. El Dockerfile ya lo fija. |
| `MAX_INFLIGHT` | `8` | Cuántos mensajes se mandan a n8n a la vez. Es el freno que evita tumbar n8n en una avalancha. |
| `MAX_INTENTOS` | `5` | Reintentos antes de marcar un mensaje como fallido. |
| `TIMEOUT_N8N_MS` | `180000` | Cuánto se espera a que n8n conteste, en milisegundos. Tres minutos: un agente con varias herramientas tarda. |
| `SOLO_REGISTRAR` | `false` | En `true` guarda todo pero **no reenvía a n8n**. Modo de prueba para ver qué llega sin que nadie reciba respuesta. |

### Avisos por Telegram

| Variable | Por omisión | Qué hace |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | vacío | Token del bot que manda los avisos. Vacío = sin avisos. |
| `TELEGRAM_CHAT_IDS` | vacío | A quién se avisa. Varios separados por coma. |
| `ALERTA_COLA` | `25` | Avisa si la cola pasa de este número de pendientes. |
| `ALERTA_EDAD_MIN` | `5` | Avisa si el pendiente más viejo lleva más de estos minutos. |

### Reconciliación con Kommo (opcional)

Compara lo que Kommo dice haber registrado contra lo que recibimos. **Se
enciende sola en cuanto hay `KOMMO_TOKEN`**; sin token queda apagada, que es
como está hoy.

| Variable | Por omisión | Qué hace |
|---|---|---|
| `KOMMO_TOKEN` | vacío | Token de larga duración de Kommo. **Es el interruptor**: sin él no hay reconciliación ni rescate. |
| `KOMMO_BASE` | `https://administracioneventos6.kommo.com/api/v4` | Base del API. De aquí también sale el subdominio para los enlaces del tablero. |
| `RECON_CADA_MIN` | `5` | Cada cuántos minutos se revisa. |
| `RECON_VENTANA_MIN` | `120` | Hacia atrás cuánto se mira en cada revisión. |
| `RECON_GRACIA_MIN` | `60` | Cuánto se le concede a Kommo para reintentar antes de dar un mensaje por perdido. |
| `RECON_DESDE` | vacío | Fecha ISO a partir de la cual se cuenta. Antes de que el intermediario entrara en la ruta es normal no tener los mensajes, y contarlos como perdidos sería un falso positivo. Hoy en producción: `2026-09-28T00:00:00Z`. |

### Rescate de mensajes perdidos (opcional)

Cuando la reconciliación detecta que Kommo nunca entregó un mensaje, el rescate
lo reconstruye y lo mete por la puerta normal.

| Variable | Por omisión | Qué hace |
|---|---|---|
| `RESCATE_SIMULACRO` | `true` | **Por omisión NO envía**: solo anota lo que habría hecho. Hay que ponerlo en `false` explícitamente para que rescate de verdad. |
| `RESCATE_TRAS_MIN` | `4` | Cuánto se espera antes de intentar el rescate. |
| `RESCATE_HASTA_MIN` | `15` | Techo. Pasado esto no se rescata: el campo de Kommo ya fue sobrescrito por mensajes más nuevos y se enviaría el texto equivocado. |
| `KOMMO_CAMPO_MENSAJE` | `Acá va el mensaje` | Nombre del campo del lead donde el salesbot de Kommo deja el último mensaje entrante. De ahí se saca el texto a rescatar. |
| `RESCATE_ETAPAS` | vacío | IDs de etapa, separados por coma, donde sí se rescata. Vacío = en ninguna. Solo tiene sentido donde el salesbot escribe ese campo; en las demás el texto estaría desfasado. |

**Los dos valores por omisión que protegen**: `RESCATE_SIMULACRO=true` y
`RESCATE_ETAPAS` vacío. Encender el rescate sin pensarlo puede hacer que el
agente conteste a un mensaje viejo.

---

## Permisos que hace falta pedirle a Kommo

El intermediario solo necesita token **si se quiere la reconciliación**. Para
recibir webhooks y reenviar no hace falta ninguno.

Los endpoints que usa con ese token:

| Endpoint | Para qué |
|---|---|
| `GET /api/v4/events?filter[type][]=incoming_chat_message` | La lista de mensajes que Kommo registró |
| `GET /api/v4/leads/{id}` | Leer la etapa y el campo del mensaje, para el rescate |
| `GET /api/v4/talks?filter[entity_id]=…` | Encontrar la conversación del lead |

Los **scopes** que debe traer la integración de Kommo:

- `crm` — leads y eventos
- `list_external_messages` — las conversaciones
- `notifications` y `push_notifications` — webhooks
- `send_external_messages` — si el mismo token se usa para responder
- `files` y `files_delete` — solo si ese token también sube imágenes al Drive

El token del proyecto ya trae los siete, porque es el mismo que usa el envío.

### El webhook, del lado de Kommo

En **Ajustes → Integraciones → Webhooks**:

- Destino: `https://automatizaciones-salones-intermediario.hpzji3.easypanel.host/kommo`
- Evento: **`add_message`** (mensaje agregado)

Kommo manda `application/x-www-form-urlencoded` con claves tipo
`message[add][0][text]`. El intermediario **no transforma nada**: guarda el
cuerpo tal cual y se lo pasa a n8n con el mismo `content-type`. Quien lo
interpreta es el flujo.

---

## La base de datos

PostgreSQL. **El esquema se crea solo en cada arranque** (`CREATE TABLE IF NOT
EXISTS`), así que no hay migraciones que correr a mano.

| Tabla | Para qué | Quién la escribe |
|---|---|---|
| `cola_mensajes` | La cola: cada webhook con su estado, intentos, tiempos y error | el intermediario |
| `latencia_ack` | Cuánto tardó en contestarle a Kommo cada vez | el intermediario |
| `reconciliacion` | Un renglón por mensaje que Kommo dice haber tenido, con su veredicto | el intermediario |
| `buffer_mensajes` | Ráfagas: mensajes seguidos de un mismo lead, para contestar una sola vez | **el flujo de n8n** |
| `conversacion_turnos` | Un renglón por turno: qué dijo el cliente, qué agente contestó y qué redactó | **el flujo de n8n** |

Las dos últimas no las usa el intermediario. Viven aquí porque **este proceso
es el único que administra el esquema de esta base**, y así se crean solas sin
que nadie tenga que acordarse.

Los estados de `cola_mensajes` son `pendiente`, `procesando`, `enviado` y
`fallido`. **Ninguna fila se borra nunca**, ni siquiera al reenviar a mano: el
reenvío reinicia los intentos y conserva el historial.

El contenedor **no necesita volumen**. Todo el estado vive en Postgres, así que
se puede reemplazar entero sin perder la cola.

---

## Cómo se empieza el desarrollo

### En la máquina de uno

```bash
cd intermediario
npm install
```

Hace falta un PostgreSQL. El más rápido:

```bash
docker run -d --name pg-intermediario -e POSTGRES_PASSWORD=local -p 5432:5432 postgres:16
```

Y arrancar en modo prueba, que guarda todo pero no reenvía a nadie:

```bash
DATABASE_URL=postgres://postgres:local@localhost:5432/postgres SOLO_REGISTRAR=true npm start
```

Abre `http://localhost:3000` y ahí está el tablero. Para simular un mensaje de
Kommo sin tener Kommo:

```bash
curl -X POST http://localhost:3000/kommo -H "Content-Type: application/x-www-form-urlencoded" --data "message[add][0][id]=prueba-1&message[add][0][type]=incoming&message[add][0][entity_id]=123&message[add][0][text]=hola"
```

### En el servidor

En Easypanel, proyecto `automatizaciones`, **+ Service → App**:

| Campo | Valor |
|---|---|
| Nombre | `salones-intermediario` |
| Source | el repositorio, rama `main` |
| Build | **Dockerfile**, con *Build context* en `intermediario/` |
| Puerto del dominio | **3000** |

Las variables van en **Environment**. Después, en Kommo, apuntar el webhook a
`https://<dominio>/kommo`.

**No lleva volumen.** Si alguien le agrega uno, es señal de que algo se está
guardando en disco que no debería.

---

## Cómo se revisa que esté bien

1. **`GET /health`** → `{"ok":true,"enVuelo":0,"max":8}`. Es lo que debe mirar
   cualquier monitor.
2. **El tablero**, en `/`. Lo que importa: `pendientes` cerca de cero y
   `fallidos` en cero.
3. **`GET /api/stats`** da lo mismo en JSON, con los percentiles de latencia.

Si `pendientes` crece y no baja, n8n está caído o lento. Si `fallidos` sube,
n8n está contestando con error: la columna `error` de `cola_mensajes` dice cuál.

---

## Lo que hay que saber antes de tocarlo

**El 200 va antes que el reenvío, no después.** Ese orden es todo el diseño.
Invertirlo —reenviar y luego contestar— devuelve el problema que este servicio
existe para resolver.

**El `msg_id` único es la red de seguridad contra duplicados.** Si se quita esa
restricción, un reintento de Kommo hace que el cliente reciba dos respuestas.

**Un mensaje que n8n contesta con error se reintenta, y eso puede duplicar un
envío a medias.** Por eso, del lado del flujo, el nodo que manda el mensaje al
cliente está en «continuar aunque falle»: así n8n devuelve 200 y el
intermediario no reintenta. El fallo se ve en la columna `enviada` de
`conversacion_turnos`, no en la cola.
