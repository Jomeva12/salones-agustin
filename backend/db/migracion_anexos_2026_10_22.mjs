// ============================================================================
//  El Excel del 22-oct-2026: lo que faltaba de Esmeralda, Santa Cruz y Quetzal.
//
//      node backend/db/migracion_anexos_2026_10_22.mjs
//
//  Idempotente: lo que ya este cargado no se duplica ni se pisa.
//
//  Tres bloques:
//
//  1. VENTANA ENERO-MARZO 2027 (Esmeralda y Santa Cruz; Norma ya la tiene)
//     El Lic. no bajo ningun numero: añadio una regla que deja alcanzar un
//     precio barato que antes no se podia ofrecer todavia. La nota anterior
//     decia «cuando estemos en Febrero del 2027 se puede ofrecer en Abril»
//     —rodante a dos meses—, asi que hoy, en octubre de 2026, no aplicaba. La
//     nueva dice «cuando estemos en Octubre, Noviembre y Diciembre del 2026».
//
//     Consecuencia, y es grande: un evento de enero a marzo de 2027 cotizado
//     hoy pasa de $55,400 a $37,400 en Esmeralda y de $52,400 a $37,400 en
//     Santa Cruz. Entre quince y veinte mil pesos menos segun el tramo. Se le
//     advirtio a Jorge con los numeros y dijo que se cargara.
//
//     Sin esto los salones se contradicen: Norma ya cotiza $37,400 y los otros
//     dos $55,400 por el mismo evento. Y Maya le dice al cliente que son un
//     grupo de cuatro salones muy cerca uno del otro, o sea que los compara.
//
//  2. ESCALON DE 6 MESES O MAS (Esmeralda y Santa Cruz)
//     Esto NO mueve ningun precio: los veinte importes coinciden exactamente
//     con el recargo de $10.000 que el codigo venia calculando solo. Lo que
//     cambia es de donde sale el numero — deja de ser una invencion nuestra y
//     pasa a ser dato del Lic. El dia que el recargo cambie se tocara el
//     Excel y no el codigo.
//
//  3. PAQUETE BRONCE BODA Y XV 2026 DE QUETZAL
//     Nuevo de verdad: Quetzal solo tenia ese paquete para 2027 y 2028.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const MAPA = join(AQUI, '..', '..', 'imagenes', 'anexos_agustin_2026-10-22.json');
if (!existsSync(MAPA)) {
  console.error(`FALTA el mapa en ${MAPA}. Sin el no hay nada que cargar.`);
  console.error('Si esto sale en el servidor, el Dockerfile no copia imagenes/*.json.');
  process.exit(1);
}
const anexos = JSON.parse(readFileSync(MAPA, 'utf8'));

const db = new DatabaseSync(DB);

// Las columnas de ventana pueden no existir en una base que nunca vio el
// anexo anterior.
const cols = db.prepare('PRAGMA table_info(tarifa)').all().map((c) => c.name);
for (const c of ['evento_desde', 'evento_hasta', 'cotiza_desde', 'cotiza_hasta']) {
  if (!cols.includes(c)) {
    db.exec(`ALTER TABLE tarifa ADD COLUMN ${c} TEXT`);
    console.log(`  columna ${c} agregada`);
  }
}

/**
 * El contenido —las cortesias— de un bloque.
 *
 * `paquete_contenido` tiene llave unica por (paquete, salon, escalon,
 * variante), asi que no basta con copiar: hay que darle su sitio. Se copia del
 * contenido que ya usa ese paquete en ese salon para no inventar horas ni
 * duracion; lo unico que cambia entre bloques son las cortesias.
 */
function contenidoCon(paqueteId, salonId, cortesias, escalonId) {
  const ya = db.prepare(
    `SELECT id FROM paquete_contenido
      WHERE paquete_id = ? AND salon_id = ? AND cortesias = ?
        AND IFNULL(escalon_id,-1) = IFNULL(?,-1)`)
    .get(paqueteId, salonId, cortesias, escalonId);
  if (ya) return ya.id;

  const base = db.prepare(
    `SELECT * FROM paquete_contenido
      WHERE paquete_id = ? AND salon_id = ? ORDER BY id LIMIT 1`).get(paqueteId, salonId);
  if (!base) return null;   // sin modelo no se inventa un contenido

  const variante = (db.prepare(
    `SELECT MAX(variante) v FROM paquete_contenido
      WHERE paquete_id = ? AND salon_id = ? AND IFNULL(escalon_id,-1) = IFNULL(?,-1)`)
    .get(paqueteId, salonId, escalonId).v ?? 0) + 1;

  const campos = Object.keys(base).filter((k) => k !== 'id');
  const valor = (k) => {
    if (k === 'cortesias') return cortesias;
    if (k === 'escalon_id') return escalonId;
    if (k === 'variante') return variante;
    return base[k];
  };
  const r = db.prepare(
    `INSERT INTO paquete_contenido (${campos.join(',')})
     VALUES (${campos.map(() => '?').join(',')})`).run(...campos.map(valor));
  return Number(r.lastInsertRowid);
}

