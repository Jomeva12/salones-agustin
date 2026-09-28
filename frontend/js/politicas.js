// Las políticas del negocio. Vivían al final de Respuestas y ahí se ahogaban:
// son 43 y quedaban debajo de 31 preguntas, en una rejilla de dos columnas
// donde no se encontraba nada.
//
// Aquí se organizan por las dos cosas que de verdad las separan:
//   · QUIÉN la puede saber  — pública, regla interna del agente, o restringida
//   · DE QUÉ trata          — la sección que traía el Excel
import { api, error, puede, sesion } from './api.js';
import { el, limpiar, cargando, abrirCajon, cerrarCajon } from './ui.js';

const VIS = [
  ['publico', 'Se le puede decir al cliente',
   'El agente lo contesta tal cual, sin consultar a nadie.'],
  ['regla_interna', 'Así debe trabajar el agente',
   'Son sus instrucciones, no cosas que le diga al cliente.'],
  ['restringido', 'Nunca se dice',
   'Existen, pero el agente no las da: si preguntan, pasa al cliente con la encargada. Por eso tampoco se muestran aquí.'],
];

let filtroVis = 'publico';
let filtroSec = '';
let busqueda = '';

export async function politicas(raiz) {
  limpiar(raiz);
  const cont = el('div', { class: 'politicas-pag' });
  raiz.append(cont);
  cont.append(el('div', { class: 'titulo' }, [
    el('h2', { text: 'Políticas del negocio' }),
    el('p', { text: 'Las reglas con las que se trabaja: lo que se le puede decir al cliente, ' +
                    'cómo debe comportarse el agente y lo que nunca se comparte.' }),
  ]));
  const zona = el('div');
  cont.append(zona);
  await pintar(zona);
}

async function pintar(zona) {
  limpiar(zona).append(cargando());
  let todas;
  try { todas = (await api.politicas('todo')).politicas; }
  catch (e) { limpiar(zona).append(error('No se pudo cargar: ' + e.message)); return; }

  limpiar(zona);
  const recargar = () => pintar(zona);

  // ── quién la puede saber: la división que más importa ─────────────────────
  // Cada pestaña lleva su color y su explicación: antes la explicación iba
  // aparte, en una franja gris que no se asociaba con nada.
  const tabs = el('div', { class: 'tabs-vis', role: 'tablist' });
  for (const [v, rot, explica] of VIS) {
    const n = todas.filter((p) => p.visibilidad === v).length;
    tabs.append(el('button', {
      type: 'button', role: 'tab', 'aria-selected': String(filtroVis === v),
      class: `tab-vis${filtroVis === v ? ' sel' : ''} ${v}`,
      onclick: () => { filtroVis = v; filtroSec = ''; recargar(); },
    }, [
      el('div', { class: 'tab-vis-cab' }, [el('b', { text: rot }), el('span', { class: 'cuenta', text: String(n) })]),
      el('span', { class: 'explica', text: explica }),
    ]));
  }
  zona.append(tabs);

  const deEste = todas.filter((p) => p.visibilidad === filtroVis);

  // ── buscar y filtrar por sección ──────────────────────────────────────────
  const buscar = el('input', { type: 'search', value: busqueda, style: 'width:100%',
    placeholder: 'Anticipo, cancelación, música, estacionamiento…' });
  let reloj;
  buscar.addEventListener('input', () => {
    busqueda = buscar.value;
    clearTimeout(reloj);
    reloj = setTimeout(() => { aplicar(); }, 200);
  });

  const secciones = [...new Set(deEste.map((p) => p.seccion))].sort();
  const pills = el('div', { class: 'filtros-cat' });
  const hacerPill = (v, t, n) => el('button', {
    type: 'button', class: `filtro-cat${filtroSec === v ? ' sel' : ''}`,
    onclick: () => { filtroSec = filtroSec === v ? '' : v; recargar(); },
  }, [t, el('b', { text: String(n) })]);
  pills.append(hacerPill('', 'Todas', deEste.length));
  for (const sec of secciones) {
    pills.append(hacerPill(sec, sec, deEste.filter((p) => p.seccion === sec).length));
  }

  const btnNueva = filtroVis !== 'restringido' && puede('respuestas')
    ? el('button', { class: 'primario', text: '+ Nueva política', onclick: () => {
        enPanel('Nueva política', 'Aparecerá en la pestaña que elijas',
          (volver, alGuardar) => formulario({ visibilidad: filtroVis, seccion: filtroSec || 'Politicas' }, volver, alGuardar), recargar);
      } })
    : null;

  zona.append(el('section', { class: 'bloque-cot barra-serv', style: 'margin-top:16px' }, [
    el('div', { class: 'fila-buscar' }, [buscar, btnNueva].filter(Boolean)),
    pills,
  ]));

  const lista = el('div', { class: 'lista-politicas' });
  zona.append(lista);

  function aplicar() {
    const q = busqueda.trim().toLowerCase();
    const visibles = deEste.filter((p) =>
      (!filtroSec || p.seccion === filtroSec) &&
      (!q || `${p.tema} ${p.detalle ?? ''} ${p.notas ?? ''}`.toLowerCase().includes(q)));
    limpiar(lista);
    if (!visibles.length) {
      lista.append(el('div', { class: 'bloque-cot vacio', text: 'Nada con ese filtro.' }));
      return;
    }
    // Una caja por sección, como en Servicios: se lee por tema, no como
    // una pila de tarjetas iguales.
    const porSec = new Map();
    for (const p of visibles) {
      if (!porSec.has(p.seccion)) porSec.set(p.seccion, []);
      porSec.get(p.seccion).push(p);
    }
    for (const [sec, ps] of porSec) {
      lista.append(el('section', { class: `bloque-cot grupo-pol ${filtroVis}` }, [
        el('header', { class: 'cab-bloque' }, [
          el('h3', { text: sec }),
          el('span', { class: 'cuenta-paq', text: `${ps.length} política${ps.length > 1 ? 's' : ''}` }),
        ]),
        el('div', { class: 'filas-pol' }, ps.map((p) => fila(p, recargar))),
      ]));
    }
  }
  aplicar();
  setTimeout(() => { if (busqueda) buscar.focus(); }, 30);
}

