// ============================================================================
//  Los dos anexos que mandó el Lic. Barrón el 20-oct-2026, tal como los mandó.
//
//      node backend/db/migracion_anexos_agustin.mjs
//
//  Idempotente: si las tarifas ya están, no las duplica.
//
//  ANEXO 1 — ventana de calendario (filas 67-71 del Excel)
//    Norma · Bronce · 2027, para eventos de enero a marzo de 2027, cotizando
//    entre octubre de 2026 y marzo de 2027. Los importes son los mismos que
//    ya estaban como «Faltan 2 meses», pero la regla NO es de anticipación:
//    cotizando hoy (octubre de 2026) un evento de marzo de 2027 —a cinco
//    meses— esta tarifa da $37,400 donde el escalón daría $55,400.
//
//    Eso se le advirtió a Jorge con los números y dijo que se cargara tal
//    como venía. Queda escrito aquí porque dentro de seis meses nadie se va a
//    acordar de que fue una decisión y no un descuido.
//
//  ANEXO 2 — el escalón que faltaba (filas 92-96)
//    Norma · Bronce · 2027 del séptimo mes en adelante. Hasta hoy ese hueco
//    se tapaba sumando $10,000 a la tarifa de «3 a 5 meses», por instrucción
//    del Lic. Los veinte importes del anexo coinciden EXACTAMENTE con ese
//    recargo, los cuatro días y los cinco tramos. Así que esto no cambia
//    ningún precio: convierte una invención en dato, y de paso trae tres
//    cortesías que no estábamos mencionando.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe la base en ' + DB); process.exit(1); }

const MAPA = join(AQUI, '..', '..', 'imagenes', 'anexos_agustin_2026-10-20.json');
if (!existsSync(MAPA)) {
  console.error(`FALTA el mapa en ${MAPA}. Sin él no hay nada que cargar.`);
  console.error('Si esto sale en el servidor, el Dockerfile no está copiando imagenes/*.json.');
  process.exit(1);
}
const anexos = JSON.parse(readFileSync(MAPA, 'utf8'));

const db = new DatabaseSync(DB);

// Las columnas de ventana se agregan sobre la marcha: las bases que ya
// existen no las tienen y aquí no hay sistema de migraciones.
const cols = db.prepare('PRAGMA table_info(tarifa)').all().map((c) => c.name);
for (const c of ['evento_desde', 'evento_hasta', 'cotiza_desde', 'cotiza_hasta']) {
  if (!cols.includes(c)) {
    db.exec(`ALTER TABLE tarifa ADD COLUMN ${c} TEXT`);
    console.log(`  columna ${c} agregada`);
  }
}

const salon = db.prepare("SELECT id FROM salon WHERE clave = 'norma'").get();
const paquete = db.prepare("SELECT id FROM paquete WHERE nombre LIKE 'Paquete Bronce%' AND activo = 1").get();
if (!salon || !paquete) { console.error('No encontré Norma o el Paquete Bronce.'); process.exit(1); }

/**
 * El contenido con las cortesías de este anexo.
 *
 * `paquete_contenido` tiene llave única por (paquete, salón, escalón,
 * variante), así que no basta con copiar: hay que darle su sitio. El escalón
 * del anexo lo da; cuando no hay escalón —la ventana de calendario— se usa la
 * siguiente variante libre.
 */
