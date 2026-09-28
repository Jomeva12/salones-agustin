// Los cuatro salones: lo que el agente cuenta de cada uno y las reglas con
// las que opera.
//
// Los datos estaban en la base desde el principio pero no se veían en ninguna
// pantalla: la dirección, el WhatsApp, el horario de visitas y el párrafo de
// venta son justo lo que el agente va a contestar, y nadie podía corregirlos.
//
// Dos clases de campo, y se tratan distinto a propósito:
//   · los DESCRIPTIVOS los conoce mejor quien está en el salón.
//   · los OPERATIVOS (capacidad, aseo, cierre) mandan sobre la agenda y sobre
//     el precio, así que son del administrador.
import { api, error, puede, sesion } from './api.js';
import { el, limpiar, cargando, icono, abrirCajon, cerrarCajon, MESES } from './ui.js';

const CAMPOS = [
  ['direccion', 'Dirección', 'Como se la dictas a un cliente que va llegando.'],
  ['maps_url', 'Enlace de Google Maps', 'El que se manda por WhatsApp.'],
  ['whatsapp', 'WhatsApp del salón', null],
  ['encargada', 'Encargada', 'Su nombre aparece cuando hay que confirmar una fecha.'],
  ['encargada_wa', 'WhatsApp de la encargada', null],
  ['horario_visitas', 'Horario para visitas', 'Cuándo puede ir un cliente a conocerlo.'],
  ['estacionamiento', 'Estacionamiento', null],
  ['fanpage', 'Facebook', 'La URL completa de la fanpage.'],
  ['instagram', 'Instagram', null],
  ['tiktok', 'TikTok', null],
];

export async function salones(raiz) {
  limpiar(raiz);
  const cont = el('div', { class: 'salones-pag' });
  raiz.append(cont);
  cont.append(el('div', { class: 'titulo' }, [
    el('h2', { text: 'Salones' }),
    el('p', { text: 'Lo que se le cuenta al cliente de cada salón, y las reglas con las que opera.' }),
  ]));
  const zona = el('div');
  cont.append(zona);
  await pintar(zona);
}

async function pintar(zona) {
  limpiar(zona).append(cargando());
  let lista;
  try { lista = await api.salones(); }
  catch (e) { limpiar(zona).append(error('No se pudo cargar: ' + e.message)); return; }

  limpiar(zona);
  const yo = sesion();
  const soloEl = yo?.rol !== 'admin' && yo?.salon ? yo.salon : null;
  if (soloEl) {
    zona.append(el('div', { class: 'aviso info', style: 'margin-bottom:16px' }, [
      'Tu cuenta está asignada a un salón: puedes corregir sus datos de contacto. ',
      'Los demás los ves, pero no los cambias.',
    ]));
  }
  // Los cuatro de un vistazo: cuánta gente recibe cada uno y hasta dónde
  // está capturada su agenda. Tocar uno baja a su ficha.
  zona.append(el('div', { class: 'salones-resumen' }, lista.map((s) => resumenSalon(s))));
  zona.append(el('div', { class: 'salones-rejilla' }, lista.map((s) => tarjetaSalon(s, zona, soloEl))));
}

// ── vista general ───────────────────────────────────────────────────────────
const TOPE = 300; // la barra de capacidad va de 0 al salón más grande
const agendaCorta = (iso) => {
  if (!iso) return true;
  const lim = new Date(); lim.setFullYear(lim.getFullYear() + 1);
  return iso < lim.toISOString().slice(0, 10);
};
const mesAnio = (iso) => { const [y, m] = iso.split('-').map(Number); return `${MESES[m - 1].slice(0, 3)} ${y}`; };

