/**
 * Intermediario de webhooks Kommo -> n8n (Salones Agustin Barron)
 *
 * Motivo: Kommo exige respuesta en 2 s. n8n (modo regular, un solo proceso)
 * supera ese limite el 6,7% del tiempo, y Kommo marca esas entregas como
 * fallidas. Este servicio recibe, persiste y responde 200 en milisegundos;
 * luego alimenta a n8n a un ritmo que no lo satura.
 *
 * Reglas:
 *   - Persistir SIEMPRE antes de responder 200 (si no, se pierde el mensaje).
 *   - Guardar el payload EXACTAMENTE como lo manda Kommo y reenviarlo intacto.
 *   - Deduplicar por msg_id (mata los reintentos de Kommo).
 *   - FIFO por entity_id: orden estricto por conversacion, paralelo entre leads.
 *   - Nunca mas de MAX_INFLIGHT ejecuciones en vuelo contra n8n.
 *   - NUNCA borrar filas: el historial completo queda para auditoria.
 */

import http from 'node:http';
import { Buffer } from 'node:buffer';
import pg from 'pg';

const CFG = {
  puerto: Number(process.env.PORT || 3000),
  dbUrl: process.env.DATABASE_URL,
  n8nUrl: process.env.N8N_WEBHOOK_URL,
  maxInflight: Number(process.env.MAX_INFLIGHT || 8),
  maxIntentos: Number(process.env.MAX_INTENTOS || 5),
  timeoutN8nMs: Number(process.env.TIMEOUT_N8N_MS || 180000),
  alertaCola: Number(process.env.ALERTA_COLA || 25),
  alertaEdadMin: Number(process.env.ALERTA_EDAD_MIN || 5),
  tgToken: process.env.TELEGRAM_BOT_TOKEN || '',
  tgChats: (process.env.TELEGRAM_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  soloRegistrar: process.env.SOLO_REGISTRAR === 'true', // modo prueba: no reenvia a n8n
  // Reconciliacion: compara lo que Kommo registro contra lo que recibimos.
  kommoBase: process.env.KOMMO_BASE || 'https://administracioneventos6.kommo.com/api/v4',
  kommoToken: process.env.KOMMO_TOKEN || '',
  reconCadaMin: Number(process.env.RECON_CADA_MIN || 5),
  reconVentanaMin: Number(process.env.RECON_VENTANA_MIN || 120),
  reconGraciaMin: Number(process.env.RECON_GRACIA_MIN || 60), // ventana de reintentos de Kommo
  // Suelo: eventos anteriores a esta fecha se ignoran. Antes de que el
  // intermediario entrara en la ruta es normal que no los tengamos, y
  // contarlos como perdidos seria un falso positivo.
  reconDesde: process.env.RECON_DESDE || '',
  // Rescate: reconstruir el mensaje perdido y meterlo por la puerta normal.
  // Corto a proposito: el campo 'Aca va el mensaje' de Kommo guarda SOLO el
  // ultimo mensaje, asi que esperar mucho significaria reenviar un texto que
  // ya no corresponde.
  rescateTrasMin: Number(process.env.RESCATE_TRAS_MIN || 4),
  // Techo: pasado esto NO se rescata. El campo de Kommo ya habra sido
  // sobrescrito por mensajes mas nuevos y enviariamos el texto equivocado.
  rescateHastaMin: Number(process.env.RESCATE_HASTA_MIN || 15),
  rescateSimulacro: process.env.RESCATE_SIMULACRO !== 'false', // por defecto NO envia
  campoMensaje: process.env.KOMMO_CAMPO_MENSAJE || 'Acá va el mensaje',
  // Solo se rescata en etapas donde el salesbot de Kommo escribe el campo
  // con el mensaje entrante. En las demas el texto estaria desfasado, asi
  // que se marca para atencion humana en vez de responder algo equivocado.
  rescateEtapas: (process.env.RESCATE_ETAPAS || '')
    .split(',').map((x) => x.trim()).filter(Boolean),
};

if (!CFG.dbUrl) throw new Error('Falta DATABASE_URL');
if (!CFG.n8nUrl && !CFG.soloRegistrar) throw new Error('Falta N8N_WEBHOOK_URL');

const pool = new pg.Pool({ connectionString: CFG.dbUrl, max: 12 });
const log = (...a) => console.log(new Date().toISOString(), ...a);

// node-postgres emite 'error' en clientes ociosos cuando se cae la conexion.
// Sin este manejador, ese evento tumba el proceso entero.
pool.on('error', (e) => log('ERROR del pool de Postgres (recuperable):', e.message));

// ---------------------------------------------------------------- esquema

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS cola_mensajes (
  id                BIGSERIAL PRIMARY KEY,
  msg_id            TEXT UNIQUE,
  entity_id         TEXT,
  texto             TEXT,
  tipo              TEXT,
  payload           TEXT        NOT NULL,
  content_type      TEXT,
  recibido_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_en_kommo   TIMESTAMPTZ,
  estado            TEXT        NOT NULL DEFAULT 'pendiente',
  intentos          INT         NOT NULL DEFAULT 0,
  siguiente_intento TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviado_en        TIMESTAMPTZ,
  espera_ms         INT,
  ack_ms            INT,
  error             TEXT
);
CREATE INDEX IF NOT EXISTS ix_cola_pendientes ON cola_mensajes (estado, siguiente_intento, id);
CREATE INDEX IF NOT EXISTS ix_cola_entity     ON cola_mensajes (entity_id, estado);
CREATE INDEX IF NOT EXISTS ix_cola_recibido   ON cola_mensajes (recibido_en DESC);
ALTER TABLE cola_mensajes ADD COLUMN IF NOT EXISTS adjunto TEXT;

-- Un renglon por turno de conversacion: lo que dijo el cliente, que agente
-- contesto y que redacto. Tampoco la usa el intermediario, la escribe el
-- flujo; vive aqui por lo mismo que el buffer.
--
-- Mientras la respuesta no se envie, esta tabla ES el producto: es donde se
-- lee lo que el agente HABRIA contestado, sin que ningun cliente lo reciba.
-- Por eso 'enviada' arranca en false y no se toca hasta que exista el envio.
--
-- 'campos' guarda como estaba el lead en ese momento. Sin esa foto, revisar
-- meses despues por que cotizo lo que cotizo es imposible: los campos de
-- Kommo ya cambiaron.
CREATE TABLE IF NOT EXISTS conversacion_turnos (
  id            BIGSERIAL PRIMARY KEY,
  lead_id       TEXT        NOT NULL,
  msg_id        TEXT,
  origen        TEXT,
  autor         TEXT,
  cliente_dijo  TEXT,
  en_rafaga     INT,
  agente        TEXT,
  respuesta     TEXT,
  enviada       BOOLEAN     NOT NULL DEFAULT false,
  etapa_id      BIGINT,
  campos        JSONB,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_turnos_lead ON conversacion_turnos (lead_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS ix_turnos_fecha ON conversacion_turnos (creado_en DESC);
-- Como quedo partida la respuesta: es lo que de verdad se enviaria.
ALTER TABLE conversacion_turnos ADD COLUMN IF NOT EXISTS partes JSONB;

-- Buffer de rafagas para n8n. No lo usa el intermediario: lo usa el flujo,
-- que junta los mensajes seguidos de una misma conversacion y contesta una
-- sola vez. Vive aqui porque este proceso es el unico que administra el
-- esquema de esta base, y asi la tabla se crea sola en cada arranque.
--
-- Sin columna de candado no hay nada que se pueda trabar: una fila sin consumir
-- es trabajo pendiente, no una conversacion bloqueada. Si una
-- ejecucion muere a medias, el siguiente mensaje se lleva todo lo que quedo.
CREATE TABLE IF NOT EXISTS buffer_mensajes (
  id           BIGSERIAL PRIMARY KEY,
  lead_id      TEXT        NOT NULL,
  msg_id       TEXT        UNIQUE,
  texto        TEXT,
  recibido_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumido_en TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_buffer_pendientes
  ON buffer_mensajes (lead_id, recibido_en) WHERE consumido_en IS NULL;

CREATE TABLE IF NOT EXISTS latencia_ack (
  id       BIGSERIAL PRIMARY KEY,
  momento  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ms       INT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lat_momento ON latencia_ack (momento DESC);

-- Reconciliacion: un registro por cada mensaje entrante que Kommo dice haber
-- tenido, con el veredicto de si nos llego o no. Es el historial de novedades.
CREATE TABLE IF NOT EXISTS reconciliacion (
  evento_id   TEXT PRIMARY KEY,
  entity_id   TEXT,
  creado_en   TIMESTAMPTZ NOT NULL,
  visto_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  estado      TEXT        NOT NULL,   -- ok | pendiente | recuperado | perdido
  llegado_en  TIMESTAMPTZ,
  demora_seg  INT,
  texto       TEXT,
  revisado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_recon_creado ON reconciliacion (creado_en DESC);
CREATE INDEX IF NOT EXISTS ix_recon_estado ON reconciliacion (estado, creado_en DESC);
ALTER TABLE reconciliacion ADD COLUMN IF NOT EXISTS msg_id       TEXT;
ALTER TABLE reconciliacion ADD COLUMN IF NOT EXISTS rescatado_en TIMESTAMPTZ;
ALTER TABLE reconciliacion ADD COLUMN IF NOT EXISTS rescate_nota TEXT;
CREATE INDEX IF NOT EXISTS ix_recon_msg ON reconciliacion (msg_id);
`;

// ---------------------------------------------------------------- utilidades

function parseKommo(raw) {
  // Kommo envia x-www-form-urlencoded con claves tipo message[add][0][text].
  // Solo extraemos campos para MOSTRAR en el panel; el payload se guarda y se
  // reenvia tal cual llego, sin transformar nada.
  const p = new URLSearchParams(raw);
  const g = (k) => p.get(k) || null;
  const ts = g('message[add][0][created_at]');

  // Imagen / audio / documento llegan sin texto: describimos el adjunto.
  const mt = g('message[add][0][message_type]');
  const at = g('message[add][0][attachment][type]');
  const an = g('message[add][0][attachment][file_name]');
  const au = g('message[add][0][attachment][link]') || g('message[add][0][attachment][url]');
  const clase = at || (mt && mt !== 'text' ? mt : null);
  const adjunto = clase ? [clase, an, au].filter(Boolean).join(' | ') : null;

  return {
    msgId: g('message[add][0][id]'),
    entityId: g('message[add][0][entity_id]') || g('message[add][0][element_id]'),
    texto: g('message[add][0][text]'),
    tipo: g('message[add][0][type]'),
    adjunto,
    creadoEnKommo: ts ? new Date(Number(ts) * 1000) : null,
  };
}

async function telegram(texto) {
  if (!CFG.tgToken || !CFG.tgChats.length) return;
  for (const chat of CFG.tgChats) {
    try {
      await fetch(`https://api.telegram.org/bot${CFG.tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: texto }),
      });
    } catch (e) {
      log('ERROR telegram:', e.message);
    }
  }
}

// ---------------------------------------------------------------- receptor

async function recibir(req, res, raw) {
  const t0 = Date.now();
  const d = parseKommo(raw);

  // Sin msg_id no podemos deduplicar; lo guardamos igual con una clave sintetica.
  const msgId = d.msgId || `sin-id:${t0}:${Math.trunc(performance.now() * 1000)}`;

  try {
    const r = await pool.query(
      `INSERT INTO cola_mensajes
         (msg_id, entity_id, texto, tipo, adjunto, payload, content_type, creado_en_kommo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (msg_id) DO NOTHING
       RETURNING id`,
      [msgId, d.entityId, d.texto, d.tipo, d.adjunto, raw,
       req.headers['content-type'] || '', d.creadoEnKommo]
    );

    const ms = Date.now() - t0;
    // Responder DESPUES de persistir: si respondieramos antes, una caida
    // entre ambos perderia el mensaje y Kommo ya no lo reintentaria.
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');

    pool.query('INSERT INTO latencia_ack (ms) VALUES ($1)', [ms]).catch(() => {});
    if (r.rowCount === 0) {
      log(`dup  ${msgId} lead=${d.entityId} (${ms}ms)`);
    } else {
      pool.query('UPDATE cola_mensajes SET ack_ms=$1 WHERE id=$2', [ms, r.rows[0].id]).catch(() => {});
      log(`in   ${msgId} lead=${d.entityId} ${JSON.stringify(d.texto || d.adjunto || '(vacio)')} (${ms}ms)`);
    }
  } catch (e) {
    log('ERROR al persistir:', e.message);
    // 500 a proposito: que Kommo reintente, es preferible a perderlo.
    res.writeHead(500).end('error');
    telegram(`Intermediario Salones: fallo al persistir un mensaje.\n${e.message}`);
  }
}

// ---------------------------------------------------------------- worker

let enVuelo = 0;

async function reclamar(cupo) {
  // Un solo mensaje en vuelo por entity_id (orden por conversacion),
  // y dentro de cada conversacion el mas antiguo primero.
  const { rows } = await pool.query(
    `UPDATE cola_mensajes SET estado='procesando', intentos = intentos + 1
      WHERE id IN (
        SELECT c.id FROM cola_mensajes c
         WHERE c.estado = 'pendiente'
           AND c.siguiente_intento <= now()
           AND NOT EXISTS (
                 SELECT 1 FROM cola_mensajes p
                  WHERE p.entity_id IS NOT DISTINCT FROM c.entity_id
                    AND p.estado = 'procesando')
           AND c.id = (SELECT MIN(m.id) FROM cola_mensajes m
                        WHERE m.entity_id IS NOT DISTINCT FROM c.entity_id
                          AND m.estado = 'pendiente'
                          AND m.siguiente_intento <= now())
         ORDER BY c.id
         LIMIT $1
         FOR UPDATE SKIP LOCKED)
      RETURNING *`,
    [cupo]
  );
  return rows;
}

async function entregar(fila) {
  const espera = Date.now() - new Date(fila.recibido_en).getTime();

  if (CFG.soloRegistrar) {
    await pool.query(
      `UPDATE cola_mensajes SET estado='enviado', enviado_en=now(), espera_ms=$1 WHERE id=$2`,
      [espera, fila.id]
    );
    log(`test ${fila.msg_id} (modo SOLO_REGISTRAR, no se envio a n8n)`);
    return;
  }

  try {
    // El payload viaja intacto, con el mismo content-type que mando Kommo.
    const r = await fetch(CFG.n8nUrl, {
      method: 'POST',
      headers: { 'content-type': fila.content_type || 'application/x-www-form-urlencoded' },
      body: fila.payload,
      signal: AbortSignal.timeout(CFG.timeoutN8nMs),
    });
    if (!r.ok) throw new Error(`n8n respondio ${r.status}`);

    await pool.query(
      `UPDATE cola_mensajes SET estado='enviado', enviado_en=now(), espera_ms=$1, error=NULL WHERE id=$2`,
      [espera, fila.id]
    );
    log(`out  ${fila.msg_id} lead=${fila.entity_id} espera=${Math.round(espera / 1000)}s`);
  } catch (e) {
    const agotado = fila.intentos >= CFG.maxIntentos;
    const backoff = Math.min(2 ** fila.intentos, 60); // 2,4,8,16,32,60 s
    await pool.query(
      `UPDATE cola_mensajes
          SET estado = $1, error = $2, siguiente_intento = now() + ($3 || ' seconds')::interval
        WHERE id = $4`,
      [agotado ? 'fallido' : 'pendiente', String(e.message).slice(0, 500), backoff, fila.id]
    );
    log(`ERR  ${fila.msg_id} intento ${fila.intentos}/${CFG.maxIntentos}: ${e.message}`);
    if (agotado) {
      telegram(
        `Intermediario Salones: mensaje NO entregado a n8n tras ${CFG.maxIntentos} intentos.\n` +
          `lead: ${fila.entity_id}\nmsg: ${fila.msg_id}\n` +
          `texto: ${fila.texto || fila.adjunto || '(sin texto)'}\nerror: ${e.message}\n` +
          `Reenvialo a mano desde el panel.`
      );
    }
  }
}

async function bucle() {
  try {
    const cupo = CFG.maxInflight - enVuelo;
    if (cupo > 0) {
      const filas = await reclamar(cupo);
      for (const f of filas) {
        enVuelo++;
        entregar(f)
          .catch((e) => log('ERROR no capturado en entregar:', e.message))
          .finally(() => { enVuelo--; });
      }
    }
  } catch (e) {
    log('ERROR en el bucle:', e.message);
  } finally {
    setTimeout(bucle, 400);
  }
}

// Rescate: si el proceso murio con filas en 'procesando', devolverlas a la cola.
async function rescatarHuerfanas() {
  const { rowCount } = await pool.query(
    `UPDATE cola_mensajes SET estado='pendiente'
      WHERE estado='procesando' AND recibido_en < now() - interval '10 minutes'`
  );
  if (rowCount) log(`rescatadas ${rowCount} filas atascadas en 'procesando'`);
}

let ultimaAlerta = 0;
async function vigilar() {
  try {
    const { rows } = await pool.query(
      `SELECT count(*) FILTER (WHERE estado='pendiente') AS pendientes,
              count(*) FILTER (WHERE estado='fallido')   AS fallidos,
              COALESCE(EXTRACT(EPOCH FROM now()
                       - MIN(recibido_en) FILTER (WHERE estado='pendiente')), 0) AS edad_seg
         FROM cola_mensajes`
    );
    const s = rows[0];
    const alerta = Number(s.pendientes) > CFG.alertaCola || Number(s.edad_seg) > CFG.alertaEdadMin * 60;
    if (alerta && Date.now() - ultimaAlerta > 10 * 60 * 1000) {
      ultimaAlerta = Date.now();
      telegram(
        `Intermediario Salones: la cola se esta acumulando.\n` +
          `pendientes: ${s.pendientes}\nmas antiguo: ${Math.round(s.edad_seg / 60)} min\nfallidos: ${s.fallidos}`
      );
    }
  } catch (e) {
    log('ERROR al vigilar:', e.message);
  }
}

// ------------------------------------------------------- reconciliacion

/**
 * Le pregunta a Kommo que mensajes entrantes registro en la ventana reciente y
 * los contrasta con lo que este servicio recibio. Es la unica forma de detectar
 * lo que Kommo nunca nos entrego: mirando solo nuestra tabla, esos mensajes son
 * invisibles (sesgo de supervivencia).
 *
 * Estados:
 *   ok          -> nos llego
 *   pendiente   -> falta, pero sigue dentro de la ventana de reintentos de Kommo
 *   recuperado  -> faltaba y llego despues (se guarda cuanto tardo)
 *   perdido     -> paso la ventana de gracia y nunca llego
 */
async function kommo(ruta) {
  const r = await fetch(CFG.kommoBase + ruta, {
    headers: { Authorization: `Bearer ${CFG.kommoToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(45000),
  });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`Kommo ${ruta} respondio ${r.status}`);
  return r.json();
}

/**
 * Reconstruye el webhook que Kommo habria enviado y lo mete en NUESTRA cola.
 * No llamamos al fork de rescate de n8n: al entrar por la cola normal se
 * reutiliza todo el pipeline correcto de plan D (buffer, dedup, Stop IA,
 * round robin). Y como usamos el msg_id real, si Kommo entrega el mensaje mas
 * tarde, la deduplicacion lo descarta sola.
 */
async function rescatar(ev, msgId, creado) {
  const lead = String(ev.entity_id);

  // 1) La etapa manda: si el salesbot de Kommo no escribe el campo en esta
  //    etapa, el texto estaria desfasado y responderiamos a otro mensaje.
  const l = await kommo(`/leads/${lead}`);
  const etapa = String((l && l.status_id) || '');
  if (!CFG.rescateEtapas.includes(etapa)) {
    return {
      estado: 'requiere_atencion',
      nota: `etapa ${etapa} sin salesbot: el texto no es de fiar, no se responde`,
      texto: null,
    };
  }

  // 2) El texto vive en el campo personalizado que llena ese salesbot.
  const campo = ((l && l.custom_fields_values) || [])
    .find((c) => (c.field_name || '').trim() === CFG.campoMensaje);
  const texto = campo && campo.values && campo.values[0] && campo.values[0].value;
  if (!texto) throw new Error(`campo "${CFG.campoMensaje}" vacio`);

  // Guarda contra campo desfasado: el salesbot no escribe en cada mensaje, asi
  // que el campo puede tener uno viejo. Si ese texto ya lo procesamos antes
  // para este lead, no es el mensaje perdido: no respondemos nada.
  const yaVisto = await pool.query(
    'SELECT 1 FROM cola_mensajes WHERE entity_id=$1 AND texto=$2 LIMIT 1', [lead, texto]);
  if (yaVisto.rowCount) {
    return {
      estado: 'requiere_atencion',
      nota: 'el texto del campo ya fue procesado antes: campo desfasado, no se responde',
      texto,
    };
  }

  // 3) talk_id / chat_id / contact_id: el chat_id es la clave del buffer de plan D.
  const t = await kommo(`/talks?filter[entity_id]=${lead}&filter[entity_type]=lead&limit=1`);
  const talk = t && t._embedded && t._embedded.talks && t._embedded.talks[0];
  if (!talk || !talk.chat_id) throw new Error('sin talk/chat_id para el lead');

  const cuerpo = new URLSearchParams({
    'account[subdomain]': (CFG.kommoBase.match(/\/\/([^.]+)\./) ?? ['', ''])[1],
    'account[id]': String(ev.account_id || ''),
    'message[add][0][id]': msgId,
    'message[add][0][chat_id]': talk.chat_id,
    'message[add][0][talk_id]': String(talk.talk_id),
    'message[add][0][contact_id]': String(talk.contact_id || ''),
    'message[add][0][text]': texto,
    'message[add][0][created_at]': String(Math.floor(creado.getTime() / 1000)),
    'message[add][0][message_type]': 'text',
    'message[add][0][element_type]': '2',
    'message[add][0][entity_type]': 'lead',
    'message[add][0][element_id]': lead,
    'message[add][0][entity_id]': lead,
    'message[add][0][type]': 'incoming',
    'message[add][0][origin]': talk.origin || 'waba',
  }).toString();

  const nota = `talk=${talk.talk_id} chat=${talk.chat_id} texto=${JSON.stringify(texto).slice(0, 160)}`;

  if (CFG.rescateSimulacro) {
    log(`SIMULACRO de rescate: lead ${lead} msg ${msgId} -> ${nota}`);
    return { estado: 'simulacro', nota: 'SIMULACRO (no enviado) | ' + nota, texto, payload: cuerpo };
  }

  const ins = await pool.query(
    `INSERT INTO cola_mensajes
       (msg_id, entity_id, texto, tipo, payload, content_type, creado_en_kommo)
     VALUES ($1,$2,$3,'incoming',$4,'application/x-www-form-urlencoded',$5)
     ON CONFLICT (msg_id) DO NOTHING RETURNING id`,
    [msgId, lead, texto, cuerpo, creado.toISOString()]
  );
  if (!ins.rowCount) return { estado: 'ok', nota: 'ya estaba en la cola', texto };
  log(`RESCATADO: lead ${lead} msg ${msgId} encolado como #${ins.rows[0].id}`);
  return { estado: 'rescatado', nota, texto };
}

/**
 * Le pregunta a Kommo que mensajes entrantes registro y los contrasta con lo
 * que recibimos. Kommo anota el evento en su propio libro tenga o no exito
 * notificando por webhook: por eso este cruce revela lo que nunca nos llego.
 *
 * Estados: ok | pendiente | recuperado | perdido | simulacro | rescatado
 */
let ultimaRevision = 0;

async function ventanaDesde() {
  const tope = Math.floor(Date.now() / 1000) - CFG.reconVentanaMin * 60;
  // Primera pasada tras arrancar: ventana completa.
  if (!ultimaRevision) return tope;
  // Solape de 90 s: Kommo puede tardar en indexar el evento.
  let desde = ultimaRevision - 90;
  // Si hay algo sin resolver, hay que seguir mirandolo hasta que se cierre.
  const q = await pool.query(
    `SELECT EXTRACT(EPOCH FROM MIN(creado_en))::bigint AS t
       FROM reconciliacion WHERE estado = 'pendiente'`);
  const pend = q.rows[0].t ? Number(q.rows[0].t) : null;
  if (pend && pend < desde) desde = pend;
  return Math.max(desde, tope);
}

async function reconciliar() {
  if (!CFG.kommoToken) return;
  const desde = await ventanaDesde();
  let eventos = [];
  try {
    const d = await kommo(`/events?filter[type][]=incoming_chat_message` +
                          `&filter[created_at][from]=${desde}&limit=250`);
    eventos = (d && d._embedded && d._embedded.events) || [];
  } catch (e) {
    log('ERROR al reconciliar contra Kommo:', e.message);
    return;
  }

  const suelo = CFG.reconDesde ? new Date(CFG.reconDesde).getTime() : 0;
  const cuenta = {};
  let ignorados = 0;

  for (const ev of eventos) {
    const lead = String(ev.entity_id);
    const creado = new Date(Number(ev.created_at) * 1000);
    if (creado.getTime() < suelo) { ignorados++; continue; }

    // El evento trae el mismo identificador de mensaje que el webhook: emparejar
    // por msg_id es exacto, sin margenes de tiempo ni falsos positivos.
    const va = ev.value_after && ev.value_after[0] && ev.value_after[0].message;
    const msgId = (va && va.id) || null;
    const edadMin = (Date.now() - creado.getTime()) / 60000;

    const q = msgId
      ? await pool.query(
          'SELECT recibido_en, texto, adjunto FROM cola_mensajes WHERE msg_id=$1', [msgId])
      : await pool.query(
          `SELECT recibido_en, texto, adjunto FROM cola_mensajes
            WHERE entity_id=$1 AND creado_en_kommo BETWEEN $2::timestamptz - interval '8 seconds'
                                                       AND $2::timestamptz + interval '8 seconds'
            ORDER BY id LIMIT 1`, [lead, creado.toISOString()]);

    const prev = await pool.query(
      'SELECT estado FROM reconciliacion WHERE evento_id=$1', [ev.id]);
    const antes = prev.rowCount ? prev.rows[0].estado : null;
    const yaGestionado = ['rescatado', 'simulacro', 'requiere_atencion'].includes(antes);

    let estado, llegado = null, demora = null, texto = null, nota = null, rescatadoEn = null;

    if (q.rowCount) {
      llegado = q.rows[0].recibido_en;
      demora = Math.round((new Date(llegado).getTime() - creado.getTime()) / 1000);
      texto = q.rows[0].texto || q.rows[0].adjunto;
      // Si lo habiamos rescatado, conservamos ese veredicto: es informacion.
      estado = yaGestionado ? antes : (['pendiente', 'perdido'].includes(antes) ? 'recuperado' : 'ok');
    } else if (yaGestionado) {
      estado = antes;
    } else if (edadMin >= CFG.rescateTrasMin && edadMin <= CFG.rescateHastaMin) {
      try {
        const r = await rescatar(ev, msgId || `rescate:${ev.id}`, creado);
        estado = r.estado; nota = r.nota; texto = r.texto;
        if (['rescatado', 'simulacro', 'requiere_atencion'].includes(estado)) {
          rescatadoEn = new Date().toISOString();
        }
      } catch (e) {
        // Cualquier fallo se marca para atencion humana: preferimos que alguien
        // lo mire a responderle al cliente algo que no corresponde.
        estado = 'requiere_atencion';
        nota = 'no se pudo reconstruir: ' + e.message;
        rescatadoEn = new Date().toISOString();
        log(`no se pudo rescatar lead ${lead}: ${e.message}`);
      }
    } else if (edadMin > CFG.rescateHastaMin) {
      // Demasiado viejo: el campo de Kommo ya fue sobrescrito por mensajes
      // mas nuevos, asi que no se toca. Queda para atencion humana.
      estado = 'requiere_atencion';
      if (!antes) {
        nota = `fuera de ventana de rescate (${Math.round(edadMin)} min > ${CFG.rescateHastaMin})`;
        rescatadoEn = new Date().toISOString();
      }
    } else {
      estado = 'pendiente';
    }

    cuenta[estado] = (cuenta[estado] || 0) + 1;
    await pool.query(
      `INSERT INTO reconciliacion
         (evento_id, entity_id, msg_id, creado_en, estado, llegado_en, demora_seg, texto, rescatado_en, rescate_nota)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (evento_id) DO UPDATE
         SET estado=EXCLUDED.estado, llegado_en=EXCLUDED.llegado_en, demora_seg=EXCLUDED.demora_seg,
             msg_id=COALESCE(EXCLUDED.msg_id, reconciliacion.msg_id),
             texto=COALESCE(EXCLUDED.texto, reconciliacion.texto),
             rescatado_en=COALESCE(EXCLUDED.rescatado_en, reconciliacion.rescatado_en),
             rescate_nota=COALESCE(EXCLUDED.rescate_nota, reconciliacion.rescate_nota),
             revisado_en=now()`,
      [ev.id, lead, msgId, creado.toISOString(), estado, llegado, demora, texto, rescatadoEn, nota]
    );
  }
  ultimaRevision = Math.floor(Date.now() / 1000);
  if (!eventos.length) return;   // nada nuevo: ni siquiera loguear
  log(`reconciliacion: ${eventos.length} eventos -> ` +
      Object.entries(cuenta).map(([k, v]) => `${k}:${v}`).join(' ') +
      (ignorados ? ` (ignorados por corte: ${ignorados})` : '') +
      (CFG.rescateSimulacro ? ' [SIMULACRO]' : ''));
}

// ---------------------------------------------------------------- panel

async function stats() {
  const [cola, lat, flujo] = await Promise.all([
    pool.query(
      `SELECT count(*) FILTER (WHERE estado='pendiente')  AS pendientes,
              count(*) FILTER (WHERE estado='procesando') AS procesando,
              count(*) FILTER (WHERE estado='enviado')    AS enviados,
              count(*) FILTER (WHERE estado='fallido')    AS fallidos,
              COALESCE(EXTRACT(EPOCH FROM now()
                       - MIN(recibido_en) FILTER (WHERE estado='pendiente')), 0) AS edad_seg,
              COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY espera_ms)
                       FILTER (WHERE enviado_en > now() - interval '1 hour'), 0) AS espera_p50,
              COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY espera_ms)
                       FILTER (WHERE enviado_en > now() - interval '1 hour'), 0) AS espera_p95
         FROM cola_mensajes`
    ),
    pool.query(
      `SELECT COALESCE(percentile_cont(0.5)  WITHIN GROUP (ORDER BY ms),0) AS p50,
              COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY ms),0) AS p95,
              COALESCE(max(ms),0) AS max, count(*) AS n,
              count(*) FILTER (WHERE ms > 2000) AS sobre_2s
         FROM latencia_ack WHERE momento > now() - interval '1 hour'`
    ),
    pool.query(
      `SELECT count(*) FILTER (WHERE recibido_en > now() - interval '1 hour') AS in_1h,
              count(*) FILTER (WHERE enviado_en  > now() - interval '1 hour') AS out_1h
         FROM cola_mensajes`
    ),
  ]);
  const recon = await pool.query(
    `SELECT count(*) FILTER (WHERE estado='ok')         AS ok,
            count(*) FILTER (WHERE estado='pendiente')  AS pendiente,
            count(*) FILTER (WHERE estado='recuperado') AS recuperado,
            count(*) FILTER (WHERE estado='perdido')    AS perdido,
            count(*) FILTER (WHERE estado='requiere_atencion') AS atencion,
            count(*) FILTER (WHERE estado='rescatado')  AS rescatado,
            count(*)                                    AS total,
            count(*) FILTER (WHERE estado='perdido'
                     AND creado_en > now() - interval '24 hours') AS perdido_24h,
            count(*) FILTER (WHERE creado_en > now() - interval '24 hours') AS total_24h
       FROM reconciliacion`
  );
  return {
    cola: cola.rows[0], ack: lat.rows[0], flujo: flujo.rows[0], recon: recon.rows[0],
    enVuelo, maxInflight: CFG.maxInflight, soloRegistrar: CFG.soloRegistrar,
    reconActiva: Boolean(CFG.kommoToken), kommoBase: CFG.kommoBase, reconDesde: CFG.reconDesde,
  };
}

const PANEL = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Intermediario Salones</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#0f1115;--card:#181b22;--line:#262b36;--tx:#e6e9ef;--mut:#8b93a7;--ok:#3fb950;--warn:#d29922;--bad:#f85149;--acc:#58a6ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.5 ui-sans-serif,system-ui,sans-serif;padding:20px}
h1{font-size:17px;margin:0 0 4px}.sub{color:var(--mut);font-size:12px;margin-bottom:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}
.lbl{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.5px}
.val{font-size:26px;font-weight:600;margin-top:4px}.u{font-size:12px;color:var(--mut);font-weight:400}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line);font-size:12px}
th{color:var(--mut);font-weight:500;text-transform:uppercase;font-size:10px;letter-spacing:.5px}
td.txt{max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{padding:1px 7px;border-radius:20px;font-size:11px}
.t-enviado{background:#12351d;color:var(--ok)}.t-pendiente{background:#3a2d0c;color:var(--warn)}
.t-procesando{background:#0d2f4f;color:var(--acc)}.t-fallido{background:#3d1518;color:var(--bad)}
.wrap{overflow-x:auto}.f{margin-bottom:10px}
.f button{background:var(--card);color:var(--tx);border:1px solid var(--line);padding:5px 12px;border-radius:6px;cursor:pointer;margin-right:6px;font-size:12px}
.f button.on{border-color:var(--acc);color:var(--acc)}
.rb{background:#1f2530;color:var(--acc);border:1px solid var(--line);padding:3px 9px;border-radius:5px;cursor:pointer;font-size:11px;white-space:nowrap}
.rb:hover{border-color:var(--acc)}.rb:disabled{opacity:.3;cursor:not-allowed}
.tabs{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid var(--line)}
.tabs button{background:none;border:none;border-bottom:2px solid transparent;color:var(--mut);padding:8px 14px;cursor:pointer;font-size:13px}
.tabs button.on{color:var(--tx);border-bottom-color:var(--acc)}
.t-ok{background:#12351d;color:var(--ok)}.t-perdido{background:#3d1518;color:var(--bad)}
.t-recuperado{background:#0d2f4f;color:var(--acc)}
.t-rescatado{background:#2a1f52;color:#bc8cff}.t-requiere_atencion{background:#4a2410;color:#ffa657}.t-simulacro{background:#3a2d0c;color:var(--warn)}
a.lead{color:var(--acc);text-decoration:none;border-bottom:1px dotted var(--acc)}a.lead:hover{opacity:.8}
#badge{background:var(--bad);color:#fff;border-radius:10px;padding:0 6px;font-size:10px;margin-left:4px}
.panelgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:12px;margin-bottom:14px}
.card h3{margin:0 0 10px;font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.5px;font-weight:500}
.card table{border:none;background:none}.card table td,.card table th{padding:4px 6px;border-bottom:1px solid var(--line)}
.bar{fill:var(--acc)}.bar2{fill:#3fb950}.barbad{fill:var(--bad)}
svg text{fill:var(--mut);font-size:9px}
.leyenda{font-size:10px;color:var(--mut);margin-top:6px}
</style></head><body>
<h1>Intermediario Kommo &rarr; n8n</h1>
<div class="sub">Salones &middot; actualiza cada 3 s &middot; <span id="modo"></span></div>
<div class="tabs">
  <button data-tab="mensajes" class="on">Mensajes recibidos</button>
  <button data-tab="recon">Dashboard <span id="badge"></span></button>
</div>
<div class="grid" id="k"></div>

<div id="vista-mensajes">
  <div class="f">
    <button data-e="" class="on">Todos</button><button data-e="perdido">Perdidos <span id="cnt-perd"></span></button>
    <button data-e="pendiente">Pendientes</button><button data-e="procesando">En vuelo</button>
    <button data-e="fallido">Fallidos</button><button data-e="enviado">Enviados</button>
  </div>
  <div id="aviso-perd"></div>
  <div class="wrap"><table><thead><tr><th>Recibido</th><th>Lead</th><th>Mensaje</th><th>Estado</th><th>ACK</th><th>Espera</th><th>Int.</th><th>Error</th><th></th></tr></thead><tbody id="t"></tbody></table></div>
  <div id="pag-m" style="margin-top:10px"></div>
</div>

<div id="vista-recon" style="display:none">
  <div class="f">
    <button data-h="6">Ultimas 6 h</button><button data-h="24" class="on">Ultimas 24 h</button><button data-h="72">Ultimos 3 dias</button>
    <button id="revisar" style="float:right;border-color:#58a6ff;color:#58a6ff">Actualizar</button>
  </div>
  <div class="grid" id="dk"></div>
  <div class="card" style="margin-bottom:14px"><h3>Horas pico &middot; mensajes entrantes por hora del dia (Colombia)</h3><div id="gpico"></div></div>
  <div class="card" style="margin-bottom:14px"><h3>Leads distintos por hora del dia (Colombia)</h3><div id="gpico2"></div></div>
  <div class="panelgrid">
    <div class="card"><h3>Mensajes y leads por hora</h3><div id="g1"></div></div>
    <div class="card"><h3>Leads nuevos por hora</h3><div id="g2"></div></div>
    <div class="card"><h3>Mensajes que no llegaron, por hora</h3><div id="g4"></div></div>
    <div class="card"><h3>Cuanto tarda en llegarnos el mensaje (s)</h3><div id="g5"></div></div>
    <div class="card"><h3>Dias de la semana</h3><div id="g6"></div></div>
  </div>
  <div class="card" id="drill" style="display:none;margin-bottom:14px"></div>
  <div class="panelgrid">
    <div class="card"><h3>Cuantos mensajes escribe cada lead</h3><table id="t-porlead"></table></div>
    <div class="card"><h3>Tipo de contenido</h3><table id="t-tipos"></table></div>
    <div class="card"><h3>Leads mas activos</h3><table id="t-leads"></table></div>
    <div class="card"><h3>Salud tecnica</h3><table id="t-tec"></table></div>
  </div>
  <div class="card" style="padding:14px">
    <h3>Detalle de reconciliacion <span id="corte" style="text-transform:none;letter-spacing:0"></span></h3>
    <div class="f">
      <button data-r="" class="on">Todos</button><button data-r="requiere_atencion">Requieren atencion</button>
      <button data-r="perdido">Perdidos</button><button data-r="rescatado">Rescatados</button>
      <button data-r="recuperado">Recuperados</button><button data-r="ok">OK</button>
    </div>
    <div class="wrap"><table><thead><tr><th>Creado en Kommo</th><th>Lead</th><th>Mensaje</th><th>Veredicto</th><th>Demora</th><th>Antiguedad</th><th>Rescate</th></tr></thead><tbody id="tr"></tbody></table></div>
    <div id="pag-r" style="margin-top:10px"></div>
  </div>
</div>
  </div>
</div>
</div>
<script>
let filtro='', filtroR='', tab='mensajes', horas=24;
const PP=50;                       // filas por pagina
let pagM=0, pagP=0, pagR=0;        // pagina de mensajes / perdidos / reconciliacion
const n=(v,d=0)=>Number(v||0).toFixed(d);
const esc=s=>String(s==null?'':s).replace(/[<>&]/g,'');
function tarjeta(l,v,u,c){return '<div class="card"><div class="lbl">'+l+'</div><div class="val '+(c||'')+'">'+v+(u?' <span class="u">'+u+'</span>':'')+'</div></div>'}

// --- adjuntos: 'voice | file.ogg | https://...' -> 'audio - file.ogg' ---
const NOMBRE={voice:'audio',picture:'imagen',video:'video',file:'archivo',document:'documento',audio:'audio'};
function adjuntoLegible(a){
  if(!a) return '';
  const p=String(a).split(' | ');
  const clase=NOMBRE[(p[0]||'').toLowerCase()]||p[0];
  const nombre=p[1] && !/^https?:/i.test(p[1]) ? p[1] : '';
  return nombre ? clase+' - '+nombre : clase;
}
// --- paginador reutilizable ---
function paginador(destino, pagina, hayMas, fn){
  const el=document.getElementById(destino); if(!el) return;
  el.innerHTML='<button class="rb" '+(pagina<=0?'disabled':'')+' data-nav="-1">Anterior</button>'
    +'<span style="color:#8b93a7;font-size:11px;margin:0 10px">Pagina '+(pagina+1)+'</span>'
    +'<button class="rb" '+(hayMas?'':'disabled')+' data-nav="1">Siguiente</button>';
  el.querySelectorAll('button[data-nav]').forEach(b=>b.onclick=()=>fn(Number(b.dataset.nav)));
}



// --- detalle: leads de un rango, con lo que escribieron ---
let drillMin=0, drillMax=0, drillRango='', drillPag=0;
function cerrarDrill(){ const b=document.getElementById('drill'); if(b) b.style.display='none'; }
async function verLeads(mn,mx,rango){
  drillMin=mn; drillMax=mx; drillRango=rango; drillPag=0;
  await pintarDrill();
  document.getElementById('drill').scrollIntoView({behavior:'smooth',block:'start'});
}
async function pintarDrill(){
  const box=document.getElementById('drill'); if(!box) return;
  const s=await (await fetch('api/stats')).json();
  const base=(s.kommoBase||'').replace('/api/v4','');
  const all=await (await fetch('api/leads-rango?min='+drillMin+'&max='+drillMax+'&p='+drillPag)).json();
  const hayMas=all.length>50, filas=all.slice(0,50);
  box.style.display='';
  box.innerHTML='<h3 style="display:flex;justify-content:space-between;align-items:center">'
    +'<span>Leads que escribieron: '+drillRango+'</span>'
    +'<button class="rb" onclick="cerrarDrill()">Cerrar</button></h3>'
    +'<div class="wrap"><table><thead><tr><th>Lead</th><th>Mensajes</th><th>Primero</th><th>Ultimo</th><th>Que escribio</th></tr></thead><tbody>'
    +(filas.length?filas.map(function(r){
        return '<tr>'
          +'<td><a class="lead" href="'+base+'/leads/detail/'+r.entity_id+'" target="_blank" rel="noopener">'+esc(r.entity_id)+'</a></td>'
          +'<td style="text-align:right">'+r.c+'</td>'
          +'<td>'+new Date(r.primero).toLocaleString('es-CO')+'</td>'
          +'<td>'+new Date(r.ultimo).toLocaleString('es-CO')+'</td>'
          +'<td class="txt" style="max-width:520px" title="'+esc(r.muestra)+'">'+esc(r.muestra)+'</td>'
          +'</tr>';
      }).join('')
      :'<tr><td colspan="5" style="color:#8b93a7">Sin leads en este rango.</td></tr>')
    +'</tbody></table></div>'
    +'<div id="pag-d" style="margin-top:10px"></div>';
  paginador('pag-d',drillPag,hayMas,(d)=>{drillPag=Math.max(0,drillPag+d);pintarDrill();});
}

// --- barras con ejes legibles: viewBox amplio y SIN deformar el texto ---
function barrasEje(datos, campoX, campoY, opts){
  opts=opts||{};
  if(!datos.length) return '<div class="leyenda">Sin datos.</div>';
  const W=900, H=300, ML=54, MR=18, MT=24, MB=46;
  const iw=W-ML-MR, ih=H-MT-MB, n=datos.length;
  const vals=datos.map(d=>Number(d[campoY])||0);
  const crudo=Math.max(...vals,1);
  // Paso "bonito" (1, 2 o 5 por decada) para que el eje Y no salga con decimales.
  const bruto=crudo/4, exp=Math.pow(10,Math.floor(Math.log10(bruto)||0));
  const norm=bruto/exp;
  const paso=(norm<=1?1:norm<=2?2:norm<=5?5:10)*exp;
  const max=Math.max(Math.ceil(crudo/paso)*paso, paso);
  const bw=iw/n, x=i=>ML+i*bw, y=v=>MT+ih-(v/max)*ih;
  const pico=vals.indexOf(Math.max(...vals));
  let g='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:'+(opts.px||320)+'px;display:block">';
  // eje Y: 5 marcas con rejilla y su valor
  const marcas=Math.round(max/paso);
  for(let k=0;k<=marcas;k++){
    const v=k*paso, yy=y(v);
    g+='<line x1="'+ML+'" y1="'+yy+'" x2="'+(W-MR)+'" y2="'+yy+'" stroke="#262b36" stroke-width="1"/>';
    g+='<text x="'+(ML-9)+'" y="'+(yy+4)+'" text-anchor="end" style="font-size:13px;fill:#8b93a7">'+(Math.round(v*10)/10)+'</text>';
  }
  // barras
  datos.forEach(function(d,i){
    const v=Number(d[campoY])||0, yy=y(v), h=MT+ih-yy;
    const col = i===pico ? '#58a6ff' : '#2f6fa8';
    g+='<rect x="'+(x(i)+bw*0.16)+'" y="'+yy+'" width="'+(bw*0.68)+'" height="'+Math.max(h,1)+'" fill="'+col+'" rx="2"><title>'+d[campoX]+': '+v+(opts.u||'')+'</title></rect>';
    if(v>0 && (i===pico || n<=24))
      g+='<text x="'+(x(i)+bw/2)+'" y="'+(yy-6)+'" text-anchor="middle" style="font-size:11px;fill:'+(i===pico?'#e6e9ef':'#8b93a7')+'">'+v+'</text>';
    g+='<text x="'+(x(i)+bw/2)+'" y="'+(H-MB+20)+'" text-anchor="middle" style="font-size:12px;fill:'+(i===pico?'#e6e9ef':'#8b93a7')+'">'+d[campoX]+'</text>';
  });
  // ejes
  g+='<line x1="'+ML+'" y1="'+(MT+ih)+'" x2="'+(W-MR)+'" y2="'+(MT+ih)+'" stroke="#3a4150" stroke-width="1.5"/>';
  g+='<line x1="'+ML+'" y1="'+MT+'" x2="'+ML+'" y2="'+(MT+ih)+'" stroke="#3a4150" stroke-width="1.5"/>';
  // titulos de eje
  g+='<text x="'+(ML+iw/2)+'" y="'+(H-6)+'" text-anchor="middle" style="font-size:12px;fill:#8b93a7">'+(opts.ejeX||'')+'</text>';
  g+='<text x="14" y="'+(MT+ih/2)+'" text-anchor="middle" transform="rotate(-90 14 '+(MT+ih/2)+')" style="font-size:12px;fill:#8b93a7">'+(opts.ejeY||'')+'</text>';
  g+='</svg>';
  return g+(opts.pie?'<div class="leyenda">'+opts.pie+'</div>':'');
}

// --- grafico de linea (una o varias series) en SVG ---
function lineas(datos, campoX, series, opts){
  opts=opts||{};
  if(!datos.length) return '<div class="leyenda">Sin datos en este periodo.</div>';
  const W=100,H=opts.alto||58,n=datos.length;
  let max=opts.min||0;
  series.forEach(s=>datos.forEach(d=>{max=Math.max(max,Number(d[s.c])||0)}));
  max=max||1;
  const x=i=>n<2?W/2:(i*W)/(n-1), y=v=>H-(Number(v)||0)/max*H;
  let svg='<svg viewBox="0 0 '+W+' '+(H+2)+'" preserveAspectRatio="none" style="width:100%;height:'+(opts.px||130)+'px">';
  // rejilla
  [0.25,0.5,0.75].forEach(f=>{svg+='<line x1="0" y1="'+(H*f)+'" x2="'+W+'" y2="'+(H*f)+'" stroke="#262b36" stroke-width="0.3"/>';});
  series.forEach(function(se){
    const pts=datos.map((d,i)=>x(i)+','+y(d[se.c])).join(' ');
    if(se.area) svg+='<polygon points="0,'+H+' '+pts+' '+W+','+H+'" fill="'+se.color+'" opacity="0.13"/>';
    svg+='<polyline points="'+pts+'" fill="none" stroke="'+se.color+'" stroke-width="0.9" stroke-linejoin="round"/>';
    datos.forEach((d,i)=>{svg+='<circle cx="'+x(i)+'" cy="'+y(d[se.c])+'" r="0.9" fill="'+se.color+'"><title>'+d[campoX]+' - '+se.n+': '+(d[se.c]||0)+'</title></circle>';});
  });
  svg+='</svg>';
  const leyenda=series.map(se=>'<span style="color:'+se.color+'">&#9679;</span> '+se.n).join(' &nbsp; ');
  return svg+'<div class="leyenda">'+leyenda+' &nbsp;&middot;&nbsp; '+datos[0][campoX]+' &rarr; '+datos[n-1][campoX]+' &middot; max '+Math.round(max*10)/10+(opts.u||'')+'</div>';
}

// --- grafico de barras en SVG, sin dependencias ---
function barras(datos, campoX, campoY, opts){
  opts=opts||{};
  if(!datos.length) return '<div class="leyenda">Sin datos en este periodo.</div>';
  const W=100, H=opts.alto||70, n=datos.length, w=W/n;
  const vals=datos.map(d=>Number(d[campoY])||0);
  const max=Math.max(opts.min||0, ...vals) || 1;
  const umbral=opts.umbral;
  let svg='<svg viewBox="0 0 '+W+' '+(H+10)+'" preserveAspectRatio="none" style="width:100%;height:'+(opts.px||120)+'px">';
  if(umbral!=null && umbral<=max){
    const y=H-(umbral/max)*H;
    svg+='<line x1="0" y1="'+y+'" x2="'+W+'" y2="'+y+'" stroke="#f85149" stroke-width="0.4" stroke-dasharray="1.5,1.5"/>';
  }
  datos.forEach(function(d,i){
    const v=Number(d[campoY])||0, h=(v/max)*H;
    const cls=(umbral!=null && v>umbral)?'barbad':(opts.verde?'bar2':'bar');
    svg+='<rect class="'+cls+'" x="'+(i*w+w*0.15)+'" y="'+(H-h)+'" width="'+(w*0.7)+'" height="'+Math.max(h,0.4)+'"><title>'+d[campoX]+': '+v+'</title></rect>';
  });
  svg+='</svg>';
  const prim=datos[0][campoX], ult=datos[n-1][campoX];
  return svg+'<div class="leyenda">'+prim+' &rarr; '+ult+' &middot; max '+Math.round(max*10)/10+(opts.u||'')+'</div>';
}
function tabla(filas, cols){
  if(!filas.length) return '<tr><td style="color:#8b93a7">Sin datos.</td></tr>';
  return filas.map(f=>'<tr>'+cols.map(c=>'<td'+(c.num?' style="text-align:right"':'')+'>'+c.v(f)+'</td>').join('')+'</tr>').join('');
}

async function reenviar(id,estado){
  if(estado==='enviado'){ if(!confirm('Este mensaje YA se entrego a n8n.\\nReenviarlo puede duplicar la conversacion.\\n\\nContinuar?')) return; }
  else { if(!confirm('Reenviar el mensaje #'+id+' a n8n?')) return; }
  const r=await fetch('api/reenviar/'+id,{method:'POST'});
  if(!r.ok){const e=await r.json().catch(()=>({}));alert('No se pudo reenviar: '+(e.error||r.status));}
  tick();
}
async function tick(){
  const s=await (await fetch('api/stats')).json();
  document.getElementById('modo').textContent = s.soloRegistrar ? 'MODO PRUEBA - no reenvia a n8n' : 'activo - max '+s.maxInflight+' en vuelo';
  const ack=Number(s.ack.p95), sobre=Number(s.ack.sobre_2s);
  document.getElementById('k').innerHTML=[
    tarjeta('En cola',n(s.cola.pendientes),'',Number(s.cola.pendientes)>25?'bad':Number(s.cola.pendientes)>5?'warn':'ok'),
    tarjeta('En vuelo',s.enVuelo+' / '+s.maxInflight),
    tarjeta('ACK a Kommo p95',n(ack),'ms',ack>2000?'bad':ack>1000?'warn':'ok'),
    tarjeta('ACK mayor a 2 s (1 h)',n(sobre),'',sobre>0?'bad':'ok'),
    tarjeta('Espera en cola p95',n(Number(s.cola.espera_p95)/1000,1),'s'),
    tarjeta('Mas antiguo',n(Number(s.cola.edad_seg)/60,1),'min',Number(s.cola.edad_seg)>300?'bad':''),
    tarjeta('Entran / salen (1 h)',n(s.flujo.in_1h)+' / '+n(s.flujo.out_1h)),
    tarjeta('Fallidos',n(s.cola.fallidos),'',Number(s.cola.fallidos)>0?'bad':'ok'),
  ].concat(s.reconActiva?[
    tarjeta('Requieren atencion',n(s.recon.atencion),'',Number(s.recon.atencion)>0?'bad':'ok'),
    tarjeta('Rescatados',n(s.recon.rescatado),'',Number(s.recon.rescatado)>0?'warn':'ok'),
    tarjeta('Cobertura 24 h', Number(s.recon.total_24h)>0 ? n(100*(Number(s.recon.total_24h)-Number(s.recon.perdido_24h))/Number(s.recon.total_24h),1) : '--','%',
      Number(s.recon.perdido_24h)>0?'warn':'ok'),
  ]:[]).join('');
  // ---- badge + pestaña de reconciliacion (antes del render de mensajes) ----
  const perd=Number(s.recon?(Number(s.recon.perdido)+Number(s.recon.atencion)):0);
  if(s.reconDesde){document.getElementById('corte').textContent='Cuenta desde '+new Date(s.reconDesde).toLocaleString('es-CO')+' (cuando el intermediario entro en la ruta).';}
  const sinAtender=Number(s.recon?s.recon.atencion:0), noLlegaron=Number(s.recon?s.recon.perdido:0);
  const cp=document.getElementById('cnt-perd');
  if(cp){
    const tot=sinAtender+noLlegaron;
    cp.textContent = tot? '('+tot+')' : '';
    cp.style.color = sinAtender? '#ffa657' : (tot? '#f85149' : '');
    cp.style.fontWeight = tot? '600' : '';
  }
  const bg0=document.getElementById('badge');
  bg0.textContent = perd>0 ? perd : ''; bg0.style.display = perd>0 ? '' : 'none';
  if(tab==='recon'){
    const D=await (await fetch('api/dashboard?horas='+horas)).json();
    const g=D.global||{}, c=D.cobertura||{};
    const DIAS=['Domingo','Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'];
    // --- KPIs en lenguaje de negocio ---
    document.getElementById('dk').innerHTML=[
      tarjeta('Mensajes recibidos',n(g.mensajes)),
      tarjeta('Leads atendidos',n(g.leads)),
      tarjeta('No llegaron',n(c.no_llegaron),'',Number(c.no_llegaron)>0?'bad':'ok'),
      tarjeta('Con error',n(g.fallidos),'',Number(g.fallidos)>0?'bad':'ok'),
      tarjeta('Demora tipica',n(c.demora_p50),'s',Number(c.demora_p50)>30?'warn':'ok'),
      tarjeta('Demora maxima',n(c.demora_max),'s',Number(c.demora_max)>120?'warn':'ok'),
      tarjeta('Minuto mas cargado', D.pico? n(D.pico.n)+' msg':'--','', ''),
    ].join('');
    // --- graficos ---
    document.getElementById('g1').innerHTML=lineas(D.serie,'h',[
      {c:'mensajes',n:'Mensajes',color:'#58a6ff',area:1},{c:'leads',n:'Leads',color:'#3fb950'}],{});
    document.getElementById('g2').innerHTML=lineas(D.nuevos,'h',[{c:'nuevos',n:'Leads nuevos',color:'#bc8cff',area:1}],{});
    // completar las 24 horas para que el eje X no tenga huecos
    const porHora={}; D.horaDia.forEach(r=>{porHora[r.hora]=r;});
    const H24=[...Array(24).keys()].map(h=>({h:String(h).padStart(2,'0'),
      n:(porHora[h]&&porHora[h].n)||0, leads:(porHora[h]&&porHora[h].leads)||0}));
    const picoH=H24.reduce((a,b)=>Number(b.n)>Number(a.n)?b:a,H24[0]);
    const totalH=H24.reduce((a,b)=>a+Number(b.n),0);
    document.getElementById('gpico').innerHTML=barrasEje(H24,'h','n',{px:340,
      ejeX:'Hora del dia (00 a 23, hora de Colombia)', ejeY:'Mensajes recibidos',
      pie:'Hora pico: <b style="color:#e6e9ef">'+picoH.h+':00</b> con '+picoH.n+' mensajes ('
          +(totalH?Math.round(1000*picoH.n/totalH)/10:0)+'% del total). Historico completo.'});
    document.getElementById('gpico2').innerHTML=barrasEje(H24,'h','leads',{px:300,
      ejeX:'Hora del dia (00 a 23, hora de Colombia)', ejeY:'Leads distintos',
      pie:'Cuantas conversaciones distintas hay activas en cada franja.'});
    document.getElementById('g4').innerHTML=lineas(D.faltantes,'h',[{c:'no_llegaron',n:'No llegaron',color:'#f85149',area:1}],{});
    document.getElementById('g5').innerHTML=lineas(D.faltantes,'h',[{c:'demora',n:'Demora mediana',color:'#d29922',area:1}],{u:' s'});
    document.getElementById('g6').innerHTML=barras(D.dow.map(r=>({d:DIAS[r.dow].slice(0,3),n:r.n})),'d','n',{verde:true});
    // --- tablas ---
    document.getElementById('t-porlead').innerHTML=tabla(D.porLead,[{v:r=>esc(r.rango)},
      {v:r=>'<a href="#" class="lead" onclick="verLeads('+r.cmin+','+r.cmax+',\\''+esc(r.rango)+'\\');return false">'+n(r.n)+' leads</a>',num:1}]);
    document.getElementById('t-tipos').innerHTML=tabla(D.tipos,[{v:r=>esc(r.tipo)},{v:r=>n(r.n),num:1}]);
    document.getElementById('t-leads').innerHTML=tabla(D.leads,[
      {v:r=>'<a class="lead" href="'+D.kommoBase.replace('/api/v4','')+'/leads/detail/'+r.entity_id+'" target="_blank" rel="noopener">'+esc(r.entity_id)+'</a>'},
      {v:r=>n(r.n)+' msg',num:1},
      {v:r=>new Date(r.ultimo).toLocaleTimeString('es-CO'),num:1}]);
    document.getElementById('t-tec').innerHTML=tabla([
      {k:'Respuesta a Kommo (p95)',v:n(g.ack_p95,1)+' ms'},
      {k:'Respuesta a Kommo (peor)',v:n(g.ack_max)+' ms de 2000 permitidos'},
      {k:'Espera en cola (p95)',v:n(Number(g.espera_p95)/1000,1)+' s'},
      {k:'Reintentos de entrega',v:n(g.con_reintento)},
      {k:'Mensajes con adjunto',v:n(g.adjuntos)},
      {k:'Errores registrados',v:D.errores.length?esc(D.errores[0].error):'ninguno'},
    ],[{v:r=>'<span style="color:#8b93a7">'+r.k+'</span>'},{v:r=>r.v,num:1}]);

    const rAll=await (await fetch('api/reconciliacion?estado='+filtroR+'&p='+pagR)).json();
    const hayMasR=rAll.length>PP; const rr=rAll.slice(0,PP);
    paginador('pag-r',pagR,hayMasR,(d)=>{pagR=Math.max(0,pagR+d);tick();});
    document.getElementById('tr').innerHTML=rr.map(function(r){
      const edad=(Date.now()-new Date(r.creado_en).getTime())/60000;
      const url=s.kommoBase.replace('/api/v4','')+'/leads/detail/'+r.entity_id;
      return '<tr>'
        +'<td>'+new Date(r.creado_en).toLocaleString('es-CO')+'</td>'
        +'<td><a class="lead" href="'+url+'" target="_blank" rel="noopener">'+esc(r.entity_id)+'</a></td>'
        +'<td class="txt">'+(r.texto?esc(r.texto):'<i style="color:#8b93a7">(no lo recibimos)</i>')+'</td>'
        +'<td><span class="tag t-'+r.estado+'">'+r.estado+'</span></td>'
        +'<td>'+(r.demora_seg!=null?r.demora_seg+' s':'')+'</td>'
        +'<td>'+(edad<60?edad.toFixed(0)+' min':(edad/60).toFixed(1)+' h')+'</td>'
        +'<td class="txt" title="'+esc(r.rescate_nota)+'">'+(r.rescatado_en?'<span style="color:#bc8cff">'+new Date(r.rescatado_en).toLocaleTimeString('es-CO')+'</span> ':'')+esc(r.rescate_nota).slice(0,70)+'</td>'
        +'</tr>';
    }).join('');
    return;
  }

  if(filtro==='perdido'){
    // Mensajes que Kommo registro y nunca nos llegaron. Vienen de la
    // reconciliacion, no de la cola: no tienen ACK ni intentos.
    const pAll=await (await fetch('api/perdidos?p='+pagP)).json();
    const hayMasP=pAll.length>PP; const pm=pAll.slice(0,PP);
    paginador('pag-m',pagP,hayMasP,(d)=>{pagP=Math.max(0,pagP+d);tick();});
    const avisoEl=document.getElementById('aviso-perd');
    if(avisoEl){
      const sa=pm.filter(x=>x.estado==='requiere_atencion').length;
      avisoEl.innerHTML = sa
        ? '<div style="background:#4a2410;border:1px solid #ffa657;color:#ffa657;padding:8px 12px;border-radius:8px;margin-bottom:10px;font-size:12px">'
          +'<b>'+sa+' cliente(s) escribieron y nadie les respondio.</b> El bot no pudo procesarlos: '
          +'o el lead esta en una etapa sin salesbot, o el campo del mensaje estaba vacio. '
          +'Hay que atenderlos a mano desde Kommo.</div>'
        : '';
    }
    document.getElementById('t').innerHTML=pm.map(function(r){
      const url=s.kommoBase.replace('/api/v4','')+'/leads/detail/'+r.entity_id;
      return '<tr>'
        +'<td>'+new Date(r.creado_en).toLocaleString('es-CO')+'</td>'
        +'<td><a class="lead" href="'+url+'" target="_blank" rel="noopener">'+esc(r.entity_id)+'</a></td>'
        +'<td class="txt">'+(r.texto?esc(r.texto):'<i style="color:#8b93a7">nunca nos llego</i>')+'</td>'
        +'<td><span class="tag t-'+r.estado+'">'+(r.estado==='requiere_atencion'?'SIN ATENDER':'NO LLEGO')+'</span></td>'
        +'<td>-</td><td>-</td><td>-</td>'
        +'<td class="txt" style="color:#ffa657" title="'+esc(r.rescate_nota)+'">'+esc(r.rescate_nota)+'</td>'
        +'<td><a class="rb" href="'+url+'" target="_blank" rel="noopener" style="text-decoration:none">Abrir en Kommo</a></td>'
        +'</tr>';
    }).join('') || '<tr><td colspan="9" style="color:#3fb950">Ningun mensaje perdido. Todo lo que Kommo registro nos llego.</td></tr>';
    return;
  }
  const mAll=await (await fetch('api/messages?estado='+filtro+'&p='+pagM)).json();
  const hayMasM=mAll.length>PP; const m=mAll.slice(0,PP);
  paginador('pag-m',pagM,hayMasM,(d)=>{pagM=Math.max(0,pagM+d);tick();});
  document.getElementById('t').innerHTML=m.map(function(r){
    var msg = r.texto ? esc(r.texto)
            : (r.adjunto ? '<span style="color:#58a6ff" title="'+esc(r.adjunto)+'">'+esc(adjuntoLegible(r.adjunto))+'</span>'
                         : '<i style="color:#8b93a7">(sin texto)</i>');
    return '<tr>'
      +'<td>'+new Date(r.recibido_en).toLocaleTimeString('es-CO')+'</td>'
      +'<td>'+esc(r.entity_id)+'</td>'
      +'<td class="txt" title="'+esc(r.texto||r.adjunto)+'">'+msg+'</td>'
      +'<td><span class="tag t-'+r.estado+'">'+r.estado+'</span></td>'
      +'<td>'+(r.ack_ms!=null?r.ack_ms+' ms':'')+'</td>'
      +'<td>'+(r.espera_ms!=null?(r.espera_ms/1000).toFixed(1)+' s':'')+'</td>'
      +'<td>'+r.intentos+'</td>'
      +'<td class="txt" style="color:#f85149">'+esc(r.error)+'</td>'
      +'<td><button class="rb" onclick="reenviar('+r.id+',\\''+r.estado+'\\')" '+(r.estado==='procesando'?'disabled':'')+'>Reenviar</button></td>'
      +'</tr>';
  }).join('');

  // (bloque de reconciliacion movido arriba)
}
function pintarTab(){
  document.getElementById('vista-mensajes').style.display = tab==='mensajes'?'':'none';
  document.getElementById('vista-recon').style.display   = tab==='recon'?'':'none';
}
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{
  tab=b.dataset.tab; pagM=0; pagP=0; pagR=0;
  document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on'); pintarTab(); tick();});
document.querySelectorAll('#vista-mensajes .f button').forEach(b=>b.onclick=()=>{
  filtro=b.dataset.e; pagM=0; pagP=0;
  document.querySelectorAll('#vista-mensajes .f button').forEach(x=>x.classList.remove('on'));
  b.classList.add('on');tick();});
document.querySelectorAll('#vista-recon .f button[data-r]').forEach(b=>b.onclick=()=>{
  filtroR=b.dataset.r; pagR=0;
  document.querySelectorAll('#vista-recon .f button[data-r]').forEach(x=>x.classList.remove('on'));
  b.classList.add('on');tick();});
document.querySelectorAll('#vista-recon .f button[data-h]').forEach(b=>b.onclick=()=>{
  horas=Number(b.dataset.h);
  document.querySelectorAll('#vista-recon .f button[data-h]').forEach(x=>x.classList.remove('on'));
  b.classList.add('on');tick();});
document.getElementById('revisar').onclick=async(e)=>{
  e.target.disabled=true;e.target.textContent='Revisando...';
  await fetch('api/reconciliar',{method:'POST'});
  e.target.disabled=false;e.target.textContent='Revisar ahora';tick();};
pintarTab();tick();setInterval(tick,3000);
</script></body></html>`;

// ---------------------------------------------------------------- servidor

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'POST' && url.pathname === '/kommo') {
    const trozos = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > 2_000_000) { req.destroy(); return; }
      trozos.push(c);
    });
    req.on('end', () => recibir(req, res, Buffer.concat(trozos).toString('utf8')));
    req.on('error', () => { try { res.writeHead(400).end(); } catch {} });
    return;
  }

  if (url.pathname === '/health') {
    return res.writeHead(200, { 'content-type': 'application/json' })
              .end(JSON.stringify({ ok: true, enVuelo, max: CFG.maxInflight }));
  }

  if (url.pathname === '/api/stats') {
    return stats()
      .then((s) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(s)))
      .catch((e) => res.writeHead(500).end(JSON.stringify({ error: e.message })));
  }

  // Reenvio manual. Nunca borra la fila: reinicia intentos y la devuelve a la
  // cola, conservando el historial completo para auditoria.
  if (req.method === 'POST' && url.pathname.startsWith('/api/reenviar/')) {
    const id = Number(url.pathname.split('/').pop());
    if (!Number.isInteger(id)) return res.writeHead(400).end(JSON.stringify({ error: 'id invalido' }));
    return pool
      .query(
        `UPDATE cola_mensajes
            SET estado='pendiente', intentos=0, error=NULL, siguiente_intento=now()
          WHERE id=$1 AND estado <> 'procesando'
          RETURNING id, msg_id`,
        [id]
      )
      .then((r) => {
        if (!r.rowCount) return res.writeHead(409).end(JSON.stringify({ error: 'en vuelo o inexistente' }));
        log(`reenvio manual: #${id} ${r.rows[0].msg_id}`);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
      })
      .catch((e) => res.writeHead(500).end(JSON.stringify({ error: e.message })));
  }

  if (url.pathname === '/api/reconciliacion') {
    const est = url.searchParams.get('estado') || '';
    const off = Math.max(0, Number(url.searchParams.get('p') || 0)) * 50;
    const q = est
      ? pool.query(`SELECT * FROM reconciliacion WHERE estado=$1 ORDER BY creado_en DESC LIMIT 51 OFFSET $2`, [est, off])
      : pool.query(`SELECT * FROM reconciliacion ORDER BY creado_en DESC LIMIT 51 OFFSET $1`, [off]);
    return q
      .then((r) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r.rows)))
      .catch((e) => res.writeHead(500).end(JSON.stringify({ error: e.message })));
  }

  // Forzar una pasada de reconciliacion a demanda (boton "Revisar ahora").
  if (req.method === 'POST' && url.pathname === '/api/reconciliar') {
    return reconciliar()
      .then(() => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true })))
      .catch((e) => res.writeHead(500).end(JSON.stringify({ error: e.message })));
  }

  if (url.pathname.startsWith('/api/probar-rescate/')) {
    const lead = url.pathname.split('/').pop();
    if (!/^\d+$/.test(lead)) return res.writeHead(400).end(JSON.stringify({ error: 'lead invalido' }));
    const ev = { entity_id: lead, account_id: 31584331 };
    const simulacroReal = CFG.rescateSimulacro;
    CFG.rescateSimulacro = true;                    // forzar simulacro siempre
    return rescatar(ev, 'PRUEBA-' + Date.now(), new Date())
      .then((r) => {
        CFG.rescateSimulacro = simulacroReal;
        res.writeHead(200, { 'content-type': 'application/json' })
           .end(JSON.stringify({ ok: true, ...r }, null, 1));
      })
      .catch((e) => {
        CFG.rescateSimulacro = simulacroReal;
        res.writeHead(200, { 'content-type': 'application/json' })
           .end(JSON.stringify({ ok: false, error: e.message }, null, 1));
      });
  }

  // Dashboard: metricas de negocio primero, lo tecnico al final.
  // Excluye las filas sinteticas de pruebas.
  if (url.pathname === '/api/dashboard') {
    const horas = Number(url.searchParams.get('horas') || 24);
    const REAL = `msg_id NOT LIKE 'm-%' AND msg_id NOT LIKE 'sin-id%' AND msg_id NOT LIKE 'PRUEBA%'`;
    const TZ = `AT TIME ZONE 'America/Bogota'`;
    return Promise.all([
      // 0 resumen
      pool.query(
        `SELECT count(*)::int AS mensajes,
                count(DISTINCT entity_id)::int AS leads,
                count(*) FILTER (WHERE estado='fallido')::int AS fallidos,
                count(*) FILTER (WHERE intentos > 1)::int AS con_reintento,
                count(*) FILTER (WHERE adjunto IS NOT NULL)::int AS adjuntos,
                COALESCE(percentile_cont(0.5)  WITHIN GROUP (ORDER BY ack_ms),0) AS ack_p50,
                COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY ack_ms),0) AS ack_p95,
                COALESCE(max(ack_ms),0)::int AS ack_max,
                COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY espera_ms),0) AS espera_p95,
                min(recibido_en) AS desde
           FROM cola_mensajes WHERE ${REAL}
             AND recibido_en > now() - ($1 || ' hours')::interval`, [horas]),
      // 1 serie temporal: mensajes y leads distintos por hora
      pool.query(
        `SELECT to_char(date_trunc('hour', recibido_en ${TZ}), 'DD/MM HH24:00') AS h,
                count(*)::int AS mensajes,
                count(DISTINCT entity_id)::int AS leads,
                count(*) FILTER (WHERE estado='fallido')::int AS errores
           FROM cola_mensajes
          WHERE ${REAL} AND recibido_en > now() - ($1 || ' hours')::interval
          GROUP BY date_trunc('hour', recibido_en ${TZ})
          ORDER BY date_trunc('hour', recibido_en ${TZ})`, [horas]),
      // 2 no llegaron / demora, desde el libro de Kommo
      pool.query(
        `SELECT to_char(date_trunc('hour', creado_en ${TZ}), 'DD/MM HH24:00') AS h,
                count(*)::int AS total,
                count(*) FILTER (WHERE estado IN ('perdido','requiere_atencion'))::int AS no_llegaron,
                COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_seg),0) AS demora
           FROM reconciliacion
          WHERE creado_en > now() - ($1 || ' hours')::interval
          GROUP BY date_trunc('hour', creado_en ${TZ})
          ORDER BY date_trunc('hour', creado_en ${TZ})`, [horas]),
      // 3 leads NUEVOS por hora (su primer mensaje cae en esa hora)
      pool.query(
        `WITH primeros AS (
            SELECT entity_id, min(recibido_en) AS primero
              FROM cola_mensajes WHERE ${REAL} AND entity_id IS NOT NULL
             GROUP BY entity_id)
         SELECT to_char(date_trunc('hour', primero ${TZ}), 'DD/MM HH24:00') AS h,
                count(*)::int AS nuevos
           FROM primeros WHERE primero > now() - ($1 || ' hours')::interval
          GROUP BY date_trunc('hour', primero ${TZ})
          ORDER BY date_trunc('hour', primero ${TZ})`, [horas]),
      // 4 horas pico del dia (todo el historico), con leads distintos
      pool.query(
        `SELECT EXTRACT(HOUR FROM recibido_en ${TZ})::int AS hora,
                count(*)::int AS n,
                count(DISTINCT entity_id)::int AS leads
           FROM cola_mensajes WHERE ${REAL} GROUP BY 1 ORDER BY 1`),
      // 5 dias de la semana
      pool.query(
        `SELECT EXTRACT(DOW FROM recibido_en ${TZ})::int AS dow, count(*)::int AS n
           FROM cola_mensajes WHERE ${REAL} GROUP BY 1 ORDER BY 1`),
      // 6 cuantos mensajes escribe cada lead (con los limites del rango,
      //   para poder pinchar y ver el listado)
      pool.query(
        `SELECT rango, count(*)::int AS n, min(c)::int AS cmin, max(c)::int AS cmax FROM (
            SELECT c,
                   CASE WHEN c=1 THEN '1 mensaje' WHEN c=2 THEN '2' WHEN c<=5 THEN '3 a 5'
                        WHEN c<=10 THEN '6 a 10' ELSE '11 o mas' END AS rango,
                   CASE WHEN c=1 THEN 1 WHEN c=2 THEN 2 WHEN c<=5 THEN 3
                        WHEN c<=10 THEN 4 ELSE 5 END AS ord
              FROM (SELECT entity_id, count(*) AS c FROM cola_mensajes
                     WHERE ${REAL} AND entity_id IS NOT NULL GROUP BY entity_id) x
          ) y GROUP BY rango, ord ORDER BY ord`),
      // 7 tipos de contenido
      pool.query(
        `SELECT CASE WHEN texto IS NOT NULL AND texto <> '' THEN 'Texto'
                     WHEN adjunto ILIKE 'voice%'   THEN 'Audio'
                     WHEN adjunto ILIKE 'picture%' THEN 'Imagen'
                     WHEN adjunto ILIKE 'video%'   THEN 'Video'
                     WHEN adjunto IS NOT NULL      THEN 'Archivo'
                     ELSE 'Sin contenido' END AS tipo, count(*)::int AS n
           FROM cola_mensajes WHERE ${REAL} GROUP BY 1 ORDER BY 2 DESC`),
      // 8 leads mas activos
      pool.query(
        `SELECT entity_id, count(*)::int AS n, max(recibido_en) AS ultimo
           FROM cola_mensajes WHERE ${REAL} AND entity_id IS NOT NULL
          GROUP BY entity_id ORDER BY 2 DESC LIMIT 8`),
      // 9 no llegaron: total del periodo + demora global
      pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE estado IN ('perdido','requiere_atencion'))::int AS no_llegaron,
                COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_seg),0) AS demora_p50,
                COALESCE(max(demora_seg),0)::int AS demora_max
           FROM reconciliacion WHERE creado_en > now() - ($1 || ' hours')::interval`, [horas]),
      // 10 minuto mas cargado
      pool.query(
        `SELECT to_char(date_trunc('minute', recibido_en ${TZ}), 'DD/MM HH24:MI') AS m, count(*)::int AS n
           FROM cola_mensajes WHERE ${REAL} GROUP BY 1 ORDER BY 2 DESC LIMIT 1`),
      // 11 errores
      pool.query(
        `SELECT left(error, 80) AS error, count(*)::int AS n
           FROM cola_mensajes WHERE error IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 5`),
    ])
      .then(([g, serie, falt, nuevos, horaDia, dow, porLead, tipos, leads, cob, pico, errores]) =>
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          global: g.rows[0], serie: serie.rows, faltantes: falt.rows, nuevos: nuevos.rows,
          horaDia: horaDia.rows, dow: dow.rows, porLead: porLead.rows, tipos: tipos.rows,
          leads: leads.rows, cobertura: cob.rows[0], pico: pico.rows[0] || null,
          errores: errores.rows, horas, kommoBase: CFG.kommoBase,
        })))
      .catch((e) => res.writeHead(500).end(JSON.stringify({ error: e.message })));
  }

  // Detalle: los leads que escribieron entre min y max mensajes, con una
  // muestra de lo que escribieron. Sirve para entender por que se caen.
  if (url.pathname === '/api/leads-rango') {
    const mn = Math.max(1, Number(url.searchParams.get('min') || 1));
    const mx = Number(url.searchParams.get('max') || 9999);
    const p = Math.max(0, Number(url.searchParams.get('p') || 0));
    const REAL = `msg_id NOT LIKE 'm-%' AND msg_id NOT LIKE 'sin-id%' AND msg_id NOT LIKE 'PRUEBA%'`;
    return pool
      .query(
        `WITH conteo AS (
            SELECT entity_id, count(*)::int AS c,
                   min(recibido_en) AS primero, max(recibido_en) AS ultimo
              FROM cola_mensajes WHERE ${REAL} AND entity_id IS NOT NULL
             GROUP BY entity_id)
         SELECT k.entity_id, k.c, k.primero, k.ultimo,
                (SELECT string_agg(COALESCE(m.texto, m.adjunto), '  //  ' ORDER BY m.id)
                   FROM (SELECT id, texto, adjunto FROM cola_mensajes q
                          WHERE q.entity_id = k.entity_id AND ${REAL}
                          ORDER BY q.id LIMIT 3) m) AS muestra
           FROM conteo k
          WHERE k.c BETWEEN $1 AND $2
          ORDER BY k.ultimo DESC
          LIMIT 51 OFFSET $3`,
        [mn, mx, p * 50]
      )
      .then((r) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r.rows)))
      .catch((e) => res.writeHead(500).end(JSON.stringify({ error: e.message })));
  }

  if (url.pathname === '/api/perdidos') {
    return pool
      .query(
        `SELECT evento_id, entity_id, msg_id, creado_en, estado, rescate_nota, texto
           FROM reconciliacion
          WHERE estado IN ('perdido','requiere_atencion')
          ORDER BY creado_en DESC LIMIT 51 OFFSET $1`,
        [Math.max(0, Number(url.searchParams.get('p') || 0)) * 50]
      )
      .then((r) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r.rows)))
      .catch((e) => res.writeHead(500).end(JSON.stringify({ error: e.message })));
  }

  if (url.pathname === '/api/messages') {
    const est = url.searchParams.get('estado') || '';
    const p = Math.max(0, Number(url.searchParams.get('p') || 0));
    const off = p * 50;
    const q = est
      ? pool.query(`SELECT * FROM cola_mensajes WHERE estado=$1 ORDER BY id DESC LIMIT 51 OFFSET $2`, [est, off])
      : pool.query(`SELECT * FROM cola_mensajes ORDER BY id DESC LIMIT 51 OFFSET $1`, [off]);
    return q
      .then((r) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r.rows)))
      .catch((e) => res.writeHead(500).end(JSON.stringify({ error: e.message })));
  }

  if (url.pathname === '/' || url.pathname === '/panel') {
    return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PANEL);
  }

  res.writeHead(404).end('no encontrado');
});

const arrancar = async () => {
  await pool.query(ESQUEMA);
  await rescatarHuerfanas();
  server.listen(CFG.puerto, () => {
    log(`escuchando en :${CFG.puerto} - max en vuelo ${CFG.maxInflight} - destino ${CFG.soloRegistrar ? '(MODO PRUEBA)' : CFG.n8nUrl}`);
  });
  bucle();
  setInterval(vigilar, 60_000);
  setInterval(rescatarHuerfanas, 300_000);
  if (CFG.kommoToken) {
    if (CFG.reconDesde) {
      const { rowCount } = await pool.query(
        'DELETE FROM reconciliacion WHERE creado_en < $1', [CFG.reconDesde]);
      if (rowCount) log(`reconciliacion: descartadas ${rowCount} filas anteriores al corte ${CFG.reconDesde}`);
    }
    setTimeout(reconciliar, 20_000);
    setInterval(reconciliar, CFG.reconCadaMin * 60_000);
    log(`reconciliacion contra Kommo activa: cada ${CFG.reconCadaMin} min, ventana ${CFG.reconVentanaMin} min`);
  } else log('reconciliacion DESACTIVADA (falta KOMMO_TOKEN)');
};

arrancar().catch((e) => { log('FALLO AL ARRANCAR:', e); process.exit(1); });

// Red de seguridad: preferimos un servicio vivo con un error registrado a un
// proceso muerto. Si el fallo fuera irrecuperable, las sondas de /health y la
// cola en Postgres lo dejarian en evidencia.
process.on('unhandledRejection', (r) => log('PROMESA SIN CAPTURAR:', r && r.message ? r.message : r));
process.on('uncaughtException', (e) => log('EXCEPCION SIN CAPTURAR:', e && e.stack ? e.stack : e));

for (const s of ['SIGTERM', 'SIGINT']) {
  process.on(s, () => { log('cerrando...'); server.close(() => pool.end().then(() => process.exit(0))); });
}