function contenidoCon(cortesias, modelo, escalonId) {
  const ya = db.prepare(
    `SELECT id FROM paquete_contenido
      WHERE paquete_id = ? AND salon_id = ? AND cortesias = ?
        AND IFNULL(escalon_id,-1) = IFNULL(?,-1)`)
    .get(paquete.id, salon.id, cortesias, escalonId);
  if (ya) return ya.id;

  // Se copia del contenido que ya usa ese paquete, para no inventar horas ni
  // duración: lo único que cambia entre anexos son las cortesías.
  const base = db.prepare('SELECT * FROM paquete_contenido WHERE id = ?').get(modelo);
  const variante = (db.prepare(
    `SELECT MAX(variante) v FROM paquete_contenido
      WHERE paquete_id = ? AND salon_id = ? AND IFNULL(escalon_id,-1) = IFNULL(?,-1)`)
    .get(paquete.id, salon.id, escalonId).v ?? 0) + 1;

  const campos = Object.keys(base).filter((k) => k !== 'id');
  const valor = (k) => {
    if (k === 'cortesias') return cortesias;
    if (k === 'escalon_id') return escalonId;
    if (k === 'variante') return variante;
    return base[k];
  };
  const r = db.prepare(
    `INSERT INTO paquete_contenido (${campos.join(',')})
     VALUES (${campos.map(() => '?').join(',')})`)
    .run(...campos.map(valor));
  return Number(r.lastInsertRowid);
}

const tramo = (p) => {
  // Los tramos del catálogo son 100, 101-150, 151-200, 201-250, 251-300. El
  // Excel da el tope de cada uno.
  const topes = [[100, 100], [101, 150], [151, 200], [201, 250], [251, 300]];
  return topes.find(([, h]) => h === p) ?? [p, p];
};

let puestas = 0, yaEstaban = 0;
for (const [clave, anexo] of Object.entries(anexos)) {
  const esc = anexo.escalon
    ? db.prepare('SELECT id FROM escalon WHERE nombre = ?').get(anexo.escalon)
    : null;
  if (anexo.escalon && !esc) { console.log(`  escalón desconocido: ${anexo.escalon}`); continue; }

  console.log(`\n${clave}:`);
  for (const f of anexo.filas) {
    const [desde, hasta] = tramo(f.personas);
    const ya = db.prepare(
      `SELECT id FROM tarifa
        WHERE salon_id = ? AND paquete_id = ? AND anio = ?
          AND personas_desde = ? AND personas_hasta = ?
          AND IFNULL(escalon_id,-1) = IFNULL(?,-1)
          AND IFNULL(evento_desde,'') = IFNULL(?,'')
          AND vigente_hasta IS NULL`)
      .get(salon.id, paquete.id, f.anio, desde, hasta, esc?.id ?? null, anexo.evento_desde);
    if (ya) { console.log(`  ya estaba  ${f.personas} personas`); yaEstaban++; continue; }

    // El contenido modelo: el que ya usa ese paquete en ese salón y año.
    const modelo = db.prepare(
      `SELECT contenido_id FROM tarifa
        WHERE salon_id = ? AND paquete_id = ? AND anio = ? AND contenido_id IS NOT NULL
        LIMIT 1`).get(salon.id, paquete.id, f.anio)?.contenido_id;

    db.prepare(
      `INSERT INTO tarifa (paquete_id, salon_id, escalon_id, contenido_id, anio,
                           personas_desde, personas_hasta,
                           precio_lun, precio_mar, precio_mie, precio_jue,
                           precio_vie, precio_sab, precio_dom,
                           evento_desde, evento_hasta, cotiza_desde, cotiza_hasta,
                           fila_original)
       VALUES (?,?,?,?,?, ?,?, ?,?,?,?, ?,?,?, ?,?,?,?, ?)`)
      .run(paquete.id, salon.id, esc?.id ?? null,
        modelo ? contenidoCon(anexo.cortesias, modelo, esc?.id ?? null) : null, f.anio,
        desde, hasta,
        f.precio_semana, f.precio_semana, f.precio_semana, f.precio_semana,
        f.precio_vie, f.precio_sab, f.precio_dom,
        anexo.evento_desde, anexo.evento_hasta, anexo.cotiza_desde, anexo.cotiza_hasta,
        f.fila_excel);
    console.log(`  puesta     ${f.personas} personas · sábado $${f.precio_sab}`);
    puestas++;
  }
}

console.log(`\n${puestas} tarifas cargadas · ${yaEstaban} ya estaban.`);
console.log(`${db.prepare('SELECT COUNT(*) n FROM tarifa').get().n} tarifas en total.`);
db.close();
