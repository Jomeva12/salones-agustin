// ============================================================================
//  Mete en la base las láminas que ya están subidas al Drive de Kommo.
//
//      node backend/db/aplicar_imagenes.mjs
//
//  Esto es lo que se corre EN PRODUCCIÓN. Las imágenes ya viven en el Drive
//  de Kommo —son las mismas para toda la cuenta—, así que al servidor no hay
//  que subirle nada: solo le faltan estas filas, y vienen en el manifiesto
//  imagenes/laminas.json, que sí está versionado.
//
//  Subirlas de nuevo desde el servidor no tendría sentido: los archivos de
//  imagen no están ahí, a propósito, porque pesan y el repositorio es público.
//
//  Es idempotente: una fila que ya está igual no se toca.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..', '..');
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
const MANIFIESTO = process.argv[2] ?? join(RAIZ, 'imagenes', 'laminas.json');

if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }
if (!existsSync(MANIFIESTO)) { console.error('No existe el manifiesto ' + MANIFIESTO); process.exit(1); }

const db = new DatabaseSync(DB);

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

const filas = JSON.parse(readFileSync(MANIFIESTO, 'utf8'));
let nuevas = 0, cambiadas = 0, iguales = 0, fallos = 0;

db.exec('BEGIN');
try {
  for (const f of filas) {
    // Una fila del manifiesto es de paquete (lámina) o de cortesía.
    const esCortesia = !!f.cortesia;
    const etq = f.etiqueta ?? null;
    const donde = esCortesia
      ? `${f.cortesia} · ${f.salon}`
      : `${f.paquete} · ${f.salon}${etq ? ' · ' + etq : ''}`;
    const paq = esCortesia ? null : db.prepare('SELECT id FROM paquete WHERE nombre = ?').get(f.paquete);
    const sal = db.prepare('SELECT id FROM salon WHERE clave = ?').get(f.salon);
    if (!sal || (!esCortesia && !paq)) { console.log(`  FALLO    ${donde}: paquete o salón desconocido.`); fallos++; continue; }

    const ya = esCortesia
      ? db.prepare('SELECT id, url FROM cortesia_imagen WHERE clave = ? AND salon_id = ?')
        .get(f.cortesia, sal.id)
      : db.prepare(
      'SELECT id, url FROM paquete_imagen WHERE paquete_id = ? AND salon_id = ? AND COALESCE(etiqueta,\'\') = ?')
        .get(paq.id, sal.id, etq ?? '');
    if (ya && ya.url === f.url) { iguales++; continue; }
    const tabla = esCortesia ? 'cortesia_imagen' : 'paquete_imagen';
    if (ya) {
      db.prepare('UPDATE ' + tabla + ' SET url=?, archivo_uuid=?, nombre=?, sha256=?, subida_at=datetime(\'now\') WHERE id=?')
        .run(f.url, f.archivo_uuid, f.nombre ?? null, f.sha256, ya.id);
      console.log(`  CAMBIADA ${donde}`); cambiadas++;
    } else if (esCortesia) {
      db.prepare('INSERT INTO cortesia_imagen (clave, salon_id, titulo, url, archivo_uuid, nombre, sha256) VALUES (?,?,?,?,?,?,?)')
        .run(f.cortesia, sal.id, f.titulo ?? null, f.url, f.archivo_uuid, f.nombre ?? null, f.sha256);
      console.log(`  NUEVA    ${donde}`); nuevas++;
    } else {
      db.prepare('INSERT INTO paquete_imagen (paquete_id, salon_id, etiqueta, url, archivo_uuid, nombre, sha256) VALUES (?,?,?,?,?,?,?)')
        .run(paq.id, sal.id, etq, f.url, f.archivo_uuid, f.nombre ?? null, f.sha256);
      console.log(`  NUEVA    ${donde}`); nuevas++;
    }
  }
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }

console.log(`\n${nuevas} nuevas, ${cambiadas} cambiadas, ${iguales} ya estaban igual, ${fallos} fallos.`);
console.log(`${db.prepare('SELECT COUNT(*) n FROM paquete_imagen').get().n} láminas y ${db.prepare('SELECT COUNT(*) n FROM cortesia_imagen').get().n} cortesías en la base.`);
