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

// «hace 3 h» se lee de un vistazo; una marca de tiempo hay que calcularla.
function hace(iso) {
  if (!iso) return '';
  const t = new Date(iso.replace(' ', 'T') + 'Z').getTime();
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

export async function avisos(raiz) {
  limpiar(raiz);
  const cont = el('div', { class: 'avisos-pag' });
  raiz.appendChild(cont);

  let soloPendientes = true;

  const cabecera = el('header', { class: 'avi-cab' });
  const cuerpo = el('div');
  cont.append(cabecera, cuerpo);

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

    if (!(d.avisos ?? []).length) {
      cuerpo.appendChild(el('p', { class: 'avi-vacio', text: soloPendientes
        ? 'Nada pendiente. El agente está resolviendo solo.'
        : 'Todavía no hay avisos.' }));
      return;
    }

    const lista = el('div', { class: 'avi-lista' });
    for (const a of d.avisos) lista.appendChild(tarjeta(a));
    cuerpo.appendChild(lista);
  }

  function tarjeta(a) {
    const pendiente = a.estado === 'pendiente';
    const acciones = el('div', { class: 'avi-acciones' });

    if (a.lead_id) {
      acciones.appendChild(el('a', { class: 'fantasma avi-enlace',
        href: `https://administracioneventos6.kommo.com/leads/detail/${a.lead_id}`,
        target: '_blank', rel: 'noopener', text: 'Abrir en Kommo' }));
    }
    if (pendiente && puede('agenda')) {
      acciones.appendChild(el('button', { class: 'primario', text: 'Ya lo atendí',
        onclick: async (ev) => {
          ev.target.disabled = true;
          try { await api.atenderAviso(a.id); await pintar(); }
          catch (e) { ev.target.disabled = false; alert(e.message); }
        } }));
    }

    return el('article', { class: 'avi-tarjeta' + (pendiente ? '' : ' hecho') }, [
      el('div', { class: 'avi-arriba' }, [
        el('b', { text: MOTIVO[a.motivo] ?? a.motivo }),
        el('span', { class: 'avi-donde', text: a.salon_nombre || 'Sin salón' }),
        el('span', { class: 'avi-cuando', text: hace(a.creado_en) }),
      ]),
      el('p', { class: 'avi-texto', text: a.texto }),
      a.recordatorios
        ? el('span', { class: 'avi-insiste',
            text: `Se recordó ${a.recordatorios} ${a.recordatorios === 1 ? 'vez' : 'veces'}` })
        : null,
      !pendiente
        ? el('span', { class: 'avi-hecho-por',
            text: `Atendido ${hace(a.atendido_en)}${a.atendido_por ? ' por ' + a.atendido_por : ''}` })
        : null,
      acciones,
    ]);
  }

  const filtro = el('button', { class: 'fantasma', text: 'Ver también los atendidos',
    onclick: () => {
      soloPendientes = !soloPendientes;
      filtro.textContent = soloPendientes ? 'Ver también los atendidos' : 'Ver solo pendientes';
      pintar();
    } });

  cabecera.append(
    el('h1', { text: 'Avisos' }),
    el('p', { class: 'avi-sub', text:
      'Lo que el agente no pudo resolver solo. Mientras un aviso siga aquí, hay un ' +
      'cliente esperando una respuesta que nadie le ha dado.' }),
    el('div', { class: 'avi-controles' }, [filtro]));

  pintar();
}
