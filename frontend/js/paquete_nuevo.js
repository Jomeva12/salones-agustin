// Crear un paquete. Por ahora es solo la forma: enseña TODAS las variables que
// un paquete necesita, calcula en vivo cuántas filas va a generar, y todavía
// no guarda nada. Verlo antes de cablearlo es a propósito — el número de
// combinaciones sorprende, y es mejor descubrirlo aquí que después de haber
// tecleado sesenta precios.
//
// Un paquete no es una fila: es tres cosas que se multiplican entre sí.
//
//   1. EL PAQUETE      nombre, cómo se cobra, para qué celebraciones sirve.
//   2. EL CONTENIDO    qué incluye, cuántas horas, la estancia previa.
//                      Puede cambiar por salón.
//   3. LAS TARIFAS     un precio por cada combinación de
//                      salón × año × escalón × rango de invitados × día de la
//                      semana. Aquí es donde explota la cuenta.
import { api, error, pesos } from './api.js';
import { el, limpiar, cargando } from './ui.js';

const DIAS = [['lun', 'Lun'], ['mar', 'Mar'], ['mie', 'Mié'], ['jue', 'Jue'],
  ['vie', 'Vie'], ['sab', 'Sáb'], ['dom', 'Dom']];

// El estado vive aquí y no en el DOM: hay que poder contar las combinaciones
// en cada tecla sin volver a leer la pantalla.
const nuevo = () => ({
  nombre: '',
  unidad_precio: 'total',
  tipos: new Set(),
  salones: new Set(),
  anios: new Set([new Date().getFullYear() + 1]),
  escalonado: false,
  escalones: new Set(),
  rangos: [{ desde: 1, hasta: 150 }],
  horas_salon: 5,
  minutos_estancia: 30,
  cortesias: '',
  conceptos: new Map(),          // id -> 'si' | 'no'
  precios: {},                   // `${salon}|${anio}|${escalon}|${i}` -> {lun..dom}
});

let d = nuevo();
let cat = null;
let salones = [];
let idBorrador = null;
let temporizador = null;
let ultimoEnviado = '';

/**
 * Guarda solo, sin botón. Se espera un momento tras la última tecla para no
 * mandar una petición por letra, y no se manda nada si el contenido no cambió.
 *
 * El paquete nace como BORRADOR, y un borrador no se cotiza: mientras esté a
 * medias no puede llegarle a un cliente por equivocación.
 */
function autoguardar({ ya = false } = {}) {
  clearTimeout(temporizador);
  temporizador = setTimeout(async () => {
    const cuerpo = paraGuardar();
    const firma = JSON.stringify(cuerpo);
    if (firma === ultimoEnviado) return;
    if (!cuerpo.nombre || cuerpo.nombre.trim().length < 3) { señal('espera'); return; }
    señal('guardando');
    try {
      const r = await api.guardarBorrador(cuerpo);
      if (r.error) { señal('error', r.detalle); return; }
      if (r.esperando) { señal('espera'); return; }
      idBorrador = r.id;
      ultimoEnviado = firma;
      señal('guardado');
    } catch (e) { señal('error', e.message); }
  }, ya ? 0 : 900);
}

/** El estado del formulario, tal como lo espera el API. */
function paraGuardar() {
  return {
    id: idBorrador,
    nombre: d.nombre,
    unidad_precio: d.unidad_precio,
    tipos: [...d.tipos],
    salones: [...d.salones],
    escalonado: d.escalonado,
    escalones: [...d.escalones],
    horas_salon: d.horas_salon,
    minutos_estancia: d.minutos_estancia,
    cortesias: d.cortesias,
    conceptos: Object.fromEntries(d.conceptos),
    tarifas: combinaciones().map((c) => ({
      salon: c.salon, anio: c.anio, escalon_id: c.escalon_id,
      desde: c.rango.desde, hasta: c.rango.hasta,
      precios: d.precios[c.clave] ?? {},
    })),
  };
}

