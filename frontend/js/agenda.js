// Calendario de los cuatro salones. Tiene que contestar «¿está libre el 12?»
// más rápido que la libreta, y dejar registrar, corregir y cancelar sin salir.
import { api, error, pesos, usuarioActual, salonActual, fijarSalon } from './api.js';
import { el, limpiar, cargando, iso, MESES, DIAS_CORTO, fechaLarga, abrirCajon, cerrarCajon } from './ui.js';

const INICIAL = { norma: 'N', esmeralda: 'E', santacruz: 'S', quetzal: 'Q' };
const ETIQUETA = { libre: 'disponible', ocupada: 'ya tiene evento', no_confirmada: 'falta confirmar' };
const TURNO_NOMBRE = { manana: 'en la mañana', tarde: 'en la tarde', noche: 'en la noche' };
const TURNO_TEXTO = (ts) => ts.map((t) => TURNO_NOMBRE[t]).join(' o ');
const ESTATUS = [['contratado', 'Contratado'], ['separado', 'Apartado ($500)'], ['bloqueado', 'Bloqueado']];
const TURNOS = [['noche', 'Noche'], ['tarde', 'Tarde'], ['manana', 'Mañana']];

let ancla = new Date();
let filtro = salonActual();
let tipos = [];
let HORAS = [];

const enDias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  // Fecha local, no UTC: en Monterrey después de las 6 pm UTC ya es mañana.
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
};

export async function agenda(raiz) {
  limpiar(raiz);
  const cont = el('div');
  raiz.append(cont);
  cont.append(el('div', { class: 'titulo' }, [
    el('h2', { text: 'Agenda' }),
    el('p', { text: 'Solo se guarda lo que ya está comprometido. Un día sin marca está libre hasta donde cada encargada confirmó haber revisado; más allá pide confirmar.' }),
  ]));
  const zona = el('div');
  cont.append(zona);
  try {
    const cat = await api.catalogo();
    tipos = cat.tipos_evento;
    // La lista sale del API: un solo lugar decide qué horas existen.
    HORAS = cat.horas ?? [];
  } catch { tipos = []; HORAS = []; }
  await pintar(zona);
}

