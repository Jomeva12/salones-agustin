// ============================================================================
//  La tabla de citas: visitas de prospectos y ensayos.
//
//      node backend/db/migracion_citas.mjs
//
//  Esto NO es migrar.mjs: no borra nada y corre sobre la base viva.
//
//  Visitas y ensayos van juntos porque ocupan el mismo recurso —el tiempo de
//  la encargada en ese salon—. Lo que cambia es que la visita trae un lead de
//  Kommo detras y el ensayo no: el ensayo es con alguien que YA contrato, un
//  mes antes de su evento, para repasar la logistica del dia.
//
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
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name='cita'").get();

db.exec(`
  CREATE TABLE IF NOT EXISTS cita (
    id           INTEGER PRIMARY KEY,
    salon_id     INTEGER NOT NULL REFERENCES salon(id) ON DELETE CASCADE,
    tipo         TEXT NOT NULL DEFAULT 'visita' CHECK (tipo IN ('visita','ensayo')),
    fecha        TEXT NOT NULL,
    hora         TEXT NOT NULL,
    minutos      INTEGER NOT NULL DEFAULT 60,
    lead_id      TEXT,
    nombre       TEXT,
    telefono     TEXT,
    estado       TEXT NOT NULL DEFAULT 'solicitada'
                 CHECK (estado IN ('solicitada','confirmada','asistio','no_asistio','cancelada')),
    notas        TEXT,
    creada_por   TEXT,
    creada_at    TEXT NOT NULL DEFAULT (datetime('now')),
    confirmada_at TEXT
  );
  CREATE INDEX IF NOT EXISTS cita_dia    ON cita (salon_id, fecha, hora);
  CREATE INDEX IF NOT EXISTS cita_estado ON cita (estado, fecha);
  CREATE INDEX IF NOT EXISTS cita_lead   ON cita (lead_id);
`);

console.log(habia ? 'La tabla ya existia; no se toco nada.' : 'Tabla cita creada.');
console.log(`${db.prepare('SELECT COUNT(*) n FROM cita').get().n} citas registradas.`);
