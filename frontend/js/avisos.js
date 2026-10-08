// Lo que el agente no pudo resolver y le toca a una persona.
//
// La regla del Lic. Barrón es que el agente nunca deje al cliente sin
// información: si no tiene un dato, no se apaga — avisa y sigue conversando.
// Esta pantalla es donde queda ese aviso, para que ninguno se pierda entre los
// mensajes del grupo de WhatsApp. Uno de las 2 de la madrugada se lee aquí a
// las 9.
import { api, error, salonActual, puede } from './api.js';
import { el, limpiar, cargando } from './ui.js';

const MOTIVO = {
  sin_dato: 'Falta un dato',
  cita: 'Quiere agendar una visita',
  disponibilidad: 'Pregunta por disponibilidad',
  apartado: 'Quiere apartar la fecha',
  descuento: 'Pide descuento',
  contratar: 'Quiere contratar',
  queja: 'Se queja o reclama',
  humano: 'Pide hablar con una persona',
};
// Tres tipos de urgencia, cada uno con su color: lo que necesita a una persona
// ya, lo que es una venta por cerrar, y lo que solo es un dato que falta.
const TIPO = {
  queja: 'urgente', humano: 'urgente', contratar: 'urgente', apartado: 'urgente',
  cita: 'venta', disponibilidad: 'venta', descuento: 'venta',
  sin_dato: 'dato',
};
const TIPO_TXT = { urgente: 'Atender ya', venta: 'Venta por cerrar', dato: 'Falta información' };
const ESPERA_LARGA_MIN = 120;

const aFecha = (iso) => new Date(String(iso).replace(' ', 'T') + 'Z');
const minutosDesde = (iso) => (iso ? Math.max(0, Math.round((Date.now() - aFecha(iso).getTime()) / 60000)) : 0);

// «hace 3 h» se lee de un vistazo; una marca de tiempo hay que calcularla.
function hace(iso) {
  if (!iso) return '';
  const min = minutosDesde(iso);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}
const cuandoExacto = (iso) => (iso ? aFecha(iso).toLocaleString('es-MX',
  { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }) : '');