/** Rellena el formulario con un borrador que ya existía. */
function cargar(b) {
  idBorrador = b.id;
  d.nombre = b.nombre ?? '';
  d.unidad_precio = b.unidad_precio ?? 'total';
  d.tipos = new Set(b.tipos ?? []);
  d.salones = new Set(b.salones ?? []);
  d.escalonado = !!b.escalonado;
  d.escalones = new Set(b.escalones ?? []);
  d.horas_salon = b.horas_salon ?? 5;
  d.minutos_estancia = b.minutos_estancia ?? 0;
  d.cortesias = b.cortesias ?? '';
  d.conceptos = new Map(Object.entries(b.conceptos ?? {}).map(([k, v]) => [Number(k), v]));
  if (b.anios?.length) d.anios = new Set(b.anios);
  if (b.rangos?.length) d.rangos = b.rangos;
  d.precios = b.precios ?? {};
  // Lo recién cargado es idéntico a lo guardado: no hay que reenviarlo.
  ultimoEnviado = JSON.stringify(paraGuardar());
}

// ── el aviso de abajo a la derecha ─────────────────────────────────────────
const TEXTO = {
  espera:   ['Ponle nombre para empezar a guardar', 'espera'],
  guardando:['Guardando…', 'trabajando'],
  guardado: ['Guardado', 'listo'],
  error:    ['No se pudo guardar', 'mal'],
};
function señal(estado, detalle) {
  let caja = document.getElementById('autoguardado');
  if (!caja) {
    caja = el('div', { class: 'autoguardado', id: 'autoguardado', role: 'status', 'aria-live': 'polite' });
    document.body.append(caja);
  }
  const [texto, clase] = TEXTO[estado] ?? TEXTO.espera;
  caja.className = `autoguardado ${clase}`;
  limpiar(caja).append(
    el('span', { class: 'punto' }),
    el('span', { class: 'txt', text: detalle ? `${texto}: ${detalle}` : texto }),
  );
  // «Guardado» se desvanece solo: es una confirmación, no un estado.
  clearTimeout(caja._irse);
  if (estado === 'guardado') {
    caja._irse = setTimeout(() => caja.classList.add('tenue'), 2200);
  } else caja.classList.remove('tenue');
}

export function limpiarSeñal() {
  clearTimeout(temporizador);
  document.getElementById('autoguardado')?.remove();
}

export async function paqueteNuevo(raiz, params = {}) {
  limpiar(raiz);
  const cont = el('div', { class: 'crear-paq' });
  raiz.append(cont);
  cont.append(cargando());

  try {
    [cat, salones] = await Promise.all([api.catalogo(), api.salones()]);
  } catch (e) { limpiar(cont).append(error('No se pudo cargar: ' + e.message)); return; }

  d = nuevo();
  idBorrador = null;
  ultimoEnviado = '';
  limpiarSeñal();
  for (const s of salones) d.salones.add(s.clave);

  // Volver a un borrador que quedó a medias: se recupera tal como se dejó.
  let retomado = false;
  if (params.id) {
    try {
      const b = await api.borrador(params.id);
      if (!b.error) { cargar(b); retomado = true; }
    } catch { /* si no carga, se empieza de cero */ }
  }

  limpiar(cont);
  cont.append(el('div', { class: 'encabezado-pagina' }, [
    el('a', { class: 'volver', href: '#/paquetes', text: '← Paquetes' }),
    el('h2', { text: retomado ? `Terminar «${d.nombre}»` : 'Crear un paquete' }),
    el('p', { text: 'Un paquete no es una fila: es lo que incluye, más un precio por cada ' +
                    'combinación de salón, año, anticipación, rango de invitados y día de la semana.' }),
  ]));

  const cuerpo = el('div', { class: 'pasos-paq' });
  cont.append(cuerpo);
  pintar(cuerpo);
}

function pintar(zona) {
  limpiar(zona);
  zona.append(pasoIdentidad());
  zona.append(pasoAlcance());
  zona.append(pasoContenido());
  zona.append(pasoPrecios());
  zona.append(resumen(zona));
  // Cada cambio recalcula la cuenta: es el dato que hace entender el modelo.
  for (const campo of zona.querySelectorAll('input,select,textarea')) {
    campo.addEventListener('change', () => refrescarCuenta(zona));
  }
}

/**
 * Repintar reconstruye el DOM, y al hacerlo el navegador pierde dónde estabas:
 * por eso la página saltaba al tocar cualquier pastilla. Se guarda la posición
 * y se devuelve en el mismo cuadro, antes de que se dibuje nada.
 */
