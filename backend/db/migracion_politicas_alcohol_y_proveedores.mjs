// ============================================================================
//  Dos politicas que hicieron escalar al agente sin necesidad.
//
//      node backend/db/migracion_politicas_alcohol_y_proveedores.mjs
//
//  Idempotente: no pisa un texto ya corregido desde el panel.
//
//  Nace de dos chats reales seguidos. Un cliente pregunto si podia llevar su
//  propio mariachi y otro si podia meter cerveza. Maya paso los dos a la
//  encargada. El primero era un dato que faltaba; el segundo YA ESTABA en la
//  politica 13 y en nueve servicios con precio — solo que escritos con otras
//  palabras. Cada escalada evitable es una venta que se enfria.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const db = new DatabaseSync(DB);

// ── 1. Proveedores externos: el dato que faltaba ────────────────────────────
//
// El detalle lleva a proposito las palabras con las que el cliente pregunta
// —mariachi, pastel, fotografo, DJ— y no solo «proveedor externo». La busqueda
// es por texto: si el cliente escribe «mariachi» y la politica solo dice
// «proveedores», no la encuentra y acaba escalando un dato que si existe.
const TEMA = '¿Se pueden contratar proveedores externos?';
const DETALLE =
  'Sí. Los salones proveen todo lo que incluye el paquete, pero el cliente '
  + 'puede traer sus propios proveedores si así lo prefiere: mariachi, grupo '
  + 'musical, DJ, pastel, fotógrafo, video, decoración, maquillista o '
  + 'animación. No se cobra nada por dejarlos entrar.';
const NOTAS =
  'Esto es sobre SERVICIOS. Los alimentos y las bebidas tienen su propia '
  + 'regla (ver «¿Se permite meter alimentos o bebidas externas?»): la cena no '
  + 'puede ser externa y el alcohol paga descorche. El pastel es la excepción '
  + 'conocida y sí se permite. Varios de estos servicios también se venden '
  + 'como sorpresa dentro del paquete; que el cliente pueda traer el suyo no '
  + 'quiere decir que no se le ofrezca el nuestro primero.';

const ya = db.prepare('SELECT id FROM politica WHERE tema = ?').get(TEMA);
if (ya) {
  console.log(`Proveedores externos: ya existía (id ${ya.id}); sin tocar.`);
} else {
  const r = db.prepare(
    `INSERT INTO politica (seccion, tema, detalle, notas, visibilidad)
     VALUES ('Politicas', ?, ?, ?, 'publico')`).run(TEMA, DETALLE, NOTAS);
  console.log(`Proveedores externos: agregada (id ${r.lastInsertRowid}).`);
}

// ── 2. Alcohol: el dato que SI estaba y no se encontraba ────────────────────
//
// La regla no cambia ni un ápice. Lo que cambia es el vocabulario: decía
// «bebidas alcohólicas» y el cliente escribe «cerveza», «caguama», «botella»,
// «tequila». Son las palabras con las que se busca, y sin ellas la politica
// es invisible justo cuando hace falta.
const TEMA_BEBIDAS = '¿Se permite meter alimentos o bebidas externas?';
const fila = db.prepare('SELECT id, detalle, notas FROM politica WHERE tema = ?').get(TEMA_BEBIDAS);

if (!fila) {
  console.log('Alcohol: no encontré la política de bebidas; no toco nada.');
} else if (/cerveza/i.test(fila.detalle ?? '')) {
  console.log(`Alcohol: la política ${fila.id} ya trae el vocabulario; sin tocar.`);
} else {
  const nuevoDetalle =
    'Sí se puede meter alcohol: cerveza, caguama, six, cartón, botella de '
    + 'tequila, whisky, vino o ron. Lo único es que se paga un descorche, que '
    + 'es el permiso municipal para introducirlo, y el costo depende de la '
    + 'presentación: desde $50 el six hasta $500 el cartón de caguamas. Las '
    + 'bebidas sin alcohol entran sin cobro. De comida solo se permite la '
    + 'rápida —hamburguesas, hotdogs, pizza—, nunca la cena.';
  const nuevasNotas =
    'Los precios exactos de cada descorche están en servicios, categoría '
    + 'Bebidas: búscalos por «descorche». Son nueve, uno por presentación. '
    + 'Para servir comida rápida en el momento de la cena tiene que venir '
    + 'empaquetada de manera individual. La cena no puede ser externa.';
  db.prepare('UPDATE politica SET detalle = ?, notas = ? WHERE id = ?')
    .run(nuevoDetalle, nuevasNotas, fila.id);
  console.log(`Alcohol: política ${fila.id} reescrita con las palabras del cliente.`);
}

const descorches = db.prepare(
  "SELECT count(*) c FROM servicio WHERE activo = 1 AND nombre LIKE '%escorche%'").get().c;
console.log(`${descorches} descorches con precio en servicios.`);
db.close();