export async function avisos(raiz) {
  limpiar(raiz);
  const cont = el('div', { class: 'avisos-pag' });
  raiz.appendChild(cont);

  let soloPendientes = true;

  const cabecera = el('div');
  const cuerpo = el('div');
  cont.append(cabecera, cuerpo);

  const pestanas = el('div', { class: 'segmentos', role: 'tablist' });
  const pintarPestanas = (n) => {
    limpiar(pestanas).append(
      el('button', { type: 'button', role: 'tab', class: soloPendientes ? 'sel' : '',
        onclick: () => { soloPendientes = true; pintar(); } },
        ['Pendientes', n ? el('b', { class: 'avi-cuenta', text: String(n) }) : null]),
      el('button', { type: 'button', role: 'tab', class: soloPendientes ? '' : 'sel', text: 'Todos',
        onclick: () => { soloPendientes = false; pintar(); } }),
    );
  };

  async function pintar() {
    limpiar(cuerpo);
    cuerpo.appendChild(cargando('lista'));
    let d;
    try {
      d = await api.avisos(soloPendientes ? 'pendiente' : null, salonActual() || null);
    } catch {
      limpiar(cuerpo);
      cuerpo.appendChild(error('No se pudieron leer los avisos.'));
      return;
    }
    limpiar(cuerpo);
    const lista = d.avisos ?? [];
    const pendientes = lista.filter((a) => a.estado === 'pendiente');
    pintarPestanas(typeof d.pendientes === 'number' ? d.pendientes : pendientes.length);

    if (!lista.length) {
      cuerpo.appendChild(el('div', { class: 'bloque-cot avi-vacio' }, [
        el('div', { class: 'avi-vacio-ico', text: '✓' }),
        el('b', { text: soloPendientes ? 'Nada pendiente' : 'Todavía no hay avisos' }),
        el('p', { text: soloPendientes
          ? 'El agente está resolviendo solo. Cuando algo necesite a una persona, aparece aquí.'
          : 'Cuando el agente no pueda resolver algo, el aviso quedará aquí.' }),
      ]));
      return;
    }

    // La urgencia primero: cuántos clientes esperan y desde cuándo.
    if (pendientes.length) {
      const masViejo = pendientes.reduce((a, b) => (aFecha(a.creado_en) < aFecha(b.creado_en) ? a : b));
      const urgentes = pendientes.filter((a) => TIPO[a.motivo] === 'urgente').length;
      cuerpo.appendChild(el('div', { class: 'avi-resumen' }, [
        el('div', { class: 'dato' }, [el('b', { text: String(pendientes.length) }),
          el('span', { text: pendientes.length === 1 ? 'cliente esperando respuesta' : 'clientes esperando respuesta' })]),
        el('div', { class: 'dato' }, [el('b', { text: hace(masViejo.creado_en).replace('hace ', '') }),
          el('span', { text: 'lleva esperando el más antiguo' })]),
        el('div', { class: `dato${urgentes ? ' alerta' : ''}` }, [el('b', { text: String(urgentes) }),
          el('span', { text: urgentes === 1 ? 'necesita a una persona ya' : 'necesitan a una persona ya' })]),
      ]));
    }

    // Pendientes arriba y del más viejo al más nuevo: el que más ha esperado
    // es el primero que hay que contestar. Lo atendido va después.
    const orden = [...lista].sort((a, b) =>
      (a.estado === 'pendiente' ? 0 : 1) - (b.estado === 'pendiente' ? 0 : 1)
      || (a.estado === 'pendiente' ? aFecha(a.creado_en) - aFecha(b.creado_en) : aFecha(b.creado_en) - aFecha(a.creado_en)));
    cuerpo.appendChild(el('div', { class: 'avi-lista' }, orden.map(tarjeta)));
  }

  function tarjeta(a) {
    const pendiente = a.estado === 'pendiente';
    const tipo = TIPO[a.motivo] ?? 'dato';
    const espera = minutosDesde(a.creado_en);
    const acciones = el('div', { class: 'avi-acciones' });

    if (a.lead_id) {
      acciones.appendChild(el('a', { class: 'avi-enlace',
        href: `https://administracioneventos6.kommo.com/leads/detail/${a.lead_id}`,
        target: '_blank', rel: 'noopener', text: 'Abrir en Kommo ↗' }));
    }
    if (pendiente && puede('agenda')) {
      acciones.appendChild(el('button', { class: 'primario', text: 'Ya lo atendí',
        onclick: async (ev) => {
          ev.target.disabled = true;
          try { await api.atenderAviso(a.id); await pintar(); }
          catch { ev.target.disabled = false; /* el aviso de error ya lo da api.js */ }
        } }));
    }

    return el('article', { class: `avi-tarjeta t-${tipo}${pendiente ? '' : ' hecho'}` }, [
      el('div', { class: 'avi-arriba' }, [
        el('div', { class: 'avi-motivo' }, [
          el('span', { class: `avi-tipo t-${tipo}`, text: TIPO_TXT[tipo] }),
          el('b', { text: MOTIVO[a.motivo] ?? a.motivo }),
        ]),
        el('div', { class: 'avi-meta' }, [
          el('span', { class: 'avi-donde', text: a.salon_nombre ? a.salon_nombre.replace(' Eventos', '') : 'Sin salón' }),
          el('span', { class: `avi-cuando${pendiente && espera >= ESPERA_LARGA_MIN ? ' tarde' : ''}`,
            title: cuandoExacto(a.creado_en), text: hace(a.creado_en) }),
        ]),
      ]),
      el('p', { class: 'avi-texto', text: a.texto }),
      el('div', { class: 'avi-pie' }, [
        el('div', { class: 'avi-estado' }, [
          a.recordatorios
            ? el('span', { class: 'avi-insiste',
                text: `Se recordó ${a.recordatorios} ${a.recordatorios === 1 ? 'vez' : 'veces'}` })
            : null,
          !pendiente
            ? el('span', { class: 'avi-hecho-por',
                text: `✓ Atendido ${hace(a.atendido_en)}${a.atendido_por ? ' por ' + a.atendido_por : ''}` })
            : null,
        ]),
        acciones,
      ]),
    ]);
  }

  cabecera.append(
    el('div', { class: 'titulo' }, [
      el('h2', { text: 'Avisos' }),
      el('p', { text: 'Lo que el agente no pudo resolver solo. Mientras un aviso siga aquí, hay un ' +
        'cliente esperando una respuesta que nadie le ha dado.' }),
    ]),
    el('section', { class: 'bloque-cot avi-barra' }, [
      pestanas,
      el('span', { class: 'avi-filtro-salon', text: salonActual()
        ? 'Solo los de este salón. Para verlos todos, elige «Los cuatro salones» en el menú.'
        : 'De los cuatro salones' }),
    ]));
  pintarPestanas(0);

  pintar();
}