async function pintar(zona) {
  limpiar(zona);
  const y = ancla.getFullYear(), m = ancla.getMonth();
  const ultimo = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

  // Los salones como píldoras, igual que en Cotizar: son cinco opciones y
  // verlas todas a la vez es más rápido que abrir una lista.
  const SALONES = [['', 'Los cuatro'], ['norma', 'Norma'], ['esmeralda', 'Esmeralda'],
    ['santacruz', 'Santa Cruz'], ['quetzal', 'Quetzal']];
  const pildoras = el('div', { class: 'pildoras', role: 'radiogroup', 'aria-label': 'Qué salón ver' },
    SALONES.map(([v, t]) => el('button', {
      type: 'button', role: 'radio', 'aria-checked': String(filtro === v),
      class: `pildora${filtro === v ? ' sel' : ''}`, text: t,
      onclick: () => { filtro = v; fijarSalon(filtro); pintar(zona); },
    })));

  zona.append(el('div', { class: 'agenda-barra' }, [
    el('div', { class: 'navega' }, [
      el('button', { text: '‹', 'aria-label': 'Mes anterior', onclick: () => { ancla = new Date(y, m - 1, 1); pintar(zona); } }),
      el('button', { class: 'hoy-btn', text: 'Hoy', onclick: () => { ancla = new Date(); pintar(zona); } }),
      el('button', { text: '›', 'aria-label': 'Mes siguiente', onclick: () => { ancla = new Date(y, m + 1, 1); pintar(zona); } }),
    ]),
    el('h3', { class: 'mes-actual', text: `${MESES[m][0].toUpperCase()}${MESES[m].slice(1)} ${y}` }),
    el('div', { class: 'salon-filtro' }, [pildoras]),
  ]));

  // El calendario primero: es a lo que se entra. La fecha de captura se
  // mantiene una vez por semana y va debajo.
  const leyenda = el('div', { class: 'leyenda' });
  const marco = el('section', { class: 'bloque-cot calendario' }, [
    el('header', { class: 'cab-bloque' }, [
      el('h3', { text: filtro ? 'Eventos del mes' : 'Los cuatro salones' }),
      leyenda,
    ]),
  ]);
  const cuerpoCal = el('div', { class: 'cuerpo-cal' }, [cargando()]);
  marco.append(cuerpoCal);
  zona.append(marco);

  const zonaCaptura = el('div');
  zona.append(zonaCaptura);

  let datos, salones, disp;
  try {
    [datos, salones, disp] = await Promise.all([
      api.agenda(iso(y, m, 1), iso(y, m, ultimo)),
      api.salones(),
      // Los eventos no bastan: hace falta saber si TODAVÍA CABE otro, que es
      // lo que decide si ese día se puede vender o no.
      api.dispRango(iso(y, m, 1), iso(y, m, ultimo)),
    ]);
  } catch (e) { limpiar(cuerpoCal).append(error('No se pudo cargar: ' + e.message)); return; }
  const cupo = new Map();
  for (const d of disp) for (const x of d.salones) cupo.set(`${d.fecha}|${x.clave}`, x);

  const visibles = filtro ? salones.filter((s) => s.clave === filtro) : salones;
  const porDia = new Map();
  for (const c of datos) {
    const k = `${c.fecha}|${c.salon}`;
    if (!porDia.has(k)) porDia.set(k, []);
    porDia.get(k).push(c);
  }
  const confirmada = Object.fromEntries(salones.map((s) => [s.clave, s.confirmada_hasta]));
  /**
   * Lo que el color tiene que decir NO es «¿hay algo aquí?» sino «¿todavía
   * puedo vender este día?». Un salón con una boda de noche tiene la mañana y
   * la tarde libres: pintarlo de rojo es decirle al vendedor que no lo ofrezca.
   *
   *   libre         → cabe otro evento (esté vacío o no)
   *   ocupada       → ya no cabe nada más
   *   no_confirmada → cabría, pero la encargada no ha revisado hasta esa fecha
   */
  const estado = (f, c) => {
    const x = cupo.get(`${f}|${c}`);
    if (!x) return 'no_confirmada';
    if (!x.cabe) return 'ocupada';
    return x.confirmada ? 'libre' : 'no_confirmada';
  };
  const cuantos = (f, c) => cupo.get(`${f}|${c}`)?.eventos ?? 0;
  const ahora = new Date();
  const hoyISO = iso(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());

  limpiar(cuerpoCal);
  const rejilla = el('div', { class: 'mes' });
  for (const d of DIAS_CORTO) rejilla.append(el('div', { class: 'dow', text: d }));
  const primer = new Date(Date.UTC(y, m, 1)).getUTCDay();
  for (let i = 0; i < primer; i++) rejilla.append(el('div', { class: 'dia vacio' }));

  for (let d = 1; d <= ultimo; d++) {
    const f = iso(y, m, d);
    const dow = new Date(Date.UTC(y, m, d)).getUTCDay();
    // Con un solo salón el día tiene espacio para decir QUÉ hay, no un punto.
    let marca;
    if (visibles.length === 1) {
      const s = visibles[0];
      // Un día puede tener más de un evento: si solo se pintara el primero,
      // el segundo sería invisible en el calendario.
      const evs = porDia.get(`${f}|${s.clave}`) ?? [];
      const st = estado(f, s.clave);
      marca = el('div', { class: 'puntos' }, evs.length
        ? [
            evs.slice(0, 2).map((ev) => el('div', { class: `ev ${ev.estatus}` }, [
              el('b', { text: ev.tipo_evento ?? 'Evento' }),
              el('span', { text: ev.hora_inicio ?? (ev.estatus === 'separado' ? 'apartado' : ev.turno) }),
            ])),
            evs.length > 2 ? el('div', { class: 'ev mas', text: `+${evs.length - 2} más` }) : null,
          ]
        : [el('div', { class: `ev vacio-ev ${st}`, text: st === 'libre' ? 'libre' : 'sin confirmar' })]);
      // Con evento pero con hueco: el dato que antes no se veía.
      if (evs.length && st === 'libre') {
        marca.append(el('div', { class: 'cabe-mas', text: 'cabe otro' }));
      }
    } else {
      // Antes cada día llevaba las cuatro iniciales con su número y su color:
      // tres cosas que descifrar, cuatro veces, en una casilla de calendario.
      // Ahora solo se dibuja lo que TIENE algo. Un día del todo libre queda en
      // blanco, y así los días con trabajo saltan a la vista sin leer nada.
      marca = el('div', { class: 'salones-dia' });
      const conEvento = visibles.filter((s) => cuantos(f, s.clave) > 0);
      const porConfirmar = visibles.filter((s) => !cupo.get(`${f}|${s.clave}`)?.confirmada);

      for (const s of conEvento) {
        const x = cupo.get(`${f}|${s.clave}`);
        const n = cuantos(f, s.clave);
        const corto = s.nombre.replace(' Eventos', '');
        marca.append(el('span', {
          class: `sal ${x.cabe ? 'cabe' : 'lleno'}`,
          title: `${corto}: ${n} evento${n > 1 ? 's' : ''}. ` +
                 (x.cabe ? `Todavía cabe otro ${TURNO_TEXTO(x.huecos)}.` : 'Ya no cabe otro.'),
          // El número solo cuando hay más de uno: un «1» en todas es ruido.
          text: (INICIAL[s.clave] ?? '?') + (n > 1 ? ` ${n}` : ''),
        }));
      }
      // Lo que falta confirmar no es cosa de cada salón en la casilla: se
      // resume en una marca y el detalle está en el tooltip y al abrir el día.
      if (porConfirmar.length) {
        marca.append(el('span', { class: 'sal duda', text: '?',
          title: 'Falta que revisen su agenda: ' +
                 porConfirmar.map((s) => s.nombre.replace(' Eventos', '')).join(', ') +
                 '. Puede haber eventos en su libreta sin capturar.' }));
      }
    }
    const clases = ['dia'];
    if (visibles.length === 1) clases.push('solo');
    if (dow === 0 || dow === 5 || dow === 6) clases.push('finde');
    if (f === hoyISO) clases.push('hoy');
    const libres = visibles.filter((x) => cuantos(f, x.clave) === 0).length;
    rejilla.append(el('button', {
      class: clases.join(' '), 'aria-label': fechaLarga(f),
      title: visibles.length === 1 ? undefined
        : libres === visibles.length ? `${fechaLarga(f)}: los ${libres} salones libres`
        : `${fechaLarga(f)}: ${visibles.length - libres} con evento, ${libres} sin nada`,
      onclick: () => detalle(f, visibles, porDia, confirmada, zona),
    }, [el('div', { class: 'd', text: String(d) }), marca]));
  }
  cuerpoCal.append(rejilla);
  leyenda.append(
    el('span', { class: 'leg' }, [el('span', { class: 'sal cabe', text: 'N' }), 'tiene evento y cabe otro']),
    el('span', { class: 'leg' }, [el('span', { class: 'sal lleno', text: 'N' }), 'ya no cabe otro']),
    el('span', { class: 'leg' }, [el('span', { class: 'sal duda', text: '?' }), 'falta confirmar']),
    el('span', { class: 'leg tenue', text: 'día en blanco = los cuatro libres' }),
  );
  cuerpoCal.append(el('div', { class: 'pie-cal', text: visibles.length === 1
    ? `Mostrando solo ${visibles[0].nombre}. Toca un día para registrar, corregir o cancelar.`
    : 'Solo se marcan los salones que ya tienen evento: N Norma · E Esmeralda · ' +
      'S Santa Cruz · Q Quetzal. Toca un día para el detalle.' }));

  zonaCaptura.append(captura(salones, zona));
}

