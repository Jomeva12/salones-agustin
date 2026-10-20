// ============================================================================
//  Que se pueda RESPONDER a un aviso en el grupo y la respuesta llegue al
//  cliente.
//
//      node backend/db/migracion_respuesta_en_el_grupo.mjs
//
//  Idempotente.
//
//  Lo pidio el Lic. Barron el 20-oct-2026: que cuando Maya pregunte algo en el
//  grupo —una cita, sobre todo— la encargada pueda contestarle ahi mismo y la
//  respuesta le llegue al cliente sin que nadie abra Kommo.
//
//  La pieza que lo hace posible la da Telegram sola: al publicar un aviso
//  devuelve su `message_id`, y cuando alguien usa «Responder a este mensaje»,
//  lo que llega trae `reply_to_message.message_id`. Guardando ese numero junto
//  al aviso, la respuesta queda amarrada al lead sin ambiguedad: no hay que
//  adivinar de que cliente hablaba, ni leer el resto del grupo.
//
//  El `chat_id` se guarda tambien, y no sobra: el message_id es unico DENTRO
//  de un chat, no entre chats. Hoy todos los avisos van a un grupo, pero cada
//  salon va a tener el suyo, y entonces el 923 de Norma y el 923 de Esmeralda
//  serian el mismo numero apuntando a dos leads distintos.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const db = new DatabaseSync(DB);

const COLUMNAS = [
  ['telegram_chat_id', 'TEXT'],
  ['telegram_message_id', 'INTEGER'],
  // Lo que escribio la encargada, tal cual. Se guarda aunque Maya lo redacte
  // para el cliente: si manana alguien discute que se le dijo, lo que vale es
  // esto y no la version redactada.
  ['respuesta', 'TEXT'],
  ['respondido_por', 'TEXT'],
  ['respondido_en', 'TEXT'],
  // Lo que Maya acabo diciendole al cliente.
  ['respuesta_al_cliente', 'TEXT'],
];

const hay = db.prepare('PRAGMA table_info(aviso)').all().map((c) => c.name);
let puestas = 0;
for (const [col, tipo] of COLUMNAS) {
  if (hay.includes(col)) { console.log(`  ya estaba   ${col}`); continue; }
  db.exec(`ALTER TABLE aviso ADD COLUMN ${col} ${tipo}`);
  console.log(`  agregada    ${col}`);
  puestas++;
}

// Buscar un aviso por el mensaje al que contestaron es la consulta del camino
// critico: corre con cada respuesta en el grupo.
const idx = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_aviso_telegram'").get();
if (idx) {
  console.log('  ya estaba   indice idx_aviso_telegram');
} else {
  db.exec(`CREATE INDEX idx_aviso_telegram
             ON aviso (telegram_chat_id, telegram_message_id)`);
  console.log('  agregado    indice idx_aviso_telegram');
  puestas++;
}

console.log(`\n${puestas} cambios.`);
console.log(`${db.prepare('SELECT COUNT(*) n FROM aviso').get().n} avisos en la tabla.`);
db.close();
