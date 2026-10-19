// ============================================================================
//  Sube las fotos de un salón al Drive de Kommo y guarda su URL.
//
//      node backend/db/subir_fotos_salon.mjs <salon> <carpeta>
//      node backend/db/subir_fotos_salon.mjs norma imagenes/_fotos_salon/norma
//
//  Por qué al Drive de Kommo y no al panel: el adjunto del salesbot solo
//  acepta un uuid de archivo de Kommo. Una URL de cualquier otro hosting se
//  descarta —en silencio— y el mensaje sale sin imagen.
//
//  Idempotente por el sha256: una foto ya subida no se vuelve a subir, aunque
//  el archivo venga con otro nombre. WhatsApp los nombra por la hora, así que
//  el mismo jpeg llega dos veces con dos nombres distintos más a menudo de lo
//  que parece.
//
//  El `orden` sale del nombre del archivo, que la extracción numeró. De las
//  veinte fotos de un salón solo se mandan las primeras, así que ese orden es
//  la selección — y se corrige después desde el panel, no aquí.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PROYECTO = resolve(AQUI, '..', '..');
const DB = process.env.DB_PATH ?? join(AQUI, 'salones.db');

const TOKEN = process.env.KOMMO_TOKEN
  ?? (existsSync(join(PROYECTO, '.kommo_token'))
    ? readFileSync(join(PROYECTO, '.kommo_token'), 'utf8').trim() : null);
if (!TOKEN) { console.error('Falta KOMMO_TOKEN (o el archivo .kommo_token).'); process.exit(1); }

const [clave, carpetaArg] = process.argv.slice(2);
if (!clave || !carpetaArg) {
  console.error('Uso: node backend/db/subir_fotos_salon.mjs <salon> <carpeta>');
  process.exit(1);
}
const carpeta = resolve(carpetaArg);
if (!existsSync(carpeta)) { console.error('No existe la carpeta ' + carpeta); process.exit(1); }

const db = new DatabaseSync(DB);
const sal = db.prepare('SELECT id, nombre FROM salon WHERE clave = ?').get(clave);
if (!sal) { console.error('Salón desconocido: ' + clave); process.exit(1); }

const TIPO = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

// El host del Drive es distinto en cada cuenta de Kommo: se pregunta, no se
// adivina. Dar por bueno el de otra cuenta ya tuvo rota esta función una vez.
const cuenta = await (await fetch(
  'https://administracioneventos6.kommo.com/api/v4/account?with=drive_url',
  { headers: { Authorization: 'Bearer ' + TOKEN } })).json();
const DRIVE = cuenta.drive_url;
if (!DRIVE) { console.error('Kommo no devolvió drive_url.'); process.exit(1); }
console.log(`Drive: ${DRIVE}  ·  ${sal.nombre}\n`);

async function subir(datos, nombreEnKommo, contentType) {
  const ses = await (await fetch(DRIVE + '/v1.0/sessions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_name: nombreEnKommo, file_size: datos.length,
      content_type: contentType, with_preview: true,
    }),
  })).json();
  if (!ses.upload_url) throw new Error('sin upload_url: ' + JSON.stringify(ses).slice(0, 200));

  // Kommo corta la subida en partes de max_part_size (512 KB) y devuelve la
  // URL de la siguiente en `next_url`, NO en `upload_url`. Varias fotos pasan
  // ese tope, así que una sola llamada no basta.
  const trozo = ses.max_part_size || datos.length;
  let destino = ses.upload_url, desde = 0, f = null;
  while (desde < datos.length) {
    const parte = datos.subarray(desde, Math.min(desde + trozo, datos.length));
    f = await (await fetch(destino, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: parte,
    })).json();
    desde += parte.length;
    if (desde < datos.length) {
      destino = f?.next_url ?? f?.upload_url ?? f?._links?.upload?.href;
      if (!destino) throw new Error('Kommo no dio URL para la siguiente parte');
    }
  }
  const url = f?._links?.download?.href;
  if (!url) throw new Error('sin url de descarga');
  // El uuid es el penúltimo tramo de la URL, que es lo que el adjunto de la
  // plantilla pide como `id`.
  return { url, uuid: url.split('/')[5] };
}

const archivos = readdirSync(carpeta)
  .filter((a) => TIPO[extname(a).toLowerCase()])
  .sort();

const ponerOrden = db.prepare('UPDATE salon_imagen SET orden = ? WHERE id = ?');
let subidas = 0, saltadas = 0, fallos = 0, orden = 0;

for (const archivo of archivos) {
  orden += 10;
  const datos = readFileSync(join(carpeta, archivo));
  const sha = createHash('sha256').update(datos).digest('hex');
  const ya = db.prepare('SELECT id FROM salon_imagen WHERE salon_id = ? AND sha256 = ?')
    .get(sal.id, sha);
  if (ya) { ponerOrden.run(orden, ya.id); console.log(`  igual    ${archivo}`); saltadas++; continue; }

  try {
    const { url, uuid } = await subir(datos, `${clave} - salon ${archivo}`,
      TIPO[extname(archivo).toLowerCase()]);
    db.prepare(
      `INSERT INTO salon_imagen (salon_id, titulo, orden, url, archivo_uuid, nombre, sha256)
       VALUES (?,?,?,?,?,?,?)`)
      .run(sal.id, null, orden, url, uuid, archivo, sha);
    console.log(`  subida   ${archivo}`);
    subidas++;
  } catch (e) {
    console.log(`  FALLO    ${archivo}: ${e.message}`);
    fallos++;
  }
}

console.log(`\n${subidas} subidas · ${saltadas} ya estaban · ${fallos} fallos`);
console.log(`${db.prepare('SELECT COUNT(*) n FROM salon_imagen WHERE salon_id = ?').get(sal.id).n} fotos de ${sal.nombre} en total.`);
db.close();