// ── panel del día ───────────────────────────────────────────────────────────
async function detalle(fecha, salones, porDia, confirmada, zona) {
  const cuerpo = abrirCajon(fechaLarga(fecha).replace(/^./, (c) => c.toUpperCase()), null);
  // Los tres horarios estándar de ese día, salón por salón. Es lo que
  // distingue «ya tiene evento» de «ya tiene evento y todavía cabe otro».
  const huecos = {};
  try {
    const res = await Promise.all(['manana', 'tarde', 'noche'].map(
      (t) => api.disponibilidad(fecha, t).then((r) => [t, r.salones ?? []])));
    for (const [t, lista] of res) {
      for (const x of lista) {
        if (x.estado !== 'ocupada') (huecos[x.salon] ??= []).push(t);
      }
    }
  } catch { /* si falla, el panel sigue sirviendo sin este matiz */ }
  if (!usuarioActual()) {
    cuerpo.append(el('div', { class: 'aviso atencion', style: 'margin-bottom:14px',
      text: 'Para registrar o cambiar algo, elige abajo a la izquierda quién está trabajando.' }));
  }
  for (const s of salones) {
    const eventos = porDia.get(`${fecha}|${s.clave}`) ?? [];
    const libre = eventos.length === 0;
    const conf = confirmada[s.clave];
    const st = !libre ? 'ocupada' : (conf && fecha <= conf ? 'libre' : 'no_confirmada');
    const suyos = huecos[s.clave] ?? [];

    const card = el('div', { class: 'tarjeta', style: 'margin-bottom:11px' }, [
      el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:10px' }, [
        el('b', { style: 'font-size:14.5px', text: s.nombre.replace(' Eventos', '') }),
        el('span', {
          class: `chip ${!libre && suyos.length ? 'libre' : st}`,
          text: libre ? ETIQUETA[st]
                      : (suyos.length ? `cabe otro ${TURNO_TEXTO(suyos)}` : 'lleno'),
        }),
      ]),
    ]);

    for (const ev of eventos) card.append(bloqueEvento(ev, zona));

    if (st === 'no_confirmada') {
      card.append(el('div', { style: 'font-size:12.5px;color:var(--tinta-3);margin-top:7px',
        text: `${s.encargada} revisó su agenda hasta el ${conf ?? '—'}.` }));
    }
    // Aunque ya haya evento se puede agregar otro: lo que manda no es la
    // fecha sino que quepan las horas de aseo entre uno y otro. Si no caben,
    // el API lo rechaza y dice con cuál choca.
    const hueco = el('div');
    const sinHora = eventos.some((e) => !e.hora_inicio || !e.hora_fin);
    if (libre || suyos.length) {
      card.append(hueco, el('button', {
        style: 'margin-top:10px',
        text: libre ? '+ Registrar evento' : `+ Agregar otro ${TURNO_TEXTO(suyos)}`,
        onclick: (e) => { e.target.remove(); hueco.append(formulario(null, s, fecha, zona)); },
      }));
    } else if (!sinHora) {
      card.append(el('div', { style: 'font-size:12.5px;color:var(--tinta-3);margin-top:9px',
        text: 'Este día ya no admite otro evento: no quedan 2 horas libres para el aseo.' }));
    }
    if (!libre && sinHora) {
      card.append(el('div', { class: 'aviso atencion', style: 'margin-top:9px;font-size:12.5px' }, [
        'Al evento de arriba le falta el horario. Sin saber a qué hora es, no se puede ',
        'calcular el aseo, así que el día se toma completo. Ponle hora con ',
        el('b', { text: 'Corregir' }), ' y entonces podrás agendar otro.',
      ]));
    }
    cuerpo.append(card);
  }
}

