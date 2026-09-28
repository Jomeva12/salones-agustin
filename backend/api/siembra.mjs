// ============================================================================
//  Modo siembra: poner la base en su sitio desde el navegador.
//
//  Por que existe. En un servidor la base vive en un volumen, y el volumen
//  nace vacio. Meter ahi un archivo de 500 KB exige SSH, y SSH exige una
//  contrasena de root que muchas veces no esta a la mano. Este modo lo
//  resuelve con lo unico que siempre se tiene: un navegador.
//
//  Cuando corre. SOLO cuando no hay base. Si el archivo existe, este modulo
//  no se carga y sus rutas no responden: no es una puerta que quede abierta.
//
//  Que pide. El mismo API_TOKEN del panel. Sin token definido no arranca
//  siquiera, porque seria dejar que cualquiera escriba la base del negocio.
//
//  Al terminar, el proceso sale con codigo 0. El contenedor se reinicia solo
//  y esta vez encuentra la base y arranca normal.
// ============================================================================
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

// Todo archivo SQLite empieza con estos 16 bytes. Es lo primero que se mira:
// asi un PDF o un zip renombrado se rechazan antes de tocar el disco.
const FIRMA = Buffer.from('SQLite format 3\0', 'latin1');
const MAX = 64 * 1024 * 1024;

