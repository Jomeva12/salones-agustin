// Cliente del API. Todo pasa por aquí para que el manejo de errores viva en
// un solo lugar y las vistas no tengan que repetirlo.

async function pedir(ruta, opciones = {}) {
  const res = await fetch(ruta, {
    ...opciones,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(opciones.headers ?? {}) },
  });
  // La sesión dura una jornada. Cuando vence, esto pasa en medio de cualquier
  // pantalla: mejor mandar a entrar que dejar un error que no dice qué hacer.
  if (res.status === 401) { location.replace('/entrar'); throw new Error('Se cerró la sesión.'); }
  let cuerpo;
  try { cuerpo = await res.json(); }
  catch { throw new Error(`Respuesta no válida de ${ruta} (${res.status})`); }
  if (!res.ok) throw new Error(cuerpo.detalle ?? cuerpo.error ?? `Error ${res.status}`);
  return cuerpo;
}

const q = (o) => new URLSearchParams(
  Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '')
).toString();

export const api = {
  salud:        ()      => pedir('/api/salud'),
  hoy:      (salon)     => pedir(`/api/hoy?${q({ salon })}`),
  salones:      ()      => pedir('/api/salones'),
  imagenes:     ()      => pedir('/api/imagenes'),
  avisos: (estado, salon) => pedir(`/api/avisos?${q({ estado, salon })}`),
  atenderAviso: (id) => pedir('/api/avisos', { method: 'PUT', body: JSON.stringify({ id, estado: 'atendido' }) }),
  citas: (desde, hasta, salon) => pedir(`/api/citas?${q({ desde, hasta, salon })}`),
  huecosCita: (salon, fecha)   => pedir(`/api/citas/huecos?${q({ salon, fecha })}`),
  crearCita:   (d) => pedir('/api/citas', { method: 'POST', body: JSON.stringify(d) }),
  cambiarCita: (d) => pedir('/api/citas', { method: 'PUT',  body: JSON.stringify(d) }),
  // La imagen viaja como bytes y no como multipart: el panel es el unico
  // cliente y el servidor no tiene dependencias para parsear multipart.
  reemplazarImagen: (tipo, id, archivo) => pedir(
    `/api/imagenes/archivo?${q({ tipo, id, nombre: archivo.name })}`,
    { method: 'POST', body: archivo,
      headers: { 'Content-Type': archivo.type || 'application/octet-stream' } }),
  catalogo:     ()      => pedir('/api/catalogo'),
  agenda:       (d, h)  => pedir(`/api/agenda?${q({ desde: d, hasta: h })}`),
  dia:       (f, salon) => pedir(`/api/dia?${q({ fecha: f, salon })}`),
  costoCambioFecha: (id, nueva) => pedir(`/api/costo-cambio-fecha?${q({ id, nueva })}`),
  dispRango:    (d, h)  => pedir(`/api/disponibilidad-rango?${q({ desde: d, hasta: h })}`),
  disponibilidad: (f, t) => pedir(`/api/disponibilidad?${q({ fecha: f, turno: t })}`),
  cotizar:      (datos) => pedir('/api/cotizar', { method: 'POST', body: JSON.stringify(datos) }),
  crearCompromiso: (d)  => pedir('/api/compromisos', { method: 'POST', body: JSON.stringify(d) }),
  guardarControl:  (d)  => pedir('/api/control-agenda', { method: 'PUT', body: JSON.stringify(d) }),
  tarifas:      (f)     => pedir(`/api/tarifas?${q(f)}`),
  contenido:    (id)    => pedir(`/api/contenido?${q({ id })}`),
  revisar:      ()      => pedir('/api/revisar'),
  servicios: (salon, texto) => pedir(`/api/servicios?${q({ salon, q: texto })}`),
  faq:       (texto)        => pedir(`/api/faq?${q({ q: texto })}`),
  politicas: (incluir)      => pedir(`/api/politicas?${q({ incluir })}`),

  // escritura
  guardarTarifa:   (d) => pedir('/api/tarifas', { method: 'PUT', body: JSON.stringify(conUsuario(d)) }),
  resolverTarifa:  (d) => pedir('/api/tarifas/resolver', { method: 'POST', body: JSON.stringify(conUsuario(d)) }),
  guardarConceptos:(d) => pedir('/api/contenido-conceptos', { method: 'PUT', body: JSON.stringify(conUsuario(d)) }),
  crearConcepto:   (d) => pedir('/api/conceptos', { method: 'POST', body: JSON.stringify(conUsuario(d)) }),
  borrador:      (id) => pedir(`/api/paquetes/borrador?${q({ id })}`),
  guardarBorrador: (d) => pedir('/api/paquetes/borrador', { method: 'POST', body: JSON.stringify(d) }),
  editarSalon:   (d) => pedir('/api/salones', { method: 'PUT', body: JSON.stringify(d) }),
  crearFaq:      (d) => pedir('/api/faq', { method: 'POST', body: JSON.stringify(d) }),
  editarFaq:     (d) => pedir('/api/faq', { method: 'PUT', body: JSON.stringify(d) }),
  borrarFaq:     (d) => pedir('/api/faq', { method: 'DELETE', body: JSON.stringify(d) }),
  crearPolitica: (d) => pedir('/api/politicas', { method: 'POST', body: JSON.stringify(d) }),
  editarPolitica:(d) => pedir('/api/politicas', { method: 'PUT', body: JSON.stringify(d) }),
  borrarPolitica:(d) => pedir('/api/politicas', { method: 'DELETE', body: JSON.stringify(d) }),
  publicarPaquete: (d) => pedir('/api/paquetes/publicar', { method: 'POST', body: JSON.stringify(d) }),
  bitacora:      (n)   => pedir(`/api/bitacora?${q({ limite: n })}`),

  // usuarios (solo admin)
  usuarios:        ()  => pedir('/api/usuarios'),
  crearUsuario:    (d) => pedir('/api/usuarios', { method: 'POST', body: JSON.stringify(d) }),
  editarUsuario:   (d) => pedir('/api/usuarios', { method: 'PUT', body: JSON.stringify(d) }),
  claveUsuario:    (d) => pedir('/api/usuarios/clave', { method: 'POST', body: JSON.stringify(d) }),
  desbloquearUsuario: (d) => pedir('/api/usuarios/desbloquear', { method: 'POST', body: JSON.stringify(d) }),
  editarCompromiso:(d) => pedir('/api/compromisos', { method: 'PUT', body: JSON.stringify(conUsuario(d)) }),
  cancelarCompromiso:(d)=> pedir('/api/compromisos', { method: 'DELETE', body: JSON.stringify(conUsuario(d)) }),
  servicio:      (id)  => pedir(`/api/servicio?${q({ id })}`),
  editarServicio:(d)   => pedir('/api/servicios', { method: 'PUT', body: JSON.stringify(conUsuario(d)) }),
  crearServicio: (d)   => pedir('/api/servicios', { method: 'POST', body: JSON.stringify(conUsuario(d)) }),
};