function bloqueEvento(ev, zona) {
  const caja = el('div', { style: 'margin-top:9px;padding-top:9px;border-top:1px solid var(--linea)' });
  const resumen = el('div', { style: 'font-size:13px;color:var(--tinta-2)' }, [
    `${ev.turno} · ${ev.estatus === 'separado' ? 'apartado' : ev.estatus}` +
    `${ev.tipo_evento ? ' · ' + ev.tipo_evento : ''}` +
    `${ev.hora_inicio ? ` (${ev.hora_inicio}–${ev.hora_fin ?? ''})` : ''}`,
  ]);
  if (ev.vence) {
    resumen.append(el('div', { style: 'margin-top:4px' },
      [el('span', { class: 'chip duda', text: `vence el ${ev.vence}` })]));
  }
  if (ev.notas) resumen.append(el('div', { style: 'font-size:12.5px;color:var(--tinta-3);margin-top:4px', text: ev.notas }));
  caja.append(resumen);

  const zonaForm = el('div');
  const acciones = el('div', { class: 'fila', style: 'margin-top:9px' });
  acciones.append(el('button', { text: 'Corregir', onclick: () => {
    acciones.hidden = true;
    zonaForm.append(formulario(ev, { clave: ev.salon, nombre: ev.salon_nombre }, ev.fecha, zona));
  } }));
  acciones.append(el('button', { text: 'Cancelar evento', style: 'color:var(--ocupada)', onclick: () => {
    acciones.hidden = true;
    zonaForm.append(confirmarCancelacion(ev, zona, () => { acciones.hidden = false; limpiar(zonaForm); }));
  } }));
  caja.append(acciones, zonaForm);
  return caja;
}