/** Comparacion en tiempo constante: un `===` filtra el largo y los prefijos. */
function tokenValido(dado, esperado) {
  const a = Buffer.from(String(dado ?? ''));
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

const PAGINA = `<!doctype html><html lang="es"><meta charset="utf-8">
<title>Sembrar la base</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light}
body{font:15px/1.55 system-ui,sans-serif;margin:0;background:#f4f5f7;color:#1c1f24;
     display:grid;place-items:center;min-height:100vh;padding:24px}
.caja{background:#fff;border:1px solid #dfe3e8;border-radius:12px;padding:28px;max-width:520px;width:100%}
h1{font-size:19px;margin:0 0 6px}
p{color:#5b6572;margin:0 0 18px}
label{display:block;font-weight:600;margin:16px 0 6px;font-size:13px}
input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cdd3da;border-radius:8px;font:inherit}
button{margin-top:20px;width:100%;padding:11px;border:0;border-radius:8px;background:#1a7f5a;
       color:#fff;font:inherit;font-weight:600;cursor:pointer}
button:disabled{background:#9bb5ab;cursor:default}
#aviso{margin-top:16px;padding:11px 13px;border-radius:8px;font-size:14px;display:none}
.mal{background:#fdecec;color:#8c2020} .bien{background:#e8f5ee;color:#16603f}
</style>
<div class="caja">
<h1>Sembrar la base</h1>
<p>El volumen está vacío. Sube el respaldo más reciente y el panel arranca solo.</p>
<label for="t">Token del panel</label>
<input id="t" type="password" autocomplete="off" placeholder="El API_TOKEN de este servicio">
<label for="f">Archivo de la base</label>
<input id="f" type="file" accept=".db,.sqlite,.sqlite3">
<button id="b">Subir</button>
<div id="aviso"></div>
</div>
<script>
const $ = (i) => document.getElementById(i);
const decir = (t, ok) => { const a = $('aviso'); a.textContent = t;
  a.className = ok ? 'bien' : 'mal'; a.style.display = 'block'; };
$('b').onclick = async () => {
  const f = $('f').files[0];
  if (!$('t').value) return decir('Falta el token.');
  if (!f) return decir('Falta el archivo.');
  $('b').disabled = true; decir('Subiendo ' + Math.round(f.size / 1024) + ' KB...', true);
  try {
    const r = await fetch('/sembrar', { method: 'POST',
      headers: { 'authorization': 'Bearer ' + $('t').value,
                 'content-type': 'application/octet-stream' },
      body: await f.arrayBuffer() });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { decir(d.detalle || d.error || ('Error ' + r.status)); $('b').disabled = false; return; }
    decir(d.detalle, true);
    // El proceso se reinicia: se espera y se recarga ya en el panel normal.
    setTimeout(() => location.replace('/'), 6000);
  } catch (e) { decir('No se pudo subir: ' + e.message); $('b').disabled = false; }
};
</script></html>`;

/**
 * Levanta el servidor minimo de siembra. No devuelve: el proceso vive aqui
 * hasta que llega la base, y entonces sale para que el arranque normal la
 * encuentre.
 */
export function arrancarSiembra({ dbPath, puerto, host, token }) {
  if (!token) {
    console.error('\n  No hay base y tampoco API_TOKEN.');
    console.error('  Define API_TOKEN para poder subirla desde el navegador.\n');
    process.exit(1);
  }

  const servidor = createServer((req, res) => {
    const json = (code, cuerpo) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(cuerpo));
    };

    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(PAGINA);
    }
    if (req.method !== 'POST' || new URL(req.url, 'http://x').pathname !== '/sembrar') {
      return json(404, { error: 'no encontrado' });
    }

    const dado = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!tokenValido(dado, token)) {
      return json(401, { error: 'token incorrecto' });
    }

    const trozos = [];
    let total = 0;
    req.on('data', (t) => {
      total += t.length;
      if (total > MAX) { req.destroy(); return; }
      trozos.push(t);
    });
    req.on('end', () => {
      const datos = Buffer.concat(trozos);
      if (datos.length < 512 || !datos.subarray(0, 16).equals(FIRMA)) {
        return json(400, { error: 'no es una base SQLite',
          detalle: 'El archivo no empieza con la firma de SQLite. ¿Subiste el correcto?' });
      }

      // Se escribe aparte y se comprueba ANTES de ponerlo en su sitio. Una
      // base a medias en la ruta buena arrancaria el panel con un negocio
      // incompleto, que es peor que no arrancar.
      const temporal = dbPath + '.subiendo';
      try {
        mkdirSync(dirname(dbPath), { recursive: true });
        writeFileSync(temporal, datos);

        const db = new DatabaseSync(temporal, { readOnly: true });
        const cuenta = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
        const resumen = { salones: cuenta('salon'), tarifas: cuenta('tarifa'),
                          compromisos: cuenta('compromiso'), politicas: cuenta('politica'),
                          usuarios: cuenta('usuario') };
        db.close();
        if (!resumen.salones || !resumen.usuarios) {
          unlinkSync(temporal);
          return json(400, { error: 'base incompleta',
            detalle: 'Esa base no tiene salones o no tiene usuarios. No se instaló.' });
        }

        renameSync(temporal, dbPath);
        console.log('base sembrada:', JSON.stringify(resumen));
        json(200, { ok: true, resumen,
          detalle: `Listo: ${resumen.salones} salones, ${resumen.tarifas} tarifas, ` +
                   `${resumen.usuarios} usuario(s). El panel se está reiniciando.` });
        // Salir con codigo DISTINTO DE CERO, aunque la siembra haya ido bien.
        // Docker reinicia con la politica on-failure, que mira el codigo: con 0
        // entiende «termino su trabajo» y deja el contenedor abajo. Paso en el
        // primer despliegue real: la base quedo puesta y el panel no volvio.
        setTimeout(() => { servidor.close(); process.exit(1); }, 400);
      } catch (e) {
        try { if (existsSync(temporal)) unlinkSync(temporal); } catch {}
        json(400, { error: 'no se pudo leer la base', detalle: e.message });
      }
    });
  });

  servidor.listen(puerto, host, () => {
    console.log(`\n  MODO SIEMBRA — no hay base en ${dbPath}`);
    console.log(`  Abre el panel en el navegador y sube el respaldo.`);
    console.log(`  escucha .. ${host}:${puerto}\n`);
  });
}
