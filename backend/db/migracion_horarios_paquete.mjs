// ============================================================================
//  Qué horarios se pueden ofrecer.
//
//      node backend/db/migracion_horarios_paquete.mjs [--aplicar]
//
//  El dato ya estaba en la base, pero como texto suelto y por eso nadie podía
//  calcular con él:
//
//    · «Salón por 5 horas» / «Salón por 4 horas» son conceptos del paquete.
//      Ahí vive la DURACIÓN.
//    · «Media hora antes para estancia» es otro concepto. El cliente ocupa el
//      salón media hora antes de su hora de inicio, y eso cuenta para el aseo.
//    · La política «Costo de la hora extra» dice: «sin excepción, todos los
//      eventos terminan a más tardar a la 1:00 am. Lo anterior por reglamento
//      municipal». Ese es un TOPE DURO, no una costumbre.
//
//  Con esos tres números, la hora de inicio deja de ser algo que se pregunta y
//  pasa a ser algo que se calcula: 5 horas que deben terminar a la 1:00 am
//  significan que lo más tarde que se puede empezar son las 8:00 pm. Que es,
//  exactamente, lo que muestran los 154 eventos ya capturados.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = join(AQUI, 'salones.db');
const APLICAR = process.argv.includes('--aplicar');
if (!existsSync(DB)) { console.error('No existe salones.db'); process.exit(1); }

// Hora habitual de inicio por tipo de evento. Las cuatro primeras salen de los
// eventos ya capturados; las dos últimas no tienen historial y son un supuesto
// que hay que confirmar con el Lic. Barrón.
const FRANJA = {
  xv:         { min: '19:00', max: '20:00', fuente: 'datos: 103 eventos, todos 7 u 8 pm' },
  boda:       { min: '19:00', max: '20:00', fuente: 'datos: 29 eventos, todos 7, 7:30 u 8 pm' },
  posada:     { min: '19:00', max: '20:00', fuente: 'datos: 9 eventos, 7 y 8 pm' },
  cumpleanos: { min: '13:00', max: '20:00', fuente: 'datos: 11 de noche y 1 de 1 pm' },
  graduacion: { min: '19:00', max: '20:00', fuente: 'SUPUESTO: sin eventos capturados' },
  babyshower: { min: '11:00', max: '17:00', fuente: 'SUPUESTO: sin eventos capturados; paquete de 4 h' },
};

const db = new DatabaseSync(DB, { readOnly: !APLICAR });
const col = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

if (col('paquete_contenido').includes('horas_salon')) {
  console.log('Ya estaba aplicada.');
  process.exit(0);
}

// ── lo que se puede deducir ─────────────────────────────────────────────────
const duracion = db.prepare(`
  SELECT pc.id, p.nombre AS paquete, s.nombre AS salon, k.nombre AS concepto
    FROM paquete_contenido pc
    JOIN paquete p ON p.id = pc.paquete_id
    JOIN salon   s ON s.id = pc.salon_id
    LEFT JOIN paquete_contenido_concepto x ON x.contenido_id = pc.id AND x.incluido = 1
    LEFT JOIN concepto k ON k.id = x.concepto_id AND k.nombre LIKE 'Salón por % horas'
   ORDER BY pc.id`).all();

const porContenido = new Map();
for (const f of duracion) {
  if (!porContenido.has(f.id)) porContenido.set(f.id, { ...f, horas: null });
  const m = f.concepto?.match(/Salón por (\d+) horas/);
  if (m) porContenido.get(f.id).horas = Number(m[1]);
}

const estancia = new Set(db.prepare(`
  SELECT DISTINCT x.contenido_id id FROM paquete_contenido_concepto x
    JOIN concepto k ON k.id = x.concepto_id
   WHERE x.incluido = 1 AND k.nombre LIKE '%estancia%previo%'
      OR (x.incluido = 1 AND k.nombre LIKE 'Media hora antes%')`).all().map((r) => r.id));

const conHoras = [...porContenido.values()].filter((c) => c.horas);
const sinHoras = [...porContenido.values()].filter((c) => !c.horas);

console.log(`${porContenido.size} contenidos de paquete.`);
console.log(`  con duración declarada: ${conHoras.length}`);
console.log(`  sin declararla:         ${sinHoras.length}`);
const reparto = {};
for (const c of conHoras) reparto[c.horas] = (reparto[c.horas] ?? 0) + 1;
console.log('  reparto:', Object.entries(reparto).map(([h, n]) => `${n} de ${h} h`).join(', '));
console.log(`  con media hora de estancia previa: ${estancia.size}`);

if (sinHoras.length) {
  console.log('\nSin duración (se quedan en NULL; el API usará 5 h, que es lo que dura el 99%):');
  for (const c of sinHoras.slice(0, 8)) console.log(`  ${c.paquete} · ${c.salon}`);
  if (sinHoras.length > 8) console.log(`  ...y ${sinHoras.length - 8} más`);
}

console.log('\nFranja horaria por tipo de evento:');
for (const [k, v] of Object.entries(FRANJA)) console.log(`  ${k.padEnd(11)} ${v.min}–${v.max}   (${v.fuente})`);
console.log('\nTope de cierre: 01:00 en los cuatro salones (reglamento municipal).');

if (!APLICAR) {
  console.log('\nVista previa. Para aplicarlo:  node backend/db/migracion_horarios_paquete.mjs --aplicar');
  process.exit(0);
}

const respaldo = DB.replace(/\.db$/, '.antes-de-franjas.db');
copyFileSync(DB, respaldo);
console.log('\nRespaldo:', respaldo);

db.exec('BEGIN');
try {
  db.exec('ALTER TABLE paquete_contenido ADD COLUMN horas_salon REAL');
  db.exec('ALTER TABLE paquete_contenido ADD COLUMN minutos_estancia INTEGER NOT NULL DEFAULT 0');
  // Reglamento municipal: sin excepción todos los eventos terminan a la 1:00.
  // Vive por salón porque es lo que permite cambiarlo si un municipio cambia.
  db.exec("ALTER TABLE salon ADD COLUMN cierre_maximo TEXT NOT NULL DEFAULT '01:00'");
  // La ventana en la que ese tipo de evento se acostumbra empezar. El tope
  // real lo pone cierre_maximo menos la duración; esto es la costumbre.
  db.exec('ALTER TABLE tipo_evento ADD COLUMN inicio_min TEXT');
  db.exec('ALTER TABLE tipo_evento ADD COLUMN inicio_max TEXT');

  const pon = db.prepare('UPDATE paquete_contenido SET horas_salon=?, minutos_estancia=? WHERE id=?');
  for (const c of porContenido.values()) pon.run(c.horas, estancia.has(c.id) ? 30 : 0, c.id);

  const franja = db.prepare('UPDATE tipo_evento SET inicio_min=?, inicio_max=? WHERE clave=?');
  for (const [clave, v] of Object.entries(FRANJA)) franja.run(v.min, v.max, clave);

  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('Falló, no se cambió nada:', e.message);
  process.exit(1);
}
console.log('\nListo.');