function repintar(zona) {
  const y = window.scrollY;
  const raiz = zona.closest('.pasos-paq') ?? zona;
  pintar(raiz);
  requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'instant' }));
  autoguardar();
}

// ── 1. qué es ───────────────────────────────────────────────────────────────
function pasoIdentidad() {
  const nombre = el('input', { type: 'text', value: d.nombre,
    placeholder: 'Paquete Esmeralda Boda y XV', style: 'width:100%' });
  nombre.addEventListener('input', () => { d.nombre = nombre.value; autoguardar(); });

  const unidad = el('div', { class: 'opciones' }, [
    ['total', 'Precio fijo', 'Un total por el evento, sin importar cuántos vengan.'],
    ['por_persona', 'Por invitado', 'El precio se multiplica por el número de invitados.'],
  ].map(([v, t, ayuda]) => opcion(v === d.unidad_precio, t, ayuda, () => {
    d.unidad_precio = v; repintar(unidad);
  })));

  const tipos = el('div', { class: 'pildoras-multi' }, cat.tipos_evento.map((t) =>
    chip(d.tipos.has(t.clave), t.nombre, () => {
      d.tipos.has(t.clave) ? d.tipos.delete(t.clave) : d.tipos.add(t.clave);
      repintar(tipos);
    })));

  return caja(1, 'Qué es el paquete', [
    campo('Nombre', nombre, 'Como lo va a ver quien cotiza. Tiene que ser único.'),
    campo('Cómo se cobra', unidad),
    campo('¿Para qué celebraciones sirve?', tipos,
      d.tipos.size ? null : 'Elige al menos una: es lo que hace que aparezca al cotizar.'),
  ]);
}

// ── 2. dónde, cuándo y para cuántos ────────────────────────────────────────
function pasoAlcance() {
  const sal = el('div', { class: 'pildoras-multi' }, salones.map((s) =>
    chip(d.salones.has(s.clave), s.nombre.replace(' Eventos', ''), () => {
      d.salones.has(s.clave) ? d.salones.delete(s.clave) : d.salones.add(s.clave);
      repintar(sal);
    })));

  const hoy = new Date().getFullYear();
  const anios = el('div', { class: 'pildoras-multi' }, [hoy, hoy + 1, hoy + 2, hoy + 3].map((a) =>
    chip(d.anios.has(a), String(a), () => {
      d.anios.has(a) ? d.anios.delete(a) : d.anios.add(a);
      repintar(anios);
    })));

  // El escalón es la quinta variable del precio y la que nadie ve venir.
  const esc = el('div', { class: 'opciones' }, [
    [false, 'El mismo precio todo el año', 'No importa con cuánta anticipación se contrate.'],
    [true, 'El precio cambia según la anticipación',
     'Se cobra distinto si faltan 6 meses que si falta uno. Así funcionan las tarifas de 2027 y 2028.'],
  ].map(([v, t, ayuda]) => opcion(v === d.escalonado, t, ayuda, () => {
    d.escalonado = v;
    if (v && !d.escalones.size) for (const e of cat.escalones) d.escalones.add(e.id);
    repintar(esc);
  })));

  const cualesEsc = d.escalonado
    ? el('div', { class: 'pildoras-multi' }, cat.escalones.map((e) =>
        chip(d.escalones.has(e.id), e.nombre, () => {
          d.escalones.has(e.id) ? d.escalones.delete(e.id) : d.escalones.add(e.id);
          repintar(cualesEsc);
        })))
    : null;

  // Los rangos de invitados: cada uno es otra tarifa por salón y por año.
  const rangos = el('div', { class: 'rangos' });
  d.rangos.forEach((r, i) => {
    const desde = el('input', { type: 'number', min: '1', value: String(r.desde) });
    const hasta = el('input', { type: 'number', min: '1', value: String(r.hasta) });
    desde.addEventListener('input', () => { r.desde = Number(desde.value); autoguardar(); });
    hasta.addEventListener('input', () => { r.hasta = Number(hasta.value); autoguardar(); });
    rangos.append(el('div', { class: 'rango' }, [
      el('span', { text: 'de' }), desde, el('span', { text: 'a' }), hasta,
      el('span', { text: 'invitados' }),
      d.rangos.length > 1
        ? el('button', { class: 'quita', text: '✕', 'aria-label': 'Quitar este rango',
            onclick: () => { d.rangos.splice(i, 1); repintar(rangos); } })
        : null,
    ].filter(Boolean)));
  });
  rangos.append(el('button', { class: 'fantasma', text: '+ Otro rango de invitados',
    onclick: () => {
      const ult = d.rangos[d.rangos.length - 1];
      d.rangos.push({ desde: ult.hasta + 1, hasta: ult.hasta + 50 });
      repintar(rangos);
    } }));

  return caja(2, 'Dónde, cuándo y para cuántos', [
    campo('¿En qué salones?', sal, 'Los precios pueden ser distintos en cada uno; eso se llena abajo.'),
    campo('¿Para qué años?', anios, 'Cada año lleva su propia lista de precios.'),
    campo('¿El precio depende de la anticipación?', esc),
    cualesEsc ? campo('¿Qué escalones?', cualesEsc) : null,
    campo('Rangos de invitados', rangos,
      'Cada rango es una tarifa aparte. Si el precio no cambia con el número de invitados, deja uno solo.'),
  ].filter(Boolean));
}

