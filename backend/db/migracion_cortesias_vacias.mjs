// ============================================================================
//  Rellena las cortesías que la carga del Excel dejó vacías.
//
//      node backend/db/migracion_cortesias_vacias.mjs
//
//  Esto NO es migrar.mjs: no borra nada y corre sobre la base viva.
//
//  El problema: 55 tarifas (el 5%) apuntaban a un registro de contenido sin
//  ninguna cortesía, así que al cotizarlas el agente decía que el paquete no
//  incluye nada. No era una regla de negocio — era el patrón de una celda
//  combinada en Excel: el texto se escribió una vez, en la primera fila del
//  bloque, y la carga no lo arrastró hacia las demás.
//
//  El arreglo: a cada registro vacío se le copia el texto de su gemelo, que
//  es el registro del MISMO paquete, MISMO salón y MISMO escalón que sí lo
//  tiene. Se copia solo el texto; los conceptos no se tocan.
//
//  Tres guardas, porque escribir de más aquí se traduce en prometerle al
//  cliente algo que no lleva:
//    1. Solo se rellena lo que está vacío. Un texto ya escrito nunca se pisa.
//    2. El gemelo tiene que ser único. Si hay dos candidatos distintos, no se
//       adivina: se reporta y se deja como está.
//    3. Los dos tienen que llevar exactamente los mismos conceptos, con los
//       mismos «incluido». Si difieren no son el mismo paquete y copiar el
//       texto seria mentir.
//
//  Es idempotente: al terminar no queda nada vacío, así que correrlo otra vez
//  no hace nada.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');

if (!existsSync(DB)) {
  console.error('No existe la base en ' + DB);
  process.exit(1);
}

const db = new DatabaseSync(DB);

// Un respaldo antes de tocar nada. VACUUM INTO y no una copia del archivo:
// con WAL, copiar el .db a secas se lleva una base a medias.
const sello = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const respaldo = join(dirname(DB), `salones.antes-de-cortesias-${sello}.db`);
db.exec(`VACUUM INTO '${respaldo.replace(/'/g, "''")}'`);
console.log('Respaldo en ' + respaldo + '\n');

const conceptos = (id) => db.prepare(
  'SELECT concepto_id, incluido FROM paquete_contenido_concepto WHERE contenido_id = ? ORDER BY concepto_id')
  .all(id).map((r) => `${r.concepto_id}:${r.incluido}`).join(',');

// Solo los vacíos que alguna tarifa usa de verdad. Un registro vacío que nadie
// referencia no le hace daño a nadie y no hay por qué inventarle un texto.
const vacios = db.prepare(`
  SELECT pc.id, pc.paquete_id, pc.salon_id, pc.escalon_id,
         p.nombre AS paquete, s.clave AS salon, e.nombre AS escalon,
         (SELECT COUNT(*) FROM tarifa t WHERE t.contenido_id = pc.id) AS tarifas
    FROM paquete_contenido pc
    JOIN paquete p ON p.id = pc.paquete_id
    JOIN salon   s ON s.id = pc.salon_id
    LEFT JOIN escalon e ON e.id = pc.escalon_id
   WHERE COALESCE(TRIM(pc.cortesias), '') = ''
     AND EXISTS (SELECT 1 FROM tarifa t WHERE t.contenido_id = pc.id)
   ORDER BY p.nombre, s.clave`).all();

console.log(`${vacios.length} registros de contenido sin cortesías, en uso.\n`);

let arreglados = 0, saltados = 0, tarifas = 0;

db.exec('BEGIN');
try {
  for (const v of vacios) {
    const donde = `${v.paquete} · ${v.salon} · ${v.escalon ?? 'fecha fija'}`;

    // El gemelo: mismo paquete, mismo salón, mismo escalón, con texto.
    // El IS de SQLite compara NULL con NULL como iguales, que es lo que hace
    // falta para los paquetes de fecha fija (escalon_id en NULL).
    const gemelos = db.prepare(`
      SELECT id, cortesias FROM paquete_contenido
       WHERE paquete_id = ? AND salon_id = ? AND escalon_id IS ?
         AND id <> ? AND COALESCE(TRIM(cortesias), '') <> ''`)
      .all(v.paquete_id, v.salon_id, v.escalon_id, v.id);

    const distintos = [...new Set(gemelos.map((g) => g.cortesias))];
    if (distintos.length === 0) {
      console.log(`  SALTADO  ${donde}: no tiene ningún gemelo con texto.`);
      saltados++; continue;
    }
    if (distintos.length > 1) {
      console.log(`  SALTADO  ${donde}: ${distintos.length} textos distintos, no se adivina.`);
      saltados++; continue;
    }

    const mios = conceptos(v.id);
    const suyos = conceptos(gemelos[0].id);
    if (mios !== suyos) {
      console.log(`  SALTADO  ${donde}: los conceptos no coinciden con el gemelo.`);
      saltados++; continue;
    }

    db.prepare('UPDATE paquete_contenido SET cortesias = ? WHERE id = ?')
      .run(distintos[0], v.id);
    console.log(`  ARREGLADO ${donde} (${v.tarifas} tarifas) ← contenido ${gemelos[0].id}`);
    arreglados++; tarifas += v.tarifas;
  }
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }

const quedan = db.prepare(`
  SELECT COUNT(*) n FROM tarifa t JOIN paquete_contenido pc ON pc.id = t.contenido_id
   WHERE COALESCE(TRIM(pc.cortesias), '') = ''`).get().n;

console.log(`\n${arreglados} registros arreglados, ${tarifas} tarifas recuperadas.`);
if (saltados) console.log(`${saltados} saltados: hay que revisarlos a mano.`);
console.log(`Tarifas que siguen sin cortesías: ${quedan}.`);
