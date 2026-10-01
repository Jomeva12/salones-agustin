// Piezas compartidas de interfaz: iconos, esqueletos, panel deslizante y
// formateo de fechas en español. Sin librerías.
import { el, limpiar } from './api.js';

// ─────────────────────────────── iconos ─────────────────────────────────────
const TRAZOS = {
  hoy:        'M3 10h18M8 3v4M16 3v4M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  cotizar:    'M12 2v20M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5s2 2.7 5 3.5 5 1.6 5 3.5-2.2 3-5 3-5-1.1-5-3',
  agenda:     'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 14h3v3H8z',
  paquetes:   'M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8M2 4h20v4H2zM12 8v13M12 4V2',
  servicios:  'M12 2l2.6 6.3 6.4.5-4.9 4.2 1.5 6.6L12 16.1 6.4 19.6l1.5-6.6L3 8.8l6.4-.5z',
  respuestas: 'M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM9 9h.01M12 9h.01M15 9h.01',
  pendientes: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  configuracion: 'M9 20H4a2 2 0 0 1-2-2v-1a5 5 0 0 1 5-5h2M12 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM17 14v6M14 17h6',
  salones: 'M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6M9 11h.01M15 11h.01',
  imagenes: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M8.5 9.5a1.2 1.2 0 1 1-2.4 0 1.2 1.2 0 0 1 2.4 0z',
  politicas: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6M9 9h1',
};

export function icono(nombre) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', TRAZOS[nombre] ?? TRAZOS.hoy);
  svg.append(p);
  return svg;
}

// ─────────────────────────────── fechas ─────────────────────────────────────
export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const partes = (iso) => iso.split('-').map(Number);

