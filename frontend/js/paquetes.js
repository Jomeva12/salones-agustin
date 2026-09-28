// Los 14 paquetes, agrupados por lo que se celebra. Precios y contenido
// editables, con las validaciones que una hoja de cálculo nunca pudo hacer.
import { api, pesos, error, usuarioActual, salonActual } from './api.js';
import { el, limpiar, cargando, abrirCajon } from './ui.js';

const CORTO = { norma: 'Norma', esmeralda: 'Esmeralda', santacruz: 'Santa Cruz', quetzal: 'Quetzal' };
const ORDEN = ['XV años y bodas', 'Graduaciones', 'Posadas', 'Otras celebraciones'];

// La escalera de XV y bodas. El color de cada nivel es el que le da nombre:
// así se distinguen de un vistazo sin leer.
const NIVELES = [['bronce', 'Bronce'], ['onix', 'Onix'], ['plata', 'Plata'], ['oro', 'Oro']];
const nivelDe = (p) => NIVELES.findIndex(([k]) => p.nombre.toLowerCase().includes(k));

function grupoDe(p) {
  const n = p.nombre.toLowerCase();
  if (/bronce|onix|plata|oro/.test(n)) return 'XV años y bodas';
  if (/graduaci/.test(n)) return 'Graduaciones';
  if (/posada/.test(n)) return 'Posadas';
  return 'Otras celebraciones';
}

export async function paquetes(raiz) {
  limpiar(raiz);
  const cont = el('div');
  raiz.append(cont);
  cont.append(el('div', { class: 'titulo con-accion' }, [
    el('div', {}, [
      el('h2', { text: 'Paquetes' }),
      el('p', { text: 'Los paquetes del catálogo. Abre uno para ver o cambiar lo que incluye y sus precios.' }),
    ]),
    // Crear cuelga de aquí y no del menú: se hace dos veces al año, y un ítem
    // más en la barra estorba todos los días.
    el('a', { class: 'boton primario', href: '#/paquetes/nuevo', text: '+ Crear paquete' }),
  ]));
  const zona = el('div');
  cont.append(zona);
  zona.append(cargando('tarjetas'));

  let cat;
  try { cat = await api.catalogo(); }
  catch (e) { limpiar(zona).append(error(e.message)); return; }

  const repintar = async () => { limpiar(zona); await dibujar(zona, await api.catalogo()); };
  await dibujar(zona, cat, repintar);
}

async function dibujar(zona, cat, repintar) {
  limpiar(zona);
  const mio = salonActual();
  const lista0 = mio
    ? cat.paquetes.filter((p) => (p.salones ?? '').split(',').includes(mio))
    : cat.paquetes;
  if (mio) {
    zona.append(el('div', { class: 'aviso info', style: 'margin-bottom:16px',
      text: `Mostrando los ${lista0.length} paquetes que se ofrecen en este salón. Para verlos todos, elige «Los cuatro salones».` }));
  }
  const porGrupo = new Map(ORDEN.map((g) => [g, []]));
  for (const p of lista0) porGrupo.get(grupoDe(p)).push(p);
  // Primero los de los tres salones grandes y luego los de Quetzal, cada
  // renglón subiendo de nivel: Bronce, Onix, Plata, Oro.
  const soloQuetzal = (p) => (p.salones === 'quetzal' ? 1 : 0);
  for (const lista of porGrupo.values()) {
    lista.sort((a, b) => soloQuetzal(a) - soloQuetzal(b)
      || nivelDe(a) - nivelDe(b) || (a.desde ?? 0) - (b.desde ?? 0));
  }
  for (const g of ORDEN) {
    const lista = porGrupo.get(g);
    if (!lista.length) continue;
    // Quetzal tiene su propia línea de paquetes. Revueltos con los de los
    // otros salones, «Bronce Boda y XV» parecía un quinto nivel después de Oro.
    const quetzal = lista.filter(soloQuetzal);
    const resto = lista.filter((p) => !soloQuetzal(p));
    const partes = quetzal.length && resto.length
      ? [[resto.every((p) => (p.salones ?? '').split(',').length === 4)
          ? 'En los cuatro salones' : 'Norma, Esmeralda y Santa Cruz', resto],
         ['Solo en Quetzal', quetzal]]
      : [[null, lista]];
    const seccion = el('section', { class: 'bloque-cot grupo-paq' }, [
      el('header', { class: 'cab-bloque' }, [
        el('h3', { text: g }),
        el('span', { class: 'cuenta-paq', text: `${lista.length} paquete${lista.length > 1 ? 's' : ''}` }),
      ]),
    ]);
    for (const [sub, ps] of partes) {
      if (sub) seccion.append(el('div', { class: 'sub-paq', text: sub }));
      const rej = el('div', { class: 'rejilla-paq escalona' });
      for (const p of ps) rej.append(tarjeta(p, cat.conceptos, repintar));
      seccion.append(rej);
    }
    zona.append(seccion);
  }
}