function confirmarCancelacion(ev, zona, volver) {
  const motivo = el('input', { type: 'text', placeholder: 'El cliente canceló, cambió de fecha…', style: 'width:100%' });
  const aviso = el('div', { style: 'font-size:12.5px;color:var(--ocupada);margin-top:6px' });
  return el('div', { style: 'margin-top:9px' }, [
    el('div', { class: 'aviso atencion', style: 'margin-bottom:9px',
      text: 'Al cancelar, la fecha queda libre de inmediato y se puede volver a vender. El evento se borra, pero queda registrado quién lo canceló y por qué.' }),
    el('label', { class: 'campo' }, ['Motivo', motivo]),
    el('div', { class: 'fila', style: 'margin-top:9px' }, [
      el('button', { class: 'primario', style: 'background:var(--ocupada);border-color:var(--ocupada)',
        text: 'Sí, liberar la fecha', onclick: async (e) => {
          if (!usuarioActual()) { aviso.textContent = 'Primero elige quién eres.'; return; }
          e.target.disabled = true;
          try {
            const r = await api.cancelarCompromiso({ id: ev.id, motivo: motivo.value.trim() });
            if (r.error) { aviso.textContent = r.detalle ?? r.error; e.target.disabled = false; return; }
            cerrarCajon();
            pintar(zona);
          } catch (err) { aviso.textContent = err.message; e.target.disabled = false; }
        } }),
      el('button', { text: 'No, dejarlo', onclick: volver }),
    ]),
    aviso,
  ]);
}

