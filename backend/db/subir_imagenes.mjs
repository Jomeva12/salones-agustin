// ============================================================================
//  Sube las láminas de los paquetes al Drive de Kommo y guarda su URL.
//
//      node backend/db/subir_imagenes.mjs imagenes/norma/mapa.json
//
//  Por qué al Drive de Kommo y no al panel: el adjunto del salesbot solo
//  acepta un uuid de archivo de Kommo. Una URL de cualquier otro hosting se
//  descarta —en silencio— y el mensaje sale sin imagen.
//
//  El panel guarda únicamente la URL, no el archivo.
//
//  Es idempotente por el sha256 del archivo: si la lámina ya está subida y no
//  ha cambiado, no se vuelve a subir. Si cambió, sube la nueva y reemplaza la
//  URL; la vieja se queda en el Drive por si hay que volver atrás.
//
//  El mapa es un JSON con una entrada por lámina:
//    [{ "archivo": "n01.jpeg", "paquete": "Paquete Bronce",
//       "salon": "norma", "etiqueta": null }]
//
//  `etiqueta` existe porque un paquete puede tener varias láminas: el de
//  «Baby Shower, Despedidas de Soltera y Bautizos» es uno solo en precio y
//  contenido, pero el arte lo parte en tres y a quien va a bautizar no se le
//  enseñan globos de despedida.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');

const TOKEN = process.env.KOMMO_TOKEN
  ?? (existsSync(join(RAIZ, '.kommo_token'))
    ? readFileSync(join(RAIZ, '.kommo_token'), 'utf8').trim() : null);
if (!TOKEN) { console.error('Falta KOMMO_TOKEN (o el archivo .kommo_token).'); process.exit(1); }

const mapaRuta = process.argv[2];
if (!mapaRuta) { console.error('Uso: node backend/db/subir_imagenes.mjs <mapa.json>'); process.exit(1); }
const mapa = JSON.parse(readFileSync(mapaRuta, 'utf8'));
const CARPETA = dirname(resolve(mapaRuta));

const db = new DatabaseSync(DB);

// La tabla es aparte y no una columna de paquete_contenido porque ahí la
// clave incluye el escalón, y un paquete puede necesitar varias láminas sin
// que eso tenga nada que ver con la anticipación.
db.exec(`
  CREATE TABLE IF NOT EXISTS paquete_imagen (
    id            INTEGER PRIMARY KEY,
    paquete_id    INTEGER NOT NULL REFERENCES paquete(id),
    salon_id      INTEGER NOT NULL REFERENCES salon(id),
    etiqueta      TEXT,
    url           TEXT NOT NULL,
    archivo_uuid  TEXT NOT NULL,
    nombre        TEXT,
    sha256        TEXT NOT NULL,
    subida_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS paquete_imagen_unica
    ON paquete_imagen (paquete_id, salon_id, COALESCE(etiqueta, ''));

  CREATE TABLE IF NOT EXISTS cortesia_imagen (
    id            INTEGER PRIMARY KEY,
    clave         TEXT NOT NULL,
    salon_id      INTEGER NOT NULL REFERENCES salon(id),
    titulo        TEXT,
    url           TEXT NOT NULL,
    archivo_uuid  TEXT NOT NULL,
    nombre        TEXT,
    sha256        TEXT NOT NULL,
    subida_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS cortesia_imagen_unica
    ON cortesia_imagen (clave, salon_id);
`);

// El host del Drive es distinto en cada cuenta de Kommo: se pregunta, no se
// adivina. Dar por bueno el de otra cuenta es lo que tenía rota la función.
const cuenta = await (await fetch(
  'https://administracioneventos6.kommo.com/api/v4/account?with=drive_url',
  { headers: { Authorization: 'Bearer ' + TOKEN } })).json();
const DRIVE = cuenta.drive_url;
if (!DRIVE) { console.error('Kommo no devolvió drive_url.'); process.exit(1); }
console.log('Drive de la cuenta: ' + DRIVE + '\n');

async function subir(ruta, nombreEnKommo) {
  const datos = readFileSync(ruta);
  const ses = await (await fetch(DRIVE + '/v1.0/sessions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_name: nombreEnKommo, file_size: datos.length,
      content_type: 'image/jpeg', with_preview: true,
    }),
  })).json();
  if (!ses.upload_url) throw new Error('sin upload_url: ' + JSON.stringify(ses));

  // Kommo corta la subida en partes de max_part_size (512 KB) y va devolviendo
  // la URL de la siguiente. Varias láminas pasan de ese tope, así que una sola
  // llamada no basta: la última parte es la que devuelve el archivo.
  const trozo = ses.max_part_size || datos.length;
  let destino = ses.upload_url, desde = 0, f = null;
  while (desde < datos.length) {
    const parte = datos.subarray(desde, Math.min(desde + trozo, datos.length));
    f = await (await fetch(destino, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: parte,
    })).json();
    desde += parte.length;
    if (desde < datos.length) {
      destino = f?.next_url ?? f?.upload_url ?? f?._links?.upload?.href;
      if (!destino) throw new Error('Kommo no dio URL para la siguiente parte: ' + JSON.stringify(f).slice(0, 300));
    }
  }
  const url = f?._links?.download?.href;
  if (!url) throw new Error('sin url de descarga: ' + JSON.stringify(f).slice(0, 300));
  // El uuid es el penúltimo tramo de la URL, que es justo lo que el adjunto
  // de la plantilla pide como `id`.
  return { url, uuid: url.split('/')[5] };
}

