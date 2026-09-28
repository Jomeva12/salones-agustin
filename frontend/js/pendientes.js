// Lo que falta decidir. No es un listado de datos sueltos: es una lista de
// preguntas para el Lic. Barrón, cada una con las opciones sobre la mesa.
import { api, pesos, error, usuarioActual, salonActual } from './api.js';
import { el, limpiar, cargando } from './ui.js';

export async function pendientes(raiz) {
  limpiar(raiz);
  const cont = el('div');
  raiz.append(cont);
  cont.append(el('div', { class: 'titulo' }, [
    el('h2', { text: 'Pendientes' }),
    el('p', { text: 'Preguntas que quedaron abiertas al pasar la información del Excel. Mientras sigan aquí, el cotizador no arriesga: manda al cliente con la encargada en vez de dar un precio que podría estar mal.' }),
  ]));
  const zona = el('div');
  cont.append(zona);
  zona.append(cargando('tarjetas'));

  let d;
  try { d = await api.revisar(); }
  catch (e) { limpiar(zona).append(error(e.message)); return; }
  limpiar(zona);

  // Cada encargada ve lo suyo: no tiene por qué decidir sobre otro salón.
  const mio = salonActual();
  const NOMBRE = { norma: 'Norma', esmeralda: 'Esmeralda', santacruz: 'Santa Cruz', quetzal: 'Quetzal' };
  if (mio) {
    const suyo = (x) => x.salon.replace(' Eventos', '') === NOMBRE[mio];
    d = { ...d, tarifas: d.tarifas.filter(suyo), contenidos: d.contenidos.filter(suyo),
          agenda: d.agenda.filter(suyo) };
    zona.append(el('div', { class: 'aviso info', style: 'margin-bottom:16px',
      text: `Mostrando solo lo de ${NOMBRE[mio]}. Para ver los cuatro salones, cámbialo abajo a la izquierda.` }));
  }

  const total = d.tarifas.length + d.contenidos.length;
  if (!total) {
    zona.append(el('div', { class: 'aviso info', text: 'No queda nada por decidir. Todo el catálogo está confirmado.' }));
  } else {
    zona.append(el('div', { class: 'rejilla c3 escalona', style: 'margin-bottom:26px' }, [
      indicador(d.tarifas.length, 'precios que tienen más de una versión'),
      indicador(d.contenidos.length, 'paquetes con el contenido repetido'),
      indicador(d.agenda.filter((a) => a.confirmada_hasta < '2028-01-01').length, 'agendas que se quedan cortas'),
    ]));
  }

  const recargar = () => pendientes(raiz);
  if (d.tarifas.length) zona.append(preciosEnDisputa(d.tarifas, recargar));
  if (d.contenidos.length) zona.append(contenidosRepetidos(d.contenidos));
  zona.append(agendas(d.agenda));
}

const indicador = (n, r) => el('div', { class: 'indicador' }, [
  el('div', { class: 'n num', text: String(n) }),
  el('div', { class: 'r', text: r }),
]);

