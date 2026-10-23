// ============================================================================
//  Para aniversarios y cumpleaños, SOLO el Bronce. Y los de Quetzal pierden el
//  apellido «Boda y XV».
//
//      node backend/db/migracion_escalera_solo_bronce_cumple.mjs
//
//  Idempotente.
//
//  Dos cosas, las dos del Lic. Barron el 23-oct-2026.
//
//  1. CORRIGE LO QUE CARGUE AYER. Ayer abri el Bronce, el Onix, el Plata y el
//     Oro para aniversarios y cumpleaños, porque el Lic. dijo que «se pueden
//     utilizar, pero son costos muy altos». Era demasiado:
//
//       «El ónix y el plata hay que ofrecerlo solo para bodas y 15 años. No es
//        lo mismo pagar 25,000 pesos a 70,000 pesos, y un paquete de 70,000 te
//        incluye muchas cosas que puedes utilizar en una boda, pero en un
//        aniversario y cumpleaños no... Si el cliente lo pide, le podemos
//        cotizar el ónix y el plata sin ningún problema, pero siempre hay que
//        empezar de abajo hacia arriba.»
//
//     «Se puede si lo pide» no es «se ofrece». Lo que decide aqui es lo que
//     Maya SACA por su cuenta, asi que para cumpleaños queda el Bronce solo.
//     Que una encargada cotice un Plata si el cliente lo pide no lo impide
//     esto: lo hace ella desde el panel.
//
//  2. LOS NOMBRES DE QUETZAL. Sus paquetes se llamaban «Onix Boda y XV» y
//     «Plata Boda y XV», asi que a un cliente de cumpleaños le habria llegado
//     «le ofrezco el Paquete Onix Boda y XV». El Lic. autorizo quitarlo:
//
//       «Sí pueden ustedes modificar ahí internamente el ónix y el plata,
//        quitarle el concepto boda 15 años.»
//
//     Pasan a ser el mismo «Paquete Onix» y «Paquete Plata» de los otros tres
//     salones, que es lo que son: la misma escalera con otros precios. El
//     precio vive en la tarifa, que es por salon.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const db = new DatabaseSync(DB);
const uno = (sql, ...a) => db.prepare(sql).get(...a);

// ── 1. (ANULADO el mismo día) ───────────────────────────────────────────────
//
// Aqui se cerraban el Onix, el Plata y el Oro para cumpleaños. Duro unas
// horas: en la reunion del 23-oct el Lic. aclaro que a mas de seis meses en
// Quetzal SI se cotizan —«no sería que no tenemos paquete, sería: el
// cumpleaños que tú quieres celebrar te saldría en 55 porque es un paquete
// más caro»— y que lo suyo era el ORDEN, no la disponibilidad: «siempre hay
// que empezar de abajo hacia arriba».
//
// Lo reabre `migracion_cumple_de_abajo_hacia_arriba.mjs`, y el orden lo
// resuelve `ordenarParaVender`. Este paso se queda vacio a proposito: si se
// reejecutara con el cierre dentro, desharia aquello en silencio.

// ── 2. Los de Quetzal pierden el «Boda y XV» ────────────────────────────────
const RENOMBRES = [
  ['Paquete Onix Boda y XV', 'Paquete Onix'],
  ['Paquete Plata Boda y XV', 'Paquete Plata'],
];
for (const [viejo, nuevo] of RENOMBRES) {
  const v = uno('SELECT id, activo FROM paquete WHERE nombre = ?', viejo);
  const n = uno('SELECT id FROM paquete WHERE nombre = ?', nuevo);
  if (!v) { console.log(`  ya estaba   «${viejo}» ya no existe`); continue; }
  if (!n) { console.log(`  !! no existe «${nuevo}», no hay a dónde mover`); continue; }

  // Solo debe usarlo Quetzal. Si lo usara otro salon, moverlo a ciegas
  // mezclaria dos catalogos y eso no se hace en silencio.
  const salones = db.prepare(
    `SELECT DISTINCT s.clave FROM tarifa t JOIN salon s ON s.id = t.salon_id
      WHERE t.paquete_id = ? AND t.vigente_hasta IS NULL`).all(v.id).map((x) => x.clave);
  const ajenos = salones.filter((s) => s !== 'quetzal');
  if (ajenos.length) {
    console.log(`  !! «${viejo}» lo usan también: ${ajenos.join(', ')} — sin tocar`);
    continue;
  }

  // El contenido se muda con la tarifa: si se queda, las cortesias apuntan a
  // un paquete retirado.
  const c = db.prepare('UPDATE paquete_contenido SET paquete_id = ? WHERE paquete_id = ?')
    .run(n.id, v.id);
  const t = db.prepare('UPDATE tarifa SET paquete_id = ? WHERE paquete_id = ?')
    .run(n.id, v.id);
  if (t.changes || c.changes) {
    console.log(`  movidas     ${t.changes} tarifas y ${c.changes} contenidos `
      + `de «${viejo}» a «${nuevo}»`);
  }
  if (v.activo) {
    db.prepare('UPDATE paquete SET activo = 0 WHERE id = ?').run(v.id);
    console.log(`  desactivado «${viejo}»: ya no lo usa nadie`);
  }
}

// ── Comprobación ────────────────────────────────────────────────────────────
console.log('\nComprobación — qué se OFRECE por salón y tipo de evento:');
for (const s of db.prepare('SELECT id, nombre FROM salon WHERE activo = 1 ORDER BY id').all()) {
  for (const te of db.prepare(
    "SELECT id, nombre FROM tipo_evento WHERE clave IN ('xv','cumpleanos')").all()) {
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
