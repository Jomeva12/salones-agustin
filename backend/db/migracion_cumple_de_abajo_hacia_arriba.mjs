// ============================================================================
//  Un cumpleaños ve toda la escalera, pero empezando por el mas barato.
//
//      node backend/db/migracion_cumple_de_abajo_hacia_arriba.mjs
//
//  Idempotente.
//
//  Corrige lo que cargue unas horas antes. Por un audio del Lic. entendi que
//  el Onix y el Plata NO debian ofrecerse para cumpleaños, y los cerre. En la
//  reunion del 23-oct-2026 quedo claro que era otra cosa.
//
//  Que pasa en Quetzal a mas de seis meses, donde el Bronce ya no aplica:
//
//    «Si alguien me pide una cotización, yo le voy a dar el ónix o el plata,
//     hablando del quetzal, porque ya pasa de 7 meses. Muy posiblemente van a
//     decir "está muy caro". Entonces nosotros lo tenemos registrado, y ya
//     cuando abril entre dentro de los 6 meses le mandamos mensaje: ya tengo
//     una promoción.»
//
//  Y cuando se le pregunto que debia contestar Maya:
//
//    «No sería que no tenemos paquete, sería: el aniversario que tú quieres
//     celebrar para el 20 de abril te saldría en 55, porque es un paquete más
//     caro, te incluye esto.»
//
//  Asi que no era disponibilidad, era ORDEN:
//
//    «Si el cliente lo pide, le podemos cotizar el ónix y el plata sin ningún
//     problema, pero SIEMPRE hay que empezar de abajo hacia arriba.»
//
//  Esa parte la resuelve `ordenarParaVender` en logica.mjs: en cumpleaños
//  ordena por precio de menor a mayor, y en bodas y XV sigue mandando el
//  orden de venta —Plata primero— que el Lic. fijo en su momento. Aqui solo
//  se devuelve la disponibilidad.
//
//  Dejar un cumpleaños sin NADA que cotizar era lo peor de las dos opciones:
//  el cliente se va, y encima nadie se entera de que se fue.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const db = new DatabaseSync(DB);
const uno = (sql, ...a) => db.prepare(sql).get(...a);

const cumple = uno("SELECT id FROM tipo_evento WHERE clave = 'cumpleanos'");
if (!cumple) { console.error('No encontré el tipo de evento de cumpleaños.'); process.exit(1); }

// La escalera entera. El Bronce ya estaba; los otros tres vuelven.
const ESCALERA = ['Paquete Bronce', 'Paquete Onix', 'Paquete Plata', 'Paquete Oro'];
let puestos = 0;
for (const nombre of ESCALERA) {
  const p = uno('SELECT id, activo FROM paquete WHERE nombre = ?', nombre);
  if (!p) { console.log(`  (no existe ${nombre})`); continue; }
  if (!p.activo) { console.log(`  (${nombre} está desactivado)`); continue; }
  if (uno('SELECT 1 x FROM paquete_tipo_evento WHERE paquete_id=? AND tipo_evento_id=?',
          p.id, cumple.id)) {
    console.log(`  ya estaba   ${nombre}`);
    continue;
  }
  db.prepare('INSERT INTO paquete_tipo_evento (paquete_id, tipo_evento_id) VALUES (?,?)')
    .run(p.id, cumple.id);
  console.log(`  abierto     ${nombre} para aniversarios y cumpleaños`);
  puestos++;
}
console.log(`\n${puestos} paquetes reabiertos.`);

console.log('\nComprobación — que ningún salón se quede sin nada que cotizar:');
for (const s of db.prepare('SELECT id, nombre FROM salon WHERE activo = 1 ORDER BY id').all()) {
  const paqs = db.prepare(
    `SELECT DISTINCT p.nombre FROM tarifa t
       JOIN paquete p ON p.id = t.paquete_id
       JOIN paquete_tipo_evento pt ON pt.paquete_id = p.id
      WHERE t.salon_id = ? AND pt.tipo_evento_id = ? AND t.vigente_hasta IS NULL
        AND p.activo = 1 AND p.borrador = 0 AND p.fecha_fija IS NULL
      ORDER BY p.nombre`).all(s.id, cumple.id).map((x) => x.nombre.replace('Paquete ', ''));
  console.log(`  ${s.nombre.padEnd(20)} ` + (paqs.length ? paqs.join(', ') : '*** NINGUNO ***'));
}
db.close();