let subidas = 0, saltadas = 0, fallos = 0;

for (const m of mapa) {
  // Una entrada es de paquete (lámina) o de cortesía (foto de una cosa
  // concreta). Se distinguen por cuál de los dos campos traen.
  const esCortesia = !!m.cortesia;
  const etq = m.etiqueta ?? null;
  const donde = esCortesia
    ? `${m.cortesia} · ${m.salon}`
    : `${m.paquete} · ${m.salon}${etq ? ' · ' + etq : ''}`;

  const paq = esCortesia ? null : db.prepare('SELECT id FROM paquete WHERE nombre = ?').get(m.paquete);
  const sal = db.prepare('SELECT id FROM salon WHERE clave = ?').get(m.salon);
  if (!sal || (!esCortesia && !paq)) { console.log(`  FALLO    ${donde}: paquete o salón desconocido.`); fallos++; continue; }

  const ruta = join(CARPETA, m.archivo);
  if (!existsSync(ruta)) { console.log(`  FALLO    ${donde}: no existe ${m.archivo}.`); fallos++; continue; }
  const sha = createHash('sha256').update(readFileSync(ruta)).digest('hex');

  const ya = esCortesia
    ? db.prepare('SELECT id, sha256 FROM cortesia_imagen WHERE clave = ? AND salon_id = ?')
      .get(m.cortesia, sal.id)
    : db.prepare(
    'SELECT id, sha256 FROM paquete_imagen WHERE paquete_id = ? AND salon_id = ? AND COALESCE(etiqueta,\'\') = ?')
      .get(paq.id, sal.id, etq ?? '');
  if (ya && ya.sha256 === sha) { console.log(`  igual    ${donde}`); saltadas++; continue; }

  try {
    const nombreEnKommo = esCortesia
      ? `${m.salon} - cortesia ${m.cortesia}.jpg`
      : `${m.salon} - ${m.paquete}${etq ? ' (' + etq + ')' : ''}.jpg`;
    const { url, uuid } = await subir(ruta, nombreEnKommo);
    const tabla = esCortesia ? 'cortesia_imagen' : 'paquete_imagen';
    if (ya) {
      db.prepare('UPDATE ' + tabla + ' SET url=?, archivo_uuid=?, nombre=?, sha256=?, subida_at=datetime(\'now\') WHERE id=?')
        .run(url, uuid, m.archivo, sha, ya.id);
      console.log(`  CAMBIADA ${donde}`);
    } else if (esCortesia) {
      db.prepare('INSERT INTO cortesia_imagen (clave, salon_id, titulo, url, archivo_uuid, nombre, sha256) VALUES (?,?,?,?,?,?,?)')
        .run(m.cortesia, sal.id, m.titulo ?? null, url, uuid, m.archivo, sha);
      console.log(`  SUBIDA   ${donde}`);
    } else {
      db.prepare('INSERT INTO paquete_imagen (paquete_id, salon_id, etiqueta, url, archivo_uuid, nombre, sha256) VALUES (?,?,?,?,?,?,?)')
        .run(paq.id, sal.id, etq, url, uuid, m.archivo, sha);
      console.log(`  SUBIDA   ${donde}`);
    }
    subidas++;
  } catch (e) {
    console.log(`  FALLO    ${donde}: ${e.message}`);
    fallos++;
  }
}

console.log(`\n${subidas} subidas, ${saltadas} ya estaban igual, ${fallos} fallos.`);
const total = db.prepare('SELECT COUNT(*) n FROM paquete_imagen').get().n;
console.log(`${total} láminas registradas en total.`);

// El manifiesto es lo que viaja a producción. Las láminas ya viven en el
// Drive de Kommo —son las mismas para todos—, así que lo único que le falta
// a la base de producción son estas filas. Subir el archivo de imagen otra
// vez desde el servidor seria absurdo: no está ahí, y no hace falta.
const manifiesto = db.prepare(`
  SELECT p.nombre AS paquete, s.clave AS salon, i.etiqueta, i.url,
         i.archivo_uuid, i.nombre, i.sha256
    FROM paquete_imagen i
    JOIN paquete p ON p.id = i.paquete_id
    JOIN salon   s ON s.id = i.salon_id
   ORDER BY s.clave, p.nombre, i.etiqueta`).all();
const manifiestoCortesias = db.prepare(`
  SELECT c.clave AS cortesia, s.clave AS salon, c.titulo, c.url,
         c.archivo_uuid, c.nombre, c.sha256
    FROM cortesia_imagen c
    JOIN salon s ON s.id = c.salon_id
   ORDER BY s.clave, c.clave`).all();
const rutaManifiesto = join(RAIZ, 'imagenes', 'laminas.json');
writeFileSync(rutaManifiesto, JSON.stringify(manifiesto.concat(manifiestoCortesias), null, 1) + '\n', 'utf8');
console.log(`Manifiesto escrito en ${rutaManifiesto}`);
