// ============================================================================
//  Cada salon tiene su propio numero de WhatsApp y su propio usuario de Kommo.
//
//      node backend/db/migracion_whatsapp_por_salon.mjs
//
//  Idempotente.
//
//  El 5-nov-2026 se vincularon los cuatro numeros. Desde entonces, por donde
//  entra un cliente dice de que salon es, sin tener que preguntarselo:
//
//      +52 1 81 8692 6400  ->  Norma        (fuente 22494)
//      +52 1 81 8691 7220  ->  Esmeralda    (fuente 22564)
//      +52 1 81 2004 1207  ->  Santa Cruz   (fuente 22496)
//      +52 1 81 1010 7131  ->  Quetzal      (fuente 22498)
//
//  El numero NO viaja en el webhook: lo unico que manda Kommo es
//  `origin: waba`. Lo que si queda grabado en el lead es el `source_id`, y por
//  eso el enrutado se hace con el, no con el telefono.
//
//  Los ids de fuente salieron de la propia lista de canales de Kommo
//  (`/ajax/v4/sources`), donde cada uno trae el nombre que le puso Agustin al
//  conectarlo — «Norma Eventos», «Santa Cruz eventos», «Quetzal Eventos»,
//  «esmeraldaeventos762». La correspondencia numero <-> salon es la que paso
//  Jorge; la de fuente <-> salon es la que dice Kommo. Las dos coinciden salon
//  por salon.
//
//  Y cada salon tiene ademas su USUARIO en Kommo, que es a quien se le asigna
//  el lead. Antes todos caian en «Asesora Ana» (13666384), que es el usuario
//  de la integracion: con todos los leads del mismo dueño, ninguna encargada
//  distinguia los suyos.
//
//  OJO con los canales de Comentarios de Facebook: un mensaje que entra por
//  ahi NO es un privado. Por eso se guarda el canal y no solo el id.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

// Lo de Facebook ya estaba (migracion_fuentes_kommo.mjs); se repite aqui
// entero a proposito, porque esta tabla es la lista COMPLETA de puertas de
// entrada de cada salon y leerla a medias seria peor que no leerla.
const SALONES = {
  norma: {
    usuario_kommo: 16027263,
    telefono: '+5218186926400',
    fuentes: [
      { id: 22494, canal: 'whatsapp',    numero: '+5218186926400', nombre: 'Norma Eventos' },
      { id: 21772, canal: 'messenger',   pagina: 'Centro Social Norma', fb: '508961825937980' },
      { id: 21774, canal: 'comentarios', pagina: 'Centro Social Norma' },
    ],
  },
  esmeralda: {
    usuario_kommo: 16027259,
    telefono: '+5218186917220',
    fuentes: [
      { id: 22564, canal: 'whatsapp',    numero: '+5218186917220', nombre: 'esmeraldaeventos762' },
    ],
  },
  santacruz: {
    usuario_kommo: 16027243,
    telefono: '+5218120041207',
    fuentes: [
      { id: 22496, canal: 'whatsapp',    numero: '+5218120041207', nombre: 'Santa Cruz eventos' },
      { id: 21764, canal: 'messenger',   pagina: 'Santa Cruz Eventos', fb: '206055262587762' },
      { id: 21766, canal: 'comentarios', pagina: 'Santa Cruz Eventos' },
    ],
  },
  quetzal: {
    usuario_kommo: 16027255,
    telefono: '+5218110107131',
    fuentes: [
      { id: 22498, canal: 'whatsapp',    numero: '+5218110107131', nombre: 'Quetzal Eventos' },
      { id: 21768, canal: 'messenger',   pagina: 'Quetzal Eventos', fb: '107420285608891' },
      { id: 21770, canal: 'comentarios', pagina: 'Quetzal Eventos' },
    ],
  },
};

const db = new DatabaseSync(DB);
const cols = db.prepare('PRAGMA table_info(salon)').all().map((c) => c.name);
for (const [col, tipo] of [['fuentes_kommo', 'TEXT'],
                           ['usuario_kommo_id', 'INTEGER'],
                           ['telefono_whatsapp', 'TEXT']]) {
  if (cols.includes(col)) { console.log(`  ya estaba   columna ${col}`); continue; }
  db.exec(`ALTER TABLE salon ADD COLUMN ${col} ${tipo}`);
  console.log(`  agregada    columna ${col}`);
}

for (const [clave, d] of Object.entries(SALONES)) {
  const s = db.prepare(
    'SELECT id, nombre, fuentes_kommo, usuario_kommo_id, telefono_whatsapp FROM salon WHERE clave = ?')
    .get(clave);
  if (!s) { console.log(`  !! no existe el salón ${clave}`); continue; }
  const nuevo = JSON.stringify(d.fuentes);
  const igual = s.fuentes_kommo === nuevo
    && Number(s.usuario_kommo_id) === d.usuario_kommo
    && s.telefono_whatsapp === d.telefono;
  if (igual) { console.log(`  ya estaba   ${s.nombre}`); continue; }
  db.prepare(`UPDATE salon SET fuentes_kommo = ?, usuario_kommo_id = ?,
              telefono_whatsapp = ? WHERE id = ?`)
    .run(nuevo, d.usuario_kommo, d.telefono, s.id);
  console.log(`  puesto      ${s.nombre}`);
}

// ── Comprobación ────────────────────────────────────────────────────────────
//
// Dos cosas que tienen que cumplirse y que un vistazo rapido no garantiza:
// que ningun salon se quede sin WhatsApp, y que ninguna fuente este repetida
// en dos salones — un id duplicado mandaria los leads de uno al otro sin que
// nadie lo note.
console.log('\nComprobación — por dónde entra cada salón:');
const vistas = new Map();
let mal = 0;
for (const r of db.prepare(
  `SELECT nombre, clave, fuentes_kommo, usuario_kommo_id, telefono_whatsapp
     FROM salon WHERE activo = 1 ORDER BY id`).all()) {
  const f = r.fuentes_kommo ? JSON.parse(r.fuentes_kommo) : [];
  const wa = f.filter((x) => x.canal === 'whatsapp');
  console.log(`  ${r.nombre.padEnd(20)} usuario ${String(r.usuario_kommo_id ?? '—').padEnd(10)}`
    + `${(r.telefono_whatsapp ?? '*** SIN WHATSAPP ***').padEnd(16)} `
    + (f.length ? f.map((x) => `${x.id}/${x.canal}`).join(' · ') : '*** SIN FUENTES ***'));
  if (wa.length !== 1) { console.log('     !! debería tener exactamente un WhatsApp'); mal++; }
  if (!r.usuario_kommo_id) { console.log('     !! sin usuario de Kommo'); mal++; }
  for (const x of f) {
    if (vistas.has(x.id)) { console.log(`     !! la fuente ${x.id} ya es de ${vistas.get(x.id)}`); mal++; }
    vistas.set(x.id, r.clave);
  }
}
console.log(mal ? `\n${mal} problema(s).` : '\nTodo cuadra.');
db.close();