// ── 3. qué incluye ──────────────────────────────────────────────────────────
function pasoContenido() {
  const horas = el('input', { type: 'number', min: '1', max: '12', step: '0.5', value: String(d.horas_salon) });
  horas.addEventListener('input', () => { d.horas_salon = Number(horas.value); autoguardar(); });
  const estancia = el('select', {}, [['0', 'Sin estancia previa'], ['30', 'Media hora antes'],
    ['60', 'Una hora antes']].map(([v, t]) => el('option', { value: v, text: t, selected: String(d.minutos_estancia) === v })));
  estancia.addEventListener('change', () => { d.minutos_estancia = Number(estancia.value); autoguardar(); });

  const cort = el('textarea', { rows: '2', style: 'width:100%',
    placeholder: 'Arreglo de la escalera de presentación, Aro iluminado…' });
  cort.value = d.cortesias;
  cort.addEventListener('input', () => { d.cortesias = cort.value; autoguardar(); });

  // El cierre no se elige: lo fija el reglamento municipal.
  const cierre = el('div', { class: 'derivado' }, [
    el('b', { text: `Última hora de inicio: ${ultimoInicio()}` }),
    el('span', { text: `${d.horas_salon} h de evento y cierre a la 1:00 am por reglamento municipal. ` +
                       'No se captura: se calcula.' }),
  ]);
  horas.addEventListener('input', () => {
    cierre.firstChild.textContent = `Última hora de inicio: ${ultimoInicio()}`;
    cierre.lastChild.textContent = `${d.horas_salon} h de evento y cierre a la 1:00 am por reglamento municipal. ` +
      'No se captura: se calcula.';
  });

  const buscar = el('input', { type: 'search', placeholder: 'Buscar concepto…', style: 'width:100%' });
  const lista = el('div', { class: 'conceptos-nuevo' });
  const pintarLista = () => {
    const q = buscar.value.trim().toLowerCase();
    limpiar(lista);
    for (const c of cat.conceptos) {
      if (q && !c.nombre.toLowerCase().includes(q)) continue;
      const est = d.conceptos.get(c.id) ?? null;
      lista.append(el('div', { class: `concepto-fila${est ? ' puesto' : ''}` }, [
        el('span', { class: 'nom', text: c.nombre }),
        el('div', { class: 'tres' }, [['si', 'Incluye'], ['no', 'No incluye'], [null, '—']].map(([v, t]) =>
          el('button', {
            type: 'button', class: `mini${est === v ? ' sel ' + (v ?? 'na') : ''}`, text: t,
            onclick: () => {
              if (v === null) d.conceptos.delete(c.id); else d.conceptos.set(c.id, v);
              pintarLista(); refrescarCuenta(lista); autoguardar();
            },
          }))),
      ]));
    }
  };
  buscar.addEventListener('input', pintarLista);
  pintarLista();

  return caja(3, 'Qué incluye', [
    el('div', { class: 'fila' }, [
      campo('Horas de salón', horas),
      campo('Estancia previa', estancia),
    ]),
    cierre,
    campo('De cortesía', cort, 'Lo que se regala. Sale destacado en la cotización.'),
    campo('Conceptos', el('div', {}, [buscar, lista]),
      'Lo que no marques queda como «no aplica» y no se menciona al cliente.'),
  ]);
}

