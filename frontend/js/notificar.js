// Avisos flotantes («toasts»): la confirmación de que algo se guardó, se subió
// o falló. Antes el panel no decía nada: repintaba la pantalla y quedaba la
// duda de si se había guardado. Y los errores salían con el alert() del
// navegador, que bloquea la página y se ve distinto en cada equipo.
//
// Sin dependencias a propósito: api.js lo importa para avisar de cada
// escritura desde un solo lugar, y ui.js depende de api.js.
//
//   notificar.exito('Precio guardado')
//   notificar.error('No se pudo guardar', { detalle: e.message })
//   const n = notificar.cargando('Subiendo imagen…'); … n.exito('Imagen reemplazada')

const DURACION = { exito: 4200, info: 4200, aviso: 7000, error: 8000 };
const ICONO = {
  exito: 'M5 12.5l4.5 4.5L19 7.5',
  error: 'M12 8v5M12 16.5h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  aviso: 'M12 8v5M12 16.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  info: 'M12 11v6M12 7.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
};
const MAX_VISIBLES = 4;

let pila = null;
function contenedor() {
  if (pila?.isConnected) return pila;
  pila = document.createElement('div');
  pila.className = 'notis';
  // Lo lee el lector de pantalla sin mover el foco: «polite» para no
  // interrumpir a quien está escribiendo.
  pila.setAttribute('role', 'status');
  pila.setAttribute('aria-live', 'polite');
  document.body.appendChild(pila);
  return pila;
}

function svg(d) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2.2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', d);
  s.appendChild(p);
  return s;
}

function crear(tipo, titulo, { detalle = '', duracion } = {}) {
  const caja = contenedor();
  // Si se acumulan, se va el más viejo: más de cuatro ya no se leen.
  while (caja.children.length >= MAX_VISIBLES) caja.firstElementChild.remove();

  const n = document.createElement('div');
  const ico = document.createElement('span');
  const texto = document.createElement('div');
  const t = document.createElement('b');
  const d = document.createElement('span');
  const cerrar = document.createElement('button');
  const barra = document.createElement('i');

  ico.className = 'noti-ico';
  texto.className = 'noti-texto';
  d.className = 'noti-detalle';
  cerrar.className = 'noti-cerrar';
  cerrar.type = 'button';
  cerrar.setAttribute('aria-label', 'Cerrar aviso');
  cerrar.textContent = '×';
  barra.className = 'noti-barra';
  texto.append(t, d);
  n.append(ico, texto, cerrar, barra);
  caja.appendChild(n);

  let reloj = null, restante = 0, inicio = 0;
  const quitar = () => {
    clearTimeout(reloj);
    n.classList.add('sale');
    setTimeout(() => n.remove(), 220);
  };
  const programar = (ms) => {
    clearTimeout(reloj);
    restante = ms; inicio = Date.now();
    barra.style.animation = 'none';
    void barra.offsetWidth; // reinicia la animación de la barra
    barra.style.animation = ms ? `noti-tiempo ${ms}ms linear forwards` : 'none';
    if (ms) reloj = setTimeout(quitar, ms);
  };
  // Al pasar el mouse se detiene: alguien que está leyendo el error no debe
  // perderlo a media frase.
  n.addEventListener('mouseenter', () => {
    if (!reloj) return;
    clearTimeout(reloj); reloj = null;
    restante -= Date.now() - inicio;
    barra.style.animationPlayState = 'paused';
  });
  n.addEventListener('mouseleave', () => {
    if (reloj || n.classList.contains('cargando') || restante <= 0) return;
    inicio = Date.now();
    barra.style.animationPlayState = 'running';
    reloj = setTimeout(quitar, restante);
  });
  cerrar.addEventListener('click', quitar);

  const pintar = (tipoN, tituloN, detalleN, ms) => {
    n.className = `noti ${tipoN}`;
    ico.replaceChildren(tipoN === 'cargando' ? Object.assign(document.createElement('span'), { className: 'noti-giro' }) : svg(ICONO[tipoN]));
    t.textContent = tituloN;
    d.textContent = detalleN ?? '';
    d.hidden = !detalleN;
    // Los errores se anuncian con más fuerza que una confirmación.
    n.setAttribute('role', tipoN === 'error' ? 'alert' : 'status');
    programar(tipoN === 'cargando' ? 0 : (ms ?? DURACION[tipoN]));
  };
  pintar(tipo, titulo, detalle, duracion);

  // El aviso de «cargando» se convierte en el resultado, en el mismo lugar.
  const control = { cerrar: quitar };
  for (const tp of ['exito', 'error', 'aviso', 'info']) {
    control[tp] = (tituloN, op = {}) => { pintar(tp, tituloN, op.detalle, op.duracion); return control; };
  }
  return control;
}

export const notificar = {
  exito: (titulo, op) => crear('exito', titulo, op),
  error: (titulo, op) => crear('error', titulo, op),
  aviso: (titulo, op) => crear('aviso', titulo, op),
  info: (titulo, op) => crear('info', titulo, op),
  cargando: (titulo, op) => crear('cargando', titulo, op),
};