// ── precios con varias versiones ────────────────────────────────────────────
function preciosEnDisputa(filas, recargar) {
  const s = el('div', { class: 'seccion' }, [
    el('h3', {}, ['¿Cuál de estos precios aplica?', el('span', { class: 'cuenta', text: `${filas.length} decisiones` })]),
    el('p', { style: 'color:var(--tinta-2);font-size:13.5px;margin:-4px 0 14px;max-width:74ch',
      text: 'Para la misma consulta hay más de un precio y nada en el Excel dice cuál corresponde. Basta elegir uno de cada grupo.' }),
  ]);
  const rej = el('div', { class: 'rejilla c2 escalona' });
  for (const f of filas) {
    const ids = String(f.ids ?? '').split(',').filter(Boolean).map(Number);
    const precios = String(f.precios_sab ?? '').split(',').map(Number);
    const filasExcel = String(f.filas ?? '').split(',');
    // cada opción conserva su id, para poder elegirla
    const opciones = ids.map((id, i) => ({ id, precio: precios[i], fila: filasExcel[i] }))
      .sort((a, b) => a.precio - b.precio);

    const estado = el('div', { class: 'pregunta-final' });
    const caja = el('div', { class: 'decision' }, [
      el('h4', { text: `${f.paquete.replace('Paquete ', '')} en ${f.salon.replace(' Eventos', '')}` }),
      el('div', { class: 'ctx', text: `Eventos de ${f.anio} · de ${f.personas_desde} a ${f.personas_hasta} invitados` }),
    ]);
    const fila = el('div', { class: 'opciones' });
    for (const o of opciones) {
      fila.append(el('button', {
        class: 'opcion', title: `Fila ${o.fila} del Excel`,
        style: 'cursor:pointer',
        onclick: async () => {
          if (!usuarioActual()) { estado.textContent = 'Primero elige quién eres, abajo a la izquierda.'; return; }
          estado.textContent = 'Guardando…';
          try {
            const r = await api.resolverTarifa({
              mantener: o.id, retirar: ids.filter((x) => x !== o.id),
            });
            if (r.error) { estado.textContent = r.detalle ?? r.error; return; }
            estado.textContent = `✓ Se quedó ${pesos(o.precio)}`;
            setTimeout(recargar, 900);
          } catch (e) { estado.textContent = e.message; }
        },
      }, [pesos(o.precio)]));
    }
    caja.append(fila);
    estado.textContent = `Toca el precio correcto. Los otros ${opciones.length - 1} se retiran (filas ${filasExcel.join(', ')} del Excel).`;
    caja.append(estado);
    rej.append(caja);
  }
  s.append(rej);
  return s;
}

// ── contenidos repetidos ────────────────────────────────────────────────────
function contenidosRepetidos(filas) {
  const grupos = new Map();
  for (const f of filas) {
    const k = `${f.salon}|${f.paquete}`;
    if (!grupos.has(k)) grupos.set(k, { salon: f.salon, paquete: f.paquete, n: 0 });
    grupos.get(k).n++;
  }
  const s = el('div', { class: 'seccion' }, [
    el('h3', {}, ['¿Cuál lista de lo que incluye es la buena?', el('span', { class: 'cuenta', text: `${grupos.size} decisiones` })]),
    el('p', { style: 'color:var(--tinta-2);font-size:13.5px;margin:-4px 0 14px;max-width:74ch',
      text: 'El mismo paquete, en el mismo salón, aparece con más de una lista de lo que incluye. Hay que quedarse con una.' }),
  ]);
  const rej = el('div', { class: 'rejilla c3 escalona' });
  for (const g of grupos.values()) {
    rej.append(el('div', { class: 'decision' }, [
      el('h4', { text: g.paquete.replace('Paquete ', '') }),
      el('div', { class: 'ctx', text: g.salon.replace(' Eventos', '') }),
      el('div', { class: 'opciones' }, [el('div', { class: 'opcion', text: `${g.n} versiones` })]),
    ]));
  }
  s.append(rej);
  return s;
}

// ── agendas ─────────────────────────────────────────────────────────────────
function agendas(lista) {
  const s = el('div', { class: 'seccion' }, [
    el('h3', { text: '¿Hasta cuándo está revisada cada agenda?' }),
    el('p', { style: 'color:var(--tinta-2);font-size:13.5px;margin:-4px 0 14px;max-width:74ch',
      text: 'Más allá de esta fecha el sistema deja de afirmar que un día está libre. Si se vende 2028, las agendas tienen que llegar hasta allá. Se actualiza desde la pantalla de Agenda.' }),
  ]);
  const rej = el('div', { class: 'rejilla c4 escalona' });
  for (const a of lista) {
    const corta = a.confirmada_hasta < '2028-01-01';
    rej.append(el('div', { class: 'tarjeta' }, [
      el('b', { style: 'font-size:14px', text: a.salon.replace(' Eventos', '') }),
      el('div', { class: 'num', style: 'font-size:18px;font-weight:650;margin-top:7px', text: a.confirmada_hasta }),
      el('div', { style: 'margin-top:8px' }, [
        el('span', { class: `chip ${corta ? 'duda' : 'libre'}`,
          text: corta ? 'se queda corta' : 'alcanza' }),
      ]),
      el('div', { style: 'font-size:11.5px;color:var(--tinta-3);margin-top:7px',
        text: a.fuente === 'libreta' ? 'La lleva a mano' : 'La lleva el sistema' }),
    ]));
  }
  s.append(rej);
  return s;
}
