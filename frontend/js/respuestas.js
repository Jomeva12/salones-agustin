// Lo que se contesta cuando preguntan algo que no es el precio.
import { api, error, puede, sesion } from './api.js';
import { el, limpiar, cargando } from './ui.js';
import { confirmar } from './confirmar.js';


let filtroCat = '';

export async function respuestas(raiz) {
  limpiar(raiz);
  filtroCat = '';
  const cont = el('div');
  raiz.append(cont);
  const zonaAlta = el('div');
  const btnNueva = el('button', {
    class: 'primario', text: '+ Nueva pregunta',
    onclick: () => {
      btnNueva.hidden = true;
      zonaAlta.append(formFaq(null, () => { btnNueva.hidden = false; }, recargar));
    },
  });
  cont.append(el('div', { class: 'titulo con-accion' }, [
    el('div', {}, [
      el('h2', { text: 'Respuestas' }),
      el('p', { text: 'Las dudas que más llegan por WhatsApp y las políticas del negocio, con el texto tal cual se contesta.' }),
    ]),
    puede('respuestas') ? btnNueva : null,
  ].filter(Boolean)));
  cont.append(zonaAlta);
  // Las politicas se fueron a su propia pantalla: eran 43 y aqui quedaban
  // debajo de 31 preguntas, donde no se encontraba ninguna.
  cont.append(el('div', { class: 'aviso info', style: 'margin-bottom:18px' }, [
    'Las ', el('b', { text: 'pol\u00edticas del negocio' }), ' ahora tienen su propia pantalla. ',
    el('a', { href: '#/politicas', text: 'Abrirlas \u2192' }),
  ]));

  const buscar = el('input', { type: 'search', placeholder: 'Anticipo, descuento, estacionamiento…', style: 'min-width:270px' });
  const pildoras = el('div', { class: 'filtros', style: 'margin-top:14px' });
  const salida = el('div');
  cont.append(el('div', { class: 'tarjeta', style: 'margin-bottom:22px' }, [
    el('div', { class: 'fila' }, [el('label', { class: 'campo' }, ['Buscar', buscar])]),
    pildoras,
  ]));
  cont.append(salida);

  let reloj;
  buscar.addEventListener('input', () => { clearTimeout(reloj); reloj = setTimeout(recargar, 250); });

  async function recargar() {
    limpiar(salida).append(cargando());
    try {
      const faqs = await api.faq(buscar.value);
      pintarPildoras(faqs, pildoras, recargar);
      limpiar(salida);
      salida.append(seccionPreguntas(faqs, recargar));
    } catch (e) { limpiar(salida).append(error(e.message)); }
  }
  await recargar();
}

function pintarPildoras(faqs, caja, recargar) {
  const cuenta = new Map();
  for (const f of faqs) cuenta.set(f.categoria ?? 'Otras', (cuenta.get(f.categoria ?? 'Otras') ?? 0) + 1);
  limpiar(caja);
  const hacer = (v, t, n) => el('button', {
    class: `filtro${filtroCat === v ? ' sel' : ''}`,
    onclick: () => { filtroCat = filtroCat === v ? '' : v; recargar(); },
  }, [t, el('span', { class: 'n', text: String(n) })]);
  caja.append(hacer('', 'Todas', faqs.length));
  for (const [c, n] of [...cuenta].sort((a, b) => b[1] - a[1])) caja.append(hacer(c, c, n));
}

