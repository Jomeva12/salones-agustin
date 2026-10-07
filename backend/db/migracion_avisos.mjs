// ============================================================================
//  La tabla de avisos: lo que el agente no pudo resolver y le toca a alguien.
//
//      node backend/db/migracion_avisos.mjs
//
//  Esto NO es migrar.mjs: no borra nada y corre sobre la base viva.
//  Es idempotente.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const db = new DatabaseSync(DB);
const habia = !!db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name='aviso'").get();

db.exec(`
  CREATE TABLE IF NOT EXISTS aviso (
    id             INTEGER PRIMARY KEY,
    salon_id       INTEGER REFERENCES salon(id),
    lead_id        TEXT,
    motivo         TEXT NOT NULL,
    texto          TEXT NOT NULL,
    estado         TEXT NOT NULL DEFAULT 'pendiente'
                   CHECK (estado IN ('pendiente','atendido')),
    creado_en      TEXT NOT NULL DEFAULT (datetime('now')),
    ultimo_aviso_en TEXT,
    recordatorios  INTEGER NOT NULL DEFAULT 0,
    atendido_en    TEXT,
    atendido_por   TEXT
  );
  CREATE INDEX IF NOT EXISTS aviso_pendientes ON aviso (estado, creado_en);
  CREATE INDEX IF NOT EXISTS aviso_lead       ON aviso (lead_id);
`);

console.log(habia ? 'La tabla ya existia; no se toco nada.' : 'Tabla aviso creada.');
const n = db.prepare("SELECT COUNT(*) n FROM aviso WHERE estado='pendiente'").get().n;
console.log(`${n} avisos pendientes.`);
