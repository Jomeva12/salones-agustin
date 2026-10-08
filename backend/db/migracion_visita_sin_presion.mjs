// ============================================================================
//  La visita se ofrece cuando el prospecto ya esta satisfecho, no en cada
//  cotizacion.
//
//      node backend/db/migracion_visita_sin_presion.mjs
//
//  Idempotente.
//
//  Por que toca la base y no solo el prompt: la politica 46 decia «al final de
//  CADA cotizacion, invitar a visitarnos», y el agente la lee con
//  `incluir=agente`. Dejarla como estaba y cambiar solo el prompt le pone dos
//  ordenes opuestas delante, y el resultado no es que gane una: es que alterna
//  sin que se pueda predecir cual.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const db = new DatabaseSync(DB);

const TEMA = 'Cómo cerrar cada cotización';
const DETALLE =
  'La visita se ofrece cuando el prospecto ya tiene la información que vino a '
  + 'buscar, no en cada mensaje ni al pie de cada cotización. Primero se le '
  + 'atiende: se le contesta, se le manda la lámina del paquete, se le '
  + 'resuelven las dudas. Cuando ya está satisfecho, entonces se le invita a '
  + 'conocer el salón y se le menciona que ahí descubre cómo obtener más '
  + 'cortesías.';
const NOTAS =
  'Como máximo se menciona tres veces en toda la conversación. Si ya se '
  + 'ofreció dos veces y el prospecto no dijo que sí, no se vuelve a sacar: '
  + 'repetirla deja de sonar a invitación y empieza a sonar a presión. Esto '
  + 'corrige la versión anterior, que pedía invitar al final de CADA '
  + 'cotización y acabó convirtiendo la invitación en muletilla.';

const fila = db.prepare('SELECT id, detalle FROM politica WHERE tema = ?').get(TEMA);
if (!fila) {
  console.log('No encontré la política «Cómo cerrar cada cotización»; no toco nada.');
} else if (/ya está satisfecho/.test(fila.detalle ?? '')) {
  console.log(`La política ${fila.id} ya estaba corregida; sin tocar.`);
} else {
  db.prepare('UPDATE politica SET detalle = ?, notas = ? WHERE id = ?')
    .run(DETALLE, NOTAS, fila.id);
  console.log(`Política ${fila.id} reescrita: la visita va al final, no en cada cotización.`);
}
db.close();