/** Un solo formulario para dar de alta y para corregir. */
function formulario(ev, salon, fecha, zona) {
  const nuevo = !ev;

  // Mover un evento de fecha cuesta dinero y hasta ahora no se podia hacer
  // desde el panel: habia que borrarlo y volverlo a crear, perdiendo el
  // registro. La escala de cobro vivia como parrafo en las politicas, o sea
  // como algo que alguien tenia que recordar. Aqui se pregunta al API y se
  // avisa ANTES de guardar.
  const campoFechaNueva = el('input', { type: 'date', value: ev?.fecha ?? fecha });
  const avisoCobro = el('div', { class: 'cobro-cambio', hidden: true });

  const verCobro = async () => {
    const nv = campoFechaNueva.value;
    if (nuevo || !ev || !nv || nv === ev.fecha) { avisoCobro.hidden = true; return; }
    try {
      const c = await api.costoCambioFecha(ev.id, nv);
      if (c.error) { avisoCobro.hidden = true; return; }
      // .append() no filtra nulos como hace el(): un null se renderiza como
      // el texto «null». Hay que quitarlos antes.
      limpiar(avisoCobro).append(...[
        el('div', {}, [
          el('b', { text: c.costo ? `Mover esta fecha cuesta ${pesos(c.costo)}` : 'Mover esta fecha no tiene costo' }),
          el('span', { text: ` \u2014 ${c.tramo}.` }),
        ]),
        c.cruza_anio
          ? el('div', { class: 'extra' }, [
              el('b', { text: 'Adem\u00e1s cambia de a\u00f1o. ' }),
              'Eso agrega entre ', el('b', { text: '$5,000 y $10,000' }),
              ' seg\u00fan el paquete. La pol\u00edtica no dice de qu\u00e9 depende: conf\u00edrmalo con la encargada.',
            ])
          : null,
      ].filter(Boolean));
      avisoCobro.className = 'cobro-cambio' + (c.cruza_anio ? ' ojo' : (c.costo ? '' : ' gratis'));
      avisoCobro.hidden = false;
    } catch { avisoCobro.hidden = true; }
  };
  campoFechaNueva.addEventListener('change', verCobro);
  const turno = el('select', {}, TURNOS.map(([v, t]) => el('option', { value: v, text: t })));
  const estatus = el('select', {}, ESTATUS.map(([v, t]) => el('option', { value: v, text: t })));
  const tipo = el('select', {}, [el('option', { value: '', text: 'Sin especificar' })]
    .concat(tipos.map((t) => el('option', { value: t.clave, text: t.nombre }))));
  // Se eligen, no se escriben. El texto libre es lo que dejó «13:00 pm» en la
  // base, y ahora la hora decide si el salón admite otro evento ese día.
  const opciones = () => HORAS.map((h) => el('option', { value: h, text: h }));
  const hIni = el('select', {}, opciones());
  const hFin = el('select', {}, opciones());
  // Cuánto dura, calculado en vivo: es la única forma de que se vea que un
  // fin «1:00 am» significa el día siguiente y no un evento negativo.
  const duracion = el('div', { style: 'font-size:12.5px;color:var(--tinta-3)' });
  const verDuracion = () => {
    const i = HORAS.indexOf(hIni.value), f = HORAS.indexOf(hFin.value);
    if (i < 0 || f < 0) { duracion.textContent = ''; return; }
    const pasos = (f - i + HORAS.length) % HORAS.length;
    const horas = pasos / 2;
    const cruza = f <= i;
    duracion.textContent = pasos === 0
      ? 'El inicio y el fin son la misma hora.'
      : `Dura ${horas % 1 ? horas.toFixed(1).replace('.5', ' y media') : horas} horas` +
        (cruza ? ', termina al día siguiente.' : '.') +
        (horas > 10 ? ' ¿Seguro? Revisa las horas.' : '');
    duracion.style.color = pasos === 0 || horas > 10 ? 'var(--ocupada)' : 'var(--tinta-3)';
  };
  hIni.addEventListener('change', verDuracion);
  hFin.addEventListener('change', verDuracion);
  const vence = el('input', { type: 'date' });
  const notas = el('input', { type: 'text', placeholder: 'Nombre del cliente, detalles…', style: 'width:100%' });
  const aviso = el('div', { style: 'font-size:12.5px;color:var(--ocupada);margin-top:7px' });

  // Horario típico según el turno. Es lo que más se captura, y dejarlo puesto
  // evita que el evento nazca sin horas: sin horas el día se bloquea entero y
  // ya no se le puede meter un segundo evento.
  const HORARIO = { manana: ['9:00 am', '1:00 pm'], tarde: ['1:00 pm', '5:00 pm'],
                    noche: ['8:00 pm', '1:00 am'] };
  const proponerHoras = () => {
    const [a, b] = HORARIO[turno.value] ?? HORARIO.noche;
    hIni.value = a; hFin.value = b;
    verDuracion();
  };
  if (nuevo) {
    proponerHoras();
    // Solo mientras nadie las haya tocado: si la encargada escribe una hora,
    // cambiar el turno no se la debe borrar.
    let tocado = false;
    for (const x of [hIni, hFin]) x.addEventListener('input', () => { tocado = true; });
    turno.addEventListener('change', () => { if (!tocado) proponerHoras(); });
  }

  if (ev) {
    turno.value = ev.turno;
    estatus.value = ev.estatus;
    if (ev.tipo_evento) {
      const t = tipos.find((x) => x.nombre === ev.tipo_evento);
      if (t) tipo.value = t.clave;
    }
    // Un evento viejo puede no tener hora, o tenerla fuera de la lista: en
    // ese caso se le agrega como opción para no perder el dato al guardar.
    for (const [sel, val] of [[hIni, ev.hora_inicio], [hFin, ev.hora_fin]]) {
      if (!val) { sel.prepend(el('option', { value: '', text: 'Sin hora' })); sel.value = ''; }
      else {
        if (!HORAS.includes(val)) sel.prepend(el('option', { value: val, text: `${val} (fuera de lista)` }));
        sel.value = val;
      }
    }
    verDuracion();
    vence.value = ev.vence ?? '';
    notas.value = ev.notas ?? '';
  }

  // Un apartado de $500 caduca a los 7 días: se propone solo.
  const campoVence = el('label', { class: 'campo' }, ['Vence el', vence]);
  const ajustarVence = () => {
    const esApartado = estatus.value === 'separado';
    campoVence.hidden = !esApartado;
    if (esApartado && !vence.value) vence.value = enDias(7);
  };
  estatus.addEventListener('change', ajustarVence);
  ajustarVence();

  const guardar = el('button', { class: 'primario', text: nuevo ? 'Registrar' : 'Guardar cambios',
    onclick: async () => {
      if (!usuarioActual()) { aviso.textContent = 'Primero elige quién eres, abajo a la izquierda.'; return; }
      guardar.disabled = true;
      const datos = {
        // Al corregir se manda la fecha del campo: es lo que permite mover el
        // evento sin borrarlo y volverlo a crear.
        ...(nuevo ? {} : { fecha: campoFechaNueva.value }),
        turno: turno.value, estatus: estatus.value, tipo_evento: tipo.value || null,
        hora_inicio: hIni.value, hora_fin: hFin.value,
        vence: estatus.value === 'separado' ? vence.value : '',
        notas: notas.value.trim(),
      };
      try {
        const r = nuevo
          ? await api.crearCompromiso({ ...datos, salon: salon.clave, fecha })
          : await api.editarCompromiso({ ...datos, id: ev.id });
        if (r.error) { aviso.textContent = r.detalle ?? r.error; guardar.disabled = false; return; }
        cerrarCajon();
        pintar(zona);
      } catch (e) { aviso.textContent = e.message; guardar.disabled = false; }
    } });

  return el('div', { style: 'margin-top:11px;display:flex;flex-direction:column;gap:9px' }, [
    el('div', { class: 'fila' }, [
      el('label', { class: 'campo' }, ['Turno', turno]),
      el('label', { class: 'campo' }, ['Estado', estatus]),
      el('label', { class: 'campo' }, ['Celebración', tipo]),
    ]),
    // Solo al corregir: al dar de alta, la fecha es la del dia que se abrio.
    nuevo ? null : el('label', { class: 'campo' }, ['Fecha del evento', campoFechaNueva]),
    nuevo ? null : avisoCobro,
    el('div', { class: 'fila' }, [
      el('label', { class: 'campo' }, ['Empieza', hIni]),
      el('label', { class: 'campo' }, ['Termina', hFin]),
      campoVence,
    ]),
    duracion,
    el('div', { style: 'font-size:12.5px;color:var(--tinta-3);margin-top:-3px' },
      ['La hora importa: el salón admite otro evento el mismo día si entre uno y otro ',
       'caben 2 horas de aseo. Un evento sin horario ocupa el día completo.']),
    el('label', { class: 'campo' }, ['Notas', notas]),
    el('div', { class: 'fila' }, [guardar]),
    aviso,
  ]);
}

