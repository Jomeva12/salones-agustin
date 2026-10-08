// ============================================================================
//  Fechas que no cierran el salon pero cambian lo que hay que decir.
//
//      node backend/db/migracion_fechas_especiales.mjs
//
//  Idempotente: crea la tabla si falta y siembra las Semanas Santas que
//  falten. Lo que ya este sembrado NO se toca — si alguien corrigio el texto
//  desde el panel, volver a correr esto no se lo borra.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const db = new DatabaseSync(DB);
const habia = !!db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name='fecha_especial'").get();

db.exec(`
  CREATE TABLE IF NOT EXISTS fecha_especial (
    id        INTEGER PRIMARY KEY,
    clave     TEXT NOT NULL UNIQUE,
    titulo    TEXT NOT NULL,
    desde     TEXT NOT NULL,
    hasta     TEXT NOT NULL,
    aviso     TEXT NOT NULL,
    notas     TEXT,
    se_cotiza INTEGER NOT NULL DEFAULT 1 CHECK (se_cotiza IN (0,1)),
    activa    INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0,1))
  );
  CREATE INDEX IF NOT EXISTS idx_especial_rango
    ON fecha_especial (activa, desde, hasta);
`);

/**
 * Domingo de Pascua (algoritmo de Butcher, calendario gregoriano).
 *
 * Se calcula y no se teclea a proposito: la Pascua se mueve cada ano y una
 * lista escrita a mano caduca en silencio. El dia que alguien venda 2031,
 * esto ya lo sabe.
 */
function pascua(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Suma dias en UTC: sin hora no hay zona horaria que corra la fecha. */
const mas = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// La semana entera, de Domingo de Ramos a Domingo de Pascua. Lo decidio el
// Lic.: prefiere que se avise de mas a que alguien planee una misa el lunes
// santo y se entere tarde.
// Con acentos: esto puede salir casi tal cual al chat del cliente.
const AVISO =
  'En Semana Santa la iglesia no celebra misas ni bodas. Si tu evento llevaba '
  + 'misa, ese día no se va a poder. El salón sí está disponible: la fecha se '
  + 'cotiza y se contrata como cualquier otra.';

const NOTAS =
  'Se cotiza normal y no se desanima a nadie: lo que se quiere es vender. Si '
  + 'el cliente duda por lo de la misa o pide hablar con alguien, avisar a la '
  + 'encargada: el asesor tiene margen para mejorar la oferta.';

const poner = db.prepare(
  `INSERT INTO fecha_especial (clave, titulo, desde, hasta, aviso, notas, se_cotiza, activa)
   VALUES (?, ?, ?, ?, ?, ?, 1, 1)
   ON CONFLICT(clave) DO NOTHING`);

const DESDE = new Date().getUTCFullYear();
let nuevas = 0;
for (let y = DESDE; y <= DESDE + 6; y++) {
  const p = pascua(y);
  const r = poner.run(`semana_santa_${y}`, `Semana Santa ${y}`,
                      mas(p, -7), p, AVISO, NOTAS);
  if (r.changes) { nuevas++; console.log(`  + Semana Santa ${y}: ${mas(p, -7)} a ${p}`); }
}

console.log(habia ? 'La tabla ya existia; no se toco nada.' : 'Tabla fecha_especial creada.');
console.log(`${nuevas} ${nuevas === 1 ? 'fecha sembrada' : 'fechas sembradas'}.`);
console.log(`${db.prepare('SELECT count(*) c FROM fecha_especial WHERE activa = 1').get().c} activas en total.`);
db.close();