/**
 * Quién está trabajando. Ya no lo elige la persona de un menú: sale de la
 * sesión abierta, y el servidor la usa para firmar la bitácora sin creerle
 * nada al navegador. Esto es solo la copia para pintar la pantalla.
 */
let SESION = null;
export const usuarioActual = () => SESION?.nombre ?? '';
export const sesion = () => SESION;
export const puede = (que) => !!SESION?.permisos?.[que];

export async function cargarSesion() {
  const r = await fetch('/api/yo', { credentials: 'same-origin' }).then((x) => x.json());
  SESION = r.usuario ? r : null;
  return SESION;
}

export async function salir() {
  try { await fetch('/api/salir', { method: 'POST', credentials: 'same-origin' }); } catch { /* igual sale */ }
  location.replace('/entrar');
}

/** El salón en el que se está trabajando. Vacío = los cuatro (la vista del Lic.). */
export function salonActual() {
  try { return localStorage.getItem('salon') || ''; } catch { return ''; }
}
export function fijarSalon(v) {
  try { localStorage.setItem('salon', v); } catch { /* modo privado */ }
  // Que el selector del menú diga lo mismo que la página que lo cambió.
  const sel = document.getElementById('salon');
  if (sel) sel.value = v;
  document.body.dataset.salon = v || 'todos';
}

/** Cada encargada trabaja en un salón. Al elegirse, el salón se elige solo. */
export const SALON_DE = {
  'Nelly Tovar': 'norma',
  'Karla Morquecho': 'esmeralda',
  'Viridiana Meza': 'santacruz',
  'Raquel Esquivel': 'quetzal',
};
// El servidor sobrescribe este campo con quien tenga la sesión; va solo para
// que las pantallas que lo muestran antes de guardar no queden en blanco.
const conUsuario = (d) => ({ ...d, usuario: usuarioActual() || 'sin identificar' });

// ── utilidades compartidas ──────────────────────────────────────────────────
export const pesos = (n) =>
  n === null || n === undefined ? '—' : '$' + Number(n).toLocaleString('es-MX');

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const iso = (y, m, d) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Crea un elemento con props y contenido, sin innerHTML. */
export function el(tag, props = {}, hijos = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  // Aplana a fondo: un hijo puede venir de un ternario que devuelve un arreglo,
  // y sin esto se imprime como «[object HTMLElement]».
  for (const h of [hijos].flat(Infinity)) {
    if (h === null || h === undefined || h === false) continue;
    n.append(h.nodeType ? h : document.createTextNode(String(h)));
  }
  return n;
}

export const limpiar = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };

export function error(mensaje) {
  return el('div', { class: 'aviso', text: mensaje });
}