// ── una política ────────────────────────────────────────────────────────────
/** Abre el formulario en el panel lateral; al guardar cierra y repinta. */
function enPanel(titulo, subtitulo, hacer, recargar) {
  const cuerpo = abrirCajon(titulo, subtitulo);
  cuerpo.closest('.cajon')?.classList.add('form');
  cuerpo.classList.add('cajon-cuerpo');
  const panel = el('div', { class: 'cajon-panel' });
  cuerpo.append(panel);
  panel.append(hacer(cerrarCajon, async () => { cerrarCajon(); await recargar(); }));
}

function fila(p, recargar) {
  const oculta = p.visibilidad === 'restringido';
  const puedeTocar = puede('respuestas') && !(oculta && sesion()?.rol !== 'admin');

  // Antes cada política cargaba dos botones grandes siempre visibles: con 43
  // pesaban más que el texto. Ahora son discretos y aparecen al pasar.
  const acciones = puedeTocar
    ? el('div', { class: 'acciones-pol' }, [
        el('button', { type: 'button', text: 'Corregir', onclick: () =>
          enPanel('Corregir política', p.tema, (volver, alGuardar) => formulario(p, volver, alGuardar), recargar) }),
        el('button', { type: 'button', class: 'peligro', text: 'Borrar', onclick: () =>
          enPanel('Borrar política', p.tema, (volver, alGuardar) => confirmarBaja(p, volver, alGuardar), recargar) }),
      ])
    : null;

  const texto = oculta ? 'Consúltalo con la encargada del salón.' : (p.detalle ?? '—');
  // Se recorta a tres renglones y el botón solo aparece si de verdad se cortó:
  // contar letras fallaba con los textos que traen espacios de más del Excel.
  const dice = el('div', { class: 'dice recortado', text: texto });
  const mas = el('button', { type: 'button', class: 'leer-mas', text: 'Leer completo', hidden: 'hidden', onclick: () => {
    const cerrado = dice.classList.toggle('recortado');
    mas.textContent = cerrado ? 'Leer completo' : 'Mostrar menos';
  } });
  // requestAnimationFrame no corre con la pestaña en segundo plano: el
  // setTimeout es la red para que el botón no se quede escondido.
  const medir = () => { if (dice.isConnected) mas.hidden = dice.scrollHeight <= dice.clientHeight + 2; };
  requestAnimationFrame(medir);
  setTimeout(medir, 400);

  return el('article', { class: `politica ${p.visibilidad}` }, [
    el('div', { class: 'cab' }, [el('b', { class: 'tema', text: p.tema }), acciones]),
    dice, mas,
    p.notas && !oculta
      ? el('div', { class: 'nota-pol' }, [el('b', { text: 'Ojo' }), el('span', { text: p.notas })])
      : null,
  ].filter(Boolean));
}