function seccionPreguntas(faqs, recargar) {
  const visibles = filtroCat ? faqs.filter((f) => (f.categoria ?? 'Otras') === filtroCat) : faqs;
  const s = el('div', { class: 'seccion' }, [
    el('h3', {}, ['Dudas frecuentes', el('span', { class: 'cuenta', text: String(visibles.length) })]),
  ]);
  if (!visibles.length) {
    s.append(el('div', { class: 'vacio', text: 'No encontré preguntas con ese filtro.' }));
    return s;
  }
  const lista = el('div', { class: 'escalona' });
  for (const f of visibles) {
    const resp = el('div', { class: 'respuesta' }, [f.respuesta]);
    if (f.notas) resp.append(el('div', { class: 'nota' }, [el('b', { text: 'Ojo: ' }), f.notas]));
    // Quien atiende es quien se entera de que una respuesta quedó vieja: que
    // la pueda corregir donde la está leyendo, sin buscar otra pantalla.
    if (puede('respuestas')) {
      const zonaEd = el('div');
      const acciones = el('div', { class: 'fila', style: 'margin-top:10px' }, [
        el('button', { text: 'Corregir', onclick: () => {
          acciones.hidden = true;
          zonaEd.append(formFaq(f, () => { acciones.hidden = false; limpiar(zonaEd); }, recargar));
        } }),
        el('button', { style: 'color:var(--ocupada)', text: 'Borrar', onclick: async () => {
          // Borrar pide motivo: queda en la bitácora junto con el texto completo.
          const hecho = await confirmar({
            titulo: '¿Borrar esta respuesta?',
            texto: [el('b', { text: f.pregunta }), '. El agente deja de usarla en ese momento.'],
            nota: 'El texto completo queda guardado en la bitácora, así que se puede recuperar si fue por error.',
            motivo: { etiqueta: '¿Por qué?', placeholder: 'Ya no aplica, cambió la política…' },
            confirmar: 'Sí, borrar',
            accion: (motivo) => api.borrarFaq({ id: f.id, motivo }),
          });
          if (hecho) await recargar();
        } }),
      ]);
      resp.append(acciones, zonaEd);
    }
    resp.hidden = true;
    const boton = el('button', {
      'aria-expanded': 'false',
      onclick: () => {
        resp.hidden = !resp.hidden;
        boton.setAttribute('aria-expanded', String(!resp.hidden));
      },
    }, [
      f.categoria ? el('span', { class: 'chip neutro', text: f.categoria }) : null,
      el('span', { text: f.pregunta }),
      el('span', { class: 'flecha', text: '›' }),
    ]);
    lista.append(el('div', { class: 'pregunta-caja' }, [boton, resp]));
  }
  s.append(lista);
  return s;
}



// ── formularios ────────────────────────────────────────────────────

/** Alta y corrección de una pregunta, con el mismo formulario. */
function formFaq(f, volver, recargar) {
  const nuevo = !f;
  const categoria = el('input', { type: 'text', placeholder: 'Pagos, Horarios, Servicios…', value: f?.categoria ?? '' });
  const pregunta = el('input', { type: 'text', style: 'width:100%',
    placeholder: '¿Se puede llevar bebida de fuera?', value: f?.pregunta ?? '' });
  const respuesta = el('textarea', { rows: '4', style: 'width:100%',
    placeholder: 'El texto tal como se le contesta al cliente…' });
  respuesta.value = f?.respuesta ?? '';
  const notas = el('input', { type: 'text', style: 'width:100%',
    placeholder: 'Para quien atiende, no para el cliente', value: f?.notas ?? '' });
  const aviso = el('div', { class: 'aviso-form' });

  const guardar = el('button', { class: 'primario', text: nuevo ? 'Crear' : 'Guardar', onclick: async () => {
    aviso.textContent = '';
    guardar.disabled = true;
    const datos = {
      categoria: categoria.value, pregunta: pregunta.value,
      respuesta: respuesta.value, notas: notas.value,
    };
    try {
      const r = nuevo ? await api.crearFaq(datos) : await api.editarFaq({ ...datos, id: f.id });
      if (r.error) { aviso.textContent = r.detalle ?? r.error; guardar.disabled = false; return; }
      await recargar();
    } catch (e) { aviso.textContent = e.message; guardar.disabled = false; }
  } });

  const caja = el('div', { class: 'edita' }, [
    el('div', { class: 'fila' }, [
      el('label', { class: 'campo ancho' }, ['La pregunta, como la hace el cliente', pregunta]),
      el('label', { class: 'campo' }, ['Categoría', categoria]),
    ]),
    el('label', { class: 'campo' }, ['La respuesta, tal cual se manda', respuesta]),
    el('label', { class: 'campo' }, ['Nota interna (opcional)', notas]),
    el('div', { class: 'fila', style: 'margin-top:12px' }, [
      guardar,
      el('button', { class: 'fantasma', text: 'Cancelar', onclick: () => { caja.remove(); volver(); } }),
    ]),
    aviso,
  ]);
  setTimeout(() => pregunta.focus(), 30);
  return caja;
}


