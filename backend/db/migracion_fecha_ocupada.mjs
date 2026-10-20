// ============================================================================
//  Que decir, y en que orden, cuando la fecha esta ocupada.
//
//      node backend/db/migracion_fecha_ocupada.mjs
//
//  Idempotente.
//
//  El Lic. lo pidio el 20-oct-2026 viendo un chat suyo: estaba bien decir que
//  la fecha estaba ocupada, pero el agente saltaba de ahi a «tienes libres
//  Esmeralda y Santa Cruz» sin explicar antes que son un grupo de cuatro
//  salones muy cerca uno del otro. Sin esa frase, ofrecer otro salon suena a
//  que lo mandan a otra empresa.
//
//  Y si no hay fecha en ninguno, lo que toca no es despedirse: es ofrecer
//  otra fecha del salon por el que entro el mensaje.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const db = new DatabaseSync(DB);
const TEMA = 'Venta cruzada entre salones';

const DETALLE =
  'Si la fecha está ocupada en un salón, el orden del mensaje importa y es '
  + 'este: 1) se le dice que esa fecha ya está tomada; 2) ANTES de ofrecer '
  + 'otro salón, se le comenta que somos un grupo de cuatro salones muy cerca '
  + 'uno del otro, todos en Guadalupe; 3) recién entonces se le dice en cuál '
  + 'sí está libre esa fecha. Si no está libre en ninguno de los cuatro, no '
  + 'se cierra la conversación: se le ofrecen otras fechas disponibles del '
  + 'salón por el que entró su mensaje. Sólo tomar en consideración que Norma '
  + 'Eventos, Esmeralda Eventos y Santa Cruz Eventos su mínimo de capacidad '
  + 'es de 100 invitados y el máximo de 300. A diferencia del salón Quetzal '
  + 'Eventos que el mínimo es de 50 y máximo de 150.';

const NOTAS =
  'Petición expresa del Lic. Barrón; la de los cuatro salones la precisó el '
  + '20-oct-2026 viendo un chat real. Sin esa frase, ofrecer otro salón suena '
  + 'a que se lo mandan a otra empresa, y esa venta se pierde. Santa Cruz y '
  + 'Quetzal comparten dirección; Norma y Esmeralda están a unos minutos.';

const fila = db.prepare('SELECT id, detalle FROM politica WHERE tema = ?').get(TEMA);
if (!fila) {
  console.log(`No encontré la política «${TEMA}»; no toco nada.`);
} else if (/grupo de cuatro salones/.test(fila.detalle ?? '')) {
  console.log(`La política ${fila.id} ya lo dice; sin tocar.`);
} else {
  db.prepare('UPDATE politica SET detalle = ?, notas = ? WHERE id = ?').run(DETALLE, NOTAS, fila.id);
  console.log(`Política ${fila.id} reescrita con el orden del mensaje.`);
}
db.close();
