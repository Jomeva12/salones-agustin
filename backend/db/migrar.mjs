// ============================================================================
//  Crea salones.db desde cero y carga la semilla.
//      node backend/db/migrar.mjs
//  Es destructivo: borra la base anterior. Los datos vivos se editan por el
//  frontend, no por aquí.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ventana, normalizarHora } from '../api/logica.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SEED = join(AQUI, 'seed');
const DB = join(AQUI, 'salones.db');

const leer = (n) => JSON.parse(readFileSync(join(SEED, `${n}.json`), 'utf8'));

if (!existsSync(SEED)) {
  console.error('No existe la carpeta seed/. Corre primero:\n  python backend/db/exportar_seed.py');
  process.exit(1);
}

try {
  for (const suf of ['', '-wal', '-shm']) {
    if (existsSync(DB + suf)) unlinkSync(DB + suf);
  }
} catch (e) {
  if (e.code === 'EBUSY' || e.code === 'EPERM') {
    console.error('\n  La base está abierta por otro proceso: detén el servidor y vuelve a correr.\n');
    console.error('  Windows:  Get-Process node | Stop-Process -Force');
    console.error('  Linux/Mac: pkill -f backend/server.js\n');
    process.exit(1);
  }
  throw e;
}

const db = new DatabaseSync(DB);
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');
db.exec(readFileSync(join(AQUI, 'esquema.sql'), 'utf8'));

/** Inserta un arreglo de objetos en una tabla, usando sus llaves como columnas. */
function cargar(tabla, filas, columnas) {
  if (!filas.length) return 0;
  const cols = columnas ?? Object.keys(filas[0]);
  const sql = `INSERT INTO ${tabla} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  const st = db.prepare(sql);
  let n = 0, rechazadas = [];
  for (const f of filas) {
    try {
      st.run(...cols.map((c) => {
        const v = f[c];
        return v === undefined ? null : (typeof v === 'boolean' ? (v ? 1 : 0) : v);
      }));
      n++;
    } catch (e) {
      rechazadas.push({ fila: f, error: e.message });
    }
  }
  const aviso = rechazadas.length ? `   ${rechazadas.length} rechazadas` : '';
  console.log(`  ${tabla.padEnd(30)} ${String(n).padStart(5)}${aviso}`);
  if (rechazadas.length) {
    for (const r of rechazadas.slice(0, 3)) console.log(`      · ${r.error}`);
    if (rechazadas.length > 3) console.log(`      · ...y ${rechazadas.length - 3} más`);
  }
  return n;
}

console.log(`Creando ${DB}\n`);
db.exec('BEGIN');
cargar('salon', leer('salon'));
cargar('escalon', leer('escalon'));
cargar('tipo_evento', leer('tipo_evento'));
cargar('paquete', leer('paquete'));
cargar('paquete_tipo_evento', leer('paquete_tipo_evento'));
cargar('concepto', leer('concepto'));
cargar('paquete_contenido', leer('paquete_contenido'));
cargar('paquete_contenido_concepto', leer('paquete_contenido_concepto'));
cargar('tarifa', leer('tarifa'));
// La semilla trae la hora como la escribió el equipo («8:00 pm»). El tramo
// comparable se calcula aquí, con la misma función que usa el API, para que
// una base recién creada y una migrada en sitio queden idénticas.
cargar('compromiso', leer('compromiso').map((c) => ({
  ...c,
  // El texto también se normaliza: la semilla trae «13:00 pm» de la captura
  // original, y el panel ya no permite escribir nada parecido.
  hora_inicio: normalizarHora(c.hora_inicio),
  hora_fin: normalizarHora(c.hora_fin),
  ...ventana(c.fecha, c.hora_inicio, c.hora_fin),
})));
cargar('control_agenda', leer('control_agenda'));
cargar('servicio', leer('servicio'));
cargar('servicio_salon', leer('servicio_salon'));
cargar('faq', leer('faq'));
cargar('politica', leer('politica'));
db.exec('COMMIT');

// ── comprobaciones de integridad ────────────────────────────────────────────
const uno = (sql) => db.prepare(sql).get();
console.log('\nComprobaciones:');

const fk = db.prepare('PRAGMA foreign_key_check').all();
console.log(`  llaves foráneas rotas .......... ${fk.length}`);

const rev = uno('SELECT COUNT(*) n FROM tarifa WHERE requiere_revision = 1').n;
console.log(`  tarifas que requieren revisión .. ${rev}`);

const huerf = uno(`SELECT COUNT(*) n FROM tarifa t
                   LEFT JOIN paquete_contenido c ON c.id = t.contenido_id
                   WHERE c.id IS NULL`).n;
console.log(`  tarifas sin contenido ligado .... ${huerf}`);

const traslape = uno(`
  SELECT COUNT(*) n FROM tarifa a JOIN tarifa b
    ON a.id < b.id
   AND a.salon_id = b.salon_id AND a.paquete_id = b.paquete_id
   AND a.anio = b.anio
   AND IFNULL(a.escalon_id,-1) = IFNULL(b.escalon_id,-1)
   AND a.personas_desde <= b.personas_hasta
   AND b.personas_desde <= a.personas_hasta
   AND a.requiere_revision = 0 AND b.requiere_revision = 0`).n;
console.log(`  traslapes entre tarifas vigentes . ${traslape}`);

const sinConcepto = uno(`SELECT COUNT(*) n FROM paquete_contenido c
                         LEFT JOIN paquete_contenido_concepto x ON x.contenido_id = c.id
                         WHERE x.contenido_id IS NULL`).n;
console.log(`  contenidos sin ningún concepto ... ${sinConcepto}`);

for (const r of db.prepare('SELECT visibilidad, COUNT(*) n FROM politica GROUP BY visibilidad ORDER BY visibilidad').all())
  console.log(`  políticas «${r.visibilidad}» ${'.'.repeat(Math.max(1, 22 - r.visibilidad.length))} ${r.n}`);
// Marcas de lo que nunca debe quedar en una politica publica. El numero
// privado del Lic. NO va aqui escrito: se toma de la politica 40, que es
// donde vive. Asi el detector sigue funcionando sin copiarlo al codigo.
const privado = db.prepare("SELECT detalle FROM politica WHERE id = 40").get()?.detalle ?? '';
const telefono = (privado.match(/\d{10}/) ?? [''])[0];
const marcas = ['banregio', '@gmail', ...(telefono ? [telefono] : [])];
const fuga = marcas.reduce((n, m) => n + db.prepare(
  "SELECT COUNT(*) n FROM politica WHERE visibilidad='publico' AND detalle LIKE ?"
).get('%' + m + '%').n, 0);
console.log(`  datos sensibles marcados como públicos ${fuga === 0 ? '0  (bien)' : fuga + '  ¡REVISAR!'}`);

console.log('\nListo. Arranca con:  npm start');
db.close();