function tarjeta(p, conceptos, repintar) {
  const porPersona = p.unidad_precio === 'por_persona';
  const salones = (p.salones ?? '').split(',').filter(Boolean);
  const nivel = NIVELES[nivelDe(p)]?.[0];
  // Un borrador se ve distinto a propósito: está en el catálogo pero NO se
  // cotiza, y quien lo dejó a medias tiene que poder verlo de lejos.
  return el('button', {
    class: `paq${nivel ? ' nivel-' + nivel : ''}${p.borrador ? ' borrador' : ''}`,
    onclick: () => (p.borrador
      ? (location.hash = '#/paquetes/nuevo?id=' + p.id)
      : abrirPaquete(p, conceptos, repintar)),
  }, [
    p.borrador
      ? el('div', { class: 'cinta-borrador' }, [
          el('b', { text: 'Sin terminar' }),
          el('span', { text: 'no se cotiza' }),
        ])
      : null,
    el('div', { class: 'cel', text: p.celebraciones ?? '—' }),
    el('div', { class: 'nom', text: p.nombre.replace('Paquete ', '') }),
    p.borrador && p.falta?.length
      ? el('div', { class: 'falta-paq' }, [
          el('b', { text: 'Falta ' }), p.falta.join(', ') + '.',
        ])
      : null,
    el('div', { class: 'rango' }, [
      el('small', { class: 'desde', text: 'desde' }),
      el('span', { class: 'monto', text: p.desde === null ? '—' : pesos(p.desde) }),
      el('small', { class: 'hasta', text: [
        p.desde === p.hasta ? '' : `hasta ${pesos(p.hasta)}`,
        porPersona ? 'por invitado' : 'según invitados y día',
      ].filter(Boolean).join(' · ') }),
    ]),
    el('div', { class: 'donde' }, [
      ...(salones.length === 4
        ? [el('span', { class: 'chip neutro', text: 'los cuatro salones' })]
        : salones.map((s) => el('span', { class: 'chip neutro', text: CORTO[s] ?? s }))),
      el('span', { class: 'abrir', text: p.borrador ? 'Terminarlo →' : 'Ver y editar →' }),
    ]),
  ].filter(Boolean));
}

// ── panel del paquete ───────────────────────────────────────────────────────
const DIAS_COL = [['precio_lun', 'Lun'], ['precio_mar', 'Mar'], ['precio_mie', 'Mié'],
  ['precio_jue', 'Jue'], ['precio_vie', 'Vie'], ['precio_sab', 'Sáb'], ['precio_dom', 'Dom']];

