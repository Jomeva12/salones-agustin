// ============================================================================
//  Quetzal: el paquete de aniversarios pasa a llamarse Bronce, y el Bronce de
//  bodas desaparece.
//
//      node backend/db/migracion_quetzal_bronce.mjs
//
//  Idempotente.
//
//  Lo explico porque el porque no se deduce de los datos. El Lic. Barron, el
//  23-oct-2026:
//
//    «Para bodas y 15 años, que es nuestro mercado 80-85%, usamos el bronce,
//     el ónix, el plata y el oro. Se pueden utilizar para aniversarios y
//     cumpleaños, pero son costos muy altos... La diferencia está en lo que
//     incluye el paquete. En el Quetzal, como es un salón pequeño, sería nada
//     más el bronce, ónix y plata.
//
//     El precio del bronce en el Quetzal ya me estaba pasando el costo del
//     bronce del Santa Cruz, cuando el Santa Cruz es más grande y por lógica
//     tendría que ser más caro. Por eso opté por quitar el bronce de bodas y
//     15 años en el Quetzal, y dejé el paquete aniversario-cumpleaños en
//     costo pero le cambié el nombre a bronce.»
//
//  O sea: en Quetzal, un cumpleaños y una boda agarran el MISMO Bronce —el
//  economico—, y quien quiera algo mas completo sube al Onix o al Plata.
//
//  AQUI NO SE CARGA NI UN PRECIO. Las 33 tarifas ya existen con sus importes,
//  sus escalones y sus cortesias: lo unico que cambia es de que paquete
//  cuelgan y para que tipos de evento se ofrecen.
//
//  De paso cierra un agujero que llevaba abierto desde el principio: el
//  Bronce, Onix, Plata y Oro no estaban disponibles para aniversarios ni
//  cumpleaños en NINGUN salon, y el unico paquete que lo cubria —el de
//  aniversarios— solo existia en Quetzal. Un cumpleaños en Norma no tenia
//  nada que cotizar. El 22-oct un cliente pidio uno y el sistema tuvo que
//  escalarlo porque «no hay tarifa disponible en ninguno de los salones».
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const db = new DatabaseSync(DB);
const HOY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Monterrey', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const uno = (sql, ...a) => db.prepare(sql).get(...a);
const quetzal = uno("SELECT id FROM salon WHERE clave = 'quetzal'");
const bronce = uno("SELECT id FROM paquete WHERE nombre = 'Paquete Bronce'");
const aniversarios = uno("SELECT id FROM paquete WHERE nombre = 'Paquete Aniversarios / Cumpleaños'");
const bodaXV = uno("SELECT id FROM paquete WHERE nombre = 'Paquete Bronce Boda y XV'");
if (!quetzal || !bronce) { console.error('No encontré Quetzal o el Paquete Bronce.'); process.exit(1); }

// ── 1. Las tarifas de aniversarios pasan a ser el Bronce de Quetzal ─────────
if (aniversarios) {
  const hay = uno(
    `SELECT COUNT(*) n FROM tarifa
      WHERE salon_id = ? AND paquete_id = ? AND vigente_hasta IS NULL`,
    quetzal.id, aniversarios.id).n;
  if (!hay) {
    console.log('  ya estaba   las tarifas de aniversarios ya son Bronce');
  } else {
    // El contenido cuelga del paquete igual que la tarifa, asi que se muda con
    // ella. Si no, las cortesias se quedarian apuntando a un paquete retirado.
    const c = db.prepare(
      `UPDATE paquete_contenido SET paquete_id = ? WHERE salon_id = ? AND paquete_id = ?`)
      .run(bronce.id, quetzal.id, aniversarios.id);
    const t = db.prepare(
      `UPDATE tarifa SET paquete_id = ? WHERE salon_id = ? AND paquete_id = ?`)
      .run(bronce.id, quetzal.id, aniversarios.id);
    console.log(`  movidas     ${t.changes} tarifas y ${c.changes} contenidos `
      + 'de «Aniversarios / Cumpleaños» a «Paquete Bronce»');
  }
}

