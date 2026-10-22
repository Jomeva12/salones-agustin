// ============================================================================
//  Quetzal 2027: los Boda y XV dejan de aplicar todo el año.
//
//      node backend/db/migracion_escalones_quetzal_2027.mjs
//
//  Idempotente: si ya tienen escalon, no los toca.
//
//  En Quetzal el escalon de anticipacion no cambia el PRECIO del mismo
//  paquete, como en los otros tres salones: cambia de PAQUETE. Cerca, el
//  Bronce; lejos, el Onix o el Plata.
//
//  Hasta el Excel del 22-oct-2026 las tres notas decian literalmente «se
//  ofrecerá en cualquier mes del 2027», asi que tenerlos sin escalon era
//  correcto. En el Excel nuevo el Lic. las reescribio:
//
//    Bronce Boda y XV → «del mes en curso y seis mas, contando el actual»
//                        es decir 0 a 5 meses
//    Onix  Boda y XV → «a partir del Septimo mes ... tomando en cuenta el
//                        corriente» es decir 6 meses o mas
//    Plata Boda y XV → lo mismo
//
//  Esto no es cosmetico y costaba dinero: sin escalon, el Bronce se ofrecia
//  tambien a catorce meses. Un evento lejano se cotizaba en $41,400 cuando el
//  mas barato que corresponde es el Onix, $52,400. Once mil pesos por evento.
//  Y al reves, un evento cercano veia el Plata —que a esa distancia no se
//  vende— y encima era el recomendado.
//
//  Entre los tres cubren todo el rango, asi que ningun cliente se queda sin
//  paquete: 0 a 5 el Bronce, 6 o mas el Onix y el Plata.
//
//  NO se toca el «Paquete Aniversarios / Cumpleaños», cuya nota tambien
//  cambio a 0-5 meses. Es el unico paquete general de cumpleaños de Quetzal
//  —los otros dos son de fecha fija— asi que limitarlo dejaria un cumpleaños a
//  ocho meses sin NADA que cotizar. Pendiente de preguntarle al Lic. que
//  ofrece en ese tramo.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const db = new DatabaseSync(DB);

const REGLAS = [
  ['Paquete Bronce Boda y XV', 'Faltan 0 a 5 meses'],
  ['Paquete Onix Boda y XV', 'Faltan 6 meses o más'],
  ['Paquete Plata Boda y XV', 'Faltan 6 meses o más'],
];
const ANIO = 2027;

const salon = db.prepare("SELECT id, nombre FROM salon WHERE clave = 'quetzal'").get();
if (!salon) { console.error('No encontré Quetzal.'); process.exit(1); }

let tocadas = 0, yaEstaban = 0;
for (const [nombrePaquete, nombreEscalon] of REGLAS) {
  const paquete = db.prepare('SELECT id FROM paquete WHERE nombre = ?').get(nombrePaquete);
  const escalon = db.prepare('SELECT id, meses_min, meses_max FROM escalon WHERE nombre = ?')
    .get(nombreEscalon);
  if (!paquete) { console.log(`  !! paquete desconocido: ${nombrePaquete}`); continue; }
  if (!escalon) { console.log(`  !! escalón desconocido: ${nombreEscalon}`); continue; }

  const filas = db.prepare(
    `SELECT id, escalon_id, personas_desde, personas_hasta FROM tarifa
      WHERE salon_id = ? AND paquete_id = ? AND anio = ? AND vigente_hasta IS NULL`)
    .all(salon.id, paquete.id, ANIO);

  // Una fila con OTRO escalon no se pisa en silencio: significa que alguien
  // decidio algo distinto y hay que mirarlo antes de deshacerlo.
  const ajenas = filas.filter((f) => f.escalon_id !== null && f.escalon_id !== escalon.id);
  if (ajenas.length) {
    console.log(`  !! ${nombrePaquete}: ${ajenas.length} filas ya tienen OTRO escalón. `
      + 'Sin tocar — revisar a mano.');
    continue;
  }

  const porPoner = filas.filter((f) => f.escalon_id === null);
  if (!porPoner.length) {
    console.log(`  ya estaba   ${nombrePaquete} -> ${nombreEscalon} (${filas.length} filas)`);
    yaEstaban += filas.length;
    continue;
  }

  const st = db.prepare('UPDATE tarifa SET escalon_id = ? WHERE id = ?');
  for (const f of porPoner) st.run(escalon.id, f.id);
  const tope = escalon.meses_max === null ? 'en adelante' : `a ${escalon.meses_max}`;
  console.log(`  puesto      ${nombrePaquete} -> ${nombreEscalon} `
    + `(${porPoner.length} filas · ${escalon.meses_min} ${tope} meses)`);
  tocadas += porPoner.length;
}

console.log(`\n${tocadas} tarifas clasificadas · ${yaEstaban} ya lo estaban.`);

// Que no quede un hueco: a cada distancia tiene que haber al menos un paquete.
console.log('\nComprobación — paquetes de Boda y XV disponibles por anticipación:');
for (const meses of [0, 3, 5, 6, 12, 24]) {
  const hay = db.prepare(
    `SELECT p.nombre FROM tarifa t
       JOIN paquete p ON p.id = t.paquete_id
       LEFT JOIN escalon e ON e.id = t.escalon_id
      WHERE t.salon_id = ? AND t.anio = ? AND t.vigente_hasta IS NULL
        AND p.nombre LIKE '%Boda y XV%' AND t.personas_hasta = 100
        AND (t.escalon_id IS NULL
             OR (? >= e.meses_min AND (e.meses_max IS NULL OR ? <= e.meses_max)))
      GROUP BY p.nombre ORDER BY MIN(t.precio_sab)`)
    .all(salon.id, ANIO, meses, meses);
  const lista = hay.map((x) => x.nombre.replace('Paquete ', '').replace(' Boda y XV', ''));
  console.log(`  a ${String(meses).padStart(2)} meses: ` +
    (lista.length ? lista.join(', ') : '*** NINGUNO — un cliente se quedaría sin cotización ***'));
}
db.close();