async function abrirPaquete(p, conceptos, repintar) {
  const salones = (p.salones ?? '').split(',').filter(Boolean);
  const cuerpo = abrirCajon(p.nombre.replace('Paquete ', ''), p.celebraciones ?? '');
  // Panel ancho y en tres pisos: cabecera fija, contenido que se desplaza y
  // barra de guardar fija. Antes todo se iba con el scroll, y al bajar por
  // la lista se perdían las pestañas y el salón que se estaba editando.
  const cajon = cuerpo.closest('.cajon');
  cajon?.classList.add('ancho');
  cuerpo.classList.add('cajon-cuerpo');
  const nivel = NIVELES[nivelDe(p)]?.[0];
  if (nivel) cajon?.classList.add('nivel-' + nivel);

  // Arranca en el salón en el que se está trabajando, si ese paquete existe ahí.
  const selSalon = { value: salones.includes(salonActual()) ? salonActual() : salones[0] };
  const bSalones = salones.map((s) => el('button', { type: 'button', class: 'pildora', 'data-v': s,
    text: CORTO[s] ?? s, onclick: () => { selSalon.value = s; refrescar(); } }));
  const panel = el('div', { class: 'cajon-panel' });
  let pestana = 'incluye';

  const bIncluye = el('button', { text: 'Qué incluye', onclick: () => { pestana = 'incluye'; refrescar(); } });
  const bPrecios = el('button', { text: 'Precios', onclick: () => { pestana = 'precios'; refrescar(); } });

  // Lo esencial del paquete, para no tener que volver a la tarjeta.
  const dato = (valor, rotulo) => el('div', { class: 'dato' }, [
    el('b', { text: valor }), el('span', { text: rotulo })]);
  const porPersona = p.unidad_precio === 'por_persona';
  const ficha = el('div', { class: 'ficha-paq' }, [
    dato(p.desde === null ? '—' : pesos(p.desde), porPersona ? 'desde, por invitado' : 'desde'),
    dato(p.hasta === null ? '—' : pesos(p.hasta), 'hasta'),
    dato(String(salones.length), salones.length === 1 ? 'salón' : 'salones'),
    dato(String(p.tarifas ?? '—'), 'precios cargados'),
  ]);

  cuerpo.append(
    el('div', { class: 'cajon-fijo' }, [
      ficha,
      el('div', { class: 'fila-controles' }, [
        el('div', { class: 'pestanas' }, [bIncluye, bPrecios]),
        salones.length > 1
          ? el('div', { class: 'pildoras' }, bSalones)
          : el('div', { class: 'solo-salon', text: `Solo en ${CORTO[salones[0]] ?? salones[0]}` }),
      ]),
    ]),
    panel,
  );

  async function refrescar() {
    bIncluye.classList.toggle('sel', pestana === 'incluye');
    bPrecios.classList.toggle('sel', pestana === 'precios');
    for (const b of bSalones) b.classList.toggle('sel', b.dataset.v === selSalon.value);
    limpiar(panel).append(cargando());
    try {
      const filas = await api.tarifas({ salon: selSalon.value, paquete: p.id });
      limpiar(panel);
      if (!filas.length) {
        panel.append(el('div', { class: 'vacio', text: 'Este paquete no se ofrece en ese salón.' }));
        return;
      }
      if (pestana === 'incluye') await pintarIncluye(panel, filas, conceptos, refrescar);
      else pintarPrecios(panel, filas, p, refrescar, repintar);
    } catch (e) { limpiar(panel).append(error(e.message)); }
  }
  await refrescar();
}

// ── pestaña: qué incluye (editable) ─────────────────────────────────────────
const ESTADOS = [['si', 'Incluye'], ['no', 'Se cobra aparte'], ['na', 'No aplica']];

