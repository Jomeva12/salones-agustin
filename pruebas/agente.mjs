// ============================================================================
//  Arnés para probar conversaciones SIN n8n.
//
//  Cada turno declara lo que el agente logró extraer del mensaje del cliente.
//  El arnés hace la llamada al API y muestra la traza: qué sabía, qué consultó,
//  qué le contestaron y qué podría responder.
//
//      node pruebas/agente.mjs pruebas/conversaciones/lo_que_sea.json
// ============================================================================
import { readFileSync } from 'node:fs';

const BASE = process.env.API ?? 'http://localhost:4300';
const g = (s, c) => `\x1b[${c}m${s}\x1b[0m`;
const pesos = (n) => '$' + Number(n).toLocaleString('es-MX');

async function llamar(ruta, cuerpo) {
  const res = await fetch(BASE + ruta, cuerpo
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) }
    : {});
  return res.json();
}

function resumirCotizacion(r) {
  if (r.resultado !== 'ok') {
    console.log('   ' + g('▸ ' + r.resultado.toUpperCase(), '33') +
      (r.faltan ? ' → falta: ' + r.faltan.join(', ') : ''));
    if (r.mensaje_sugerido) console.log('     sugiere: ' + r.mensaje_sugerido);
    return;
  }
  console.log(`   ${g('derivado por el API:', '90')} ${r.dia_semana} · faltan ${r.meses_anticipacion} meses · ` +
              `año ${r.anio} · ${r.personas} invitados · vigente hasta ${r.precio_vigente_hasta}`);
  for (const s of r.salones) {
    const disp = { libre: g('libre', '32'), ocupada: g('ocupada', '31'), no_confirmada: g('sin confirmar', '33') }[s.disponibilidad];
    if (s.cotizacion === 'ok') {
      const o = s.recomendado;
      const extra = o.unidad === 'por_persona' ? ` (${pesos(o.precio)}/persona)` : '';
      console.log(`     ${s.salon_nombre.padEnd(20)} ${disp.padEnd(22)} ${o.paquete.padEnd(34)} ${pesos(o.total)}${extra}`);
      console.log(`     ${''.padEnd(20)} ${''.padEnd(13)} tramo ${o.tramo_personas} · ${o.escalon}`);
    } else {
      console.log(`     ${s.salon_nombre.padEnd(20)} ${disp.padEnd(22)} ${g(s.cotizacion, '33')} → ${s.accion}`);
    }
  }
  console.log(`   ${g('vendibles:', '90')} ${r.vendibles} de ${r.salones.length}`);
}

const archivo = process.argv[2];
if (!archivo) { console.error('Uso: node pruebas/agente.mjs <archivo.json>'); process.exit(1); }
const conv = JSON.parse(readFileSync(archivo, 'utf8'));

console.log('\n' + '═'.repeat(88));
console.log(g(conv.titulo ?? archivo, '1'));
if (conv.contexto) console.log(g(conv.contexto, '90'));
console.log('═'.repeat(88));

for (const t of conv.turnos) {
  console.log('');
  if (t.cliente) console.log(g('CLIENTE  ▸ ', '36') + t.cliente);

  if (t.extraido) {
    const tiene = Object.entries(t.extraido).filter(([, v]) => v !== null && v !== undefined);
    console.log('   ' + g('extraído: ', '90') +
      (tiene.length ? tiene.map(([k, v]) => `${k}=${v}`).join('  ') : '(nada todavía)'));
  }

  if (t.llamada) {
    console.log('   ' + g('→ ' + (t.llamada.metodo ?? 'POST') + ' ' + t.llamada.ruta, '35') +
      (t.llamada.cuerpo ? '  ' + JSON.stringify(t.llamada.cuerpo) : ''));
    const r = await llamar(t.llamada.ruta, t.llamada.cuerpo);
    if (t.llamada.ruta.startsWith('/api/cotizar')) resumirCotizacion(r);
    else console.log('   ' + JSON.stringify(r, null, 2).split('\n').join('\n   '));
  } else if (t.sin_llamada) {
    console.log('   ' + g('sin llamada: ', '90') + t.sin_llamada);
  }

  if (t.maya) console.log(g('MAYA     ▸ ', '32') + t.maya.split('\n').join('\n           '));
}
console.log('');
