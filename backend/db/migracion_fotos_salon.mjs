// ============================================================================
//  Las fotos del salón: cómo se ve el lugar, no qué trae el paquete.
//
//      node backend/db/migracion_fotos_salon.mjs
//
//  Idempotente. No borra nada y corre sobre la base viva.
//
//  Tabla aparte de `paquete_imagen` porque son otra cosa y se usan en otro
//  momento. La lámina del paquete acompaña a la cotización y lleva el precio;
//  estas se mandan DESPUÉS, cuando el cliente dice que sí quiere verlas. Una
//  responde «cuánto cuesta» y la otra «cómo se ve».
//
//  `orden` no es un adorno: de las veinte que puede haber de un salón solo
//  salen las primeras, así que el orden ES la selección. Nace en 100 para que
//  subir una al principio no obligue a renumerar las demás.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const db = new DatabaseSync(DB);
const habia = !!db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name='salon_imagen'").get();

db.exec(`
  CREATE TABLE IF NOT EXISTS salon_imagen (
    id            INTEGER PRIMARY KEY,
    salon_id      INTEGER NOT NULL REFERENCES salon(id),
    titulo        TEXT,
    orden         INTEGER NOT NULL DEFAULT 100,
    activa        INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0,1)),
    url           TEXT NOT NULL,
    archivo_uuid  TEXT NOT NULL,
    nombre        TEXT,
    sha256        TEXT NOT NULL,
    subida_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Por sha256: la misma foto subida dos veces es la misma foto, aunque el
  -- archivo venga con otro nombre de WhatsApp.
  CREATE UNIQUE INDEX IF NOT EXISTS salon_imagen_unica
    ON salon_imagen (salon_id, sha256);
  CREATE INDEX IF NOT EXISTS idx_salon_imagen_orden
    ON salon_imagen (salon_id, activa, orden);
`);

console.log(habia ? 'La tabla ya existía; no se tocó nada.' : 'Tabla salon_imagen creada.');

// Las fotos ya están en el Drive de Kommo —se subieron una vez, con
// `subir_fotos_salon.mjs`— y la cuenta de Kommo es la misma en todas partes.
// Asi que aqui no se sube nada: se siembran las FILAS, que es lo unico que
// cada base necesita. El JSON lleva solo metadatos y URLs, nada binario, y
// por eso si cabe en el repositorio.
const MAPA = join(dirname(AQUI), '..', 'imagenes', 'fotos_salon.json');
if (existsSync(MAPA)) {
  const mapa = JSON.parse(readFileSync(MAPA, 'utf8'));
  const poner = db.prepare(
    `INSERT INTO salon_imagen (salon_id, titulo, orden, activa, url, archivo_uuid, nombre, sha256)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(salon_id, sha256) DO NOTHING`);
  let nuevas = 0, sinSalon = 0;
  for (const f of mapa) {
    const sal = db.prepare('SELECT id FROM salon WHERE clave = ?').get(f.salon);
    if (!sal) { sinSalon++; continue; }
    const r = poner.run(sal.id, f.titulo ?? null, f.orden, f.activa ? 1 : 0,
      f.url, f.archivo_uuid, f.nombre ?? null, f.sha256);
    if (r.changes) nuevas++;
  }
  console.log(`${nuevas} ${nuevas === 1 ? 'foto sembrada' : 'fotos sembradas'}`
    + ` de ${mapa.length} en el mapa.${sinSalon ? ` ${sinSalon} con salón desconocido.` : ''}`);
} else {
  console.log('No hay imagenes/fotos_salon.json; la tabla queda vacía.');
}

for (const s of db.prepare(
  `SELECT sa.nombre, COUNT(si.id) n, SUM(COALESCE(si.activa,0)) activas
     FROM salon sa LEFT JOIN salon_imagen si ON si.salon_id = sa.id
    WHERE sa.activo = 1 GROUP BY sa.id ORDER BY sa.id`).all()) {
  console.log(`  ${String(s.nombre).padEnd(20)} ${s.n} fotos (${s.activas ?? 0} activas)`);
}
db.close();
