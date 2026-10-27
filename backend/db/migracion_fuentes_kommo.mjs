// ============================================================================
//  De que pagina de Facebook viene cada salon.
//
//      node backend/db/migracion_fuentes_kommo.mjs
//
//  Idempotente.
//
//  Al vincular las paginas el 27-oct-2026 aparecieron SEIS fuentes y no tres:
//  cada pagina crea dos canales en Kommo, el Messenger y los Comentarios. El
//  `source_id` del lead es lo unico que dice por donde entro, porque el
//  webhook solo manda `origin: facebook`.
//
//  Guardarlo aqui sirve para tres cosas que vienen despues: saber de que salon
//  es un cliente sin preguntarselo, repartir el aviso al grupo correcto, y
//  asignar al responsable que toca.
//
//  OJO con los comentarios: un mensaje que entra por un canal de Comentarios
//  NO es un privado. Contestarlo es contestar en publico, con el precio a la
//  vista de cualquiera. Por eso se guarda el tipo y no solo el id.
//
//  Y falta Esmeralda: tres paginas para cuatro salones.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const FUENTES = {
  santacruz: [
    { id: 21764, canal: 'messenger',   pagina: 'Santa Cruz Eventos',  fb: '206055262587762' },
    { id: 21766, canal: 'comentarios', pagina: 'Santa Cruz Eventos' },
  ],
  quetzal: [
    { id: 21768, canal: 'messenger',   pagina: 'Quetzal Eventos',     fb: '107420285608891' },
    { id: 21770, canal: 'comentarios', pagina: 'Quetzal Eventos' },
  ],
  norma: [
    { id: 21772, canal: 'messenger',   pagina: 'Centro Social Norma', fb: '508961825937980' },
    { id: 21774, canal: 'comentarios', pagina: 'Centro Social Norma' },
  ],
};

const db = new DatabaseSync(DB);

const cols = db.prepare('PRAGMA table_info(salon)').all().map((c) => c.name);
if (!cols.includes('fuentes_kommo')) {
  db.exec('ALTER TABLE salon ADD COLUMN fuentes_kommo TEXT');
  console.log('  agregada    columna fuentes_kommo');
} else {
  console.log('  ya estaba   columna fuentes_kommo');
}

let puestas = 0;
for (const [clave, fuentes] of Object.entries(FUENTES)) {
  const s = db.prepare('SELECT id, nombre, fuentes_kommo FROM salon WHERE clave = ?').get(clave);
  if (!s) { console.log(`  !! no existe el salón ${clave}`); continue; }
  const nuevo = JSON.stringify(fuentes);
  if (s.fuentes_kommo === nuevo) { console.log(`  ya estaba   ${s.nombre}`); continue; }
  db.prepare('UPDATE salon SET fuentes_kommo = ? WHERE id = ?').run(nuevo, s.id);
  console.log(`  puestas     ${s.nombre} -> ${fuentes.map((f) => f.id).join(', ')}`);
  puestas++;
}

console.log(`\n${puestas} salones con fuentes.`);
for (const r of db.prepare('SELECT nombre, fuentes_kommo FROM salon ORDER BY id').all()) {
  const f = r.fuentes_kommo ? JSON.parse(r.fuentes_kommo) : [];
  console.log(`  ${r.nombre.padEnd(20)} ` + (f.length
    ? f.map((x) => `${x.id} (${x.canal})`).join(' · ')
    : '*** SIN PÁGINA CONECTADA ***'));
}
db.close();