export function diaDeSemana(iso) {
  const [y, m, d] = partes(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** «sábado 12 de diciembre de 2026» */
export function fechaLarga(iso) {
  const [y, m, d] = partes(iso);
  return `${DIAS[diaDeSemana(iso)]} ${d} de ${MESES[m - 1]} de ${y}`;
}

/** «sáb 12 dic» */
export function fechaCorta(iso) {
  const [y, m, d] = partes(iso);
  return `${DIAS_CORTO[diaDeSemana(iso)]} ${d} ${MESES[m - 1].slice(0, 3)}`;
}

/** «faltan 6 meses» en palabras, no en jerga. */
export function enPalabras(meses) {
  if (meses <= 0) return 'este mismo mes';
  if (meses === 1) return 'falta 1 mes';
  return `faltan ${meses} meses`;
}

export const iso = (y, m, d) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// ───────────────────────── esqueletos de carga ──────────────────────────────
export function cargando(tipo = 'lista') {
  const caja = el('div', { class: 'rejilla ' + (tipo === 'tarjetas' ? 'c3' : '') });
  const n = tipo === 'tarjetas' ? 3 : 1;
  for (let i = 0; i < n; i++) {
    const t = el('div', { class: 'tarjeta' });
    t.append(el('div', { class: 'hueso linea', style: 'width:42%' }));
    t.append(el('div', { class: 'hueso linea', style: 'width:78%' }));
    t.append(el('div', { class: 'hueso linea', style: 'width:60%;margin-bottom:0' }));
    caja.append(t);
  }
  return caja;
}

// ───────────────────── panel lateral deslizante ─────────────────────────────
let cerrarActual = null;

/** Abre un panel desde la derecha. Devuelve el nodo donde pintar. */
export function abrirCajon(titulo, subtitulo) {
  cerrarCajon();
  const velo = el('div', { class: 'velo', onclick: cerrarCajon });
  const cuerpo = el('div');
  const cajon = el('div', {
    class: 'cajon', role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo,
  }, [
    el('div', { class: 'cajon-top' }, [
      el('div', {}, [
        el('h3', { text: titulo }),
        subtitulo ? el('p', { style: 'color:var(--tinta-3);font-size:13px;margin-top:3px', text: subtitulo }) : null,
      ]),
      el('button', { class: 'cerrar', 'aria-label': 'Cerrar', text: '✕', onclick: cerrarCajon }),
    ]),
    cuerpo,
  ]);
  document.body.append(velo, cajon);
  const porTecla = (e) => { if (e.key === 'Escape') cerrarCajon(); };
  document.addEventListener('keydown', porTecla);
  cerrarActual = () => {
    document.removeEventListener('keydown', porTecla);
    velo.remove(); cajon.remove(); cerrarActual = null;
  };
  cajon.focus?.();
  return cuerpo;
}

export function cerrarCajon() { cerrarActual?.(); }

// Un panel pertenece a la página que lo abrió: al cambiar de página se cierra,
// si no quedaba el de Paquetes encima de Servicios.
addEventListener('hashchange', () => cerrarCajon());

// ───────────────────── número que cuenta hacia arriba ───────────────────────
export function animarNumero(nodo, destino, formatear = (v) => String(Math.round(v))) {
  // El valor correcto se escribe SIEMPRE primero. requestAnimationFrame no
  // corre si la pestaña está en segundo plano, y sin esto el número se queda
  // congelado en cero: la portada mentiría sin avisar.
  nodo.textContent = formatear(destino);
  if (destino === 0 || document.hidden
      || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const inicio = performance.now(), dur = 520;
  let vivo = true;
  // Red de seguridad: si la animación se interrumpe, el valor final queda igual.
  const red = setTimeout(() => { vivo = false; nodo.textContent = formatear(destino); }, dur + 400);
  const paso = (t) => {
    if (!vivo) return;
    const p = Math.min(1, (t - inicio) / dur);
    const suave = 1 - Math.pow(1 - p, 3);
    nodo.textContent = formatear(destino * suave);
    if (p < 1) requestAnimationFrame(paso);
    else { clearTimeout(red); vivo = false; }
  };
  requestAnimationFrame(paso);
}

// ───────────────────────── selector de fecha ────────────────────────────────
// El mismo calendario de MediaHub, para una sola fecha. El <input type=date>
// del navegador se ve distinto en cada equipo y no sabe nada del negocio:
// aquí los días pasados no se pueden elegir y el fin de semana va resaltado,
// porque cuesta distinto.
// Se porta como un input: tiene .value, avisa con el evento «input» y acepta
// .focus(), así la pantalla que lo usa no cambia su lógica.
const DIAS_MINI = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'];
const ICONO_CAL = 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z';

export function selectorFecha({ min = null, placeholder = 'Elige la fecha' } = {}) {
  let valor = '';
  const ahora = new Date();
  const hoyISO = iso(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  let anio = ahora.getFullYear(), mes = ahora.getMonth();

  const svg = (d, clase) => {
    const s = icono('hoy'); s.classList.add(clase);
    s.querySelector('path').setAttribute('d', d);
    return s;
  };
  const etiqueta = el('span', { class: 'sf-texto' });
  const disparador = el('button', { type: 'button', class: 'sf-disparador', 'aria-haspopup': 'dialog' }, [
    svg(ICONO_CAL, 'sf-icono'), etiqueta, svg('m6 9 6 6 6-6', 'sf-flecha'),
  ]);
  const pop = el('div', { class: 'sf-pop', role: 'dialog', 'aria-label': 'Elegir fecha', hidden: 'hidden' });
  const caja = el('div', { class: 'sf' }, [disparador, pop]);

  const pintarEtiqueta = () => {
    etiqueta.textContent = valor ? fechaLarga(valor).replace(/^./, (c) => c.toUpperCase()) : placeholder;
    disparador.classList.toggle('vacio', !valor);
  };

  const elegir = (nuevo) => {
    valor = nuevo;
    pintarEtiqueta();
    cerrar();
    caja.dispatchEvent(new Event('input', { bubbles: true }));
    disparador.focus();
  };

  // Atajos pensados para cotizar: lo que más se pregunta es el fin de semana.
  const sabadoDesde = (semanas) => {
    const d = new Date(ahora);
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7) + semanas * 7);
    return iso(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const enMeses = (n) => {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() + n, ahora.getDate());
    return iso(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const ATAJOS = [['Este sábado', () => sabadoDesde(0)], ['El otro sábado', () => sabadoDesde(1)],
    ['En 6 meses', () => enMeses(6)]];

  function pintar() {
    const primero = new Date(anio, mes, 1).getDay();
    const total = new Date(anio, mes + 1, 0).getDate();
    const nav = (texto, etq, delta) => el('button', { type: 'button', class: 'sf-nav', 'aria-label': etq,
      text: texto, onclick: () => { mes += delta; if (mes < 0) { mes = 11; anio--; } if (mes > 11) { mes = 0; anio++; } pintar(); } });
    const dias = el('div', { class: 'sf-dias' });
    for (let i = 0; i < primero; i++) dias.append(el('span'));
    for (let d = 1; d <= total; d++) {
      const f = iso(anio, mes, d);
      const dow = (primero + d - 1) % 7;
      const pasado = min && f < min;
      const clases = ['sf-dia'];
      if (f === valor) clases.push('sel');
      if (f === hoyISO) clases.push('hoy');
      if (dow === 0 || dow === 5 || dow === 6) clases.push('finde');
      dias.append(el('button', {
        type: 'button', class: clases.join(' '), text: String(d),
        'aria-label': fechaLarga(f), 'aria-pressed': String(f === valor),
        disabled: pasado ? 'disabled' : null, onclick: () => elegir(f),
      }));
    }
    limpiar(pop).append(
      el('div', { class: 'sf-atajos' }, ATAJOS.map(([t, calc]) => {
        const f = calc();
        return el('button', { type: 'button', class: `sf-atajo${f === valor ? ' sel' : ''}`, text: t,
          title: fechaLarga(f), onclick: () => elegir(f) });
      })),
      el('div', { class: 'sf-cabeza' }, [
        nav('‹', 'Mes anterior', -1),
        el('span', { text: `${MESES[mes][0].toUpperCase()}${MESES[mes].slice(1)} de ${anio}` }),
        nav('›', 'Mes siguiente', 1),
      ]),
      el('div', { class: 'sf-semana' }, DIAS_MINI.map((d) => el('span', { text: d }))),
      dias,
      el('div', { class: 'sf-pie' }, [
        el('span', { text: valor ? fechaLarga(valor) : 'Vie, sáb y dom en negrita: cuestan distinto' }),
        el('button', { type: 'button', class: 'sf-cancelar', text: 'Cancelar', onclick: () => { cerrar(); disparador.focus(); } }),
      ]),
    );
  }

  const fuera = (e) => { if (!caja.contains(e.target)) cerrar(); };
  const tecla = (e) => { if (e.key === 'Escape') { cerrar(); disparador.focus(); } };
  function abrir() {
    const base = valor || min || hoyISO;
    anio = Number(base.slice(0, 4)); mes = Number(base.slice(5, 7)) - 1;
    pintar();
    pop.hidden = false;
    disparador.classList.add('activo');
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    (pop.querySelector('.sf-dia.sel') ?? pop.querySelector('.sf-dia.hoy:not([disabled])') ?? pop.querySelector('.sf-dia:not([disabled])'))?.focus();
  }
  function cerrar() {
    pop.hidden = true;
    disparador.classList.remove('activo');
    document.removeEventListener('mousedown', fuera);
    document.removeEventListener('keydown', tecla);
  }
  disparador.addEventListener('click', () => (pop.hidden ? abrir() : cerrar()));
  // Dentro de un <label>, un clic en el espacio del calendario activaría el
  // botón y lo cerraría. Enter tampoco debe llegar a quien escucha afuera.
  pop.addEventListener('click', (e) => e.preventDefault());
  caja.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.stopPropagation(); });

  Object.defineProperty(caja, 'value', {
    get: () => valor,
    set: (v) => { valor = v || ''; pintarEtiqueta(); },
  });
  caja.focus = () => disparador.focus();
  pintarEtiqueta();
  return caja;
}

/** Copia texto al portapapeles y confirma en el propio botón. */
export async function copiar(texto, boton) {
  const original = boton.textContent;
  try {
    await navigator.clipboard.writeText(texto);
    boton.textContent = '✓ Copiado';
  } catch {
    boton.textContent = 'No se pudo copiar';
  }
  setTimeout(() => { boton.textContent = original; }, 1800);
}

export { el, limpiar };
