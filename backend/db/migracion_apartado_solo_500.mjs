// ============================================================================
//  Del apartado, el agente solo dice los $500.
//
//      node backend/db/migracion_apartado_solo_500.mjs
//
//  Idempotente.
//
//  El Lic. lo pidio el 20-oct-2026: que mencione que son $500 para separar la
//  fecha y nada mas. Ni los 7 dias, ni los $1,500 del contrato, ni que el
//  anticipo no se regresa. Quien pregunta «como aparto» quiere saber cuanto
//  cuesta empezar; la letra chica la ve con la encargada, que es quien puede
//  explicarla y cerrar.
//
//  La letra chica NO se borra: se mueve a una politica `restringido`. Eso no
//  es un matiz — el agente consulta con `incluir=agente`, que trae `publico` y
//  `regla_interna` pero NUNCA `restringido`. Dejarla en las notas de una
//  politica publica habria sido pedirle al modelo que no la lea, y eso no es
//  una garantia: es una esperanza.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const db = new DatabaseSync(DB);

const PUBLICO =
  'Se puede apartar una fecha con tan solo $500. Con eso la fecha se bloquea '
  + 'para que no pueda ser vendida a nadie más. A partir de ahí el seguimiento '
  + 'lo hace la encargada.';
const NOTAS_PUBLICO =
  'El agente SOLO menciona los $500. Las condiciones del apartado —el plazo, '
  + 'el monto del contrato y qué pasa si no acude— están en la política '
  + 'restringida «Condiciones del apartado», que el agente no ve. Petición '
  + 'expresa del Lic. Barrón el 20-oct-2026.';

const TEMA_CHICA = 'Condiciones del apartado (no las dice el agente)';
const CHICA =
  'El cliente tiene 7 días (una semana) desde que aparta para realizar su '
  + 'contrato, que se hace con $1,500; en ese momento el evento queda '
  + 'formalmente contratado. Si no acude dentro de esos 7 días, se desbloquea '
  + 'la fecha, no se reembolsa el anticipo con que se separó y la fecha puede '
  + 'volver a venderse. Ni el anticipo ni la cantidad con que se realizó el '
  + 'contrato son reembolsables.';

let hechos = 0;

const p1 = db.prepare("SELECT id, detalle FROM politica WHERE tema = 'Anticipo para apartar fecha'").get();
if (!p1) {
  console.log('No encontré «Anticipo para apartar fecha».');
} else if (!/7 días/.test(p1.detalle ?? '')) {
  console.log('La política 1 ya estaba recortada; sin tocar.');
} else {
  db.prepare('UPDATE politica SET detalle = ?, notas = ? WHERE id = ?')
    .run(PUBLICO, NOTAS_PUBLICO, p1.id);
  console.log(`Política ${p1.id} recortada: solo los $500.`);
  hechos++;
}

const ya = db.prepare('SELECT id FROM politica WHERE tema = ?').get(TEMA_CHICA);
if (ya) {
  console.log(`La letra chica ya existe (id ${ya.id}); sin tocar.`);
} else {
  const r = db.prepare(
    `INSERT INTO politica (seccion, tema, detalle, notas, visibilidad)
     VALUES ('Politicas', ?, ?, ?, 'restringido')`)
    .run(TEMA_CHICA, CHICA,
      'Restringida a propósito: el agente consulta con incluir=agente y no la '
      + 'recibe. Está aquí para el equipo y para el panel.');
  console.log(`Letra chica guardada aparte (id ${r.lastInsertRowid}), restringida.`);
  hechos++;
}

// La política de cancelación lleva en sus notas la misma frase prohibida, y
// esa política SÍ la ve el agente.
const p8 = db.prepare("SELECT id, notas FROM politica WHERE tema = 'Política de cancelación'").get();
if (p8 && /no son reembolsables/.test(p8.notas ?? '')) {
  db.prepare('UPDATE politica SET notas = ? WHERE id = ?').run(
    'Si operare el reembolso, será indispensable que el cliente entregue '
    + 'absolutamente todos los originales de los recibos y contrato. Lo que no '
    + 'se reembolsa está en la política restringida «Condiciones del apartado»: '
    + 'el agente no lo menciona.', p8.id);
  console.log(`Política ${p8.id}: fuera de sus notas la frase del anticipo.`);
  hechos++;
}

console.log(`\n${hechos} cambios.`);
db.close();
