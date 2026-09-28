// ============================================================================
//  Deja todas las horas guardadas en un solo formato: «8:00 pm».
//
//      node backend/db/normalizar_horas.mjs           (muestra qué haría)
//      node backend/db/normalizar_horas.mjs --aplicar (lo hace)
//
//  Se capturaron a mano durante años y quedaron cosas como «13:00 pm», que es
//  un 13:00 con un pm de sobra. Mientras el formato sea libre, cada captura
//  nueva puede inventar otro; por eso el panel ahora las hace elegir de una
//  lista y esto arregla el pasado.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizarHora, ventana } from '../api/logica.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = join(AQUI, 'salones.db');
const APLICAR = process.argv.includes('--aplicar');

if (!existsSync(DB)) { console.error('No existe salones.db'); process.exit(1); }

const db = new DatabaseSync(DB, { readOnly: !APLICAR });
const filas = db.prepare(
  `SELECT c.id, c.fecha, c.hora_inicio, c.hora_fin, s.nombre AS salon
     FROM compromiso c JOIN salon s ON s.id = c.salon_id
    WHERE c.hora_inicio IS NOT NULL OR c.hora_fin IS NOT NULL
    ORDER BY c.fecha`).all();

const cambios = [], ilegibles = [];
for (const f of filas) {
  const ini = normalizarHora(f.hora_inicio);
  const fin = normalizarHora(f.hora_fin);
  // Tenía texto y no se pudo leer: eso se revisa a mano, no se adivina.
  if ((f.hora_inicio && !ini) || (f.hora_fin && !fin)) { ilegibles.push(f); continue; }
  if (ini !== f.hora_inicio || fin !== f.hora_fin) {
    cambios.push({ ...f, ini, fin, ...ventana(f.fecha, ini, fin) });
  }
}

console.log(`${filas.length} eventos con hora capturada.`);
if (!cambios.length) console.log('Todas están ya en el formato correcto.');
else {
  console.log(`\n${cambios.length} por corregir:`);
  for (const c of cambios) {
    console.log(`  ${c.fecha}  ${c.salon.padEnd(20)} «${c.hora_inicio}»–«${c.hora_fin}»` +
                `  →  «${c.ini}»–«${c.fin}»`);
  }
}
if (ilegibles.length) {
  console.log(`\n${ilegibles.length} que no se pudieron leer (se quedan como están, revísalas):`);
  for (const f of ilegibles) console.log(`  id ${f.id}  ${f.fecha}  «${f.hora_inicio}»–«${f.hora_fin}»`);
}

if (!APLICAR) {
  console.log('\nEsto fue solo la vista previa. Para aplicarlo:');
  console.log('  node backend/db/normalizar_horas.mjs --aplicar');
  process.exit(0);
}
if (!cambios.length) process.exit(0);

const respaldo = DB.replace(/\.db$/, '.antes-de-normalizar.db');
copyFileSync(DB, respaldo);
console.log('\nRespaldo:', respaldo);

db.exec('BEGIN');
try {
  // inicio_at/fin_at se recalculan junto con el texto: si se corrige
  // «13:00 pm» a «1:00 pm» y el tramo se quedara viejo, la regla del aseo
  // seguiría midiendo sobre la hora equivocada.
  const st = db.prepare(
    'UPDATE compromiso SET hora_inicio=?, hora_fin=?, inicio_at=?, fin_at=? WHERE id=?');
  for (const c of cambios) st.run(c.ini, c.fin, c.inicio_at, c.fin_at, c.id);
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('Falló, no se cambió nada:', e.message);
  process.exit(1);
}
console.log(`${cambios.length} corregidos.`);

const quedan = db.prepare(
  `SELECT COUNT(*) n FROM compromiso
    WHERE hora_inicio IS NOT NULL
      AND hora_inicio NOT GLOB '[0-9]:[0-9][0-9] [ap]m'
      AND hora_inicio NOT GLOB '[0-9][0-9]:[0-9][0-9] [ap]m'`).get().n;
console.log(`Fuera de formato después de esto: ${quedan}`);