async function pintarIncluye(panel, filas, conceptos, refrescar) {
  const cid = filas.find((f) => f.contenido_id)?.contenido_id;
  if (!cid) { panel.append(el('div', { class: 'vacio', text: 'Sin detalle cargado.' })); return; }
  const d = await api.contenido(cid);

  // estado: id de concepto -> 'si' | 'no' | 'na'
  const estado = new Map(conceptos.map((c) => [c.id, 'na']));
  const porNombre = new Map(conceptos.map((c) => [c.nombre, c.id]));
  for (const n of d.incluye) if (porNombre.has(n)) estado.set(porNombre.get(n), 'si');
  for (const n of d.no_incluye) if (porNombre.has(n)) estado.set(porNombre.get(n), 'no');
  const original = new Map(estado);

  // La duración salió de ser un concepto de texto («Salón por 5 horas») a ser
  // un número con el que se calcula a qué hora puede empezar el evento. Aquí
  // se ve, pero todavía no se edita: para eso falta la pantalla de paquetes.
  if (d.horas_salon) {
    panel.append(el('div', { class: 'atributos-paq' }, [
      el('div', { class: 'atributo' }, [
        el('b', { text: `${d.horas_salon} horas` }), el('span', { text: 'de salón' })]),
      d.minutos_estancia
        ? el('div', { class: 'atributo' }, [
            el('b', { text: `${d.minutos_estancia} min` }), el('span', { text: 'de estancia previa' })])
        : null,
      el('div', { class: 'atributo tenue' }, [
        el('b', { text: 'hasta la 1:00 am' }), el('span', { text: 'cierre por reglamento' })]),
    ].filter(Boolean)));
  }

  // La cortesía es un párrafo: en un campo de una línea se cortaba.
  const cortesias = el('textarea', { rows: '2', class: 'cortesia' });
  cortesias.value = d.cortesias ?? '';
  const ajustarAlto = () => { cortesias.style.height = 'auto'; cortesias.style.height = cortesias.scrollHeight + 2 + 'px'; };
  cortesias.addEventListener('input', () => { ajustarAlto(); marcar(); });
  panel.append(el('label', { class: 'campo campo-cortesia' }, [
    el('span', { class: 'etq-regalo', text: 'De cortesía' }), cortesias]));
  requestAnimationFrame(ajustarAlto);

  // Buscar y filtrar en un solo renglón. Los contadores ahora filtran.
  let filtroEstado = 'todos';
  const buscar = el('input', { type: 'search', placeholder: 'Buscar concepto…' });
  const filtros = el('div', { class: 'filtro-conceptos', role: 'radiogroup' });
  const pintarFiltros = () => {
    const n = { si: 0, no: 0, na: 0 };
    for (const v of estado.values()) n[v]++;
    limpiar(filtros);
    for (const [v, t, cuenta] of [['todos', 'Todos', conceptos.length],
      ...ESTADOS.map(([k, tx]) => [k, tx, n[k]])]) {
      filtros.append(el('button', {
        type: 'button', role: 'radio', 'aria-checked': String(filtroEstado === v),
        class: `${v}${filtroEstado === v ? ' sel' : ''}`,
        onclick: () => { filtroEstado = v; pintarLista(); },
      }, [el('b', { text: String(cuenta) }), ` ${t}`]));
    }
  };
  panel.append(el('div', { class: 'buscar-conceptos' }, [buscar, filtros]));

  const lista = el('div', { class: 'lista-conceptos' });
  panel.append(lista);

  const estadoTxt = el('span', { class: 'estado', text: 'Sin cambios' });
  const guardar = el('button', { class: 'primario', text: 'Guardar cambios', disabled: 'disabled',
    onclick: async () => {
      guardar.disabled = true;
      estadoTxt.textContent = 'Guardando…';
      try {
        const r = await api.guardarConceptos({
          contenido_id: cid,
          incluye: [...estado].filter(([, v]) => v === 'si').map(([k]) => k),
          no_incluye: [...estado].filter(([, v]) => v === 'no').map(([k]) => k),
          cortesias: cortesias.value.trim(),
        });
        if (r.error) { estadoTxt.textContent = r.detalle ?? r.error; guardar.disabled = false; return; }
        estadoTxt.textContent = `Guardado: ${r.incluye} incluidos, ${r.no_incluye} no incluidos`;
        setTimeout(refrescar, 900);
      } catch (e) { estadoTxt.textContent = e.message; guardar.disabled = false; }
    } });
  const nuevo = el('button', { text: 'Agregar concepto', onclick: () => agregarConcepto(refrescar) });

  function marcar() {
    const cambios = [...estado].filter(([k, v]) => original.get(k) !== v).length
      + (cortesias.value.trim() !== (d.cortesias ?? '').trim() ? 1 : 0);
    guardar.disabled = !cambios || !usuarioActual();
    barra.classList.toggle('sucia', cambios > 0);
    estadoTxt.textContent = !cambios ? 'Sin cambios'
      : !usuarioActual() ? 'Para guardar, elige quién está trabajando (abajo a la izquierda)'
      : `${cambios} cambio${cambios > 1 ? 's' : ''} sin guardar`;
  }

  // El orden se calcula una vez: marcar Sí o No ya no reordena la lista, así
  // el concepto no se escapa de debajo del cursor.
  const orden = [...conceptos].sort((a, b) => {
    const pa = { si: 0, no: 1, na: 2 }[estado.get(a.id)];
    const pb = { si: 0, no: 1, na: 2 }[estado.get(b.id)];
    return pa - pb || a.nombre.localeCompare(b.nombre);
  });

  function filaConcepto(c) {
    const fila = el('div', { class: `concepto-fila ${estado.get(c.id)}` });
    const tri = el('div', { class: 'tri' });
    const pintarFila = () => {
      const v = estado.get(c.id);
      fila.className = `concepto-fila ${v}${original.get(c.id) !== v ? ' cambiado' : ''}`;
      for (const b of tri.children) b.classList.toggle('sel', b.dataset.v === v);
    };
    for (const [v, t] of [['si', 'Sí'], ['no', 'No'], ['na', '—']]) {
      tri.append(el('button', {
        type: 'button', 'data-v': v, text: t,
        title: ESTADOS.find(([k]) => k === v)[1],
        onclick: () => { estado.set(c.id, v); pintarFila(); pintarFiltros(); marcar(); },
      }));
    }
    fila.append(el('div', { class: 'txt', text: c.nombre }), tri);
    pintarFila();
    return fila;
  }

  function pintarLista() {
    pintarFiltros();
    limpiar(lista);
    const q = buscar.value.trim().toLowerCase();
    let n = 0;
    for (const c of orden) {
      if (q && !c.nombre.toLowerCase().includes(q)) continue;
      if (filtroEstado !== 'todos' && estado.get(c.id) !== filtroEstado) continue;
      n++;
      lista.append(filaConcepto(c));
    }
    if (!n) lista.append(el('div', { class: 'vacio', text: 'Ningún concepto con ese filtro.' }));
  }
  buscar.addEventListener('input', pintarLista);
  pintarLista();

  const barra = el('div', { class: 'barra-guardar' }, [guardar, nuevo, estadoTxt]);
  panel.append(barra);
}

