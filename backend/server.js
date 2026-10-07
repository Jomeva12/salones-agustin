// ============================================================================
//  Servidor embebido: node:http + node:sqlite. Cero dependencias de npm.
//      node backend/server.js          (o npm start)
// ============================================================================
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as L from './api/logica.mjs';
import * as A from './api/acceso.mjs';
import { arrancarSiembra } from './api/siembra.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const WEB = join(RAIZ, 'frontend');
// DB_PATH por entorno para poder levantar una copia y probar contra ella sin
// arriesgar la base viva.
const DB_PATH = process.env.DB_PATH ?? join(AQUI, 'db', 'salones.db');
const PUERTO = Number(process.env.PORT ?? 4300);
// Detras de un proxy (Caddy, nginx) conviene HOST=127.0.0.1: asi el panel
// solo es alcanzable por el proxy y no queda expuesto por el puerto directo.
const HOST = process.env.HOST ?? '0.0.0.0';
// Si se define, los endpoints del agente exigen este token. n8n baja los
// headers a minúsculas, por eso aquí se leen ya normalizados.
const TOKEN = process.env.API_TOKEN ?? '';

// El token de Kommo, solo para subir imagenes a su Drive. Sin el, el panel
// las sigue mostrando —eso no necesita token— pero no puede cambiarlas.
const KOMMO_TOKEN = process.env.KOMMO_TOKEN ?? '';
const KOMMO_BASE = process.env.KOMMO_BASE ?? 'https://administracioneventos6.kommo.com';

/**
 * Sube una imagen al Drive de Kommo y devuelve su URL y su uuid.
 *
 * El host del Drive se pregunta, no se adivina: cambia segun la cuenta, y
 * dar por bueno el de otra deja la imagen fuera del dominio que el salesbot
 * acepta. Y los archivos grandes van por partes, donde la siguiente URL
 * llega en `next_url` y no en `upload_url`, que es el nombre del primer paso.
 */
async function subirAKommo(bytes, nombre, tipo) {
  const cab = { Authorization: 'Bearer ' + KOMMO_TOKEN };
  const cuenta = await (await fetch(KOMMO_BASE + '/api/v4/account?with=drive_url',
    { headers: cab })).json();
  if (!cuenta.drive_url) throw new Error('Kommo no devolvio drive_url');

  const ses = await (await fetch(cuenta.drive_url + '/v1.0/sessions', {
    method: 'POST', headers: { ...cab, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_name: nombre, file_size: bytes.length,
                           content_type: tipo, with_preview: true }),
  })).json();
  if (!ses.upload_url) throw new Error('Kommo no abrio la subida');

  const trozo = ses.max_part_size || bytes.length;
  let destino = ses.upload_url, desde = 0, f = null;
  while (desde < bytes.length) {
    const parte = bytes.subarray(desde, Math.min(desde + trozo, bytes.length));
    f = await (await fetch(destino, { method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' }, body: parte })).json();
    desde += parte.length;
    if (desde < bytes.length) {
      destino = f?.next_url ?? f?.upload_url;
      if (!destino) throw new Error('Kommo no dio URL para la siguiente parte');
    }
  }
  const url = f?._links?.download?.href;
  if (!url) throw new Error('Kommo no devolvio la URL del archivo');
  // El uuid es el penultimo tramo, que es lo que el adjunto pide como `id`.
  return { url, uuid: url.split('/')[5] };
}

if (!existsSync(DB_PATH)) {
  // Sin base no se puede servir el panel, pero tampoco hay que rendirse:
  // en un servidor el volumen nace vacio y subir el archivo por SSH exige
  // una contrasena que muchas veces no esta a la mano. Se levanta el modo
  // siembra, que deja ponerla desde el navegador con el API_TOKEN.
  //
  // En la maquina de uno eso no aplica: ahi la base se crea con migrar.mjs.
  if (process.env.DB_PATH) {
    console.error(`No existe la base en ${DB_PATH}.`);
    arrancarSiembra({ dbPath: DB_PATH, puerto: PUERTO, host: HOST, token: TOKEN });
  } else {
    console.error(`No existe la base en ${DB_PATH}.`);
    console.error('Corre primero:');
    console.error('  python backend/db/exportar_seed.py');
    console.error('  node backend/db/migrar.mjs');
    process.exit(1);
  }
}
// Si llegamos aqui en modo siembra, el proceso ya esta escuchando y esta
// linea reventaria. Se corta explicitamente.
if (!existsSync(DB_PATH)) { await new Promise(() => {}); }
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

const TIPOS_MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * Cabeceras que van en TODA respuesta, sea JSON o archivo.
 *
 * El panel deja de vivir en localhost: tiene contraseñas, precios y datos de
 * clientes, así que pasa a estar a un dominio de distancia de cualquiera.
 *
 * La CSP puede ser estricta porque el frontend no carga nada de terceros y
 * todo su JS son módulos externos. Los estilos sí necesitan 'unsafe-inline':
 * entrar.html trae un <style> y index.html un style= suelto.
 *
 * HSTS solo lo obedece el navegador sobre https, así que en pruebas locales
 * por http no estorba.
 */
const SEGURIDAD = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // Las láminas de los paquetes viven en el Drive de Kommo: ahí las exige
    // el adjunto del salesbot, así que el panel solo puede mostrarlas desde
    // allá. El comodín de kommo.com es por el host del Drive, que cambia
    // según la cuenta (esta es drive-c).
    //
    // Y hace falta storage.googleapis.com porque el Drive no sirve el archivo:
    // responde con una redirección a una URL firmada de Google Cloud, y la CSP
    // se aplica al destino final, no al enlace que uno escribió.
    //
    // Las dos se abren SOLO para imágenes. El resto de la política no cambia.
    "img-src 'self' data: https://*.kommo.com https://storage.googleapis.com",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

const json = (res, code, cuerpo, extra = null) => {
  const s = JSON.stringify(cuerpo, null, 2);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(s),
    'cache-control': 'no-store',
    ...SEGURIDAD,
    ...(extra ?? {}),
  });
  res.end(s);
};

async function cuerpoJSON(req) {
  const trozos = [];
  let total = 0;
  for await (const t of req) {
    total += t.length;
    if (total > 1_000_000) throw new Error('cuerpo demasiado grande');
    trozos.push(t);
  }
  if (!trozos.length) return {};
  return JSON.parse(Buffer.concat(trozos).toString('utf8'));
}

/**
 * Para subir una lámina: llegan los bytes de la imagen tal cual, sin
 * multipart. El panel es el único cliente de esta ruta y el servidor no tiene
 * dependencias, así que parsear multipart a mano seria trabajo sin premio:
 * el nombre del archivo viaja en una cabecera.
 */
