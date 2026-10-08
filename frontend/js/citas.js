// Las visitas de prospectos y los ensayos, día por día.
//
// Van juntos porque ocupan el mismo recurso: el tiempo de la encargada en ese
// salón. Y por eso esta pantalla es la pieza de la que depende todo lo demás —
// si los ensayos no se capturan aquí, el cálculo de huecos miente y el agente
// propone una hora que ya estaba tomada.
//
// El agente nunca confirma: deja la cita en «solicitada». Quien confirma es
// quien está aquí.
import { api, error, salonActual, fijarSalon, puede } from './api.js';
import { el, limpiar, cargando, fechaLarga, selectorFecha } from './ui.js';
import { confirmar } from './confirmar.js';

const ESTADO = {
  solicitada: 'Por confirmar',
  confirmada: 'Confirmada',
  asistio: 'Asistió',
  no_asistio: 'No asistió',
  cancelada: 'Cancelada',
};
const DURACIONES = [30, 45, 60, 90, 120];

const hoyISO = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')].join('-');
};
const aMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + b; };
const aHora = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** 13:00 → «1:00 pm», como se lo dice uno al cliente. */
const hora12 = (h) => {
  const [a, b] = String(h).split(':').map(Number);
  return `${a % 12 === 0 ? 12 : a % 12}:${String(b).padStart(2, '0')} ${a < 12 ? 'am' : 'pm'}`;
};
const duracion = (m) => (m % 60 ? (m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`) : `${m / 60} h`);

export async function citas(raiz) {
  limpiar(raiz);
  const cont = el('div', { class: 'citas-pag' });
  raiz.appendChild(cont);

  let fecha = hoyISO();
  let salon = salonActual() || 'norma';
  let salones = [];
  try { salones = (await api.salones()) ?? []; } catch { /* queda el salón por omisión */ }

  const cabecera = el('div');
  const cuerpo = el('div');
  cont.append(cabecera, cuerpo);

  // El formulario recuerda lo que se estaba capturando entre repintadas, y la
  // hora se puede elegir tocando un hueco libre del horario.
  const borrador = { tipo: 'visita', hora: null, minutos: 60, nombre: '', telefono: '' };

  async function pintar() {
    limpiar(cuerpo);
    cuerpo.appendChild(cargando('lista'));

    let dia, huecos;
    try {
      [dia, huecos] = await Promise.all([
        api.citas(fecha, fecha, salon),
        api.huecosCita(salon, fecha),
      ]);
    } catch (e) {
      limpiar(cuerpo);
      cuerpo.appendChild(error('No se pudo leer la agenda de citas.'));
      return;
    }

    limpiar(cuerpo);
    const delDia = (dia.citas ?? []).filter((c) => c.estado !== 'cancelada')
      .sort((a, b) => aMin(a.hora) - aMin(b.hora));
    if (!huecos.horas.includes(borrador.hora)) borrador.hora = huecos.horas[0] ?? null;

    const resumen = huecos.abierto
      ? `${delDia.length} ${delDia.length === 1 ? 'cita' : 'citas'} · ` +
        (huecos.horas.length === 0 ? 'sin horas libres'
         : huecos.horas.length === 1 ? 'queda 1 hora libre'
         : `quedan ${huecos.horas.length} horas libres`)
      : 'Cerrado';

    const izquierda = el('div', { class: 'cit-col' }, [
      el('section', { class: 'bloque-cot' }, [
        el('header', { class: 'cab-bloque' }, [
          el('h3', { text: fechaLarga(fecha) }),
          el('span', { class: `cit-resumen${huecos.abierto ? '' : ' cerrado'}`, text: resumen }),
        ]),
        el('div', { class: 'cit-cuerpo' }, [
          huecos.abierto ? horario(huecos, delDia) : el('div', { class: 'cit-cerrado-caja' }, [
            el('b', { text: 'Ese día el salón no recibe visitas' }),
            huecos.motivo ? el('p', { text: huecos.motivo }) : null,
          ]),
        ]),
      ]),
      el('section', { class: 'bloque-cot' }, [
        el('header', { class: 'cab-bloque' }, [
          el('h3', { text: 'Lo agendado' }),
          el('span', { class: 'cuenta-paq', text: delDia.length ? `${delDia.length} en el día` : '' }),
        ]),
        delDia.length
          ? el('div', { class: 'cit-lista' }, delDia.map((c) => fila(c, pintar)))
          : el('p', { class: 'cit-vacio', text: 'Nada agendado este día.' }),
      ]),
    ]);

    const derecha = huecos.abierto && puede('agenda') ? nuevo(huecos.horas, pintar) : null;
    cuerpo.appendChild(el('div', { class: `cit-rejilla${derecha ? '' : ' sola'}` }, [izquierda, derecha]));
  }

  // ── el horario del día: cada media hora, libre o tomada ───────────────────
  // Una hora no libre puede estar ocupada por una cita o bloqueada por el
  // respiro que se deja entre una y otra; se pintan distinto para que se
  // entienda por qué no se puede.
  function horario(huecos, delDia) {
    const [ini, fin] = huecos.ventana.map(aMin);
    const libres = new Set(huecos.horas);
    const tramos = el('div', { class: 'cit-horario', role: 'list' });
    for (let t = ini; t <= fin; t += 30) {
      const h = aHora(t);
      const cita = delDia.find((c) => t >= aMin(c.hora) && t < aMin(c.hora) + c.minutos);
      if (libres.has(h)) {
        tramos.append(el('button', {
          type: 'button', role: 'listitem', class: `cit-tramo libre${borrador.hora === h ? ' sel' : ''}`,
          title: puede('agenda') ? `Agendar a las ${hora12(h)}` : 'Libre',
          onclick: () => { if (!puede('agenda')) return; borrador.hora = h; pintar(); },
        }, [el('b', { text: hora12(h) }), el('span', { text: 'libre' })]));
      } else if (cita) {
        tramos.append(el('div', { role: 'listitem', class: `cit-tramo ocupado ${cita.tipo}` }, [
          el('b', { text: hora12(h) }),
          el('span', { text: cita.nombre || (cita.tipo === 'ensayo' ? 'Ensayo' : 'Visita') }),
        ]));
      } else {
        tramos.append(el('div', { role: 'listitem', class: 'cit-tramo respiro', title: 'Muy pegado a otra cita' }, [
          el('b', { text: hora12(h) }), el('span', { text: 'respiro' }),
        ]));
      }
    }
    return el('div', {}, [
      tramos,
      el('div', { class: 'cit-leyenda' }, [
        el('span', { class: 'l-libre', text: 'Libre: tócala para agendar' }),
        el('span', { class: 'l-ocupado', text: 'Con cita' }),
        el('span', { class: 'l-respiro', text: 'Respiro entre citas' }),
      ]),
    ]);
  }

  function fila(c, recargar) {
    const acciones = el('div', { class: 'cit-acciones' });
    if (puede('agenda')) {
      const mover = async (estado) => {
        try { await api.cambiarCita({ id: c.id, estado }); await recargar(); }
        catch { /* el aviso de error ya lo da api.js */ }
      };
      if (c.estado === 'solicitada') {
        acciones.appendChild(el('button', { class: 'primario', text: 'Confirmar',
          onclick: () => mover('confirmada') }));
      }
      if (c.estado === 'confirmada') {
        acciones.append(
          el('button', { text: 'Asistió', onclick: () => mover('asistio') }),
          el('button', { text: 'No asistió', onclick: () => mover('no_asistio') }));
      }
      if (c.estado !== 'cancelada' && c.estado !== 'asistio') {
        // Antes se cancelaba al primer clic; ahora pregunta.
        acciones.appendChild(el('button', { class: 'peligro', text: 'Cancelar',
          onclick: async () => {
            const hecho = await confirmar({
              titulo: '¿Cancelar esta cita?',
              texto: [el('b', { text: c.nombre || (c.tipo === 'ensayo' ? 'Ensayo' : 'Visita') }),
                ` a las ${hora12(c.hora)}. Esa hora vuelve a quedar libre para el agente.`],
              confirmar: 'Sí, cancelar la cita', cancelar: 'No, dejarla',
              accion: () => api.cambiarCita({ id: c.id, estado: 'cancelada' }),
            });
            if (hecho) await recargar();
          } }));
      }
    }

    const tel = String(c.telefono ?? '').replace(/\D/g, '');
    return el('article', { class: `cit-fila e-${c.estado}` }, [
      el('div', { class: 'cit-hora' }, [
        el('b', { text: hora12(c.hora) }),
        el('span', { text: duracion(c.minutos) }),
      ]),
      el('div', { class: 'cit-quien' }, [
        el('div', { class: 'cit-nombre' }, [
          el('b', { text: c.nombre || (c.tipo === 'ensayo' ? 'Ensayo' : 'Sin nombre') }),
          el('span', { class: `cit-tipo ${c.tipo}`, text: c.tipo === 'ensayo' ? 'Ensayo' : 'Visita' }),
        ]),
        c.telefono
          ? el('a', { class: 'cit-tel', href: tel.length >= 10 ? `https://wa.me/${tel.length === 10 ? '52' + tel : tel}` : `tel:${tel}`,
              target: '_blank', rel: 'noopener', text: c.telefono })
          : null,
        c.notas ? el('span', { class: 'cit-notas', text: c.notas }) : null,
      ]),
      el('span', { class: `cit-estado e-${c.estado}`, text: ESTADO[c.estado] ?? c.estado }),
      acciones,
    ]);
  }

  // ── agendar ───────────────────────────────────────────────────────────────
  function nuevo(horas, recargar) {
    const opciones = (lista, actual, alElegir, fmt = (v) => v) => el('div', { class: 'pildoras' },
      lista.map((v) => el('button', { type: 'button', class: `pildora${actual === v ? ' sel' : ''}`,
        text: fmt(v), onclick: () => { alElegir(v); recargar(); } })));

    const hora = el('select', {}, horas.map((h) => el('option', { value: h, text: hora12(h), selected: h === borrador.hora ? '' : null })));
    hora.addEventListener('change', () => { borrador.hora = hora.value; recargar(); });
    const nombre = el('input', { type: 'text', placeholder: 'Nombre de quien viene', value: borrador.nombre });
    nombre.addEventListener('input', () => { borrador.nombre = nombre.value; });
    const telefono = el('input', { type: 'tel', placeholder: 'Ej. 81 1234 5678', value: borrador.telefono });
    telefono.addEventListener('input', () => { borrador.telefono = telefono.value; });
    const aviso = el('span', { class: 'cit-aviso' });

    const guardar = el('button', { class: 'primario', text: horas.length ? `Agendar a las ${hora12(borrador.hora)}` : 'Sin horas libres',
      disabled: horas.length ? null : 'disabled', onclick: async () => {
        if (!horas.length) return;
        guardar.disabled = true;
        aviso.className = 'cit-aviso';
        try {
          const r = await api.crearCita({
            salon, fecha, hora: hora.value, tipo: borrador.tipo,
            minutos: borrador.minutos,
            nombre: nombre.value, telefono: telefono.value,
            // Lo que se captura aquí lo captura una persona, así que ya viene
            // confirmado: no tiene sentido que se confirme a sí misma.
            estado: 'confirmada',
          });
          if (r.aviso) { aviso.className = 'cit-aviso mal'; aviso.textContent = r.aviso; }
          borrador.nombre = ''; borrador.telefono = '';
          await recargar();
        } catch (e) {
          aviso.className = 'cit-aviso mal';
          aviso.textContent = e.message;
        } finally { guardar.disabled = false; }
      } });

    const campo = (rot, control) => el('div', { class: 'campo' }, [el('span', { class: 'etq', text: rot }), control]);
    return el('aside', { class: 'bloque-cot cit-nuevo' }, [
      el('header', { class: 'cab-bloque' }, [el('h3', { text: 'Agendar en este día' })]),
      el('div', { class: 'cit-form' }, [
        campo('Qué es', opciones(['visita', 'ensayo'], borrador.tipo, (v) => { borrador.tipo = v; },
          (v) => (v === 'visita' ? 'Visita de un prospecto' : 'Ensayo'))),
        campo('A qué hora', hora),
        campo('Cuánto dura', opciones(DURACIONES, borrador.minutos, (v) => { borrador.minutos = v; }, duracion)),
        campo('Quién viene', nombre),
        campo('Teléfono (opcional)', telefono),
      ]),
      el('div', { class: 'cit-pie' }, [guardar, aviso]),
    ]);
  }

  // ── la cabecera: qué salón y qué día ──────────────────────────────────────
  const selFecha = selectorFecha({ placeholder: 'Elige el día' });
  selFecha.value = fecha;
  selFecha.addEventListener('input', () => { fecha = selFecha.value || hoyISO(); pintar(); });
  const mover = (dias) => () => {
    const [y, m, d] = fecha.split('-').map(Number);
    const n = new Date(y, m - 1, d + dias);
    fecha = [n.getFullYear(), String(n.getMonth() + 1).padStart(2, '0'), String(n.getDate()).padStart(2, '0')].join('-');
    selFecha.value = fecha;
    pintar();
  };
  const zonaSalones = el('div');
  const pintarSalones = () => limpiar(zonaSalones).append(el('div', { class: 'pildoras' },
    (salones.length ? salones : [{ clave: salon, nombre: salon }]).map((s) => el('button', {
      type: 'button', class: `pildora${s.clave === salon ? ' sel' : ''}`, text: s.nombre.replace(' Eventos', ''),
      onclick: () => { salon = s.clave; fijarSalon(s.clave); pintarSalones(); pintar(); },
    }))));
  pintarSalones();

  cabecera.append(
    el('div', { class: 'titulo' }, [
      el('h2', { text: 'Citas' }),
      el('p', { text: 'Visitas de prospectos y ensayos. Los ensayos ocupan hora igual que una visita, ' +
        'así que si no se capturan aquí el agente va a proponer horas que ya estaban tomadas.' }),
    ]),
    el('section', { class: 'bloque-cot cit-barra' }, [
      el('div', { class: 'filtro-grupo' }, [el('span', { class: 'etq', text: 'Salón' }), zonaSalones]),
      el('div', { class: 'cit-fecha' }, [
        el('div', { class: 'navega' }, [
          el('button', { type: 'button', text: '‹', 'aria-label': 'Día anterior', onclick: mover(-1) }),
          el('button', { type: 'button', class: 'hoy-btn', text: 'Hoy',
            onclick: () => { fecha = hoyISO(); selFecha.value = fecha; pintar(); } }),
          el('button', { type: 'button', text: '›', 'aria-label': 'Día siguiente', onclick: mover(1) }),
        ]),
        selFecha,
      ]),
    ]));

  pintar();
}