function agregarConcepto(refrescar) {
  const cuerpo = abrirCajon('Agregar concepto', 'Aparecerá en la lista de todos los paquetes');
  const nombre = el('input', { type: 'text', placeholder: 'Pista iluminada, mesas VIP…', style: 'width:100%' });
  const aviso = el('div', { style: 'margin-top:10px;font-size:13px' });
  cuerpo.append(
    el('label', { class: 'campo' }, ['Cómo se le dice al cliente', nombre]),
    el('button', { class: 'primario', style: 'margin-top:14px', text: 'Agregar', onclick: async () => {
      try {
        const r = await api.crearConcepto({ nombre: nombre.value });
        if (r.error) { aviso.style.color = 'var(--ocupada)'; aviso.textContent = r.detalle ?? r.error; return; }
        aviso.style.color = 'var(--libre)';
        aviso.textContent = `Listo. Ya puedes marcarlo en cualquier paquete.`;
        setTimeout(refrescar, 800);
      } catch (e) { aviso.style.color = 'var(--ocupada)'; aviso.textContent = e.message; }
    } }),
    aviso,
  );
  nombre.focus();
}

// ── pestaña: precios (editable) ─────────────────────────────────────────────
// Antes eran hasta nueve tablas casi iguales una debajo de otra, y no se sabía
// en cuál estaba uno. Ahora se elige año y escalón, y se ve una sola.
const FINDE = new Set(['precio_vie', 'precio_sab', 'precio_dom']);
const ORDEN_ESCALON = ['Mismo mes del evento', 'Falta 1 mes', 'Faltan 2 meses',
  'Faltan 3 a 5 meses', 'Faltan 0 a 5 meses', 'Faltan 6 meses o más'];
