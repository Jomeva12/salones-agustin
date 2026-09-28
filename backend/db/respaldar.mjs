// ============================================================================
//  Respaldo de la base del panel.
//      node backend/db/respaldar.mjs [carpeta]
//
//  Usa VACUUM INTO y no una copia del archivo. Copiar salones.db a secas se
//  lleva la base SIN el WAL, o sea sin lo ultimo que se escribio: el respaldo
//  se ve bien, pesa lo mismo, y le faltan las ultimas horas. VACUUM INTO
//  escribe una base consistente aunque el panel este sirviendo en ese momento.
//
//  Para el cron diario:
//      0 3 * * *  cd /srv/salones && node backend/db/respaldar.mjs
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
const DESTINO = process.argv[2] ?? process.env.RESPALDOS ?? join(AQUI, 'respaldos');
// Cuantos dias se conservan. Un evento se contrata con 18 meses de
// anticipacion, pero un error se nota en dias: 30 copias es de sobra.
const DIAS = Number(process.env.RESPALDOS_DIAS ?? 30);

if (!existsSync(DB)) {
  console.error(`No existe la base: ${DB}`);
  process.exit(1);
}
mkdirSync(DESTINO, { recursive: true });

// Fecha en hora de Monterrey: si no, el respaldo de las 3 a.m. queda fechado
// el dia siguiente y la lista se lee al reves.
const hoy = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Monterrey', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const archivo = join(DESTINO, `salones-${hoy}.db`);
if (existsSync(archivo)) unlinkSync(archivo);   // VACUUM INTO no sobrescribe

const db = new DatabaseSync(DB, { readOnly: true });
try {
  db.exec(`VACUUM INTO '${archivo.replace(/'/g, "''")}'`);
} catch (e) {
  console.error('Fallo el respaldo:', e.message);
  process.exit(1);
}

const kb = Math.round(statSync(archivo).size / 1024);
console.log(`respaldo ok  ${archivo}  (${kb} KB)`);

// ── rotacion ────────────────────────────────────────────────────────────────
// Se borran por nombre, no por fecha del archivo: si alguien copia la carpeta
// las fechas de modificacion cambian todas y se perderia el historial entero.
const limite = new Date(Date.now() - DIAS * 86400000).toISOString().slice(0, 10);
let borrados = 0;
for (const n of readdirSync(DESTINO)) {
  const m = n.match(/^salones-(\d{4}-\d{2}-\d{2})\.db$/);
  if (m && m[1] < limite) { unlinkSync(join(DESTINO, n)); borrados++; }
}
if (borrados) console.log(`rotacion ..  ${borrados} copias de mas de ${DIAS} dias borradas`);