// ── 2. El Bronce de bodas de Quetzal se retira ──────────────────────────────
//
// Se marca `vigente_hasta` en vez de borrar: una tarifa que existio y se
// retiro es informacion, y manana alguien puede preguntar por que una
// cotizacion de hace un mes decia otro precio.
if (bodaXV) {
  const vivas = uno(
    `SELECT COUNT(*) n FROM tarifa
      WHERE salon_id = ? AND paquete_id = ? AND vigente_hasta IS NULL`,
    quetzal.id, bodaXV.id).n;
  if (!vivas) {
    console.log('  ya estaba   el «Bronce Boda y XV» de Quetzal ya está retirado');
  } else {
    const r = db.prepare(
      `UPDATE tarifa SET vigente_hasta = ?
        WHERE salon_id = ? AND paquete_id = ? AND vigente_hasta IS NULL`)
      .run(HOY, quetzal.id, bodaXV.id);
    console.log(`  retiradas   ${r.changes} tarifas del «Bronce Boda y XV» de Quetzal`);
  }
  // El paquete sigue activo mientras le quede algun salon con tarifas vivas.
  const quedan = uno(
    'SELECT COUNT(*) n FROM tarifa WHERE paquete_id = ? AND vigente_hasta IS NULL',
    bodaXV.id).n;
  if (!quedan && uno('SELECT activo FROM paquete WHERE id = ?', bodaXV.id).activo) {
    db.prepare('UPDATE paquete SET activo = 0 WHERE id = ?').run(bodaXV.id);
    console.log('  desactivado el paquete «Bronce Boda y XV»: ya no lo usa ningún salón');
  }
}

// ── 3. El paquete de aniversarios se jubila ─────────────────────────────────
if (aniversarios) {
  const quedan = uno(
    'SELECT COUNT(*) n FROM tarifa WHERE paquete_id = ? AND vigente_hasta IS NULL',
    aniversarios.id).n;
  if (quedan) {
    console.log(`  SIN TOCAR   «Aniversarios / Cumpleaños» aún tiene ${quedan} tarifas vivas`);
  } else if (uno('SELECT activo FROM paquete WHERE id = ?', aniversarios.id).activo) {
    db.prepare('UPDATE paquete SET activo = 0 WHERE id = ?').run(aniversarios.id);
    console.log('  desactivado el paquete «Aniversarios / Cumpleaños»: se quedó sin tarifas');
  } else {
    console.log('  ya estaba   «Aniversarios / Cumpleaños» desactivado');
  }
}

// ── 4. La escalera sirve también para aniversarios y cumpleaños ─────────────
//
// Palabras del Lic.: «se puede utilizar para aniversarios y cumpleaños, pero
// son costos muy altos». Caro no es lo mismo que imposible, y ofrecer algo
// caro es mejor que no tener nada que ofrecer — que es lo que pasaba hasta
// hoy fuera de Quetzal.
const cumple = uno("SELECT id FROM tipo_evento WHERE nombre LIKE '%niversario%'");
if (!cumple) {
  console.log('  !! no encontré el tipo de evento de aniversarios');
} else {
  const ESCALERA = ['Paquete Bronce', 'Paquete Onix', 'Paquete Plata', 'Paquete Oro',
                    'Paquete Onix Boda y XV', 'Paquete Plata Boda y XV'];
  let puestos = 0;
  for (const nombre of ESCALERA) {
    const p = uno('SELECT id, activo FROM paquete WHERE nombre = ?', nombre);
    if (!p || !p.activo) { console.log(`  (sin ${nombre})`); continue; }
    const ya = uno(
      'SELECT 1 x FROM paquete_tipo_evento WHERE paquete_id = ? AND tipo_evento_id = ?',
      p.id, cumple.id);
    if (ya) { console.log(`  ya estaba   ${nombre} para aniversarios`); continue; }
    db.prepare(
      'INSERT INTO paquete_tipo_evento (paquete_id, tipo_evento_id) VALUES (?,?)')
      .run(p.id, cumple.id);
    console.log(`  abierto     ${nombre} para aniversarios y cumpleaños`);
    puestos++;
  }
  if (puestos) console.log(`  (${puestos} paquetes nuevos para ese tipo de evento)`);
}

// ── Comprobación: que nadie se quede sin nada que cotizar ───────────────────
console.log('\nComprobación — paquetes disponibles por salón y tipo de evento:');
for (const s of db.prepare("SELECT id, nombre FROM salon WHERE activo = 1 ORDER BY id").all()) {
  for (const te of db.prepare(
    "SELECT id, nombre FROM tipo_evento WHERE nombre IN ('XV años','Aniversario / Cumpleaños')").all()) {
    const paqs = db.prepare(
      `SELECT DISTINCT p.nombre FROM tarifa t
         JOIN paquete p ON p.id = t.paquete_id
         JOIN paquete_tipo_evento pt ON pt.paquete_id = p.id
        WHERE t.salon_id = ? AND pt.tipo_evento_id = ? AND t.vigente_hasta IS NULL
          AND p.activo = 1 AND p.borrador = 0 AND p.fecha_fija IS NULL
        ORDER BY p.nombre`).all(s.id, te.id).map((x) => x.nombre.replace('Paquete ', ''));
    console.log(`  ${s.nombre.padEnd(20)} ${te.nombre.padEnd(24)} ` +
      (paqs.length ? paqs.join(', ') : '*** NINGUNO ***'));
  }
}
db.close();