const CORTO_ESCALON = {
  'Mismo mes del evento': 'Mismo mes', 'Falta 1 mes': '1 mes', 'Faltan 2 meses': '2 meses',
  'Faltan 3 a 5 meses': '3 a 5 meses', 'Faltan 0 a 5 meses': '0 a 5 meses',
  'Faltan 6 meses o más': '6 meses o más',
};
const posEscalon = (e) => (e === null ? -1 : (ORDEN_ESCALON.indexOf(e) + 1 || 99));

function pintarPrecios(panel, filas, p, refrescar, repintar) {
  const porPersona = p.unidad_precio === 'por_persona';
  if (porPersona) {
    panel.append(el('div', { class: 'aviso info', style: 'margin-bottom:14px',
      text: 'Este paquete se cobra por invitado. Los precios de abajo son por persona, no por evento.' }));
  }
  if (!usuarioActual()) {
    panel.append(el('div', { class: 'aviso atencion', style: 'margin-bottom:14px',
      text: 'Para poder cambiar precios, elige abajo a la izquierda quién está trabajando. Así queda registrado quién hizo el cambio.' }));
  }

  // año -> escalón -> filas
  const anios = new Map();
  for (const f of filas) {
    if (!anios.has(f.anio)) anios.set(f.anio, new Map());
    const esc = anios.get(f.anio);
    const k = f.escalon ?? null;
    if (!esc.has(k)) esc.set(k, []);
    esc.get(k).push(f);
  }
  const listaAnios = [...anios.keys()].sort((a, b) => a - b);
  // Arranca en el año en curso si existe; si no, en el primero.
  const esteAnio = new Date().getFullYear();
  let anio = listaAnios.includes(esteAnio) ? esteAnio : listaAnios[0];
  let escalon = null;

  const navAnios = el('div', { class: 'precios-anios' });
  const navEsc = el('div', { class: 'precios-escalones' });
  const zona = el('div', { class: 'precios-zona' });
  panel.append(el('div', { class: 'precios-nav' }, [navAnios, navEsc]), zona);

  // Todas las tablas se construyen una vez y solo se muestran u ocultan:
  // así un precio editado en una no se pierde al mirar otra.
  const tablas = new Map();
  const clave = (a, e) => `${a}|${e ?? ''}`;
  for (const a of listaAnios) {
    for (const [e, fs] of anios.get(a)) {
      const orden = fs.sort((x, y) => x.personas_desde - y.personas_desde);
      const vals = orden.flatMap((f) => DIAS_COL.map(([k]) => f[k])).filter((v) => v > 0);
      const resumen = el('div', { class: 'precios-resumen' }, [
        el('b', { text: `${a} · ${e ?? 'Aplica todo el año'}` }),
        el('span', { text: `${orden.length} rango${orden.length > 1 ? 's' : ''} de invitados` }),
        vals.length ? el('span', { class: 'rango-precio',
          text: `de ${pesos(Math.min(...vals))} a ${pesos(Math.max(...vals))}` }) : null,
      ]);
      const t = el('table', { class: 'tabla-precios' });
      t.append(el('thead', {}, [
        el('tr', { class: 'grupo-dias' }, [
          el('th', {}), el('th', { colspan: '4', text: 'Entre semana' }),
          el('th', { colspan: '3', class: 'finde', text: 'Fin de semana' }), el('th', {}),
        ]),
        el('tr', {}, [el('th', { text: 'Invitados' }),
          ...DIAS_COL.map(([k, n]) => el('th', { class: FINDE.has(k) ? 'finde' : '', text: n })),
          el('th', {})]),
      ]));
      const tb = el('tbody');
      for (const [i2, f] of orden.entries()) tb.append(filaEditable(f, orden[i2 - 1], refrescar, repintar));
      t.append(tb);
      const caja = el('div', { class: 'bloque-precios', hidden: 'hidden' }, [resumen, el('div', { class: 'tabla-caja' }, [t])]);
      tablas.set(clave(a, e), caja);
      zona.append(caja);
    }
  }

  const tieneCambios = (k) => !!tablas.get(k)?.querySelector('tr.sucia');
  const anioConCambios = (a) => [...anios.get(a).keys()].some((e) => tieneCambios(clave(a, e)));

  function pintarNav() {
    const escalones = [...anios.get(anio).keys()].sort((x, y) => posEscalon(x) - posEscalon(y));
    if (!escalones.includes(escalon)) escalon = escalones[0];
    limpiar(navAnios).append(...listaAnios.map((a) => el('button', {
      type: 'button', class: `precios-anio${a === anio ? ' sel' : ''}${anioConCambios(a) ? ' con-cambios' : ''}`,
      onclick: () => { anio = a; pintarNav(); },
    }, [String(a), a === esteAnio ? el('small', { text: 'este año' }) : null])));
    limpiar(navEsc);
    if (escalones.length > 1 || escalones[0] !== null) {
      navEsc.append(el('span', { class: 'etq', text: 'Cuánto falta para el evento' }),
        el('div', { class: 'segmentos' }, escalones.map((e) => el('button', {
          type: 'button', class: `${e === escalon ? 'sel' : ''}${tieneCambios(clave(anio, e)) ? ' con-cambios' : ''}`,
          title: e ?? 'Aplica todo el año', text: e === null ? 'Todo el año' : (CORTO_ESCALON[e] ?? e),
          onclick: () => { escalon = e; pintarNav(); },
        }))));
    }
    for (const [k, caja] of tablas) caja.hidden = k !== clave(anio, escalon);
  }
  // Un precio editado marca su pestaña: si se cambia de tabla, se sabe que
  // allá quedó algo sin guardar.
  zona.addEventListener('input', () => pintarNav());
  zona.addEventListener('click', (e) => { if (e.target.closest('.guardar-fila')) setTimeout(pintarNav, 1600); });
  pintarNav();

  if (filas.some((f) => f.requiere_revision)) {
    panel.append(el('div', { class: 'aviso atencion', style: 'margin-top:14px',
      text: 'Las filas resaltadas tienen varias versiones del mismo precio. Resuélvelas desde Pendientes: ahí eliges cuál se queda.' }));
  }
}

