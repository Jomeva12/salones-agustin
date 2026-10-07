// Las visitas de prospectos y los ensayos, día por día.
//
// Van juntos porque ocupan el mismo recurso: el tiempo de la encargada en ese
// salón. Y por eso esta pantalla es la pieza de la que depende todo lo demás —
// si los ensayos no se capturan aquí, el cálculo de huecos miente y el agente
// propone una hora que ya estaba tomada.
//
// El agente nunca confirma: deja la cita en «solicitada». Quien confirma es
// quien está aquí.
import { api, error, salonActual, puede } from './api.js';
import { el, limpiar, cargando, fechaLarga, DIAS } from './ui.js';

const ESTADO = {
  solicitada: 'Por confirmar',
  confirmada: 'Confirmada',
  asistio: 'Asistió',
  no_asistio: 'No asistió',
  cancelada: 'Cancelada',
};

const hoyISO = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')].join('-');
};

export async function citas(raiz) {
  limpiar(raiz);
  const cont = el('div', { class: 'citas-pag' });
  raiz.appendChild(cont);

  let fecha = hoyISO();
  let salon = salonActual() || 'norma';

  const cabecera = el('header', { class: 'cit-cab' });
  const cuerpo = el('div');
  cont.append(cabecera, cuerpo);

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
    const delDia = (dia.citas ?? []).filter((c) => c.estado !== 'cancelada');

    cuerpo.appendChild(el('div', { class: 'cit-dia' }, [
      el('b', { text: fechaLarga(fecha) }),
      el('span', { class: huecos.abierto ? '' : 'cit-cerrado',
        text: huecos.abierto
          ? `${delDia.length} ${delDia.length === 1 ? 'cita' : 'citas'} · ` +
            (huecos.horas.length === 0 ? 'sin horas libres'
             : huecos.horas.length === 1 ? 'queda 1 hora libre'
             : `quedan ${huecos.horas.length} horas libres`)
          : 'Cerrado' }),
    ]));

    if (!huecos.abierto && huecos.motivo) {
      cuerpo.appendChild(el('p', { class: 'cit-nota', text: huecos.motivo }));
    }

    // Lo del día, en orden. La hora manda: es como lo lee quien está en el
    // salón mirando qué sigue.
    if (!delDia.length) {
      cuerpo.appendChild(el('p', { class: 'cit-vacio', text: 'Nada agendado este día.' }));
    } else {
      const lista = el('div', { class: 'cit-lista' });
      for (const c of delDia) lista.appendChild(fila(c, pintar));
      cuerpo.appendChild(lista);
    }

    if (huecos.abierto && puede('agenda')) {
      cuerpo.appendChild(nuevo(salon, fecha, huecos.horas, pintar));
    }
  }

  function fila(c, recargar) {
    const etiqueta = el('span', { class: 'cit-estado e-' + c.estado, text: ESTADO[c.estado] ?? c.estado });
    const quien = c.tipo === 'ensayo'
      ? el('span', { class: 'cit-tipo', text: 'ensayo' })
      : null;

    const acciones = el('div', { class: 'cit-acciones' });
    if (puede('agenda')) {
      const mover = async (estado) => {
        try { await api.cambiarCita({ id: c.id, estado }); await recargar(); }
        catch (e) { alert(e.message); }
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
        acciones.appendChild(el('button', { class: 'fantasma', text: 'Cancelar',
          onclick: () => mover('cancelada') }));
      }
    }

    return el('div', { class: 'cit-fila' }, [
      el('div', { class: 'cit-hora' }, [
        el('b', { text: c.hora }),
        el('span', { text: `${c.minutos} min` }),
      ]),
      el('div', { class: 'cit-quien', style: 'min-width:0' }, [
        el('b', { text: c.nombre || (c.tipo === 'ensayo' ? 'Ensayo' : 'Sin nombre') }),
        el('span', {}, [c.telefono || '', quien]),
        c.notas ? el('span', { class: 'cit-notas', text: c.notas }) : null,
      ]),
      etiqueta,
      acciones,
    ]);
  }

  function nuevo(salon, fecha, horas, recargar) {
    const tipo = el('select', {}, [
      el('option', { value: 'visita', text: 'Visita de un prospecto' }),
      el('option', { value: 'ensayo', text: 'Ensayo' }),
    ]);
    const hora = el('select', {}, horas.map((h) => el('option', { value: h, text: h })));
    const nombre = el('input', { type: 'text', placeholder: 'Nombre de quien viene' });
    const telefono = el('input', { type: 'text', placeholder: 'Teléfono (opcional)' });
    const minutos = el('input', { type: 'number', value: '60', min: '15', step: '15' });
    const aviso = el('span', { class: 'cit-aviso' });

    const guardar = el('button', { class: 'primario', text: 'Agendar', onclick: async () => {
      if (!horas.length) return;
      guardar.disabled = true;
      aviso.className = 'cit-aviso';
      try {
        const r = await api.crearCita({
          salon, fecha, hora: hora.value, tipo: tipo.value,
          minutos: Number(minutos.value) || 60,
          nombre: nombre.value, telefono: telefono.value,
          // Lo que se captura aquí lo captura una persona, así que ya viene
          // confirmado: no tiene sentido que se confirme a sí misma.
          estado: 'confirmada',
        });
        if (r.aviso) { aviso.className = 'cit-aviso mal'; aviso.textContent = r.aviso; }
        nombre.value = ''; telefono.value = '';
        await recargar();
      } catch (e) {
        aviso.className = 'cit-aviso mal';
        aviso.textContent = e.message;
      } finally { guardar.disabled = false; }
    } });

    return el('div', { class: 'cit-nuevo' }, [
      el('b', { text: 'Agendar en este día' }),
      el('div', { class: 'cit-campos' }, [tipo, hora, minutos, nombre, telefono, guardar]),
      aviso,
    ]);
  }

  // ── la cabecera: qué salón y qué día ──────────────────────────────────────
  const selSalon = el('select', { onchange: () => { salon = selSalon.value; pintar(); } });
  const selFecha = el('input', { type: 'date', value: fecha,
    onchange: () => { fecha = selFecha.value; pintar(); } });
  const mover = (dias) => () => {
    const [y, m, d] = fecha.split('-').map(Number);
    const n = new Date(Date.UTC(y, m - 1, d + dias));
    fecha = n.toISOString().slice(0, 10);
    selFecha.value = fecha;
    pintar();
  };

  try {
    const salones = await api.salones();
    for (const s of salones ?? []) {
      selSalon.appendChild(el('option', { value: s.clave, text: s.nombre,
        selected: s.clave === salon ? '' : null }));
    }
  } catch { /* si falla, queda el salón por omisión */ }

  cabecera.append(
    el('h1', { text: 'Citas' }),
    el('p', { class: 'cit-sub', text:
      'Visitas de prospectos y ensayos. Los ensayos ocupan hora igual que una visita, ' +
      'así que si no se capturan aquí el agente va a proponer horas que ya estaban tomadas.' }),
    el('div', { class: 'cit-controles' }, [
      selSalon,
      el('button', { class: 'fantasma', text: '‹', 'aria-label': 'Día anterior', onclick: mover(-1) }),
      selFecha,
      el('button', { class: 'fantasma', text: '›', 'aria-label': 'Día siguiente', onclick: mover(1) }),
      el('button', { class: 'fantasma', text: 'Hoy',
        onclick: () => { fecha = hoyISO(); selFecha.value = fecha; pintar(); } }),
    ]));

  pintar();
}