function resumenSalon(s) {
  const corta = agendaCorta(s.confirmada_hasta);
  return el('button', { type: 'button', class: 'resumen-salon',
    onclick: () => document.getElementById('salon-' + s.clave)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [
    el('b', { text: s.nombre.replace(' Eventos', '') }),
    el('div', { class: 'cap-num' }, [el('span', { text: `${s.capacidad_min}–${s.capacidad_max}` }), ' invitados']),
    el('div', { class: 'barra-cap', title: `De ${s.capacidad_min} a ${s.capacidad_max} invitados` }, [
      el('i', { style: `left:${s.capacidad_min / TOPE * 100}%;width:${(s.capacidad_max - s.capacidad_min) / TOPE * 100}%` }),
    ]),
    el('div', { class: `estado-agenda${corta ? ' corta' : ''}` },
      s.confirmada_hasta ? `Agenda hasta ${mesAnio(s.confirmada_hasta)}` : 'Agenda sin capturar'),
  ]);
}

// Iconos de línea, del mismo grosor que los del menú.
const TRAZO = {
  direccion: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  whatsapp: 'M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z',
  encargada: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  horario_visitas: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  estacionamiento: 'M5 21V5a2 2 0 0 1 2-2h6a5 5 0 0 1 0 10H9M9 3v18',
  fanpage: 'M14 9h-2.5a1.5 1.5 0 0 0-1.5 1.5V21M8 14h5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 7h.01',
  tiktok: 'M15 4v9.5a3.5 3.5 0 1 1-3.5-3.5M15 4a4.5 4.5 0 0 0 4.5 4.5',
};
const ico = (k) => { const s = icono('hoy'); s.querySelector('path').setAttribute('d', TRAZO[k]); return s; };
// Los números de Monterrey vienen sin lada de país: wa.me pide el 52.
const wa = (t) => { const d = String(t ?? '').replace(/\D/g, ''); return d ? `https://wa.me/${d.length === 10 ? '52' + d : d}` : null; };
const limpiarUrl = (u) => String(u).replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');

function tarjetaSalon(s, zona, soloEl) {
  const corto = s.nombre.replace(' Eventos', '');
  const mio = !soloEl || soloEl === s.clave;
  const editable = puede('salones') && mio;
  const esAdmin = sesion()?.rol === 'admin';

  // Contacto: cada dato con su icono y, si se puede, su acción.
  const fila = (k, rot, valor, accion) => el('div', { class: 'contacto-fila' }, [
    el('span', { class: 'contacto-ico' }, [ico(k)]),
    el('div', { class: 'contacto-txt' }, [el('span', { class: 'r', text: rot }), valor]),
    accion ?? null,
  ]);
  const enlace = (href, texto) => el('a', { href, target: '_blank', rel: 'noopener', class: 'accion-salon', text: texto });
  const contacto = el('div', { class: 'contacto-salon' });
  if (s.direccion) contacto.append(fila('direccion', 'Dirección', el('span', { class: 'v', text: s.direccion }),
    s.maps_url ? enlace(s.maps_url, 'Abrir en Maps ↗') : null));
  if (s.whatsapp) contacto.append(fila('whatsapp', 'WhatsApp del salón', el('span', { class: 'v', text: s.whatsapp }),
    wa(s.whatsapp) ? enlace(wa(s.whatsapp), 'Escribir ↗') : null));
  if (s.encargada) contacto.append(fila('encargada', 'Encargada', el('span', { class: 'v', text: s.encargada }),
    s.encargada_wa && wa(s.encargada_wa) ? enlace(wa(s.encargada_wa), 'WhatsApp ↗') : null));
  if (s.horario_visitas) contacto.append(fila('horario_visitas', 'Visitas', el('span', { class: 'v', text: s.horario_visitas })));
  if (s.estacionamiento) contacto.append(fila('estacionamiento', 'Estacionamiento', el('span', { class: 'v', text: s.estacionamiento })));
  // Una fila por red. Se guardan ya con https:// (el API las normaliza), pero
  // el guard se queda: una base vieja puede traerlas sin protocolo, y sin él
  // el enlace resuelve contra el panel en vez de contra Facebook.
  for (const [k, rot] of [['fanpage', 'Facebook'], ['instagram', 'Instagram'], ['tiktok', 'TikTok']]) {
    if (!s[k]) continue;
    const href = /^https?:/i.test(s[k]) ? s[k] : 'https://' + String(s[k]).replace(/^@/, 'tiktok.com/@');
    contacto.append(fila(k, rot, el('a', { href, target: '_blank', rel: 'noopener',
      class: 'v enlace', text: limpiarUrl(s[k]) })));
  }
  if (!contacto.children.length) contacto.append(el('div', { class: 'vacio', text: 'Sin datos de contacto capturados.' }));

  // El párrafo de venta es largo: se ve el principio y se abre completo.
  let diferenciador = null;
  if (s.diferenciador) {
    const p = el('p', { class: 'recortado', text: s.diferenciador });
    const mas = el('button', { type: 'button', class: 'leer-mas', text: 'Leer completo',
      onclick: () => { const abierto = p.classList.toggle('recortado'); mas.textContent = abierto ? 'Leer completo' : 'Mostrar menos'; } });
    diferenciador = el('div', { class: 'diferenciador' }, [
      el('span', { class: 'r', text: 'Por qué este salón' }), p, s.diferenciador.length > 220 ? mas : null]);
  }

  const corta = agendaCorta(s.confirmada_hasta);
  return el('section', { class: 'bloque-cot salon-ficha', id: 'salon-' + s.clave }, [
    el('header', { class: 'cab-salon' }, [
      el('div', { class: 'nombre-salon' }, [
        el('h3', { text: corto }),
        el('span', { class: 'cap-chip', text: `${s.capacidad_min}–${s.capacidad_max} invitados` }),
      ]),
      el('div', { class: 'reglas' }, [
        regla(`${s.minutos_aseo / 60} h`, 'aseo entre eventos'),
        regla(hora12(s.cierre_maximo), 'cierre'),
      ]),
    ]),
    el('div', { class: 'cuerpo-salon' }, [contacto, diferenciador]),
    el('footer', { class: 'pie-salon' }, [
      el('span', { class: `estado-agenda${corta ? ' corta' : ''}`, text: s.confirmada_hasta
        ? `${s.encargada ?? 'La encargada'} capturó su agenda hasta el ${fechaBonita(s.confirmada_hasta)}`
        : 'La agenda no está capturada' }),
      editable ? el('button', { class: 'primario', text: 'Corregir datos', onclick: () => {
        // El formulario va en el panel lateral: dentro de la ficha la volvía
        // enorme y empujaba a los otros salones.
        const cuerpo = abrirCajon(`Corregir ${corto}`, 'Lo que el agente le cuenta al cliente y cómo opera');
        cuerpo.closest('.cajon')?.classList.add('form');
        cuerpo.classList.add('cajon-cuerpo');
        const panel = el('div', { class: 'cajon-panel' });
        cuerpo.append(panel);
        panel.append(formulario(s, esAdmin, cerrarCajon, zona));
      } }) : null,
    ].filter(Boolean)),
  ]);
}

const fechaBonita = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} de ${MESES[m - 1]} de ${y}`; };

// ── el formulario ───────────────────────────────────────────────────────────
function formulario(s, esAdmin, volver, zona) {
  const campos = {};
  const caja = el('div', { class: 'edita' });
  const aviso = el('div', { class: 'aviso-form' });

  const nombre = el('input', { type: 'text', value: s.nombre, style: 'width:100%' });
  campos.nombre = nombre;
  caja.append(el('label', { class: 'campo' }, ['Nombre del salón', nombre]));

  for (const [k, rot, ayuda] of CAMPOS) {
    const inp = el('input', { type: 'text', value: s[k] ?? '', style: 'width:100%' });
    campos[k] = inp;
    caja.append(el('label', { class: 'campo' }, [rot, inp,
      ayuda ? el('span', { class: 'ayuda', text: ayuda }) : null].filter(Boolean)));
  }

  const dif = el('textarea', { rows: '4', style: 'width:100%' });
  dif.value = s.diferenciador ?? '';
  campos.diferenciador = dif;
  caja.append(el('label', { class: 'campo' }, [
    'Por qué este salón', dif,
    el('span', { class: 'ayuda', text: 'Es el texto que el agente usa cuando preguntan qué lo hace especial.' }),
  ]));

  // ── reglas de operación ───────────────────────────────────────────────────
  caja.append(el('div', { class: 'rotulo', style: 'margin-top:20px', text: 'Cómo opera' }));
  if (!esAdmin) {
    caja.append(el('div', { class: 'aviso atencion', style: 'margin-bottom:12px' }, [
      'La capacidad, el tiempo de aseo y la hora de cierre solo los cambia un administrador: ',
      'mandan sobre la agenda y sobre el precio de los cuatro salones.',
    ]));
  }
  const capMin = el('input', { type: 'number', min: '1', value: String(s.capacidad_min), disabled: !esAdmin });
  const capMax = el('input', { type: 'number', min: '1', value: String(s.capacidad_max), disabled: !esAdmin });
  const aseo = el('select', { disabled: !esAdmin }, [30, 60, 90, 120, 150, 180, 240].map((m) =>
    el('option', { value: String(m), text: m % 60 ? `${m} min` : `${m / 60} h`, selected: s.minutos_aseo === m })));
  const cierre = el('select', { disabled: !esAdmin }, ['23:00', '00:00', '01:00', '02:00'].map((h) =>
    el('option', { value: h, text: hora12(h), selected: s.cierre_maximo === h })));
  Object.assign(campos, { capacidad_min: capMin, capacidad_max: capMax, minutos_aseo: aseo, cierre_maximo: cierre });

  caja.append(el('div', { class: 'fila' }, [
    el('label', { class: 'campo' }, ['Mínimo de invitados', capMin]),
    el('label', { class: 'campo' }, ['Máximo de invitados', capMax]),
    el('label', { class: 'campo' }, ['Aseo entre eventos', aseo]),
    el('label', { class: 'campo' }, ['Hora de cierre', cierre]),
  ]));

  // La última hora de inicio no se captura: sale del cierre menos la duración
  // del paquete. Se muestra para que se vea qué consecuencia tiene moverlo.
  const efecto = el('div', { class: 'derivado' });
  const verEfecto = () => {
    const fin = horaAMin(cierre.value) + (horaAMin(cierre.value) < 720 ? 1440 : 0);
    limpiar(efecto).append(
      el('b', { text: `Un evento de 5 h tendría que empezar a más tardar a las ${minAHora(fin - 300)}` }),
      el('span', { text: 'Se calcula solo: la hora de cierre menos lo que dura el paquete.' }),
    );
  };
  cierre.addEventListener('change', verEfecto);
  verEfecto();
  caja.append(efecto);

  const guardar = el('button', { class: 'primario', text: 'Guardar', onclick: async () => {
    aviso.textContent = '';
    guardar.disabled = true;
    const datos = { clave: s.clave };
    for (const [k, inp] of Object.entries(campos)) {
      if (inp.disabled) continue;
      datos[k] = inp.value;
    }
    try {
      const r = await api.editarSalon(datos);
      if (r.error) { aviso.textContent = r.detalle ?? r.error; guardar.disabled = false; return; }
      cerrarCajon();
      await pintar(zona);
    } catch (e) { aviso.textContent = e.message; guardar.disabled = false; }
  } });

  caja.append(el('div', { class: 'fila', style: 'margin-top:16px' }, [
    guardar,
    el('button', { class: 'fantasma', text: 'Cancelar', onclick: () => { caja.remove(); volver(); } }),
  ]), aviso);
  return caja;
}

// ── utilidades ──────────────────────────────────────────────────────────────
const regla = (valor, rotulo) =>
  el('div', { class: 'regla-salon' }, [el('b', { text: valor }), el('span', { text: rotulo })]);

const horaAMin = (h) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
const minAHora = (m) => {
  const d = ((m % 1440) + 1440) % 1440;
  return hora12(`${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`);
};
function hora12(h24) {
  if (!h24) return '—';
  const [h, m] = h24.split(':').map(Number);
  const suf = h < 12 ? 'am' : 'pm';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${suf}`;
}
const cortar = (t) => (t.length > 46 ? t.slice(0, 44) + '…' : t);