// Los precios se ven como dinero («$33,700») pero se guardan como número.
// Un input type=number no deja poner el signo ni las comas, por eso es texto
// que solo acepta dígitos. Ninguna tarifa tiene centavos: sin decimales.
const soloDigitos = (t) => String(t ?? '').replace(/\D/g, '');
const leerPrecio = (inp) => { const d = soloDigitos(inp.value); return d === '' ? null : Number(d); };
const verPrecio = (n) => (n === null || n === undefined ? '' : pesos(n));

function filaEditable(f, anterior, refrescar, repintar) {
  const tr = el('tr', { class: f.requiere_revision ? 'ojo' : '' });
  tr.append(el('td', { class: 'invitados' }, f.personas_desde === f.personas_hasta
    ? [el('b', { text: String(f.personas_desde) })]
    : [el('b', { text: String(f.personas_desde) }), el('span', { text: '–' }), el('b', { text: String(f.personas_hasta) })]));

  const campos = {};
  const avisos = el('div');

  const revisar = () => {
    const vals = DIAS_COL.map(([k]) => leerPrecio(campos[k]) ?? 0).filter((v) => v > 0);
    limpiar(avisos);
    if (!vals.length) return;
    const max = Math.max(...vals);
    // Un dígito de menos: el caso del $4,940 que debía ser $49,400.
    for (const [k, n] of DIAS_COL) {
      const v = leerPrecio(campos[k]) ?? 0;
      if (v > 0 && v * 5 < max) {
        avisos.append(el('div', { class: 'aviso atencion', style: 'margin:6px 0;font-size:12.5px',
          text: `El precio de ${n} ($${v.toLocaleString('es-MX')}) es mucho más bajo que los demás. ¿Le falta un cero?` }));
      }
    }
    // El precio debe subir al subir los invitados.
    const sab = leerPrecio(campos.precio_sab) ?? 0;
    if (anterior && sab > 0 && anterior.precio_sab > 0 && sab < anterior.precio_sab) {
      avisos.append(el('div', { class: 'aviso atencion', style: 'margin:6px 0;font-size:12.5px',
        text: `Este sábado cuesta menos que el del rango anterior (${pesos(anterior.precio_sab)}). ¿Es correcto?` }));
    }
  };

  for (const [k] of DIAS_COL) {
    const inp = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off',
      value: verPrecio(f[k]) });
    campos[k] = inp;
    // Mientras se escribe, el formato se rehace sin perder la posición del
    // cursor: se cuenta cuántos dígitos había a su izquierda.
    inp.addEventListener('input', () => {
      const antes = soloDigitos(inp.value.slice(0, inp.selectionStart ?? inp.value.length)).length;
      const n = leerPrecio(inp);
      inp.value = verPrecio(n);
      let pos = 0, vistos = 0;
      while (pos < inp.value.length && vistos < antes) { if (/\d/.test(inp.value[pos])) vistos++; pos++; }
      if (document.activeElement === inp) inp.setSelectionRange(pos, pos);
      inp.classList.toggle('tocado', (f[k] ?? null) !== n);
      tr.classList.toggle('sucia', DIAS_COL.some(([c]) => (f[c] ?? null) !== leerPrecio(campos[c])));
      revisar();
    });
    inp.addEventListener('focus', () => inp.select());
    tr.append(el('td', { class: `editable${FINDE.has(k) ? ' finde' : ''}` }, [inp]));
  }

  const estado = el('span', { style: 'font-size:12px;color:var(--tinta-3)' });
  const guardar = el('button', { class: 'primario guardar-fila', text: 'Guardar',
    onclick: async () => {
      if (!usuarioActual()) { estado.textContent = 'Elige quién eres'; return; }
      guardar.disabled = true;
      try {
        const cuerpo = { id: f.id };
        for (const [k] of DIAS_COL) cuerpo[k] = leerPrecio(campos[k]);
        const r = await api.guardarTarifa(cuerpo);
        if (r.error) { estado.textContent = r.detalle ?? r.error; guardar.disabled = false; return; }
        for (const [k] of DIAS_COL) { f[k] = cuerpo[k]; campos[k].classList.remove('tocado'); }
        tr.classList.remove('sucia');
        estado.textContent = '✓';
        repintar?.();
        setTimeout(() => { estado.textContent = ''; guardar.disabled = false; }, 1500);
      } catch (e) { estado.textContent = e.message; guardar.disabled = false; }
    } });
  tr.append(el('td', {}, [guardar, estado]));

  // Los avisos van en una fila propia, debajo.
  const trAvisos = el('tr', { class: 'fila-avisos' });
  trAvisos.append(el('td', { colspan: String(DIAS_COL.length + 1), style: 'padding:0 14px' }, [avisos]));
  const grupo = document.createDocumentFragment();
  grupo.append(tr, trAvisos);
  return grupo;
}
