// ============================================================================
//  Un salón puede dar varios eventos el mismo día, siempre que entre uno y
//  otro quepa el aseo.
//
//      node backend/db/migracion_horarios.mjs
//
//  Esto NO es migrar.mjs: no borra nada. Corre sobre la base viva porque ahí
//  están los eventos y los precios que se capturaron por el panel, que no
//  existen en la semilla.
//
//  Qué hace:
//    1. salon.minutos_aseo (2 h por omisión), editable por salón.
//    2. compromiso.inicio_at / fin_at: el evento como tramo de tiempo, con el
//       fin saltando al día siguiente cuando cruza la medianoche.
//    3. Quita el UNIQUE (salon_id, fecha, turno), que impedía el segundo
//       evento del día, y lo cambia por los triggers que sí miden horas.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ventana } from '../api/logica.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = join(AQUI, 'salones.db');
const ESQUEMA = join(AQUI, 'esquema.sql');

if (!existsSync(DB)) {
  console.error('No existe salones.db. Corre primero: node backend/db/migrar.mjs');
  process.exit(1);
}

// Respaldo antes de tocar: esto reescribe una tabla completa.
const respaldo = DB.replace(/\.db$/, `.antes-de-horarios.db`);
copyFileSync(DB, respaldo);
console.log('Respaldo:', respaldo);

let db;
try {
  db = new DatabaseSync(DB);
} catch (e) {
  if (e.code === 'SQLITE_BUSY' || /EBUSY|EPERM/.test(String(e.message))) {
    console.error('\n  La base está abierta por otro proceso: detén el servidor y vuelve a correr.');
    console.error('  Windows:  Get-Process node | Stop-Process -Force\n');
    process.exit(1);
  }
  throw e;
}

const columnas = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
if (columnas('compromiso').includes('inicio_at')) {
  console.log('Ya estaba aplicada. Nada que hacer.');
  process.exit(0);
}

// El texto de la tabla y los triggers se toman de esquema.sql para que la base
// viva y una base recién creada no puedan divergir.
const esquema = readFileSync(ESQUEMA, 'utf8');
const trozo = (re) => {
  const m = esquema.match(re);
  if (!m) throw new Error('no encontré en esquema.sql: ' + re);
  return m[0];
};
const defTabla = trozo(/CREATE TABLE compromiso \([\s\S]*?\n\);/);
const defTriggers = [
  trozo(/CREATE TRIGGER compromiso_aseo_ins[\s\S]*?\nEND;/),
  trozo(/CREATE TRIGGER compromiso_aseo_upd[\s\S]*?\nEND;/),
];
const defIndices = [
  trozo(/CREATE INDEX idx_compromiso_fecha[^;]*;/),
  trozo(/CREATE INDEX idx_compromiso_ventana[^;]*;/),
];

db.exec('PRAGMA foreign_keys = OFF');
db.exec('BEGIN');
try {
  // ── 1. minutos de aseo ────────────────────────────────────────────────────
  if (!columnas('salon').includes('minutos_aseo')) {
    db.exec('ALTER TABLE salon ADD COLUMN minutos_aseo INTEGER NOT NULL DEFAULT 120');
    console.log('salon.minutos_aseo = 120 en los cuatro salones');
  }

  // ── 2. la tabla nueva, sin el UNIQUE y con las columnas de tramo ──────────
  db.exec(defTabla.replace('CREATE TABLE compromiso (', 'CREATE TABLE compromiso_nueva ('));
  const viejas = columnas('compromiso');
  const comunes = columnas('compromiso_nueva').filter(
    (c) => viejas.includes(c) && c !== 'inicio_at' && c !== 'fin_at');
  db.exec(
    `INSERT INTO compromiso_nueva (${comunes.join(',')}) SELECT ${comunes.join(',')} FROM compromiso`);

  // ── 3. traducir las horas de texto a instantes ────────────────────────────
  const filas = db.prepare(
    'SELECT id, fecha, hora_inicio, hora_fin FROM compromiso_nueva').all();
  const poner = db.prepare('UPDATE compromiso_nueva SET inicio_at=?, fin_at=? WHERE id=?');
  let conHora = 0, sinHora = 0, noParseo = [];
  for (const f of filas) {
    const v = ventana(f.fecha, f.hora_inicio, f.hora_fin);
    if (v.inicio_at) { poner.run(v.inicio_at, v.fin_at, f.id); conHora++; }
    else {
      sinHora++;
      // Tenía texto pero no se pudo leer: eso hay que verlo a mano, no
      // adivinarlo. Se queda sin tramo y el trigger lo trata como día completo.
      if (f.hora_inicio || f.hora_fin) {
        noParseo.push(`  id ${f.id} (${f.fecha}): «${f.hora_inicio}» – «${f.hora_fin}»`);
      }
    }
  }

  // ── 4. sustituir ──────────────────────────────────────────────────────────
  db.exec('DROP TABLE compromiso');
  db.exec('ALTER TABLE compromiso_nueva RENAME TO compromiso');
  for (const x of [...defIndices, ...defTriggers]) db.exec(x);

  db.exec('COMMIT');
  console.log(`\n${conHora} eventos con tramo de tiempo, ${sinHora} sin hora capturada.`);
  if (noParseo.length) {
    console.log('\nHoras que no se pudieron leer (quedaron sin tramo, revísalas):');
    console.log(noParseo.join('\n'));
  }
} catch (e) {
  db.exec('ROLLBACK');
  console.error('\nFalló, no se cambió nada:', e.message);
  console.error('Respaldo intacto en', respaldo);
  process.exit(1);
}
db.exec('PRAGMA foreign_keys = ON');

// Comprobación: la regla tiene que rechazar lo que debe y aceptar lo que debe.
const chk = db.prepare(
  `SELECT COUNT(*) n FROM compromiso a JOIN compromiso b
     ON a.salon_id = b.salon_id AND a.id < b.id
    AND a.inicio_at IS NOT NULL AND b.inicio_at IS NOT NULL
    AND datetime(a.inicio_at) < datetime(b.fin_at, '+' ||
          (SELECT minutos_aseo FROM salon WHERE id = a.salon_id) || ' minutes')
    AND datetime(b.inicio_at) < datetime(a.fin_at, '+' ||
          (SELECT minutos_aseo FROM salon WHERE id = a.salon_id) || ' minutes')`).get();
console.log(`\nChoques entre los eventos ya capturados: ${chk.n}`);
console.log('Listo.');
