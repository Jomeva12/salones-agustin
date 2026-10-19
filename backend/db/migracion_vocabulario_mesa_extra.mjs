// ============================================================================
//  El vocabulario con que la gente pregunta por la mesa extra.
//
//      node backend/db/migracion_vocabulario_mesa_extra.mjs
//
//  Idempotente.
//
//  La politica se llama «Costo por persona adicional» y explica que NO se
//  cobra por persona sino por mesa. El problema es justo ese: quien pregunta
//  dice «cuanto cuesta un invitado adicional» o «me caben dos personas mas»,
//  y ninguna de esas palabras estaba en el texto. La busqueda es literal, asi
//  que la politica era invisible en la pregunta que la estrena.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const db = new DatabaseSync(DB);
const TEMA = 'Costo por persona adicional';

const NOTAS =
  'Se puede agregar hasta un día antes del evento. Así lo pregunta la gente: '
  + 'invitado adicional, invitados de más, persona extra, gente de más, me '
  + 'caben más, silla extra, cupo para más invitados. Los precios y lo que '
  + 'incluye cada mesa están también en servicios, categoría Mobiliario: '
  + '«Mesa extra sencilla» y «Mesa extra completa», con la restricción de que '
  + 'lo que el paquete traiga aparte (arreglos, pastel, tiempo extra) no se '
  + 'incluye en la mesa extra y se contrata por separado.';

const fila = db.prepare('SELECT id, notas FROM politica WHERE tema = ?').get(TEMA);
if (!fila) {
  console.log('No encontré la política «' + TEMA + '»; no toco nada.');
} else if (/invitado adicional/i.test(fila.notas ?? '')) {
  console.log(`La política ${fila.id} ya trae el vocabulario; sin tocar.`);
} else {
  db.prepare('UPDATE politica SET notas = ? WHERE id = ?').run(NOTAS, fila.id);
  console.log(`Política ${fila.id} con el vocabulario de quien pregunta.`);
}
db.close();
