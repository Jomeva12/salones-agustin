// ============================================================================
//  Las palabras con que la gente pide un servicio, en el servicio.
//
//      node backend/db/migracion_vocabulario_servicios.mjs
//
//  Idempotente.
//
//  La busqueda de `servicios` es literal sobre nombre, contenido, notas y
//  categoria. Eso basta cuando el cliente usa el nombre del catalogo, y falla
//  justo cuando no: pregunto «cuanto cuesta un invitado adicional», el agente
//  busco eso, no encontro nada, y en vez de buscar otra palabra se lo
//  invento — «depende del paquete», que ademas es falso: son $1,000 o $2,000
//  fijos, sin importar el paquete.
//
//  La politica ya tiene ese vocabulario. Faltaba en el servicio, que es donde
//  esta el precio.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const db = new DatabaseSync(DB);

// La coletilla se añade a las notas, que es un campo interno: el agente lo
// lee para encontrar el servicio, pero lo que le dice al cliente lo redacta
// con el nombre y lo que incluye.
const COMO_LO_PIDEN = {
  'Mesa extra sencilla':
    'Se pregunta así: invitado adicional, invitados de más, persona extra, gente de más, '
    + 'me caben más, silla extra, cupo para más invitados, mesa de más.',
  'Mesa extra completa':
    'Se pregunta así: invitado adicional, invitados de más, persona extra, gente de más, '
    + 'me caben más, silla extra, cupo para más invitados, mesa de más, con comida.',
};

const MARCA = 'Se pregunta así:';
let tocados = 0, yaEstaban = 0, sinEncontrar = 0;

for (const [nombre, coletilla] of Object.entries(COMO_LO_PIDEN)) {
  const s = db.prepare('SELECT id, notas FROM servicio WHERE nombre = ? AND activo = 1').get(nombre);
  if (!s) { console.log(`  no encontré «${nombre}»`); sinEncontrar++; continue; }
  if ((s.notas ?? '').includes(MARCA)) { console.log(`  ya estaba  ${nombre}`); yaEstaban++; continue; }
  const notas = [s.notas, coletilla].filter(Boolean).join(' ');
  db.prepare('UPDATE servicio SET notas = ? WHERE id = ?').run(notas, s.id);
  console.log(`  listo      ${nombre}`);
  tocados++;
}

console.log(`\n${tocados} servicios con el vocabulario de quien pregunta`
  + `${yaEstaban ? `, ${yaEstaban} ya lo tenían` : ''}`
  + `${sinEncontrar ? `, ${sinEncontrar} no se encontraron` : ''}.`);
db.close();
