// ============================================================================
//  Cada publicacion de un aviso deja su propio rastro.
//
//      node backend/db/migracion_mensajes_del_aviso.mjs
//
//  Idempotente.
//
//  Un aviso no se publica una vez: se publica y se repite. Guardando el
//  message_id en una columna de `aviso`, cada recordatorio pisaba al anterior
//  y solo se podia contestar al ULTIMO mensaje del grupo. En un grupo donde el
//  mismo aviso aparece cuatro veces, quien responde elige cualquiera de los
//  cuatro —normalmente el que tiene delante— y tres de cada cuatro veces la
//  respuesta se perderia en silencio.
//
//  Con una fila por publicacion, responder a cualquiera de ellas lleva al
//  mismo aviso. La columna en `aviso` se queda: sigue siendo util para saber
//  cual fue la ultima vez que se publico.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const db = new DatabaseSync(DB);

const ya = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='aviso_mensaje'").get();
if (ya) {
  console.log('  ya estaba   tabla aviso_mensaje');
} else {
  db.exec(`
    CREATE TABLE aviso_mensaje (
      chat_id    TEXT    NOT NULL,
      message_id INTEGER NOT NULL,
      aviso_id   INTEGER NOT NULL REFERENCES aviso(id),
      creado_en  TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (chat_id, message_id)
    )`);
  db.exec('CREATE INDEX idx_aviso_mensaje_aviso ON aviso_mensaje (aviso_id)');
  console.log('  creada      tabla aviso_mensaje');
}

// Lo que ya se habia publicado con el esquema anterior no se tira: se sube a
// la tabla nueva para que esos mensajes sigan sirviendo.
const traidos = db.prepare(
  `INSERT OR IGNORE INTO aviso_mensaje (chat_id, message_id, aviso_id)
   SELECT telegram_chat_id, telegram_message_id, id
     FROM aviso
    WHERE telegram_message_id IS NOT NULL AND telegram_chat_id IS NOT NULL`).run();
console.log(`  rescatados  ${traidos.changes} mensajes ya publicados`);
console.log(`\n${db.prepare('SELECT COUNT(*) n FROM aviso_mensaje').get().n} mensajes mapeados.`);
db.close();
