// ============================================================================
//  «lazer para bals» → «lazer para vals».
//
//      node backend/db/migracion_vals.mjs
//
//  Esto NO es migrar.mjs: no borra nada y corre sobre la base viva.
//
//  El texto de cortesías lo manda Maya al cliente TAL CUAL, así que una errata
//  ahí no es cosmética: la lee el cliente. Venía del Excel y la confirmó
//  Agustín contra la lámina de Presentación Elite, que dice vals con v.
//
//  Solo se cambia esa palabra. Los demás nombres de la lámina —«chisperos»
//  por «2 pirotecnias», «vals mariposas» por «lluvia de mariposas», «rayo
//  para vals» por «lazer para vals»— son la misma cosa dicha de otra manera,
//  y cuál de las dos redacciones usar es decisión del cliente, no mía.
//
//  Es idempotente: al terminar no queda ningún «bals».
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const db = new DatabaseSync(DB);

const antes = db.prepare(
  "SELECT COUNT(*) n FROM paquete_contenido WHERE cortesias LIKE '%bals%'").get().n;
console.log(`${antes} filas de cortesías con «bals».`);

db.exec('BEGIN');
try {
  db.prepare(
    "UPDATE paquete_contenido SET cortesias = REPLACE(cortesias, 'bals', 'vals') " +
    "WHERE cortesias LIKE '%bals%'").run();
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }

const quedan = db.prepare(
  "SELECT COUNT(*) n FROM paquete_contenido WHERE cortesias LIKE '%bals%'").get().n;
console.log(`${antes - quedan} corregidas. Quedan ${quedan}.`);

const muestra = db.prepare(
  "SELECT cortesias FROM paquete_contenido WHERE cortesias LIKE '%vals%' LIMIT 1").get();
if (muestra) console.log('\nAsí queda:\n  ' + muestra.cortesias);