function ultimoInicio() {
  const fin = 25 * 60;                       // la 1:00 am del día siguiente
  const m = fin - d.horas_salon * 60;
  const h = Math.floor(((m % 1440) + 1440) % 1440 / 60);
  const mm = ((m % 60) + 60) % 60;
  const suf = h < 12 ? 'am' : 'pm';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mm).padStart(2, '0')} ${suf}`;
}

// ── 4. precios ──────────────────────────────────────────────────────────────
function pasoPrecios() {
  const combis = combinaciones();
  if (!combis.length) {
    return caja(4, 'Los precios', [
      el('div', { class: 'vacio-paso', text: 'Elige al menos un salón, un año y un rango de invitados.' }),
    ]);
  }

  const tabla = el('div', { class: 'tabla-precios' });
  tabla.append(el('div', { class: 'cab' }, [
    el('div', { class: 'que', text: 'Salón · año · anticipación · invitados' }),
    ...DIAS.map(([, t]) => el('div', { class: 'd', text: t })),
  ]));

  for (const c of combis) {
    const fila = el('div', { class: 'fila-precio' });
    fila.append(el('div', { class: 'que' }, [
      el('b', { text: c.salon_nombre }),
      el('span', { text: `${c.anio} · ${c.escalon_nombre} · ${c.rango.desde}–${c.rango.hasta}` }),
    ]));
    d.precios[c.clave] ??= {};
    for (const [k] of DIAS) {
      const inp = el('input', { type: 'number', min: '0', step: '100', inputmode: 'numeric',
        value: d.precios[c.clave][k] ?? '' });
      inp.addEventListener('input', () => {
        d.precios[c.clave][k] = inp.value === '' ? null : Number(inp.value);
        refrescarCuenta(tabla);
        autoguardar();
      });
      fila.append(inp);
    }
    tabla.append(fila);
  }

  // Copiar hacia abajo ahorra teclear lo mismo sesenta veces, que es donde se
  // cometen los errores que luego aparecen como precios absurdos.
  const copiar = el('button', { class: 'fantasma', text: 'Copiar la primera fila a todas las demás',
    onclick: () => {
      const primera = d.precios[combis[0].clave];
      for (const c of combis.slice(1)) d.precios[c.clave] = { ...primera };
      repintar(tabla);
    } });

  return caja(4, 'Los precios', [
    el('div', { class: 'ayuda-precios' }, [
      el('b', { text: `${combis.length} tarifa${combis.length === 1 ? '' : 's'} por llenar. ` }),
      'Una por cada combinación. Deja en blanco los días en que ese paquete no se ofrece.',
    ]),
    copiar,
    tabla,
  ]);
}

function combinaciones() {
  const out = [];
  const escs = d.escalonado && d.escalones.size
    ? cat.escalones.filter((e) => d.escalones.has(e.id))
    : [{ id: null, nombre: 'todo el año' }];
  for (const clave of d.salones) {
    const s = salones.find((x) => x.clave === clave);
    if (!s) continue;
    for (const anio of [...d.anios].sort()) {
      for (const e of escs) {
        d.rangos.forEach((rango, i) => {
          out.push({
            clave: `${clave}|${anio}|${e.id ?? 'x'}|${i}`,
            salon: clave, salon_nombre: s.nombre.replace(' Eventos', ''),
            anio, escalon_id: e.id, escalon_nombre: e.nombre, rango,
          });
        });
      }
    }
  }
  return out;
}

// ── el resumen, que es donde se ve el tamaño de lo que se está creando ─────
function resumen(zona) {
  const caja = el('div', { class: 'resumen-paq', id: 'resumen-paq' });
  pintarResumen(caja);
  return caja;
}

function refrescarCuenta(desde) {
  const c = (desde.closest?.('.pasos-paq') ?? document).querySelector('#resumen-paq');
  if (c) pintarResumen(c);
}

function pintarResumen(caja) {
  limpiar(caja);
  const combis = combinaciones();
  const llenas = combis.filter((c) => DIAS.some(([k]) => d.precios[c.clave]?.[k] > 0)).length;
  const contenidos = d.salones.size * (d.escalonado && d.escalones.size ? d.escalones.size : 1);
  const faltan = [];
  if (!d.nombre.trim()) faltan.push('el nombre');
  if (!d.tipos.size) faltan.push('para qué celebraciones sirve');
  if (!d.salones.size) faltan.push('al menos un salón');
  if (!d.anios.size) faltan.push('al menos un año');
  if (!llenas) faltan.push('al menos un precio');

  caja.append(el('div', { class: 'cuentas' }, [
    cuenta(combis.length, combis.length === 1 ? 'tarifa' : 'tarifas', `${llenas} con precio`),
    cuenta(contenidos, contenidos === 1 ? 'contenido' : 'contenidos', 'uno por salón y escalón'),
    cuenta(d.conceptos.size, 'conceptos marcados', `de ${cat.conceptos.length}`),
    cuenta(d.tipos.size, d.tipos.size === 1 ? 'celebración' : 'celebraciones', 'donde va a aparecer'),
  ]));

  if (faltan.length) {
    caja.append(el('div', { class: 'falta' }, [
      el('b', { text: 'Falta ' }), faltan.join(', ') + '.',
    ]));
  }
  caja.append(el('div', { class: 'aviso info', style: 'margin-top:14px' }, [
    el('b', { text: 'Se va guardando solo. ' }),
    'Mientras esté incompleto queda como borrador y ',
    el('b', { text: 'no se le cotiza a nadie' }),
    '. Puedes cerrar e irte: lo encuentras en Paquetes, marcado, para terminarlo después.',
  ]));

  const aviso = el('div', { class: 'aviso-form' });
  const publicar = el('button', {
    class: 'primario', text: 'Publicar paquete', disabled: faltan.length > 0,
    title: faltan.length ? 'Falta ' + faltan.join(', ') : 'A partir de aquí se puede cotizar',
    onclick: async () => {
      publicar.disabled = true;
      autoguardar({ ya: true });
      // Se espera al guardado antes de publicar: si no, publicaría una
      // versión anterior a lo último que se escribió.
      await new Promise((r) => setTimeout(r, 700));
      try {
        const rr = await api.publicarPaquete({ id: idBorrador });
        if (rr.error) { aviso.textContent = rr.detalle ?? rr.error; publicar.disabled = false; return; }
        limpiarSeñal();
        location.hash = '#/paquetes';
      } catch (e) { aviso.textContent = e.message; publicar.disabled = false; }
    },
  });
  caja.append(el('div', { class: 'fila', style: 'margin-top:16px' }, [
    publicar,
    el('a', { class: 'boton fantasma', href: '#/paquetes', text: 'Seguir después' }),
  ]), aviso);
}

// ── piezas ──────────────────────────────────────────────────────────────────
function caja(n, titulo, hijos) {
  return el('section', { class: 'bloque-cot' }, [
    el('div', { class: 'paso' }, [
      el('span', { class: 'num', text: String(n) }),
      el('span', { text: titulo }),
    ]),
    el('div', { class: 'cuerpo-paso' }, hijos),
  ]);
}

const campo = (rotulo, control, ayuda) =>
  el('label', { class: 'campo-nuevo' }, [
    el('span', { class: 'rot', text: rotulo }),
    control,
    ayuda ? el('span', { class: 'ayuda', text: ayuda }) : null,
  ].filter(Boolean));

const chip = (activo, texto, alTocar) =>
  el('button', { type: 'button', class: `pildora${activo ? ' sel' : ''}`,
    'aria-pressed': String(activo), text: texto, onclick: alTocar });

const opcion = (activo, titulo, ayuda, alTocar) =>
  el('button', { type: 'button', class: `opcion${activo ? ' sel' : ''}`, onclick: alTocar }, [
    el('b', { text: titulo }),
    el('span', { text: ayuda }),
  ]);

const cuenta = (n, rotulo, pie) =>
  el('div', { class: "cuenta-nuevo" }, [
    el('b', { text: String(n) }),
    el('span', { text: rotulo }),
    el('small', { text: pie }),
  ]);