// ── hasta qué fecha está capturada la agenda ────────────────────────────────
// El sistema solo conoce los eventos que alguien capturó aquí. Si en la libreta
// hay un evento que todavía no se pasa, ese día se vería libre y se podría
// vender dos veces. Esta fecha es la frontera entre «sé que está libre» y
// «no tengo cómo saberlo».
function captura(salones, zona) {
  const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const enPalabras = (iso) => {
    if (!iso) return 'sin definir';
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} de ${MES[m - 1]} de ${y}`;
  };

  const elegido = () => salones.find((x) => x.clave === selSalon.value) ?? salones[0];

  const selSalon = el('select', {}, salones.map((x) =>
    el('option', { value: x.clave, text: x.nombre.replace(' Eventos', '') })));
  if (filtro && salones.some((x) => x.clave === filtro)) selSalon.value = filtro;

  const campoFecha = el('input', { type: 'date' });
  const titulo = el('h3');
  const explico = el('div', { class: 'explico' });
  const resultado = el('div', { class: 'resultado' });

  const refrescarTexto = () => {
    const s = elegido();
    campoFecha.value = s.confirmada_hasta ?? '';
    titulo.textContent = `¿Hasta qué fecha ya capturaste los eventos de ${s.nombre.replace(' Eventos', '')}?`;
    limpiar(explico).append(
      'El sistema solo conoce los eventos que alguien capturó aquí. Si en la libreta de ',
      el('b', { text: s.encargada }),
      ' hay un evento que todavía no se pasa, ese día aparecería libre y se podría vender dos veces.',
      el('br'),
      el('br'),
      'Hoy está capturada hasta el ',
      el('b', { text: enPalabras(s.confirmada_hasta) }),
      '. De esa fecha en adelante, cuando alguien pregunte por un día, el sistema no dice «libre»: dice ',
      el('b', { text: '«hay que confirmar con la encargada»' }),
      '.',
    );
    resultado.textContent = '';
  };
  selSalon.addEventListener('change', refrescarTexto);

  const guardar = el('button', { class: 'primario', text: 'Guardar', onclick: async () => {
    const s = elegido();
    if (!campoFecha.value) { resultado.style.color = 'var(--ocupada)'; resultado.textContent = 'Falta la fecha.'; return; }
    guardar.disabled = true;
    try {
      await api.guardarControl({
        salon: s.clave, confirmada_hasta: campoFecha.value,
        fuente: s.fuente ?? 'libreta', responsable: s.encargada,
      });
      resultado.style.color = 'var(--libre)';
      resultado.textContent = '✓ Guardado';
      setTimeout(() => pintar(zona), 800);
    } catch (e) {
      resultado.style.color = 'var(--ocupada)';
      resultado.textContent = e.message;
      guardar.disabled = false;
    }
  } });

  // El formulario va plegado: se actualiza una vez por semana, y abierto
  // empujaba el calendario fuera de la pantalla.
  const formulario = el('div', { class: 'captura-form', hidden: 'hidden' }, [
    titulo, explico,
    el('div', { class: 'controles' }, [
      el('label', { class: 'campo' }, ['Salón', selSalon]),
      el('label', { class: 'campo' }, ['Capturado hasta', campoFecha]),
      guardar, resultado,
    ]),
  ]);
  const abrir = (clave) => {
    if (clave) { selSalon.value = clave; refrescarTexto(); }
    formulario.hidden = false;
    botonAbrir.hidden = true;
  };
  const botonAbrir = el('button', { class: 'actualizar', text: 'Actualizar fecha', onclick: () => abrir() });

  // Los cuatro de un vistazo, en un renglón: quién va al día y quién no.
  // Tocar uno abre el formulario ya con ese salón.
  const fila = el('div', { class: 'estado-todos' });
  for (const x of salones) {
    const corta = (x.confirmada_hasta ?? '') < '2028-06-01';
    fila.append(el('button', { type: 'button', class: `pastilla${corta ? ' corta' : ''}`,
      title: `Actualizar ${x.nombre}`, onclick: () => abrir(x.clave) }, [
      el('b', { text: x.nombre.replace(' Eventos', '') }),
      el('span', { text: enPalabras(x.confirmada_hasta) }),
    ]));
  }

  const caja = el('section', { class: 'bloque-cot captura' }, [
    el('header', { class: 'cab-bloque' }, [
      el('h3', { text: 'Hasta dónde está capturada la agenda' }),
      botonAbrir,
    ]),
    el('div', { class: 'cuerpo-captura' }, [
      el('p', { class: 'explica-corta', text: 'Después de esa fecha el sistema no dice «libre»: dice «hay que confirmar con la encargada». En ámbar, los que se quedan cortos.' }),
      fila,
      formulario,
    ]),
  ]);

  refrescarTexto();
  return caja;
}