// ── formulario ──────────────────────────────────────────────────────────────
function formulario(p, volver, recargar) {
  const nuevo = !p?.id;
  const tema = el('input', { type: 'text', style: 'width:100%',
    placeholder: 'Anticipo para apartar fecha', value: p?.tema ?? '' });
  const seccion = el('input', { type: 'text', value: p?.seccion ?? 'Politicas' });
  const detalle = el('textarea', { rows: '3', style: 'width:100%' });
  detalle.value = p?.detalle ?? '';
  const notas = el('input', { type: 'text', style: 'width:100%', value: p?.notas ?? '' });
  const vis = el('select', {}, VIS.map(([v, t]) =>
    el('option', { value: v, text: t, selected: (p?.visibilidad ?? 'publico') === v })));
  const aviso = el('div', { class: 'aviso-form' });

  // Marcar algo como restringido es del admin: ahí viven los datos bancarios
  // y los teléfonos privados.
  if (sesion()?.rol !== 'admin') {
    for (const o of vis.options) if (o.value === 'restringido') o.disabled = true;
  }
  const ayuda = el('div', { class: 'ayuda-rol' });
  const ajustar = () => { ayuda.textContent = VIS.find(([v]) => v === vis.value)[2]; };
  vis.addEventListener('change', ajustar);
  ajustar();

  const guardar = el('button', { class: 'primario', text: nuevo ? 'Crear' : 'Guardar', onclick: async () => {
    aviso.textContent = '';
    guardar.disabled = true;
    const datos = { tema: tema.value, seccion: seccion.value, detalle: detalle.value,
                    notas: notas.value, visibilidad: vis.value };
    try {
      const r = nuevo ? await api.crearPolitica(datos) : await api.editarPolitica({ ...datos, id: p.id });
      if (r.error) { aviso.textContent = r.detalle ?? r.error; guardar.disabled = false; return; }
      await recargar();
    } catch (e) { aviso.textContent = e.message; guardar.disabled = false; }
  } });

  const caja = el('div', { class: 'edita' }, [
    el('label', { class: 'campo' }, ['Tema', tema]),
    el('label', { class: 'campo' }, ['Qué dice', detalle]),
    el('div', { class: 'fila' }, [
      el('label', { class: 'campo' }, ['Quién la puede saber', vis]),
      el('label', { class: 'campo' }, ['Sección', seccion]),
    ]),
    ayuda,
    el('label', { class: 'campo' }, ['Nota interna (opcional)', notas]),
    el('div', { class: 'fila', style: 'margin-top:12px' }, [
      guardar,
      el('button', { class: 'fantasma', text: 'Cancelar', onclick: () => { caja.remove(); volver(); } }),
    ]),
    aviso,
  ]);
  setTimeout(() => tema.focus(), 30);
  return caja;
}

function confirmarBaja(p, volver, recargar) {
  const motivo = el('input', { type: 'text', style: 'width:100%',
    placeholder: 'Ya no aplica, cambió la regla…' });
  const aviso = el('div', { class: 'aviso-form' });
  const si = el('button', { style: 'color:var(--ocupada)', text: 'Sí, borrar', onclick: async () => {
    si.disabled = true;
    try {
      const r = await api.borrarPolitica({ id: p.id, motivo: motivo.value.trim() });
      if (r.error) { aviso.textContent = r.detalle ?? r.error; si.disabled = false; return; }
      await recargar();
    } catch (e) { aviso.textContent = e.message; si.disabled = false; }
  } });
  return el('div', { class: 'edita' }, [
    el('div', { style: 'font-size:13.5px;color:var(--tinta-2);line-height:1.55' }, [
      'Se va a borrar ', el('b', { text: p.tema }), '. El texto queda en la bitácora, ',
      'así que se puede recuperar si fue por error.',
    ]),
    el('label', { class: 'campo', style: 'margin-top:11px' }, ['¿Por qué?', motivo]),
    el('div', { class: 'fila', style: 'margin-top:12px' }, [
      si, el('button', { class: 'fantasma', text: 'Mejor no', onclick: volver }),
    ]),
    aviso,
  ]);
}