async function cuerpoBinario(req) {
  const trozos = [];
  let total = 0;
  for await (const t of req) {
    total += t.length;
    if (total > 12_000_000) throw new Error('la imagen pesa demasiado');
    trozos.push(t);
  }
  return { bytes: Buffer.concat(trozos) };
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const entero = (v) => { const n = num(v); return Number.isInteger(n) ? n : null; };

/**
 * Deja una red social como URL completa.
 *
 * El cliente las dictó como «facebook.com/CentroSocialNorma» y «@normaeventos».
 * Sin protocolo no son URLs: el enlace del panel resolvía contra el propio
 * panel, y Kommo las rechaza cuando pide una URL de red social válida. Se
 * normaliza al guardar para que no vuelva a entrar una a medias.
 */
const comoUrl = (t) => {
  const v = String(t ?? '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  // Un arroba suelto solo tiene sentido como ruta de TikTok.
  if (v.startsWith('@')) return 'https://tiktok.com/' + v;
  return 'https://' + v.replace(/^www\./i, '');
};

/** Registra quién cambió qué. Sin el usuario, la auditoría no sirve. */
function anotar(tabla, registro, accion, usuario, detalle) {
  db.prepare('INSERT INTO bitacora (tabla, registro, accion, usuario, detalle) VALUES (?,?,?,?,?)')
    .run(tabla, registro, accion, String(usuario ?? 'sin identificar').slice(0, 60), detalle ?? null);
}

// ─────────────────────────────── rutas ──────────────────────────────────────

/**
 * Un evento de más de diez horas casi siempre es la hora de fin puesta antes
 * que la de inicio: como el fin salta al día siguiente al cruzar medianoche,
 * un 8:00 pm – 3:00 pm silencioso se vuelve un evento de 19 horas que bloquea
 * dos días. Mejor preguntarlo que guardarlo.
 */
function duracionRara(v) {
  if (!v.inicio_at) return null;
  const h = (new Date(v.fin_at.replace(' ', 'T')) - new Date(v.inicio_at.replace(' ', 'T'))) / 3600000;
  if (h <= 10) return null;
  return { error: 'duración rara',
    detalle: `Así quedaría un evento de ${Math.round(h)} horas. Revisa las horas: ` +
             `si termina antes de la hora en que empieza, se entiende que acaba al día siguiente.` };
}

/** Cuando no viene el turno, se deduce de la hora en vez de suponer «noche»:
 *  un evento de 11:00 am etiquetado como nocturno confunde a quien lo lee. */
function turnoDeLaHora(inicioAt) {
  if (!inicioAt) return 'noche';
  const h = Number(inicioAt.slice(11, 13));
  return h < 13 ? 'manana' : h < 18 ? 'tarde' : 'noche';
}

// El trigger solo sabe abortar. Aquí se averigua CON QUÉ chocó, porque
// «ocupado» a secas obliga a la encargada a ir a buscarlo a mano.
function conflicto(e, salonId, fecha, v, excluir = null) {
  if (!/aseo:/.test(String(e.message))) return null;
  const vecinos = db.prepare(
    `SELECT c.hora_inicio, c.hora_fin, c.fecha, c.inicio_at, c.fin_at, c.estatus,
            c.horario_exacto, c.turno, t.nombre AS tipo
       FROM compromiso c LEFT JOIN tipo_evento t ON t.id = c.tipo_evento_id
      WHERE c.salon_id = ? AND c.id IS NOT ?
        AND c.fecha BETWEEN date(?, '-2 day') AND date(?, '+2 day')
      ORDER BY c.fecha`).all(salonId, excluir, fecha, fecha);
  const aseo = db.prepare('SELECT minutos_aseo m FROM salon WHERE id = ?').get(salonId).m;
  const choca = vecinos.find((o) => {
    if (!v.inicio_at || !o.inicio_at) return o.fecha === fecha;
    const mas = (t, min) => new Date(t.replace(' ', 'T') + ':00').getTime() + min * 60000;
    return new Date(v.inicio_at.replace(' ', 'T')).getTime() < mas(o.fin_at, aseo)
        && new Date(o.inicio_at.replace(' ', 'T')).getTime() < mas(v.fin_at, aseo);
  });
  if (!choca) return { error: 'ocupado', detalle: 'Ese salón ya tiene otro evento encimado.' };
  // Tres casos distintos, y antes se confundían dos: hora exacta, hora
  // deducida del turno, y nada de nada. El de en medio ya no bloquea el día,
  // así que decir «no se puede calcular el aseo» sería falso.
  const ventana = choca.inicio_at
    ? `${L.hora12(choca.inicio_at.slice(11))} a ${L.hora12(choca.fin_at.slice(11))}`
    : null;
  const detalle = choca.hora_inicio
    ? `Choca con ${choca.tipo ?? 'un evento'} del ${choca.fecha} de ${choca.hora_inicio} ` +
      `a ${choca.hora_fin}. Entre un evento y otro tienen que caber ${aseo / 60} horas de aseo.`
    : choca.inicio_at
      ? `Choca con ${choca.tipo ?? 'un evento'} del ${choca.fecha}, que está capturado solo ` +
        `como «${choca.turno}» — se le supone de ${ventana}. Entre un evento y otro tienen ` +
        `que caber ${aseo / 60} horas de aseo. Si sabes su hora exacta, ponsela y quizá sí quepan.`
      : `Ese día ya hay ${choca.tipo ?? 'un evento'} sin hora ni turno capturados. ` +
        `Sin eso no se puede calcular el aseo: ponle horario y entonces se podrán agendar los dos.`;
  return {
    error: 'ocupado',
    detalle,
    choca_con: { fecha: choca.fecha, tipo: choca.tipo, de: choca.hora_inicio, a: choca.hora_fin },
  };
}

// Lo que hace falta para no quedarse sin administrador. Se comprueba antes de
// desactivar y antes de bajar de rol: si el único admin se quita a sí mismo el
// permiso, ya nadie puede devolvérselo desde el panel.
const contarAdmins = () =>
  db.prepare("SELECT COUNT(*) n FROM usuario WHERE rol = 'admin' AND activo = 1").get().n;

const ROLES = ['admin', 'encargada', 'consulta'];

/**
 * Qué le falta a un paquete para poder cotizarse. Se calcula desde la base y
 * no desde el formulario: así vale igual para un borrador recién capturado que
 * para uno que alguien dejó a medias hace un mes.
 */
function loQueFalta(id) {
  const falta = [];
  const n = (sql, ...a) => db.prepare(sql).get(id, ...a).n;
  if (!n('SELECT COUNT(*) n FROM paquete_tipo_evento WHERE paquete_id = ?')) {
    falta.push('decir para qué celebraciones sirve');
  }
  if (!n('SELECT COUNT(*) n FROM tarifa WHERE paquete_id = ?')) {
    falta.push('al menos un precio');
  }
  if (!n('SELECT COUNT(*) n FROM paquete_contenido WHERE paquete_id = ?')) {
    falta.push('el contenido');
  } else if (!n('SELECT COUNT(*) n FROM paquete_contenido WHERE paquete_id = ? AND horas_salon IS NOT NULL')) {
    falta.push('cuántas horas dura');
  }
  if (!n(`SELECT COUNT(*) n FROM paquete_contenido_concepto x
            JOIN paquete_contenido c ON c.id = x.contenido_id
           WHERE c.paquete_id = ?`)) {
    falta.push('marcar qué incluye');
  }
  return falta;
}

const rutas = {
  'GET /api/salud': () => ({
    ok: true, hoy_monterrey: L.hoyMonterrey(),
    tarifas: db.prepare('SELECT COUNT(*) n FROM tarifa').get().n,
    compromisos: db.prepare('SELECT COUNT(*) n FROM compromiso').get().n,
  }),

  // Alimenta la portada. Tres cosas que mueven dinero y que hoy nadie ve:
  // lo que viene, las fechas cercanas que se están quedando sin vender, y los
  // apartados de $500 que caducan a los 7 días.
  'GET /api/hoy': (u) => {
    const hoy = L.hoyMonterrey();
    // Con ?salon= la portada deja de ser la del dueño y pasa a ser la de una
    // encargada: sólo su salón. Es otra pantalla, no la misma filtrada.
    const clave = u.searchParams.get('salon') || '';
    const uno = clave ? db.prepare('SELECT id, clave, nombre, encargada FROM salon WHERE clave = ?').get(clave) : null;
    if (clave && !uno) return { error: 'salón desconocido' };
    const filtroSalon = uno ? ' AND c.salon_id = ' + uno.id : '';

    const proximos = db.prepare(
      `SELECT c.id, c.fecha, c.turno, c.estatus, c.notas, s.clave AS salon, s.nombre AS salon_nombre,
              t.nombre AS tipo_evento
         FROM compromiso c
         JOIN salon s ON s.id = c.salon_id
         LEFT JOIN tipo_evento t ON t.id = c.tipo_evento_id
        WHERE c.fecha >= ?${filtroSalon} ORDER BY c.fecha, s.id LIMIT ${uno ? 14 : 12}`).all(hoy);

    // Viernes, sábados y domingos de los próximos 90 días con salones libres.
    // Para una encargada son SUS fines de semana libres, en orden de fecha:
    // lo que tiene que llenar primero es lo más cercano.
    const oportunidades = uno
      ? db.prepare(
          `WITH RECURSIVE d(f) AS (
              SELECT date(?) UNION ALL SELECT date(f,'+1 day') FROM d WHERE f < date(?,'+90 day'))
           SELECT f AS fecha, 1 AS libres FROM d
            WHERE strftime('%w', f) IN ('5','6','0')
              AND NOT EXISTS (SELECT 1 FROM compromiso c
                               WHERE c.salon_id = ? AND c.fecha = d.f AND c.turno = 'noche')
            ORDER BY f ASC LIMIT 8`).all(hoy, hoy, uno.id)
      : db.prepare(
          `WITH RECURSIVE d(f) AS (
              SELECT date(?) UNION ALL SELECT date(f,'+1 day') FROM d WHERE f < date(?,'+90 day'))
           SELECT f AS fecha,
                  (SELECT COUNT(*) FROM salon WHERE activo = 1)
                  - (SELECT COUNT(*) FROM compromiso c WHERE c.fecha = d.f AND c.turno = 'noche') AS libres
             FROM d
            WHERE strftime('%w', f) IN ('5','6','0')
            ORDER BY libres DESC, f ASC LIMIT 8`).all(hoy, hoy);
    for (const o of oportunidades) {
      o.salones_libres = uno ? [{ clave: uno.clave, nombre: uno.nombre }] : db.prepare(
        `SELECT s.clave, s.nombre FROM salon s
          WHERE s.activo = 1 AND NOT EXISTS (
            SELECT 1 FROM compromiso c
             WHERE c.salon_id = s.id AND c.fecha = ? AND c.turno = 'noche')
          ORDER BY s.id`).all(o.fecha);
      o.meses_anticipacion = L.mesesEntre(hoy, o.fecha);
    }

    const porVencer = db.prepare(
      `SELECT c.id, c.fecha, c.vence, s.nombre AS salon_nombre, t.nombre AS tipo_evento
         FROM compromiso c
         JOIN salon s ON s.id = c.salon_id
         LEFT JOIN tipo_evento t ON t.id = c.tipo_evento_id
        WHERE c.estatus = 'separado' AND c.vence IS NOT NULL${filtroSalon}
        ORDER BY c.vence LIMIT 10`).all();

    // Lo que pasa HOY, en una frase.
    const deHoy = db.prepare(
      `SELECT c.turno, s.nombre AS salon_nombre, t.nombre AS tipo_evento
         FROM compromiso c JOIN salon s ON s.id = c.salon_id
         LEFT JOIN tipo_evento t ON t.id = c.tipo_evento_id
        WHERE c.fecha = ?${filtroSalon} ORDER BY s.id`).all(hoy);

    // Las próximas tres semanas completas, salón por salón. Los siete días:
    // el negocio pone precio a los siete y vende en los siete, así que una
    // rejilla que solo mostrara viernes a domingo escondería inventario.
    const salonesAct = uno
      ? [{ id: uno.id, clave: uno.clave, nombre: uno.nombre }]
      : db.prepare('SELECT id, clave, nombre FROM salon WHERE activo = 1 ORDER BY id').all();
    const diasProximos = db.prepare(
      `WITH RECURSIVE d(f) AS (
          SELECT date(?) UNION ALL SELECT date(f,'+1 day') FROM d WHERE f < date(?,'+20 day'))
       SELECT f AS fecha FROM d ORDER BY f`).all(hoy, hoy);
    const ocupa = db.prepare(
      `SELECT c.estatus, c.hora_inicio, t.nombre AS tipo FROM compromiso c
         LEFT JOIN tipo_evento t ON t.id = c.tipo_evento_id
        WHERE c.salon_id = ? AND c.fecha = ? ORDER BY c.inicio_at`);
    const proximosDias = diasProximos.map((d) => ({
      fecha: d.fecha,
      salones: salonesAct.map((s) => {
        const evs = ocupa.all(s.id, d.fecha);
        // Un día con evento no está necesariamente lleno. Se prueban los tres
        // horarios estándar: una boda de noche deja la mañana y la tarde
        // libres, y ese hueco es vendible.
        const huecos = evs.length
          ? ['manana', 'tarde', 'noche'].filter(
              (t) => L.disponibilidadSalon(db, s.id, d.fecha, t).estado !== 'ocupada')
          : [];
        return {
          clave: s.clave, nombre: s.nombre,
          libre: evs.length === 0,
          cabe_otro: huecos.length > 0,
          huecos,
          eventos: evs.length,
          tipo: evs[0]?.tipo ?? null,
          estatus: evs[0]?.estatus ?? null,
        };
      }),
    }));

    // Cuántos días de los próximos 90 siguen libres. Todos los días cuentan:
    // un lunes vacío también es una noche sin cobrar.
    const diasLibres = (id) => db.prepare(
      `WITH RECURSIVE d(f) AS (
          SELECT date(?) UNION ALL SELECT date(f,'+1 day') FROM d WHERE f < date(?,'+90 day'))
       SELECT COUNT(*) total,
              SUM(NOT EXISTS (SELECT 1 FROM compromiso c
                               WHERE c.salon_id = ? AND c.fecha = d.f AND c.turno = 'noche')) libres
         FROM d`).get(hoy, hoy, id);

    return {
      hoy,
      salon: uno ? { clave: uno.clave, nombre: uno.nombre, encargada: uno.encargada } : null,
      de_hoy: deHoy,
      proximo: proximos[0] ?? null,
      proximos_dias: proximosDias,
      proximos,
      oportunidades: oportunidades.filter((o) => o.libres > 0),
      por_vencer: porVencer,
      resumen: {
        eventos_30_dias: db.prepare(
          `SELECT COUNT(*) n FROM compromiso c
            WHERE c.fecha BETWEEN ? AND date(?,'+30 day')${filtroSalon}`).get(hoy, hoy).n,
        eventos_totales: db.prepare(
          `SELECT COUNT(*) n FROM compromiso c WHERE c.fecha >= ?${filtroSalon}`).get(hoy).n,
        dias_90: uno ? diasLibres(uno.id) : null,
        precios_por_confirmar: db.prepare(
          `SELECT COUNT(*) n FROM tarifa t WHERE t.requiere_revision = 1 AND t.vigente_hasta IS NULL
            ${uno ? 'AND t.salon_id = ' + uno.id : ''}`).get().n,
        agendas: db.prepare(
          `SELECT s.nombre, s.clave, c.confirmada_hasta, c.fuente,
                  CAST(julianday(c.confirmada_hasta) - julianday(?) AS INTEGER) AS dias
             FROM control_agenda c JOIN salon s ON s.id = c.salon_id
            ${uno ? 'WHERE s.id = ' + uno.id : ''}
            ORDER BY c.confirmada_hasta`).all(hoy),
      },
    };
  },

  'GET /api/salones': () => db.prepare(
    `SELECT s.*, c.confirmada_hasta, c.fuente, c.ultima_revision
       FROM salon s LEFT JOIN control_agenda c ON c.salon_id = s.id
      ORDER BY s.id`).all(),

  // ─────────────────────────────── acceso ──────────────────────────────────
  // Devuelve quién es la sesión actual. El panel la llama al abrir: si no hay
  // nadie, manda a la pantalla de entrada.
  /**
   * Corrige los datos de un salón.
   *
   * Hay dos clases de campo aquí y no se tratan igual:
   *
   *   · los DESCRIPTIVOS (dirección, WhatsApp, horario de visitas, el párrafo
   *     de venta) los conoce mejor quien está en el salón, y cambian solos.
   *   · los OPERATIVOS (capacidad, minutos de aseo, hora de cierre) mandan
   *     sobre la agenda y sobre el precio. Cambiar el aseo a 30 minutos
   *     abriría huecos que no existen, y bajar el cierre invalidaría
   *     cotizaciones ya dadas. Esos son del admin.
   */
  'PUT /api/salones': (_u, c, ctx) => {
    const s = db.prepare('SELECT * FROM salon WHERE clave = ?').get(String(c?.clave ?? ''));
    if (!s) return { error: 'ese salón no existe' };
    const esAdmin = ctx.usuario.rol === 'admin';
    // Una encargada solo toca el suyo.
    if (!esAdmin && ctx.usuario.salon !== s.clave) {
      return { error: 'sin permiso',
        detalle: 'Tu cuenta solo puede cambiar los datos de ' + (ctx.usuario.salon ?? 'su salón') + '.' };
    }

    const texto = (k) => (k in c ? (String(c[k] ?? '').trim() || null) : s[k]);
    const n = {
      nombre: 'nombre' in c ? String(c.nombre).trim() : s.nombre,
      direccion: texto('direccion'),
      maps_url: texto('maps_url'),
      // Las tres redes pasan por comoUrl: se guardan siempre con https://.
      fanpage: 'fanpage' in c ? comoUrl(c.fanpage) : s.fanpage,
      instagram: 'instagram' in c ? comoUrl(c.instagram) : s.instagram,
      tiktok: 'tiktok' in c ? comoUrl(c.tiktok) : s.tiktok,
      whatsapp: texto('whatsapp'),
      encargada: texto('encargada'),
      encargada_wa: texto('encargada_wa'),
      horario_visitas: texto('horario_visitas'),
      estacionamiento: texto('estacionamiento'),
      diferenciador: texto('diferenciador'),
    };
    if (n.nombre.length < 3) return { error: 'falta el nombre' };

    // Operativos: solo admin, y con límites.
    const op = { capacidad_min: s.capacidad_min, capacidad_max: s.capacidad_max,
                 minutos_aseo: s.minutos_aseo, cierre_maximo: s.cierre_maximo };
    const pedidosOp = ['capacidad_min', 'capacidad_max', 'minutos_aseo', 'cierre_maximo']
      .filter((k) => k in c && String(c[k]) !== String(s[k]));
    if (pedidosOp.length) {
      if (!esAdmin) {
        return { error: 'sin permiso',
          detalle: 'La capacidad, el tiempo de aseo y la hora de cierre solo los cambia un administrador: ' +
                   'mandan sobre la agenda y sobre el precio.' };
      }
      for (const k of pedidosOp) {
        if (k === 'cierre_maximo') {
          if (!/^\d{2}:\d{2}$/.test(String(c[k]))) return { error: 'hora de cierre inválida' };
          op[k] = String(c[k]);
        } else {
          const v = entero(c[k]);
          if (v === null || v < 0) return { error: `${k} inválido` };
          op[k] = v;
        }
      }
      if (op.capacidad_min > op.capacidad_max) {
        return { error: 'capacidad al revés',
          detalle: 'El mínimo de invitados no puede ser mayor que el máximo.' };
      }
      if (op.minutos_aseo > 8 * 60) {
        return { error: 'aseo demásiado largo',
          detalle: 'Más de ocho horas de aseo dejaría casi todos los días sin hueco. ¿Seguro?' };
      }
    }

    db.prepare(
      `UPDATE salon SET nombre=?, direccion=?, maps_url=?, fanpage=?, instagram=?,
              tiktok=?, whatsapp=?,
              encargada=?, encargada_wa=?, horario_visitas=?, estacionamiento=?,
              diferenciador=?, capacidad_min=?, capacidad_max=?, minutos_aseo=?, cierre_maximo=?
        WHERE id=?`
    ).run(n.nombre, n.direccion, n.maps_url, n.fanpage, n.instagram, n.tiktok, n.whatsapp,
          n.encargada, n.encargada_wa, n.horario_visitas, n.estacionamiento,
          n.diferenciador, op.capacidad_min, op.capacidad_max, op.minutos_aseo, op.cierre_maximo,
          s.id);

    const todos = { ...n, ...op };
    const cambios = Object.keys(todos).filter((k) => String(s[k] ?? '') !== String(todos[k] ?? ''));
    anotar('salon', s.id, 'cambio', ctx.usuario.nombre,
      `${s.nombre} · ${cambios.join(', ') || 'sin cambios'}`);
    return { ok: true, cambios: cambios.length, cambiados: cambios };
  },

  'GET /api/yo': (_u, _c, ctx) => (ctx.usuario
    ? { usuario: ctx.usuario.usuario, nombre: ctx.usuario.nombre, rol: ctx.usuario.rol,
        salon: ctx.usuario.salon, debe_cambiar: !!ctx.usuario.debe_cambiar,
        permisos: A.PERMISOS[ctx.usuario.rol] }
    : { usuario: null }),

  'POST /api/entrar': (_u, c, ctx) => {
    const nombre = String(c?.usuario ?? '').trim().toLowerCase();
    const clave = String(c?.clave ?? '');
    const u = db.prepare('SELECT * FROM usuario WHERE usuario = ?').get(nombre);

    // Mismo mensaje para usuario que no existe y contraseña equivocada: si
    // fueran distintos, cualquiera podría averiguar qué cuentas hay.
    const negar = () => ({ error: 'no coincide',
      detalle: 'El usuario o la contraseña no coinciden.' });

    if (!u || !u.activo) {
      // Se deriva igual aunque no exista, para que fallar rápido no delate
      // que esa cuenta no está.
      A.derivar(clave);
      return negar();
    }
    const min = A.estaBloqueado(u);
    if (min) {
      return { error: 'bloqueado',
        detalle: `Demasiados intentos. Vuelve a probar en ${min} minuto${min > 1 ? 's' : ''}.` };
    }
    if (!A.coincide(clave, u.sal, u.clave_hash)) {
      const bloqueo = A.fallo(db, u);
      if (bloqueo) {
        return { error: 'bloqueado',
          detalle: `Demasiados intentos. La cuenta queda bloqueada ${bloqueo} minutos.` };
      }
      return negar();
    }
    A.acierto(db, u);
    ctx.cookie = A.ponerCookie(A.abrirSesion(db, u.id, ctx.agente), { seguro: ctx.seguro });
    return { ok: true, nombre: u.nombre, rol: u.rol, salon: null, debe_cambiar: !!u.debe_cambiar };
  },

  'POST /api/salir': (_u, _c, ctx) => {
    if (ctx.token) A.cerrarSesion(db, ctx.token);
    ctx.cookie = A.borrarCookie();
    return { ok: true };
  },

  'POST /api/cambiar-clave': (_u, c, ctx) => {
    if (!ctx.usuario) return { error: 'sin sesión' };
    const u = db.prepare('SELECT * FROM usuario WHERE id = ?').get(ctx.usuario.id);
    if (!A.coincide(String(c?.actual ?? ''), u.sal, u.clave_hash)) {
      return { error: 'no coincide', detalle: 'La contraseña actual no es correcta.' };
    }
    const nueva = String(c?.nueva ?? '');
    const debil = A.claveDebil(nueva);
    if (debil) return { error: 'débil', detalle: debil };
    if (A.coincide(nueva, u.sal, u.clave_hash)) {
      return { error: 'igual', detalle: 'La contraseña nueva es la misma que la anterior.' };
    }
    const { sal, hash } = A.derivar(nueva);
    db.prepare('UPDATE usuario SET sal=?, clave_hash=?, debe_cambiar=0 WHERE id=?')
      .run(sal, hash, u.id);
    // Se tiran todas las sesiones y se abre una nueva: si alguien más tenía
    // una abierta con la contraseña vieja, se le cae aquí.
    A.cerrarTodas(db, u.id);
    ctx.cookie = A.ponerCookie(A.abrirSesion(db, u.id, ctx.agente), { seguro: ctx.seguro });
    anotar('usuario', u.id, 'cambio', u.nombre, 'cambió su contraseña');
    return { ok: true };
  },

  'POST /api/usuarios': (_u, c, ctx) => {
    if (!A.puede(ctx.usuario, 'usuarios')) return { error: 'sin permiso' };
    const usuario = String(c?.usuario ?? '').trim().toLowerCase();
    const nombre = String(c?.nombre ?? '').trim();
    const rol = String(c?.rol ?? '');

    if (!/^[a-z0-9._-]{3,20}$/.test(usuario)) {
      return { error: 'usuario inválido',
        detalle: 'De 3 a 20 caracteres, sin espacios ni acentos: letras, números, punto, guion.' };
    }
    if (nombre.length < 3) {
      return { error: 'falta el nombre',
        detalle: 'El nombre completo es el que aparece en la bitácora; con iniciales no se sabe quién fue.' };
    }
    if (!ROLES.includes(rol)) return { error: 'rol inválido' };
    if (db.prepare('SELECT 1 FROM usuario WHERE usuario = ?').get(usuario)) {
      return { error: 'ya existe', detalle: `Ya hay una cuenta con el usuario «${usuario}».` };
    }
    let salonId = null;
    if (c?.salon) {
      const s = db.prepare('SELECT id FROM salon WHERE clave = ?').get(c.salon);
      if (!s) return { error: 'salón desconocido' };
      salonId = s.id;
    }
    if (rol === 'encargada' && !salonId) {
      return { error: 'falta el salón',
        detalle: 'Una encargada necesita un salón: es lo que delimita lo que puede mover.' };
    }
    // La contraseña la genera el servidor. Nadie la escribe por otra persona:
    // así quien administra no termina conociendo la clave de nadie.
    const clave = A.claveTemporal();
    const { sal, hash } = A.derivar(clave);
    const r = db.prepare(
      `INSERT INTO usuario (usuario, nombre, sal, clave_hash, rol, salon_id, creado_por)
       VALUES (?,?,?,?,?,?,?)`).run(usuario, nombre, sal, hash, rol, salonId, ctx.usuario.nombre);
    anotar('usuario', Number(r.lastInsertRowid), 'alta', ctx.usuario.nombre,
      `creó la cuenta «${usuario}» (${nombre}, ${rol})`);
    // Se devuelve una sola vez: no se guarda en claro en ningún lado.
    return { ok: true, usuario, clave_temporal: clave };
  },

  'PUT /api/usuarios': (_u, c, ctx) => {
    if (!A.puede(ctx.usuario, 'usuarios')) return { error: 'sin permiso' };
    const objetivo = db.prepare('SELECT * FROM usuario WHERE usuario = ?')
      .get(String(c?.usuario ?? '').toLowerCase());
    if (!objetivo) return { error: 'no existe' };
    const propia = objetivo.id === ctx.usuario.id;

    const n = {
      nombre: 'nombre' in c ? String(c.nombre).trim() : objetivo.nombre,
      rol: 'rol' in c ? String(c.rol) : objetivo.rol,
      activo: 'activo' in c ? (c.activo ? 1 : 0) : objetivo.activo,
    };
    if (!ROLES.includes(n.rol)) return { error: 'rol inválido' };
    if (n.nombre.length < 3) return { error: 'falta el nombre' };

    let salonId = objetivo.salon_id;
    if ('salon' in c) {
      if (!c.salon) salonId = null;
      else {
        const s = db.prepare('SELECT id FROM salon WHERE clave = ?').get(c.salon);
        if (!s) return { error: 'salón desconocido' };
        salonId = s.id;
      }
    }
    if (n.rol === 'encargada' && !salonId) {
      return { error: 'falta el salón',
        detalle: 'Una encargada necesita un salón asignado.' };
    }
    if (n.rol !== 'encargada') salonId = null;

    // Los dos candados contra el encierro.
    const dejaDeSerAdmin = objetivo.rol === 'admin' && objetivo.activo &&
                           (n.rol !== 'admin' || !n.activo);
    if (dejaDeSerAdmin && contarAdmins() <= 1) {
      return { error: 'último admin',
        detalle: 'Es la única cuenta de administrador activa. Crea o asciende otra antes de cambiar esta, ' +
                 'o el panel se queda sin quien administre usuarios.' };
    }
    if (propia && !n.activo) {
      return { error: 'no puedes desactivarte',
        detalle: 'No puedes desactivar tu propia cuenta: te quedarías fuera en este momento.' };
    }

    db.prepare('UPDATE usuario SET nombre=?, rol=?, salon_id=?, activo=? WHERE id=?')
      .run(n.nombre, n.rol, salonId, n.activo, objetivo.id);
    // Cambiar rol o salón cambia lo que puede hacer: la sesión abierta tiene
    // que volver a nacer, si no seguiría con los permisos de antes.
    if (n.rol !== objetivo.rol || salonId !== objetivo.salon_id || !n.activo) {
      A.cerrarTodas(db, objetivo.id);
    }
    const cambios = [];
    if (n.nombre !== objetivo.nombre) cambios.push(`nombre: ${objetivo.nombre} → ${n.nombre}`);
    if (n.rol !== objetivo.rol) cambios.push(`rol: ${objetivo.rol} → ${n.rol}`);
    if (salonId !== objetivo.salon_id) cambios.push('cambió de salón');
    if (n.activo !== objetivo.activo) cambios.push(n.activo ? 'reactivada' : 'desactivada');
    anotar('usuario', objetivo.id, 'cambio', ctx.usuario.nombre,
      `«${objetivo.usuario}»: ${cambios.join(' · ') || 'sin cambios'}`);
    return { ok: true, cambios: cambios.length, sesion_cerrada: cambios.length > 0 };
  },

  // Genera una contraseña temporal nueva. No devuelve la anterior porque no
  // existe en ningún lado: solo está su derivación.
  'POST /api/usuarios/clave': (_u, c, ctx) => {
    if (!A.puede(ctx.usuario, 'usuarios')) return { error: 'sin permiso' };
    const objetivo = db.prepare('SELECT * FROM usuario WHERE usuario = ?')
      .get(String(c?.usuario ?? '').toLowerCase());
    if (!objetivo) return { error: 'no existe' };
    const clave = A.claveTemporal();
    const { sal, hash } = A.derivar(clave);
    db.prepare(
      `UPDATE usuario SET sal=?, clave_hash=?, debe_cambiar=1, intentos=0,
              bloqueado_hasta=NULL WHERE id=?`).run(sal, hash, objetivo.id);
    A.cerrarTodas(db, objetivo.id);
    anotar('usuario', objetivo.id, 'cambio', ctx.usuario.nombre,
      `generó contraseña nueva para «${objetivo.usuario}»`);
    return { ok: true, usuario: objetivo.usuario, clave_temporal: clave };
  },

  // Quita el bloqueo por intentos fallidos sin tocar la contraseña: sirve
  // cuando alguien se equivocó cinco veces y no quiere esperar los 15 minutos.
  'POST /api/usuarios/desbloquear': (_u, c, ctx) => {
    if (!A.puede(ctx.usuario, 'usuarios')) return { error: 'sin permiso' };
    const objetivo = db.prepare('SELECT * FROM usuario WHERE usuario = ?')
      .get(String(c?.usuario ?? '').toLowerCase());
    if (!objetivo) return { error: 'no existe' };
    db.prepare('UPDATE usuario SET intentos=0, bloqueado_hasta=NULL WHERE id=?').run(objetivo.id);
    return { ok: true };
  },

  'GET /api/usuarios': (_u, _c, ctx) => {
    if (!A.puede(ctx.usuario, 'usuarios')) return { error: 'sin permiso' };
    return db.prepare(
      `SELECT u.usuario, u.nombre, u.rol, s.clave AS salon, u.activo, u.debe_cambiar,
              u.ultimo_acceso, u.bloqueado_hasta
         FROM usuario u LEFT JOIN salon s ON s.id = u.salon_id
        ORDER BY u.rol, u.usuario`).all();
  },

  /**
   * Autoguardado del paquete que se está capturando.
   *
   * Nace como borrador (`borrador = 1`) y así NO se cotiza: mientras esté
   * incompleto no puede llegarle a un cliente. El frontend manda el estado
   * entero cada vez y aquí se rehace; es un borrador, no hace falta el baile
   * de diferencias, y rehacer no puede quedar a medias.
   */
  'POST /api/paquetes/borrador': (_u, c, ctx) => {
    if (!A.puede(ctx.usuario, 'precios')) return { error: 'sin permiso' };
    const nombre = String(c?.nombre ?? '').trim();
    if (nombre.length < 3) {
      // Sin nombre no hay nada que guardar todavía: no es un error, es que
      // la captura apenas empezó.
      return { ok: true, esperando: 'nombre' };
    }
    const unidad = c?.unidad_precio === 'por_persona' ? 'por_persona' : 'total';
    let id = entero(c?.id) || null;

    // node:sqlite no trae db.transaction() (eso es de better-sqlite3): la
    // transacción se lleva a mano, y sin ella un guardado a medias dejaría el
    // paquete sin contenidos ni tarifas.
    const guardar = () => {
      if (id) {
        const ya = db.prepare('SELECT borrador FROM paquete WHERE id = ?').get(id);
        if (!ya) { id = null; }
        // Un paquete ya publicado no se toca por esta vía: para eso está la
        // edición normal, que lleva bitácora campo por campo.
        else if (!ya.borrador) throw new Error('ese paquete ya no es un borrador');
      }
      if (id) {
        db.prepare('UPDATE paquete SET nombre=?, unidad_precio=? WHERE id=?').run(nombre, unidad, id);
      } else {
        const choca = db.prepare('SELECT id FROM paquete WHERE nombre = ?').get(nombre);
        if (choca) throw new Error(`Ya existe un paquete llamado «${nombre}».`);
        id = Number(db.prepare(
          'INSERT INTO paquete (nombre, unidad_precio, borrador) VALUES (?,?,1)')
          .run(nombre, unidad).lastInsertRowid);
        anotar('paquete', id, 'alta', ctx.usuario.nombre, `empezó el borrador «${nombre}»`);
      }

      // Celebraciones
      db.prepare('DELETE FROM paquete_tipo_evento WHERE paquete_id = ?').run(id);
      const pt = db.prepare(
        `INSERT INTO paquete_tipo_evento (paquete_id, tipo_evento_id)
         SELECT ?, id FROM tipo_evento WHERE clave = ?`);
      for (const t of c?.tipos ?? []) pt.run(id, String(t));

      // Contenido: uno por salón y escalón. Se rehace entero.
      db.prepare('DELETE FROM tarifa WHERE paquete_id = ?').run(id);
      db.prepare('DELETE FROM paquete_contenido WHERE paquete_id = ?').run(id);

      const salon = db.prepare('SELECT id FROM salon WHERE clave = ?');
      const insCont = db.prepare(
        `INSERT INTO paquete_contenido
           (paquete_id, salon_id, escalon_id, horas_salon, minutos_estancia, cortesias)
         VALUES (?,?,?,?,?,?)`);
      const insConcepto = db.prepare(
        'INSERT INTO paquete_contenido_concepto (contenido_id, concepto_id, incluido) VALUES (?,?,?)');
      const escalones = (c?.escalonado && c?.escalones?.length) ? c.escalones : [null];

      const contenidoDe = new Map();          // `${salon}|${escalon}` -> id
      for (const clave of c?.salones ?? []) {
        const s = salon.get(String(clave));
        if (!s) continue;
        for (const e of escalones) {
          const cid = Number(insCont.run(id, s.id, e ?? null,
            Number(c?.horas_salon) || null, Number(c?.minutos_estancia) || 0,
            (c?.cortesias ?? '').trim() || null).lastInsertRowid);
          contenidoDe.set(`${clave}|${e ?? 'x'}`, cid);
          for (const [conceptoId, valor] of Object.entries(c?.conceptos ?? {})) {
            insConcepto.run(cid, Number(conceptoId), valor === 'si' ? 1 : 0);
          }
        }
      }

      // Tarifas: solo las que tienen al menos un precio. Una fila con los
      // siete días vacíos no es una tarifa, es una casilla sin llenar.
      const insTarifa = db.prepare(
        `INSERT INTO tarifa (paquete_id, salon_id, escalon_id, contenido_id, anio,
                             personas_desde, personas_hasta,
                             precio_lun, precio_mar, precio_mie, precio_jue,
                             precio_vie, precio_sab, precio_dom)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      let nTarifas = 0;
      for (const t of c?.tarifas ?? []) {
        const s = salon.get(String(t.salon));
        if (!s) continue;
        const dias = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom']
          .map((k) => (t.precios?.[k] > 0 ? Number(t.precios[k]) : null));
        if (!dias.some((x) => x !== null)) continue;
        const desde = Math.max(1, entero(t.desde) || 1);
        const hasta = Math.max(desde, entero(t.hasta) || desde);
        insTarifa.run(id, s.id, t.escalon_id ?? null,
          contenidoDe.get(`${t.salon}|${t.escalon_id ?? 'x'}`) ?? null,
          entero(t.anio), desde, hasta, ...dias);
        nTarifas++;
      }
      return nTarifas;
    };

    db.exec('BEGIN');
    try {
      const nTarifas = guardar();
      db.exec('COMMIT');
      return { ok: true, id, tarifas: nTarifas, guardado_at: new Date().toISOString() };
    } catch (e) {
      db.exec('ROLLBACK');
      return { error: 'no se pudo guardar', detalle: e.message };
    }
  },

  /** Un borrador tal como se dejó, para volver a él y terminarlo. */
  'GET /api/paquetes/borrador': (u) => {
    const id = entero(u.searchParams.get('id'));
    const p = db.prepare('SELECT * FROM paquete WHERE id = ? AND borrador = 1').get(id);
    if (!p) return { error: 'no existe ese borrador' };

    const cont = db.prepare(
      `SELECT c.id, c.escalon_id, c.horas_salon, c.minutos_estancia, c.cortesias, s.clave AS salon
         FROM paquete_contenido c JOIN salon s ON s.id = c.salon_id
        WHERE c.paquete_id = ? ORDER BY c.id`).all(id);
    const tar = db.prepare(
      `SELECT t.anio, t.escalon_id, t.personas_desde, t.personas_hasta, s.clave AS salon,
              t.precio_lun, t.precio_mar, t.precio_mie, t.precio_jue,
              t.precio_vie, t.precio_sab, t.precio_dom
         FROM tarifa t JOIN salon s ON s.id = t.salon_id
        WHERE t.paquete_id = ? ORDER BY s.id, t.anio, t.personas_desde`).all(id);

    // Los rangos de invitados se reconstruyen de las tarifas: son los mismos
    // para todas, así que basta con los distintos.
    const rangos = [...new Map(tar.map((t) =>
      [`${t.personas_desde}|${t.personas_hasta}`,
       { desde: t.personas_desde, hasta: t.personas_hasta }])).values()]
      .sort((a, b) => a.desde - b.desde);

    // Y las claves de precio tienen que coincidir con las que arma la
    // pantalla: salón|año|escalón|índice del rango.
    const precios = {};
    for (const t of tar) {
      const i = rangos.findIndex((r) => r.desde === t.personas_desde && r.hasta === t.personas_hasta);
      precios[`${t.salon}|${t.anio}|${t.escalon_id ?? 'x'}|${i}`] = {
        lun: t.precio_lun, mar: t.precio_mar, mie: t.precio_mie, jue: t.precio_jue,
        vie: t.precio_vie, sab: t.precio_sab, dom: t.precio_dom,
      };
    }

    const conceptos = {};
    if (cont.length) {
      for (const x of db.prepare(
        'SELECT concepto_id, incluido FROM paquete_contenido_concepto WHERE contenido_id = ?')
        .all(cont[0].id)) conceptos[x.concepto_id] = x.incluido ? 'si' : 'no';
    }

    const escalones = [...new Set(cont.map((c) => c.escalon_id).filter((x) => x !== null))];
    return {
      id: p.id, nombre: p.nombre, unidad_precio: p.unidad_precio,
      tipos: db.prepare(
        `SELECT te.clave FROM paquete_tipo_evento pt JOIN tipo_evento te ON te.id = pt.tipo_evento_id
          WHERE pt.paquete_id = ?`).all(id).map((r) => r.clave),
      salones: [...new Set(cont.map((c) => c.salon))],
      escalonado: escalones.length > 0,
      escalones,
      anios: [...new Set(tar.map((t) => t.anio))].sort(),
      rangos: rangos.length ? rangos : undefined,
      horas_salon: cont[0]?.horas_salon ?? 5,
      minutos_estancia: cont[0]?.minutos_estancia ?? 0,
      cortesias: cont[0]?.cortesias ?? '',
      conceptos, precios,
      falta: loQueFalta(id),
    };
  },

  /** Publica el borrador: a partir de aquí sí se cotiza. */
  'POST /api/paquetes/publicar': (_u, c, ctx) => {
    if (!A.puede(ctx.usuario, 'precios')) return { error: 'sin permiso' };
    const id = entero(c?.id);
    const p = db.prepare('SELECT * FROM paquete WHERE id = ?').get(id);
    if (!p) return { error: 'no existe' };
    const falta = loQueFalta(id);
    if (falta.length) {
      return { error: 'incompleto', detalle: 'Falta ' + falta.join(', ') + '.', falta };
    }
    db.prepare('UPDATE paquete SET borrador = 0 WHERE id = ?').run(id);
    anotar('paquete', id, 'cambio', ctx.usuario.nombre, `publicó «${p.nombre}»`);
    return { ok: true };
  },

  'GET /api/catalogo': () => ({
    tipos_evento: db.prepare('SELECT * FROM tipo_evento ORDER BY id').all(),
    // Las horas se eligen de esta lista, no se escriben: el texto libre es lo
    // que dejó «13:00 pm» en la base.
    horas: L.horasElegibles().map((h) => h.valor),
    horario_turno: L.TURNO_HORARIO,
    escalones: db.prepare('SELECT * FROM escalon ORDER BY meses_min, IFNULL(meses_max,999)').all(),
    // Con rango de precio y en qué salones existe: sin eso, una tarjeta de
    // paquete no le dice nada a quien vende.
    paquetes: db.prepare(
      `SELECT p.id, p.nombre, p.unidad_precio, p.borrador,
              COUNT(t.id) AS tarifas,
              MIN(COALESCE(t.precio_lun, t.precio_vie)) AS desde,
              MAX(COALESCE(t.precio_sab, t.precio_vie)) AS hasta,
              (SELECT GROUP_CONCAT(x.clave) FROM (
                 SELECT DISTINCT s.clave, s.id FROM tarifa t2
                   JOIN salon s ON s.id = t2.salon_id
                  WHERE t2.paquete_id = p.id ORDER BY s.id) x) AS salones,
              (SELECT GROUP_CONCAT(te.nombre, ' · ') FROM paquete_tipo_evento pt
                 JOIN tipo_evento te ON te.id = pt.tipo_evento_id
                WHERE pt.paquete_id = p.id) AS celebraciones
         FROM paquete p
         LEFT JOIN tarifa t ON t.paquete_id = p.id AND t.requiere_revision = 0
        GROUP BY p.id
        -- Los borradores arriba: son los que alguien tiene que terminar.
        ORDER BY p.borrador DESC, p.nombre`).all()
      // Qué le falta a cada uno. Solo se calcula para los borradores: los
      // publicados ya pasaron por esta misma comprobación.
      .map((p) => (p.borrador ? { ...p, falta: loQueFalta(p.id) } : p)),
    conceptos: db.prepare('SELECT * FROM concepto ORDER BY universal DESC, nombre').all(),
  }),

  'POST /api/cotizar': (_, cuerpo) => L.cotizar(db, {
    salon: cuerpo.salon ?? null,
    tipo_evento: cuerpo.tipo_evento,
    fecha_evento: cuerpo.fecha_evento,
    personas: entero(cuerpo.personas),
    turno: cuerpo.turno ?? 'noche',
    hoy: cuerpo.hoy ?? null,
  }),

  'GET /api/disponibilidad': (u) => {
    const fecha = u.searchParams.get('fecha');
    if (!L.esFechaValida(fecha)) return { error: 'fecha inválida, usa YYYY-MM-DD' };
    const turno = u.searchParams.get('turno') ?? 'noche';
    const salones = db.prepare('SELECT id, clave, nombre FROM salon WHERE activo = 1 ORDER BY id').all();
    return {
      fecha, turno,
      salones: salones.map((s) => ({
        salon: s.clave, nombre: s.nombre, ...L.disponibilidadSalon(db, s.id, fecha, turno),
      })),
    };
  },

  /**
   * «¿Qué sábados hay libres en diciembre?» — la pregunta más común de quien
   * busca salón, y la que el agente no puede contestar solo.
   *
   * Existe porque un modelo calculó que el 5 de diciembre de 2027 era sábado
   * (es domingo), consultó ese día y cotizó sobre él. Los días de la semana
   * los cuenta SQLite con strftime, que no se equivoca ni depende de la zona
   * horaria porque trabaja sobre fechas sin hora.
   */
  'GET /api/dias-disponibles': (u) => {
    const mes = u.searchParams.get('mes');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes ?? '')) return { error: 'mes inválido, usa YYYY-MM' };
    const turno = u.searchParams.get('turno') ?? 'noche';

    const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const pedido = (u.searchParams.get('dia_semana') ?? '').trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    let filtro = null;
    if (pedido) {
      // Se aceptan «sabado» y «sábado», y también el plural que escribe la gente.
      const i = DIAS.findIndex((d) => {
        const s = d.normalize('NFD').replace(/[̀-ͯ]/g, '');
        return s === pedido || s + 's' === pedido;
      });
      if (i < 0) return { error: 'día de la semana desconocido' };
      filtro = String(i);
    }

    const dias = db.prepare(
      `WITH RECURSIVE d(f) AS (
         SELECT date(? || '-01')
         UNION ALL SELECT date(f,'+1 day') FROM d WHERE date(f,'+1 day') < date(? || '-01','+1 month'))
       SELECT f AS fecha, strftime('%w', f) AS dow FROM d`).all(mes, mes);

    const salones = db.prepare('SELECT id, clave, nombre FROM salon WHERE activo = 1 ORDER BY id').all();
    return {
      mes, turno, dia_semana: filtro === null ? null : DIAS[Number(filtro)],
      dias: dias.filter((d) => filtro === null || d.dow === filtro).map((d) => {
        const est = salones.map((s) => ({
          salon: s.clave, nombre: s.nombre,
          ...L.disponibilidadSalon(db, s.id, d.fecha, turno),
        }));
        return {
          fecha: d.fecha,
          dia_semana: DIAS[Number(d.dow)],
          // Se separan a proposito: «no_confirmada» no es «libre», y el agente
          // no debe poder confundirlas leyendo una sola lista.
          libres: est.filter((e) => e.estado === 'libre').map((e) => e.salon),
          por_confirmar: est.filter((e) => e.estado === 'no_confirmada').map((e) => e.salon),
          ocupados: est.filter((e) => e.estado === 'ocupada').map((e) => e.salon),
        };
      }),
    };
  },

  /**
   * Todas las láminas, con su paquete y su salón.
   *
   * Existe porque quien elige la imagen es un nodo Code de n8n, y un Code no
   * puede leer un nodo conectado como herramienta: `cotizar` le devuelve la
   * lámina al agente, pero el código que arma el envío no la alcanza. Son 40
   * renglones, así que se traen todos y el cruce se hace ahí.
   */
  'GET /api/imagenes': () => ({
    // Van TODOS los salones, tengan lámina o no. Quien elige la imagen
    // necesita reconocer el nombre de un salón para descartarlo: si solo
    // conociera los que ya tienen foto, al cotizar Santa Cruz sin lámina
    // subida le mandaría al cliente la de Norma.
    salones: db.prepare('SELECT clave, nombre FROM salon WHERE activo = 1 ORDER BY id').all(),
    laminas: db.prepare(
      `SELECT i.id, p.nombre AS paquete, s.clave AS salon, s.nombre AS salon_nombre,
              i.etiqueta, i.url, i.subida_at
         FROM paquete_imagen i
         JOIN paquete p ON p.id = i.paquete_id
         JOIN salon   s ON s.id = i.salon_id
        ORDER BY s.id, p.nombre, i.etiqueta`).all(),
    cortesias: db.prepare(
      `SELECT c.id, c.clave, c.titulo, c.pistas, s.clave AS salon, s.nombre AS salon_nombre,
              c.url, c.subida_at
         FROM cortesia_imagen c
         JOIN salon s ON s.id = c.salon_id
        ORDER BY s.id, c.clave`).all(),
  }),

  /**
   * Cambiar la lámina de un paquete o la foto de una cortesía, desde el panel.
   *
   * Sube la imagen al Drive de Kommo y reemplaza la URL. La vieja se queda en
   * el Drive a propósito: si la nueva sale mal, ahí está la anterior.
   *
   * Hace falta KOMMO_TOKEN. Sin él el panel sigue mostrando las imágenes —
   * eso no necesita token—, pero no puede cambiarlas.
   */
  'POST /api/imagenes/archivo': async (u, c) => {
    if (!KOMMO_TOKEN) {
      return { error: 'sin token', detalle: 'Falta KOMMO_TOKEN para poder subir imágenes a Kommo.' };
    }
    const tipo = u.searchParams.get('tipo');
    const id = entero(u.searchParams.get('id'));
    const tabla = tipo === 'cortesia' ? 'cortesia_imagen' : tipo === 'paquete' ? 'paquete_imagen' : null;
    if (!tabla || !id) return { error: 'faltan datos', detalle: 'Indica tipo (paquete o cortesia) e id.' };

    const fila = db.prepare(`SELECT id FROM ${tabla} WHERE id = ?`).get(id);
    if (!fila) return { error: 'no existe', detalle: 'Esa imagen no está registrada.' };

    const bytes = c?.bytes;
    if (!bytes?.length) return { error: 'sin archivo', detalle: 'No llegó ninguna imagen.' };
    // La firma de los formatos que Kommo muestra como foto. Se mira el
    // contenido y no la extensión, que la pone quien sube.
    const esJPG = bytes[0] === 0xff && bytes[1] === 0xd8;
    const esPNG = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const esWEBP = bytes.subarray(0, 4).toString('latin1') === 'RIFF'
                && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
    if (!esJPG && !esPNG && !esWEBP) {
      return { error: 'no es imagen', detalle: 'Solo se aceptan JPG, PNG o WebP.' };
    }

    const nombre = (u.searchParams.get('nombre') || 'lamina.jpg').slice(0, 120);
    const subida = await subirAKommo(bytes, nombre, esPNG ? 'image/png' : esWEBP ? 'image/webp' : 'image/jpeg');

    const sha = createHash('sha256').update(bytes).digest('hex');
    db.prepare(`UPDATE ${tabla} SET url = ?, archivo_uuid = ?, nombre = ?, sha256 = ?,
                subida_at = datetime('now') WHERE id = ?`)
      .run(subida.url, subida.uuid, nombre, sha, id);
    anotar(tabla, id, 'cambio', c._autor, `imagen reemplazada (${nombre})`);
    return { ok: true, url: subida.url };
  },

  // ════════════════════════════ avisos ═══════════════════════════
  //
  // La regla del Lic. Barron: el agente NUNCA deja al cliente sin informacion.
  // Si no tiene un dato, no se apaga — avisa y sigue conversando. Aqui queda
  // el aviso, como fila que se ve, para que ninguno se pierda entre los
  // mensajes del grupo.

  'GET /api/avisos': (u) => {
    const estado = u.searchParams.get('estado');
    const clave = u.searchParams.get('salon');
    const filas = db.prepare(
      `SELECT a.*, s.clave AS salon, s.nombre AS salon_nombre, s.encargada
         FROM aviso a LEFT JOIN salon s ON s.id = a.salon_id
        WHERE (? IS NULL OR a.estado = ?)
          AND (? IS NULL OR s.clave = ?)
        ORDER BY a.estado = 'pendiente' DESC, a.creado_en DESC
        LIMIT 300`).all(estado || null, estado || null, clave || null, clave || null);
    const pendientes = db.prepare(
      "SELECT COUNT(*) n FROM aviso WHERE estado = 'pendiente'").get().n;
    return { pendientes, avisos: filas };
  },

  'POST /api/avisos': (_u, c) => {
    const motivo = String(c?.motivo ?? '').trim();
    const texto = String(c?.texto ?? '').trim();
    if (!motivo) return { error: 'falta el motivo' };
    if (texto.length < 5) return { error: 'falta el texto', detalle: 'Di qué necesitas de la encargada.' };
    // El salón puede venir como clave («norma») o como lo guarda el lead en
    // Kommo («Norma Eventos»). Quien llama es el agente, y lo que tiene a la
    // mano es lo segundo.
    const s = c?.salon
      ? db.prepare('SELECT id FROM salon WHERE clave = ? OR nombre = ?').get(c.salon, c.salon)
      : null;
    const lead = (c?.lead_id ?? '').toString().trim() || null;

    // Un mismo lead preguntando lo mismo no genera dos avisos. Sin esto, cada
    // mensaje del cliente mientras espera crearia uno nuevo y la encargada
    // veria la misma pregunta cinco veces.
    if (lead) {
      const ya = db.prepare(
        "SELECT id FROM aviso WHERE lead_id = ? AND motivo = ? AND estado = 'pendiente'")
        .get(lead, motivo);
      if (ya) return { ok: true, id: ya.id, repetido: true };
    }

    const r = db.prepare(
      `INSERT INTO aviso (salon_id, lead_id, motivo, texto) VALUES (?,?,?,?)`)
      .run(s?.id ?? null, lead, motivo, texto);
    anotar('aviso', Number(r.lastInsertRowid), 'alta', c._autor ?? 'agente', motivo);
    return { ok: true, id: Number(r.lastInsertRowid), repetido: false };
  },

  'PUT /api/avisos': (_u, c) => {
    const id = entero(c?.id);
    const a = db.prepare('SELECT id FROM aviso WHERE id = ?').get(id);
    if (!a) return { error: 'ese aviso no existe' };

    if (c.estado === 'atendido') {
      db.prepare(`UPDATE aviso SET estado='atendido', atendido_en=datetime('now'),
                  atendido_por=? WHERE id=?`).run(c._autor ?? null, id);
      anotar('aviso', id, 'cambio', c._autor, 'atendido');
      return { ok: true };
    }
    // Lo usa el motor de recordatorios: deja constancia de que volvio a
    // insistir, sin tocar el estado.
    if (c.recordado) {
      db.prepare(`UPDATE aviso SET ultimo_aviso_en=datetime('now'),
                  recordatorios = recordatorios + 1 WHERE id=?`).run(id);
      return { ok: true };
    }
    return { error: 'nada que cambiar' };
  },

  // ════════════════════════════ citas ════════════════════════════
  //
  // El agente NUNCA confirma una cita: la pide, y queda en 'solicitada'.
  // Quien confirma es la encargada, desde el panel. Por eso la solicitud es
  // una fila que se ve y no un mensaje que se pierde en el chat del grupo.

  /** Las horas en que todavia cabe una visita ese dia en ese salon. */
  'GET /api/citas/huecos': (u) => {
    const clave = u.searchParams.get('salon');
    const s = db.prepare('SELECT id, clave, nombre FROM salon WHERE clave = ?').get(clave);
    if (!s) return { error: 'salón desconocido' };
    return { salon: s.clave, salon_nombre: s.nombre,
             ...L.huecosCita(db, s.id, u.searchParams.get('fecha')) };
  },

  /** La agenda de visitas y ensayos de un rango. Es lo que pinta la pantalla. */
  'GET /api/citas': (u) => {
    const desde = u.searchParams.get('desde'), hasta = u.searchParams.get('hasta');
    if (!L.esFechaValida(desde) || !L.esFechaValida(hasta)) return { error: 'desde/hasta inválidos' };
    const clave = u.searchParams.get('salon');
    const filas = db.prepare(
      `SELECT c.*, s.clave AS salon, s.nombre AS salon_nombre
         FROM cita c JOIN salon s ON s.id = c.salon_id
        WHERE c.fecha BETWEEN ? AND ?
          AND (? IS NULL OR s.clave = ?)
        ORDER BY c.fecha, c.hora`).all(desde, hasta, clave || null, clave || null);
    return { desde, hasta, salon: clave || null, citas: filas };
  },

  'POST /api/citas': (_u, c, ctx) => {
    const s = db.prepare('SELECT id FROM salon WHERE clave = ?').get(c?.salon);
    if (!s) return { error: 'salón desconocido' };
    if (!L.esFechaValida(c?.fecha)) return { error: 'fecha inválida' };
    if (!/^\d{2}:\d{2}$/.test(c?.hora ?? '')) return { error: 'hora inválida', detalle: 'Usa HH:MM.' };
    const tipo = c.tipo === 'ensayo' ? 'ensayo' : 'visita';
    const minutos = entero(c.minutos) ?? 60;

    // La encargada SI puede agendar fuera de la ventana o en martes — «si una
    // clienta solo puede el martes, se le pregunta». Lo que no se hace es
    // empalmar: eso se avisa y se deja que decida.
    const hueco = L.huecosCita(db, s.id, c.fecha, 30, minutos);
    const libre = (hueco.horas ?? []).includes(c.hora);
    // Decir «se empalma» cuando en realidad el salón cierra ese día es una
    // pista falsa: manda a la encargada a buscar una cita que no existe.
    const aviso = libre ? null
      : !hueco.abierto ? hueco.motivo
      : 'Esa hora se empalma con algo ya agendado o cae fuera de la ventana de citas.';

    const r = db.prepare(
      `INSERT INTO cita (salon_id, tipo, fecha, hora, minutos, lead_id, nombre,
                         telefono, estado, notas, creada_por)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(s.id, tipo, c.fecha, c.hora, minutos, c.lead_id ?? null,
           (c.nombre ?? '').trim() || null, (c.telefono ?? '').trim() || null,
           c.estado === 'confirmada' ? 'confirmada' : 'solicitada',
           (c.notas ?? '').trim() || null, c._autor ?? null);
    anotar('cita', Number(r.lastInsertRowid), 'alta', c._autor,
           `${tipo} ${c.fecha} ${c.hora} en ${c.salon}`);
    return { ok: true, id: Number(r.lastInsertRowid), libre, aviso };
  },

  'PUT /api/citas': (_u, c, ctx) => {
    const id = entero(c?.id);
    const antes = db.prepare('SELECT * FROM cita WHERE id = ?').get(id);
    if (!antes) return { error: 'esa cita no existe' };

    const campos = [], valores = [];
    const poner = (col, v) => { campos.push(`${col} = ?`); valores.push(v); };
    if (c.fecha !== undefined) {
      if (!L.esFechaValida(c.fecha)) return { error: 'fecha inválida' };
      poner('fecha', c.fecha);
    }
    if (c.hora !== undefined) {
      if (!/^\d{2}:\d{2}$/.test(c.hora)) return { error: 'hora inválida' };
      poner('hora', c.hora);
    }
    if (c.minutos !== undefined) poner('minutos', entero(c.minutos) ?? 60);
    if (c.nombre !== undefined) poner('nombre', (c.nombre ?? '').trim() || null);
    if (c.telefono !== undefined) poner('telefono', (c.telefono ?? '').trim() || null);
    if (c.notas !== undefined) poner('notas', (c.notas ?? '').trim() || null);
    if (c.estado !== undefined) {
      const ok = ['solicitada', 'confirmada', 'asistio', 'no_asistio', 'cancelada'];
      if (!ok.includes(c.estado)) return { error: 'estado desconocido' };
      poner('estado', c.estado);
      if (c.estado === 'confirmada') poner('confirmada_at', new Date().toISOString());
    }
    if (!campos.length) return { error: 'nada que cambiar' };
    valores.push(id);
    db.prepare(`UPDATE cita SET ${campos.join(', ')} WHERE id = ?`).run(...valores);
    anotar('cita', id, 'cambio', c._autor, campos.map((x) => x.split(' ')[0]).join(', '));
    return { ok: true };
  },

  // Rango de fechas para pintar el calendario del frontend.
  // El detalle de un día en un salón: lo que hay y, sobre todo, dónde quedan
  // los huecos. Es lo que abre el panel lateral al tocar un día.
  'GET /api/dia': (u) => {
    const fecha = u.searchParams.get('fecha');
    const clave = u.searchParams.get('salon');
    if (!L.esFechaValida(fecha)) return { error: 'fecha inválida' };
    const s = db.prepare('SELECT id, clave, nombre, encargada FROM salon WHERE clave = ?').get(clave);
    if (!s) return { error: 'salón desconocido' };
    const ctl = db.prepare('SELECT confirmada_hasta FROM control_agenda WHERE salon_id = ?').get(s.id);
    return {
      fecha,
      salon: { clave: s.clave, nombre: s.nombre, encargada: s.encargada },
      confirmada_hasta: ctl?.confirmada_hasta ?? null,
      // Más allá de donde la encargada revisó, «libre» no se puede prometer.
      agenda_confirmada: !!ctl && fecha <= ctl.confirmada_hasta,
      jornada: L.JORNADA,
      ...L.huecosDelDia(db, s.id, fecha),
    };
  },

  /**
   * Para pintar el calendario: por cada día y salón, cuántos eventos hay y —lo
   * que de verdad importa— si todavía cabe otro.
   *
   * Sin esto el calendario solo podía decir «hay algo / no hay nada», y pintaba
   * de rojo un día con una boda de noche que tiene la mañana entera libre.
   */
  'GET /api/disponibilidad-rango': (u) => {
    const desde = u.searchParams.get('desde'), hasta = u.searchParams.get('hasta');
    if (!L.esFechaValida(desde) || !L.esFechaValida(hasta)) return { error: 'desde/hasta inválidos' };
    const dias = db.prepare(
      `WITH RECURSIVE d(f) AS (SELECT date(?) UNION ALL SELECT date(f,'+1 day') FROM d WHERE f < date(?))
       SELECT f AS fecha FROM d`).all(desde, hasta);
    if (dias.length > 62) return { error: 'rango demasiado largo' };

    const sal = db.prepare('SELECT id, clave FROM salon WHERE activo = 1 ORDER BY id').all();
    const ctl = Object.fromEntries(db.prepare(
      'SELECT s.clave, c.confirmada_hasta FROM control_agenda c JOIN salon s ON s.id = c.salon_id')
      .all().map((r) => [r.clave, r.confirmada_hasta]));
    const cuenta = db.prepare(
      'SELECT COUNT(*) n FROM compromiso WHERE salon_id = ? AND fecha = ?');

    return dias.map((d) => ({
      fecha: d.fecha,
      salones: sal.map((s) => {
        const n = cuenta.get(s.id, d.fecha).n;
        // Se prueban los tres horarios estándar: una boda de noche deja la
        // mañana y la tarde libres, y ese hueco se vende igual.
        const huecos = ['manana', 'tarde', 'noche'].filter(
          (t) => L.disponibilidadSalon(db, s.id, d.fecha, t).estado !== 'ocupada');
        return {
          clave: s.clave,
          eventos: n,
          cabe: huecos.length > 0,
          huecos,
          // Más allá de donde la encargada revisó, «libre» no se promete.
          confirmada: !!ctl[s.clave] && d.fecha <= ctl[s.clave],
        };
      }),
    }));
  },

  /**
   * Cuanto costaria mover un evento, ANTES de moverlo. La pantalla lo consulta
   * mientras se elige la fecha nueva: enterarse despues de guardar no sirve.
   */
  'GET /api/costo-cambio-fecha': (u) => {
    const id = entero(u.searchParams.get('id'));
    const nueva = u.searchParams.get('nueva');
    const ev = db.prepare('SELECT fecha FROM compromiso WHERE id = ?').get(id);
    if (!ev) return { error: 'ese evento no existe' };
    return L.costoCambioFecha({ fechaOriginal: ev.fecha, fechaNueva: nueva });
  },

  'GET /api/agenda': (u) => {
    const desde = u.searchParams.get('desde'), hasta = u.searchParams.get('hasta');
    if (!L.esFechaValida(desde) || !L.esFechaValida(hasta)) return { error: 'desde/hasta inválidos' };
    return db.prepare(
      `SELECT c.id, c.fecha, c.turno, c.estatus, c.hora_inicio, c.hora_fin,
              c.inicio_at, c.fin_at, c.vence, c.notas,
              s.clave AS salon, s.nombre AS salon_nombre, t.nombre AS tipo_evento
         FROM compromiso c
         JOIN salon s ON s.id = c.salon_id
         LEFT JOIN tipo_evento t ON t.id = c.tipo_evento_id
        WHERE c.fecha BETWEEN ? AND ?
        ORDER BY c.fecha, s.id, c.inicio_at`).all(desde, hasta);
  },

  'POST /api/compromisos': (_, c) => {
    const salon = db.prepare('SELECT id FROM salon WHERE clave = ?').get(c.salon);
    if (!salon) return { error: 'salón desconocido' };
    if (!L.esFechaValida(c.fecha)) return { error: 'fecha inválida' };
    const tipo = c.tipo_evento
      ? db.prepare('SELECT id FROM tipo_evento WHERE clave = ?').get(c.tipo_evento) : null;
    const v = L.ventana(c.fecha, c.hora_inicio, c.hora_fin);
    if ((c.hora_inicio || c.hora_fin) && !v.inicio_at) {
      return { error: 'horario incompleto',
        detalle: 'Para poner varios eventos el mismo día hacen falta las dos horas, ' +
                 'la de inicio y la de fin. Con una sola no se puede calcular el aseo.' };
    }
    const largo = duracionRara(v);
    if (largo) return largo;
    try {
      const r = db.prepare(
        `INSERT INTO compromiso (salon_id, fecha, turno, estatus, tipo_evento_id,
                                 hora_inicio, hora_fin, inicio_at, fin_at,
                                 vence, notas, capturado_por)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(salon.id, c.fecha, c.turno ?? turnoDeLaHora(v.inicio_at), c.estatus ?? 'contratado',
            tipo?.id ?? null,
            L.normalizarHora(c.hora_inicio), L.normalizarHora(c.hora_fin),
            v.inicio_at, v.fin_at,
            c.vence ?? null, c.notas ?? null, c.capturado_por ?? null);
      return { ok: true, id: Number(r.lastInsertRowid) };
    } catch (e) {
      const choque = conflicto(e, salon.id, c.fecha, v);
      if (choque) return choque;
      throw e;
    }
  },

  'PUT /api/control-agenda': (_, c) => {
    const salon = db.prepare('SELECT id FROM salon WHERE clave = ?').get(c.salon);
    if (!salon) return { error: 'salón desconocido' };
    if (!L.esFechaValida(c.confirmada_hasta)) return { error: 'fecha inválida' };
    db.prepare(
      `UPDATE control_agenda SET confirmada_hasta = ?, fuente = ?, responsable = ?,
              ultima_revision = date('now') WHERE salon_id = ?`
    ).run(c.confirmada_hasta, c.fuente ?? 'libreta', c.responsable ?? null, salon.id);
    return { ok: true };
  },

  'GET /api/tarifas': (u) => {
    const salon = u.searchParams.get('salon');
    const paquete = entero(u.searchParams.get('paquete'));
    const anio = entero(u.searchParams.get('anio'));
    return db.prepare(
      `SELECT t.*, p.nombre AS paquete, p.unidad_precio, s.clave AS salon, e.nombre AS escalon
         FROM tarifa t
         JOIN paquete p ON p.id = t.paquete_id
         JOIN salon   s ON s.id = t.salon_id
         LEFT JOIN escalon e ON e.id = t.escalon_id
        WHERE (? IS NULL OR s.clave = ?)
          AND (? IS NULL OR t.paquete_id = ?)
          AND (? IS NULL OR t.anio = ?)
        ORDER BY s.id, p.nombre, t.anio, t.escalon_id, t.personas_desde`
    ).all(salon, salon, paquete, paquete, anio, anio);
  },

  'GET /api/contenido': (u) => L.contenido(db, entero(u.searchParams.get('id'))) ?? { error: 'no existe' },

  // Los servicios que SÍ caben en ese salón. Una barra libre para 300 no se
  // ofrece en Quetzal, que topa en 150.
  'GET /api/servicios': (u) => {
    const salon = u.searchParams.get('salon');
    const q = (u.searchParams.get('q') ?? '').trim();
    return db.prepare(
      `SELECT DISTINCT s.id, s.nombre, s.es_propio, s.precio, s.precio_texto,
              s.que_incluye, s.anticipacion_minima, s.notas, s.personas_ref, s.categoria
         FROM servicio s
         JOIN servicio_salon ss ON ss.servicio_id = s.id
         JOIN salon sa          ON sa.id = ss.salon_id
        WHERE s.activo = 1 AND (? = '' OR sa.clave = ?)
          AND (? = '' OR s.nombre LIKE '%' || ? || '%' OR s.que_incluye LIKE '%' || ? || '%')
        ORDER BY s.categoria, s.nombre`
    ).all(salon ?? '', salon ?? '', q, q, q);
  },

  'GET /api/faq': (u) => {
    const q = (u.searchParams.get('q') ?? '').trim();
    return db.prepare(
      `SELECT id, categoria, pregunta, respuesta, notas FROM faq
        WHERE (? = '' OR pregunta LIKE '%' || ? || '%' OR respuesta LIKE '%' || ? || '%')
        ORDER BY categoria, id`).all(q, q, q);
  },

  // Por defecto SOLO lo público. Lo restringido (datos bancarios, el teléfono
  // del Lic.) nunca sale salvo que se pida explícitamente desde el panel.
  'GET /api/politicas': (u) => {
    const incluir = u.searchParams.get('incluir') ?? 'publico';
    const vis = incluir === 'todo' ? ['publico', 'restringido', 'regla_interna']
      : incluir === 'agente' ? ['publico', 'regla_interna']
      : ['publico'];
    const marcas = vis.map(() => '?').join(',');
    const todas = db.prepare(
      `SELECT id, seccion, tema, detalle, notas, visibilidad FROM politica
        WHERE visibilidad IN (${marcas}) ORDER BY seccion, id`).all(...vis);

    // El filtro se hace aqui y no en SQL porque el LIKE de SQLite no ignora
    // acentos: buscar «cortesias» no encontraba «cortesías», y el agente va a
    // escribirlo de las dos formas. Son 50 filas; filtrarlas en memoria no
    // cuesta nada y evita esa clase de silencio.
    //
    // Se busca tambien en las notas: ahi viven las restricciones («no se
    // aceptan tarjetas», «esto no lo da el agente»), que es justo lo que
    // impide prometer algo que no existe.
    const q = (u.searchParams.get('q') ?? '').trim();
    const plano = (t) => (t ?? '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const aguja = plano(q);
    const politicas = aguja
      ? todas.filter((p) => plano(`${p.tema} ${p.detalle} ${p.notas}`).includes(aguja))
      : todas;

    // Las cortesías no son políticas y vivían fuera de toda búsqueda: el
    // agente que preguntaba «qué es el Espejo de Bienvenida» no encontraba
    // nada y contestaba que no lo tenía — siendo que va incluido en tres
    // paquetes. Se buscan aquí porque es la herramienta a la que acude.
    //
    // Se devuelve la cortesía SUELTA y no la frase entera: el texto enumera
    // cinco, y al agente dárselas juntas le hizo fundir el Espejo de
    // Bienvenida con el uso del vestido en una sola cosa.
    const cortesias = [];
    if (aguja) {
      const filas = db.prepare(
        `SELECT DISTINCT pc.cortesias, p.nombre AS paquete
           FROM paquete_contenido pc
           JOIN paquete p ON p.id = pc.paquete_id
          WHERE COALESCE(TRIM(pc.cortesias), '') <> ''`).all();
      const porCortesia = new Map();
      for (const f of filas) {
        for (const suelta of L.cortesiasSueltas(f.cortesias)) {
          if (!plano(suelta).includes(aguja)) continue;
          const clave = plano(suelta);
          if (!porCortesia.has(clave)) porCortesia.set(clave, { cortesia: suelta, incluida_en: new Set() });
          porCortesia.get(clave).incluida_en.add(f.paquete);
        }
      }
      for (const v of porCortesia.values()) {
        cortesias.push({ cortesia: v.cortesia, incluida_en: [...v.incluida_en] });
      }
    }

    return { incluir, q: q || null, total: politicas.length, politicas, cortesias };
  },

  // ════════════ escritura: respuestas y políticas ════════════

  'POST /api/faq': (_u, c, ctx) => {
    const pregunta = String(c?.pregunta ?? '').trim();
    const respuesta = String(c?.respuesta ?? '').trim();
    if (pregunta.length < 5) return { error: 'falta la pregunta' };
    if (respuesta.length < 3) {
      return { error: 'falta la respuesta',
        detalle: 'Escribe el texto tal como se le contesta al cliente: eso es lo que copia quien atiende.' };
    }
    const r = db.prepare(
      'INSERT INTO faq (categoria, pregunta, respuesta, notas) VALUES (?,?,?,?)')
      .run((c?.categoria ?? '').trim() || null, pregunta, respuesta, (c?.notas ?? '').trim() || null);
    const id = Number(r.lastInsertRowid);
    anotar('faq', id, 'alta', ctx.usuario.nombre, pregunta.slice(0, 80));
    return { ok: true, id };
  },

  'PUT /api/faq': (_u, c, ctx) => {
    const id = entero(c?.id);
    const antes = db.prepare('SELECT * FROM faq WHERE id = ?').get(id);
    if (!antes) return { error: 'esa pregunta no existe' };
    const n = {
      categoria: 'categoria' in c ? ((c.categoria ?? '').trim() || null) : antes.categoria,
      pregunta: 'pregunta' in c ? String(c.pregunta).trim() : antes.pregunta,
      respuesta: 'respuesta' in c ? String(c.respuesta).trim() : antes.respuesta,
      notas: 'notas' in c ? ((c.notas ?? '').trim() || null) : antes.notas,
    };
    if (n.pregunta.length < 5) return { error: 'falta la pregunta' };
    if (n.respuesta.length < 3) return { error: 'falta la respuesta' };
    db.prepare('UPDATE faq SET categoria=?, pregunta=?, respuesta=?, notas=? WHERE id=?')
      .run(n.categoria, n.pregunta, n.respuesta, n.notas, id);
    const cambios = Object.keys(n).filter((k) => String(antes[k] ?? '') !== String(n[k] ?? ''));
    anotar('faq', id, 'cambio', ctx.usuario.nombre,
      `${antes.pregunta.slice(0, 50)} · ${cambios.join(', ') || 'sin cambios'}`);
    return { ok: true, cambios: cambios.length };
  },

  'DELETE /api/faq': (_u, c, ctx) => {
    const id = entero(c?.id);
    const antes = db.prepare('SELECT * FROM faq WHERE id = ?').get(id);
    if (!antes) return { error: 'esa pregunta no existe' };
    db.prepare('DELETE FROM faq WHERE id = ?').run(id);
    // El texto completo va a la bitácora: si se borró por error, ahí está.
    anotar('faq', id, 'baja', ctx.usuario.nombre,
      `«${antes.pregunta}» → «${antes.respuesta}»${c?.motivo ? ' · ' + c.motivo : ''}`);
    return { ok: true };
  },

  'POST /api/politicas': (_u, c, ctx) => {
    const tema = String(c?.tema ?? '').trim();
    if (tema.length < 3) return { error: 'falta el tema' };
    const vis = ['publico', 'restringido', 'regla_interna'].includes(c?.visibilidad)
      ? c.visibilidad : 'publico';
    // Lo restringido son datos bancarios y teléfonos privados: solo el admin.
    if (vis === 'restringido' && ctx.usuario.rol !== 'admin') {
      return { error: 'sin permiso',
        detalle: 'Solo un administrador puede marcar algo como restringido.' };
    }
    const r = db.prepare(
      'INSERT INTO politica (seccion, tema, detalle, notas, visibilidad) VALUES (?,?,?,?,?)')
      .run((c?.seccion ?? '').trim() || 'Politicas', tema,
           (c?.detalle ?? '').trim() || null, (c?.notas ?? '').trim() || null, vis);
    const id = Number(r.lastInsertRowid);
    anotar('politica', id, 'alta', ctx.usuario.nombre, `${tema} (${vis})`);
    return { ok: true, id };
  },

  'PUT /api/politicas': (_u, c, ctx) => {
    const id = entero(c?.id);
    const antes = db.prepare('SELECT * FROM politica WHERE id = ?').get(id);
    if (!antes) return { error: 'esa política no existe' };
    const n = {
      tema: 'tema' in c ? String(c.tema).trim() : antes.tema,
      detalle: 'detalle' in c ? ((c.detalle ?? '').trim() || null) : antes.detalle,
      notas: 'notas' in c ? ((c.notas ?? '').trim() || null) : antes.notas,
      visibilidad: 'visibilidad' in c ? String(c.visibilidad) : antes.visibilidad,
      seccion: 'seccion' in c ? String(c.seccion).trim() : antes.seccion,
    };
    if (n.tema.length < 3) return { error: 'falta el tema' };
    if (!['publico', 'restringido', 'regla_interna'].includes(n.visibilidad)) {
      return { error: 'visibilidad inválida' };
    }
    // Tocar algo restringido, o volver algo restringido, es cosa del admin.
    if ((antes.visibilidad === 'restringido' || n.visibilidad === 'restringido')
        && ctx.usuario.rol !== 'admin') {
      return { error: 'sin permiso',
        detalle: 'Esta política tiene datos que solo un administrador puede cambiar.' };
    }
    db.prepare('UPDATE politica SET seccion=?, tema=?, detalle=?, notas=?, visibilidad=? WHERE id=?')
      .run(n.seccion, n.tema, n.detalle, n.notas, n.visibilidad, id);
    const cambios = Object.keys(n).filter((k) => String(antes[k] ?? '') !== String(n[k] ?? ''));
    anotar('politica', id, 'cambio', ctx.usuario.nombre,
      `${antes.tema} · ${cambios.join(', ') || 'sin cambios'}`);
    return { ok: true, cambios: cambios.length };
  },

  'DELETE /api/politicas': (_u, c, ctx) => {
    const id = entero(c?.id);
    const antes = db.prepare('SELECT * FROM politica WHERE id = ?').get(id);
    if (!antes) return { error: 'esa política no existe' };
    if (antes.visibilidad === 'restringido' && ctx.usuario.rol !== 'admin') {
      return { error: 'sin permiso' };
    }
    db.prepare('DELETE FROM politica WHERE id = ?').run(id);
    anotar('politica', id, 'baja', ctx.usuario.nombre,
      `«${antes.tema}»${c?.motivo ? ' · ' + c.motivo : ''}`);
    return { ok: true };
  },

  // Todo lo que está pendiente de que el Lic. confirme, en un solo lugar.

  // ══════════════════ escritura: precios y conceptos ════════════════════════

  // Corrige los precios de una tarifa. Queda registrado quién y qué cambió.
  'PUT /api/tarifas': (_, c) => {
    const id = entero(c.id);
    const antes = db.prepare('SELECT * FROM tarifa WHERE id = ?').get(id);
    if (!antes) return { error: 'esa tarifa no existe' };

    const cols = ['precio_lun','precio_mar','precio_mie','precio_jue','precio_vie','precio_sab','precio_dom'];
    const nuevos = {};
    for (const k of cols) {
      if (!(k in c)) { nuevos[k] = antes[k]; continue; }
      const v = num(c[k]);
      if (v !== null && (!Number.isFinite(v) || v < 0)) return { error: `${k}: el precio no es válido` };
      nuevos[k] = v;
    }
    const desde = entero(c.personas_desde) ?? antes.personas_desde;
    const hasta = entero(c.personas_hasta) ?? antes.personas_hasta;
    if (desde > hasta) return { error: 'el mínimo de invitados no puede ser mayor que el máximo' };

    // Asignar el escalón resuelve la ambigüedad por definición: si cada precio
    // cae en una ventana distinta, ya no compiten por la misma consulta. El
    // trigger de traslape lo verifica al guardar.
    let escalon = antes.escalon_id;
    let revision = antes.requiere_revision;
    if ('escalon_id' in c) {
      escalon = entero(c.escalon_id);
      if (escalon !== null && !db.prepare('SELECT 1 FROM escalon WHERE id = ?').get(escalon)) {
        return { error: 'ese escalón no existe' };
      }
      if (escalon !== null) revision = 0;
    }

    try {
      db.prepare(
        `UPDATE tarifa SET ${cols.map((k) => `${k} = ?`).join(', ')},
                personas_desde = ?, personas_hasta = ?,
                escalon_id = ?, requiere_revision = ?, motivo_revision = NULL,
                vigente_hasta = NULL
          WHERE id = ?`
      ).run(...cols.map((k) => nuevos[k]), desde, hasta, escalon, revision, id);
    } catch (e) {
      if (String(e.message).includes('Traslape')) {
        return { error: 'traslape', detalle: 'Ese rango de invitados se encima con otro precio del mismo paquete. Ajusta los límites.' };
      }
      throw e;
    }
    const cambios = cols.filter((k) => antes[k] !== nuevos[k])
      .map((k) => `${k.replace('precio_', '')}: ${antes[k] ?? '—'} → ${nuevos[k] ?? '—'}`);
    if (desde !== antes.personas_desde || hasta !== antes.personas_hasta) {
      cambios.push(`invitados: ${antes.personas_desde}-${antes.personas_hasta} → ${desde}-${hasta}`);
    }
    if (escalon !== antes.escalon_id) {
      const n = escalon === null ? 'sin escalón'
        : db.prepare('SELECT nombre FROM escalon WHERE id = ?').get(escalon).nombre;
      cambios.push(`cuándo aplica: ${antes.escalon_id ?? 'sin definir'} → ${n}`);
    }
    anotar('tarifa', id, 'cambio', c._autor, cambios.join(' · ') || 'sin cambios');
    return { ok: true, cambios: cambios.length };
  },

  // Resuelve un conflicto: se queda una tarifa y retira las demás.
  // No las borra: las cierra con fecha, para no perder el rastro.
  'POST /api/tarifas/resolver': (_, c) => {
    const mantener = entero(c.mantener);
    const retirar = (c.retirar ?? []).map(entero).filter(Number.isInteger);
    if (!mantener || !retirar.length) return { error: 'falta indicar cuál se mantiene y cuáles se retiran' };

    const buena = db.prepare('SELECT * FROM tarifa WHERE id = ?').get(mantener);
    if (!buena) return { error: 'esa tarifa no existe' };

    const hoy = L.hoyMonterrey();
    db.exec('BEGIN');
    try {
      for (const id of retirar) {
        db.prepare('UPDATE tarifa SET vigente_hasta = ? WHERE id = ?').run(hoy, id);
      }
      db.prepare('UPDATE tarifa SET requiere_revision = 0, motivo_revision = NULL WHERE id = ?').run(mantener);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }

    anotar('tarifa', mantener, 'cambio', c._autor,
      `se eligió este precio y se retiraron ${retirar.length} versiones (ids ${retirar.join(', ')})`);
    return { ok: true, retiradas: retirar.length };
  },

  // Reemplaza la lista de lo que incluye y lo que no un paquete en un salón.
  'PUT /api/contenido-conceptos': (_, c) => {
    const cid = entero(c.contenido_id);
    if (!db.prepare('SELECT 1 FROM paquete_contenido WHERE id = ?').get(cid)) {
      return { error: 'ese contenido no existe' };
    }
    const incluye = (c.incluye ?? []).map(entero).filter(Number.isInteger);
    const noIncluye = (c.no_incluye ?? []).map(entero).filter(Number.isInteger);
    const cruce = incluye.filter((x) => noIncluye.includes(x));
    if (cruce.length) return { error: 'un concepto no puede estar en las dos listas a la vez' };

    const antes = db.prepare('SELECT COUNT(*) n FROM paquete_contenido_concepto WHERE contenido_id = ?').get(cid).n;
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM paquete_contenido_concepto WHERE contenido_id = ?').run(cid);
      const st = db.prepare('INSERT INTO paquete_contenido_concepto (contenido_id, concepto_id, incluido) VALUES (?,?,?)');
      for (const x of incluye) st.run(cid, x, 1);
      for (const x of noIncluye) st.run(cid, x, 0);
      if ('cortesias' in c) {
        db.prepare('UPDATE paquete_contenido SET cortesias = ? WHERE id = ?').run(c.cortesias || null, cid);
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }

    anotar('paquete_contenido', cid, 'cambio', c._autor,
      `${antes} conceptos → ${incluye.length} incluidos y ${noIncluye.length} no incluidos`);
    return { ok: true, incluye: incluye.length, no_incluye: noIncluye.length };
  },

  // Da de alta un concepto nuevo para que aparezca en la lista de casillas.
  'POST /api/conceptos': (_, c) => {
    const nombre = String(c.nombre ?? '').trim();
    if (nombre.length < 3) return { error: 'el nombre es demasiado corto' };
    const clave = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const ya = db.prepare('SELECT id, nombre FROM concepto WHERE clave = ?').get(clave);
    if (ya) return { error: 'ya existe', detalle: `Ya está en la lista como «${ya.nombre}».` };
    const r = db.prepare('INSERT INTO concepto (clave, nombre, universal) VALUES (?,?,0)').run(clave, nombre);
    anotar('concepto', Number(r.lastInsertRowid), 'alta', c._autor, nombre);
    return { ok: true, id: Number(r.lastInsertRowid), nombre };
  },

  'GET /api/bitacora': (u) => db.prepare(
    `SELECT id, tabla, registro, accion, usuario, detalle, creado_at
       FROM bitacora ORDER BY creado_at DESC, id DESC LIMIT ?`
  ).all(entero(u.searchParams.get('limite')) ?? 60),

  // ══════════════════ escritura: agenda y servicios ═════════════════════════

  // Cambia un evento ya registrado.
  'PUT /api/compromisos': (_, c) => {
    const id = entero(c.id);
    const antes = db.prepare(
      `SELECT c.*, s.nombre AS salon_nombre FROM compromiso c
         JOIN salon s ON s.id = c.salon_id WHERE c.id = ?`).get(id);
    if (!antes) return { error: 'ese evento no existe' };

    const tipo = c.tipo_evento
      ? db.prepare('SELECT id FROM tipo_evento WHERE clave = ?').get(c.tipo_evento) : null;
    const n = {
      fecha: c.fecha ?? antes.fecha,
      turno: c.turno ?? antes.turno,
      estatus: c.estatus ?? antes.estatus,
      tipo_evento_id: 'tipo_evento' in c ? (tipo?.id ?? null) : antes.tipo_evento_id,
      hora_inicio: 'hora_inicio' in c ? (c.hora_inicio || null) : antes.hora_inicio,
      hora_fin: 'hora_fin' in c ? (c.hora_fin || null) : antes.hora_fin,
      vence: 'vence' in c ? (c.vence || null) : antes.vence,
      notas: 'notas' in c ? (c.notas || null) : antes.notas,
    };
    if (!L.esFechaValida(n.fecha)) return { error: 'la fecha no es válida' };
    // Un apartado sin vencimiento es un apartado que nadie vigila.
    if (n.estatus === 'separado' && !n.vence) {
      return { error: 'falta el vencimiento',
        detalle: 'Un apartado necesita fecha de vencimiento: si no, nadie se entera cuando caduca.' };
    }
    const v = L.ventana(n.fecha, n.hora_inicio, n.hora_fin);
    if ((n.hora_inicio || n.hora_fin) && !v.inicio_at) {
      return { error: 'horario incompleto',
        detalle: 'Hacen falta las dos horas, la de inicio y la de fin.' };
    }
    const largo = duracionRara(v);
    if (largo) return largo;
    try {
      db.prepare(
        `UPDATE compromiso SET fecha=?, turno=?, estatus=?, tipo_evento_id=?,
                hora_inicio=?, hora_fin=?, inicio_at=?, fin_at=?, vence=?, notas=? WHERE id=?`
      ).run(n.fecha, n.turno, n.estatus, n.tipo_evento_id,
            L.normalizarHora(n.hora_inicio), L.normalizarHora(n.hora_fin),
            v.inicio_at, v.fin_at, n.vence, n.notas, id);
    } catch (e) {
      const choque = conflicto(e, antes.salon_id, n.fecha, v, id);
      if (choque) return choque;
      throw e;
    }
    const cambios = Object.keys(n)
      .filter((k) => String(antes[k] ?? '') !== String(n[k] ?? ''))
      .map((k) => `${k}: ${antes[k] ?? '—'} → ${n[k] ?? '—'}`);

    // Mover la fecha cuesta dinero, y la escala vivia como parrafo en la
    // politica 9. Se calcula y se devuelve: quien mueve el evento tiene que
    // saber que hay que cobrarlo, no acordarse.
    let cobro = null;
    if (n.fecha !== antes.fecha) {
      cobro = L.costoCambioFecha({ fechaOriginal: antes.fecha, fechaNueva: n.fecha });
      anotar('compromiso', id, 'cambio', c._autor,
        `COBRO POR CAMBIO DE FECHA: ${cobro.detalle}`);
    }

    anotar('compromiso', id, 'cambio', c._autor,
      `${antes.salon_nombre} ${antes.fecha} · ${cambios.join(' · ') || 'sin cambios'}`);
    return { ok: true, cambios: cambios.length, cobro_cambio_fecha: cobro };
  },

  // Cancela un evento y libera la fecha. Se borra de verdad: si se quedara
  // marcado de algún modo seguiría bloqueando el día. El detalle va a la
  // bitácora, que es donde vive el historial.
  'DELETE /api/compromisos': (_, c) => {
    const id = entero(c.id);
    const e = db.prepare(
      `SELECT c.*, s.nombre AS salon_nombre, t.nombre AS tipo FROM compromiso c
         JOIN salon s ON s.id = c.salon_id
         LEFT JOIN tipo_evento t ON t.id = c.tipo_evento_id WHERE c.id = ?`).get(id);
    if (!e) return { error: 'ese evento no existe' };
    db.prepare('DELETE FROM compromiso WHERE id = ?').run(id);
    anotar('compromiso', id, 'baja', c._autor,
      `se liberó ${e.fecha} ${e.turno} en ${e.salon_nombre} (era ${e.estatus}` +
      `${e.tipo ? ', ' + e.tipo : ''})${c.motivo ? ' · motivo: ' + c.motivo : ''}`);
    return { ok: true, liberada: e.fecha };
  },

  // Ficha de un servicio con los salones donde se ofrece.
  'GET /api/servicio': (u) => {
    const id = entero(u.searchParams.get('id'));
    const s = db.prepare('SELECT * FROM servicio WHERE id = ?').get(id);
    if (!s) return { error: 'no existe' };
    s.salones = db.prepare(
      `SELECT sa.clave FROM servicio_salon ss JOIN salon sa ON sa.id = ss.salon_id
        WHERE ss.servicio_id = ? ORDER BY sa.id`).all(id).map((x) => x.clave);
    return s;
  },

  'PUT /api/servicios': (_, c) => {
    const id = entero(c.id);
    const antes = db.prepare('SELECT * FROM servicio WHERE id = ?').get(id);
    if (!antes) return { error: 'ese servicio no existe' };
    const nombre = String(c.nombre ?? antes.nombre).trim();
    if (nombre.length < 3) return { error: 'el nombre es demasiado corto' };
    const precio = 'precio' in c ? num(c.precio) : antes.precio;
    if (precio !== null && (!Number.isFinite(precio) || precio < 0)) {
      return { error: 'el precio no es válido' };
    }
    const n = {
      nombre, precio,
      precio_texto: 'precio_texto' in c ? (c.precio_texto || null) : antes.precio_texto,
      es_propio: 'es_propio' in c ? (c.es_propio ? 1 : 0) : antes.es_propio,
      que_incluye: 'que_incluye' in c ? (c.que_incluye || null) : antes.que_incluye,
      anticipacion_minima: 'anticipacion_minima' in c ? (c.anticipacion_minima || null) : antes.anticipacion_minima,
      notas: 'notas' in c ? (c.notas || null) : antes.notas,
      categoria: c.categoria ?? antes.categoria,
      activo: 'activo' in c ? (c.activo ? 1 : 0) : antes.activo,
    };
    db.prepare(
      `UPDATE servicio SET nombre=?, precio=?, precio_texto=?, es_propio=?, que_incluye=?,
              anticipacion_minima=?, notas=?, categoria=?, activo=? WHERE id=?`
    ).run(n.nombre, n.precio, n.precio_texto, n.es_propio, n.que_incluye,
          n.anticipacion_minima, n.notas, n.categoria, n.activo, id);

    if (Array.isArray(c.salones)) {
      db.prepare('DELETE FROM servicio_salon WHERE servicio_id = ?').run(id);
      const st = db.prepare(
        'INSERT INTO servicio_salon (servicio_id, salon_id) SELECT ?, id FROM salon WHERE clave = ?');
      for (const cl of c.salones) st.run(id, cl);
    }
    const cambios = Object.keys(n)
      .filter((k) => String(antes[k] ?? '') !== String(n[k] ?? ''))
      .map((k) => `${k}: ${antes[k] ?? '—'} → ${n[k] ?? '—'}`);
    anotar('servicio', id, 'cambio', c._autor, cambios.join(' · ') || 'salones actualizados');
    return { ok: true, cambios: cambios.length };
  },

  'POST /api/servicios': (_, c) => {
    const nombre = String(c.nombre ?? '').trim();
    if (nombre.length < 3) return { error: 'el nombre es demasiado corto' };
    const precio = num(c.precio);
    const r = db.prepare(
      `INSERT INTO servicio (nombre, es_propio, precio, precio_texto, que_incluye,
                             anticipacion_minima, notas, categoria, activo)
       VALUES (?,?,?,?,?,?,?,?,1)`
    ).run(nombre, c.es_propio ? 1 : 0, precio, c.precio_texto || null, c.que_incluye || null,
          c.anticipacion_minima || '1 semana', c.notas || null, c.categoria || 'Otros');
    const id = Number(r.lastInsertRowid);
    const salones = Array.isArray(c.salones) && c.salones.length
      ? c.salones : ['norma', 'esmeralda', 'santacruz', 'quetzal'];
    const st = db.prepare(
      'INSERT INTO servicio_salon (servicio_id, salon_id) SELECT ?, id FROM salon WHERE clave = ?');
    for (const cl of salones) st.run(id, cl);
    anotar('servicio', id, 'alta', c._autor,
      `${nombre} · ${precio !== null ? '$' + precio : 'sin precio'}`);
    return { ok: true, id };
  },

  'GET /api/revisar': () => ({
    // Agrupadas por la decisión que hay que tomar, no por fila suelta:
    // «Santa Cruz / Bronce 2027 / 100 invitados tiene 3 precios» es una
    // pregunta; verla como tres renglones no lo es.
    tarifas: db.prepare(
      `SELECT s.nombre AS salon, p.nombre AS paquete, t.anio,
              t.personas_desde, t.personas_hasta,
              COUNT(*) AS versiones,
              GROUP_CONCAT(t.id) AS ids,
              GROUP_CONCAT(t.precio_sab) AS precios_sab,
              GROUP_CONCAT(t.fila_original) AS filas,
              MIN(t.motivo_revision) AS motivo
         FROM tarifa t JOIN salon s ON s.id = t.salon_id JOIN paquete p ON p.id = t.paquete_id
        WHERE t.requiere_revision = 1 AND t.vigente_hasta IS NULL
        GROUP BY s.id, p.id, t.anio, t.personas_desde, t.personas_hasta
        ORDER BY versiones DESC, s.id, p.nombre, t.anio`).all(),
    contenidos: db.prepare(
      `SELECT c.id, p.nombre AS paquete, s.nombre AS salon, c.variante, c.escalon_id
         FROM paquete_contenido c
         JOIN paquete p ON p.id = c.paquete_id JOIN salon s ON s.id = c.salon_id
        WHERE c.requiere_revision = 1 ORDER BY s.id, p.nombre, c.variante`).all(),
    agenda: db.prepare(
      `SELECT s.nombre AS salon, c.confirmada_hasta, c.fuente, c.ultima_revision
         FROM control_agenda c JOIN salon s ON s.id = c.salon_id ORDER BY c.confirmada_hasta`).all(),
  }),
};

// ────────────────────────── archivos estáticos ──────────────────────────────

async function servirEstatico(req, res, ruta) {
  let rel = decodeURIComponent(ruta === '/' ? '/index.html' : ruta);
  if (rel.endsWith('/')) rel += 'index.html';
  const destino = join(WEB, normalize(rel).replace(/^([/\\])+/, ''));
  if (!destino.startsWith(WEB)) { res.writeHead(403).end('403'); return; }
  try {
    const info = await stat(destino);
    if (info.isDirectory()) return servirEstatico(req, res, rel + '/');
    const datos = await readFile(destino);
    res.writeHead(200, {
      'content-type': TIPOS_MIME[extname(destino).toLowerCase()] ?? 'application/octet-stream',
      'content-length': datos.length,
      // no-store, no no-cache: sin ETag el navegador no puede revalidar, y con
      // módulos ES se queda con la copia en memoria de la sesión. Entonces el
      // JS viejo habla con el API nuevo y la pantalla truena. Esto corre en
      // localhost; no hay nada que ahorrar cacheando.
      'cache-control': 'no-store',
      ...SEGURIDAD,
    });
    res.end(datos);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('No encontrado: ' + rel);
  }
}

// ─────────────────────────── puertas y permisos ─────────────────────────────

/** Lo único que se puede tocar sin haber entrado. */
const ABIERTAS = new Set(['POST /api/entrar', 'GET /api/salud', 'GET /api/yo', 'POST /api/salir']);

// Rutas cuyo cuerpo son bytes y no JSON.
const BINARIAS = new Set(['POST /api/imagenes/archivo']);

/** Y lo único que se puede hacer con la contraseña temporal todavía puesta. */
const CON_CLAVE_TEMPORAL = new Set([...ABIERTAS, 'POST /api/cambiar-clave']);

/**
 * Escrituras sobre la propia cuenta. No pasan por la tabla de áreas: cambiar
 * tu contraseña no es administrar el panel, y si se tratara como tal solo el
 * admin podría hacerlo — el resto quedaría con la temporal para siempre.
 */
const PROPIAS = new Set(['POST /api/cambiar-clave']);

/**
 * Qué área toca cada escritura. Lo que no esté aquí cae en 'usuarios', el
 * permiso más restringido: una ruta nueva nace cerrada y no abierta por
 * olvido.
 */
const AREA = {
  'POST /api/compromisos': 'agenda',
  'PUT /api/compromisos': 'agenda',
  'DELETE /api/compromisos': 'agenda',
  'PUT /api/control-agenda': 'agenda',
  'PUT /api/tarifas': 'precios',
  'POST /api/conceptos': 'precios',
  'PUT /api/contenido-conceptos': 'precios',
  'POST /api/servicios': 'servicios',
  'PUT /api/salones': 'salones',
  'POST /api/faq': 'respuestas',
  'PUT /api/faq': 'respuestas',
  'DELETE /api/faq': 'respuestas',
  'POST /api/politicas': 'respuestas',
  'PUT /api/politicas': 'respuestas',
  'DELETE /api/politicas': 'respuestas',
  'POST /api/paquetes/borrador': 'precios',
  'POST /api/paquetes/publicar': 'precios',
  'POST /api/imagenes/archivo': 'precios',
  'POST /api/usuarios': 'usuarios',
  'PUT /api/usuarios': 'usuarios',
  'POST /api/usuarios/clave': 'usuarios',
  'POST /api/usuarios/desbloquear': 'usuarios',
  'PUT /api/servicios': 'servicios',
  'POST /api/cotizar': 'agenda',        // no escribe nada; cotizar es parte del día a día
  'POST /api/avisos': 'agenda',
  'PUT /api/avisos': 'agenda',
  'POST /api/citas': 'agenda',
  'PUT /api/citas': 'agenda',
};

const CODIGO = { 'sin sesión': 401, 'sin permiso': 403, 'no coincide': 401, bloqueado: 429 };

// ───────────────────────────── el servidor ──────────────────────────────────

const servidor = createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const clave = `${req.method} ${u.pathname}`;

  if (!u.pathname.startsWith('/api/')) {
    // El panel no se sirve a quien no ha entrado. No es lo que protege los
    // datos —eso lo hace el guardián del API— pero evita el parpadeo de ver
    // la pantalla armarse y vaciarse.
    const quiereElPanel = u.pathname === '/' || u.pathname === '/index.html';
    if (quiereElPanel && !A.sesionValida(db, A.leerCookie(req))) {
      res.writeHead(302, { location: '/entrar', 'cache-control': 'no-store' });
      return res.end();
    }
    if (u.pathname === '/entrar') return servirEstatico(req, res, '/entrar.html');
    return servirEstatico(req, res, u.pathname);
  }

  const manejar = rutas[clave];
  if (!manejar) return json(res, 404, { error: `ruta desconocida: ${clave}` });

  // Contexto de la petición: quién la hace y por dónde. El manejador puede
  // dejar aquí una cookie para que salga en la respuesta.
  const token = A.leerCookie(req);
  const ctx = {
    token,
    usuario: A.sesionValida(db, token),
    agente: req.headers['user-agent'],
    // Detrás de un proxy la conexión al servidor es http aunque el navegador
    // hable https; sin mirar este encabezado la cookie saldría sin Secure.
    seguro: (req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https',
    cookie: null,
  };

  // El token de máquina es para n8n y el agente de WhatsApp, que no tienen
  // navegador ni sesión. Vale como identidad propia, no como la de nadie.
  if (!ctx.usuario && TOKEN) {
    const dado = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (dado === TOKEN) ctx.usuario = { id: null, usuario: 'api', nombre: 'Integración', rol: 'admin', salon: null };
  }

  if (!ABIERTAS.has(clave) && !ctx.usuario) {
    return json(res, 401, { error: 'sin sesión', detalle: 'Entra de nuevo para continuar.' });
  }
  // Con la contraseña temporal solo se puede hacer una cosa: cambiarla.
  if (ctx.usuario?.debe_cambiar && !CON_CLAVE_TEMPORAL.has(clave)) {
    return json(res, 403, { error: 'debe cambiar clave',
      detalle: 'Cambia tu contraseña temporal antes de usar el panel.' });
  }
  const escribe = req.method !== 'GET';
  if (escribe && !ABIERTAS.has(clave) && !PROPIAS.has(clave)
      && !A.puede(ctx.usuario, AREA[clave] ?? 'usuarios')) {
    return json(res, 403, { error: 'sin permiso',
      detalle: `Tu cuenta (${ctx.usuario.rol}) no puede hacer este cambio.` });
  }

  try {
    const cuerpo = req.method === 'GET' ? null
      : (BINARIAS.has(clave) ? await cuerpoBinario(req) : await cuerpoJSON(req));
    // La bitácora deja de creerle al cliente: quién hizo el cambio sale de la
    // sesión, no de un campo que cualquiera puede escribir. Va en `_autor` y
    // no en `usuario` porque ese nombre ya significa otra cosa en las rutas de
    // cuentas, donde `usuario` es a QUIÉN se le aplica el cambio: escribir
    // encima dejaba esas rutas sin destinatario.
    if (cuerpo && ctx.usuario) cuerpo._autor = ctx.usuario.nombre;
    const salida = await manejar(u, cuerpo, ctx);
    const cabeceras = ctx.cookie ? { 'set-cookie': ctx.cookie } : null;
    json(res, salida && salida.error ? (CODIGO[salida.error] ?? 400) : 200, salida, cabeceras);
  } catch (e) {
    console.error(clave, e);
    json(res, 500, { error: 'error interno', detalle: e.message });
  }
});

servidor.listen(PUERTO, HOST, () => {
  const visible = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`\n  Salones Agustín Barrón`);
  console.log(`  panel .... http://${visible}:${PUERTO}/`);
  console.log(`  api ...... http://${visible}:${PUERTO}/api/salud`);
  const enContenedor = existsSync('/.dockerenv');
  const aviso = HOST === '0.0.0.0' && !enContenedor
    ? '  (expuesto en todas las interfaces; detras de un proxy local usa HOST=127.0.0.1)' : '';
  console.log(`  escucha .. ${HOST}:${PUERTO}${aviso}`);
  console.log(`  hoy ...... ${L.hoyMonterrey()} (America/Monterrey)`);
  console.log(`  auth ..... ${TOKEN ? 'token activo' : 'ABIERTA - define API_TOKEN antes de exponerla'}\n`);
});