/**
 * Los tramos se deducen de los topes, no se llevan escritos.
 *
 * Los salones grandes van de 100 en 50 (100, 150, 200, 250, 300) y Quetzal de
 * 50 en 10 (50, 60, ... 150). El primero es cerrado —100 a 100— y cada
 * siguiente empieza donde acabo el anterior. Escribirlos a mano serian dos
 * tablas que se desincronizan el dia que el Lic. añada un tramo.
 */
function tramos(topes) {
  const orden = [...topes].sort((a, b) => a - b);
  const mapa = new Map();
  orden.forEach((t, i) => mapa.set(t, i === 0 ? [t, t] : [orden[i - 1] + 1, t]));
  return mapa;
}

let puestas = 0, yaEstaban = 0, sinSitio = 0;

for (const [clave, anexo] of Object.entries(anexos)) {
  if (clave.startsWith('_')) continue;   // `_origen` es documentacion
  console.log(`\n${clave}:`);

  const esc = anexo.escalon
    ? db.prepare('SELECT id FROM escalon WHERE nombre = ?').get(anexo.escalon)
    : null;
  if (anexo.escalon && !esc) {
    console.log(`  !! escalon desconocido: «${anexo.escalon}» — bloque saltado`);
    continue;
  }

  const paquete = db.prepare(
    'SELECT id FROM paquete WHERE nombre = ? AND activo = 1').get(anexo.paquete);
  if (!paquete) {
    console.log(`  !! paquete desconocido: «${anexo.paquete}» — bloque saltado`);
    continue;
  }

  // Por salon, porque los tramos se deducen dentro de cada uno.
  const porSalon = new Map();
  for (const f of anexo.filas) {
    if (!porSalon.has(f.salon)) porSalon.set(f.salon, []);
    porSalon.get(f.salon).push(f);
  }

  for (const [claveSalon, filas] of porSalon) {
    const salon = db.prepare('SELECT id, nombre FROM salon WHERE clave = ?').get(claveSalon);
    if (!salon) { console.log(`  !! salon desconocido: ${claveSalon}`); continue; }

    const mapa = tramos(filas.map((f) => f.personas));
    const contenidoId = contenidoCon(paquete.id, salon.id, anexo.cortesias, esc?.id ?? null);
    if (contenidoId === null) sinSitio++;

    for (const f of filas) {
      const [desde, hasta] = mapa.get(f.personas);
      const ya = db.prepare(
        `SELECT id FROM tarifa
          WHERE salon_id = ? AND paquete_id = ? AND anio = ?
            AND personas_desde = ? AND personas_hasta = ?
            AND IFNULL(escalon_id,-1) = IFNULL(?,-1)
            AND IFNULL(evento_desde,'') = IFNULL(?,'')
            AND vigente_hasta IS NULL`)
        .get(salon.id, paquete.id, f.anio, desde, hasta,
             esc?.id ?? null, anexo.evento_desde);
      if (ya) {
        console.log(`  ya estaba  ${salon.nombre} · ${f.personas} pers`);
        yaEstaban++;
        continue;
      }

      db.prepare(
        `INSERT INTO tarifa (paquete_id, salon_id, escalon_id, contenido_id, anio,
                             personas_desde, personas_hasta,
                             precio_lun, precio_mar, precio_mie, precio_jue,
                             precio_vie, precio_sab, precio_dom,
                             evento_desde, evento_hasta, cotiza_desde, cotiza_hasta,
                             fila_original)
         VALUES (?,?,?,?,?, ?,?, ?,?,?,?, ?,?,?, ?,?,?,?, ?)`)
        .run(paquete.id, salon.id, esc?.id ?? null, contenidoId, f.anio,
             desde, hasta,
             f.precio_semana, f.precio_semana, f.precio_semana, f.precio_semana,
             f.precio_vie, f.precio_sab, f.precio_dom,
             anexo.evento_desde, anexo.evento_hasta,
             anexo.cotiza_desde, anexo.cotiza_hasta, f.fila_excel);
      console.log(`  puesta     ${salon.nombre} · ${f.personas} pers · sábado $${f.precio_sab}`);
      puestas++;
    }
  }
}

console.log(`\n${puestas} tarifas cargadas · ${yaEstaban} ya estaban.`);
if (sinSitio) {
  console.log(`!! ${sinSitio} bloques se quedaron sin contenido (sin modelo del que copiar): `
    + 'esas tarifas no llevan cortesías. Revisar en el panel.');
}
console.log(`${db.prepare('SELECT COUNT(*) n FROM tarifa WHERE vigente_hasta IS NULL').get().n} tarifas vigentes en total.`);
db.close();
