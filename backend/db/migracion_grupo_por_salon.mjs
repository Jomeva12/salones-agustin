// ============================================================================
//  Cada salon avisa en SU grupo de Telegram.
//
//      node backend/db/migracion_grupo_por_salon.mjs
//
//  Idempotente: si un salon ya tiene grupo, no lo pisa.
//
//  Hasta hoy los avisos de los cuatro salones caian en un unico grupo. Eso
//  obliga a la encargada de Norma a leer los recados de Esmeralda para
//  encontrar los suyos, y cuanto mas ruido tiene un grupo menos se mira —que
//  es como se pierde el aviso que si importaba.
//
//  El Lic. paso los cuatro ids el 20-oct-2026.
//
//  OJO: un aviso puede no tener salon. Pasa cuando el cliente escribe algo que
//  hay que escalar antes de decir a que salon va. Esos NO desaparecen: siguen
//  saliendo en el grupo general, que es el unico sitio donde alguien los va a
//  ver. Un aviso sin destino es un cliente esperando que no aparece en ninguna
//  pantalla.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const GRUPOS = {
  norma: '-5520568428',
  esmeralda: '-5026866373',
  santacruz: '-5393701263',
  quetzal: '-5373038279',
};

const db = new DatabaseSync(DB);

const hay = db.prepare('PRAGMA table_info(salon)').all().map((c) => c.name);
if (!hay.includes('telegram_grupo')) {
  db.exec('ALTER TABLE salon ADD COLUMN telegram_grupo TEXT');
  console.log('  agregada    columna telegram_grupo');
} else {
  console.log('  ya estaba   columna telegram_grupo');
}

let puestos = 0;
for (const [clave, grupo] of Object.entries(GRUPOS)) {
  const s = db.prepare('SELECT id, nombre, telegram_grupo FROM salon WHERE clave = ?').get(clave);
  if (!s) { console.log(`  !! no existe el salon ${clave}`); continue; }
  if (s.telegram_grupo === grupo) { console.log(`  ya estaba   ${s.nombre} -> ${grupo}`); continue; }
  if (s.telegram_grupo) {
    // No se pisa en silencio: si alguien lo cambio desde el panel, ese valor
    // gana sobre lo que diga este archivo.
    console.log(`  SIN TOCAR   ${s.nombre} ya tiene ${s.telegram_grupo} (aqui dice ${grupo})`);
    continue;
  }
  db.prepare('UPDATE salon SET telegram_grupo = ? WHERE id = ?').run(grupo, s.id);
  console.log(`  puesto      ${s.nombre} -> ${grupo}`);
  puestos++;
}

console.log(`\n${puestos} salones con grupo nuevo.`);
for (const r of db.prepare('SELECT nombre, telegram_grupo FROM salon ORDER BY id').all()) {
  console.log(`  ${r.nombre.padEnd(20)} ${r.telegram_grupo ?? '(sin grupo: iria al general)'}`);
}
db.close();
