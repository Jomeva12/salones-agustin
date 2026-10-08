// La ventana de «¿seguro?» antes de algo que no se deshace con un clic:
// cancelar un evento, borrar una respuesta, desactivar una cuenta.
//
// Antes cada pantalla lo resolvía a su modo — un recuadro que se abría dentro
// de la lista, empujando todo hacia abajo — y dos acciones ni siquiera
// preguntaban: «Dejar de ofrecerlo» en Servicios y «Cancelar» en Citas se
// ejecutaban al primer clic.
//
//   const hecho = await confirmar({
//     titulo: '¿Cancelar este evento?',
//     texto: 'La fecha queda libre de inmediato…',
//     motivo: { etiqueta: '¿Por qué?', placeholder: 'El cliente canceló…' },
//     confirmar: 'Sí, liberar la fecha',
//     accion: (motivo) => api.cancelarCompromiso({ id, motivo }),
//   });
//
// Con «accion», la ventana la ejecuta ella misma: muestra que está trabajando,
// y si el servidor dice que no, el error aparece ahí mismo sin cerrarla — así
// no se pierde el motivo que ya se escribió. Devuelve true solo si se hizo.
// Sin «accion», devuelve { motivo } al confirmar o false al cancelar.
//
// Sin dependencias, como notificar.js.

const ICONO = {
  peligro: 'M12 8v5M12 16.5h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  normal: 'M12 11v6M12 7.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
};

const nodo = (tag, clase, texto) => {
  const n = document.createElement(tag);
  if (clase) n.className = clase;
  if (texto !== undefined) n.textContent = texto;
  return n;
};
const llenar = (n, contenido) => {
  for (const c of [contenido].flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
};

export function confirmar({
  titulo, texto = '', nota = null, tipo = 'peligro',
  confirmar: textoSi = 'Sí, continuar', cancelar: textoNo = 'Mejor no',
  motivo = null, accion = null,
} = {}) {
  return new Promise((resolver) => {
    const previo = document.activeElement;
    const velo = nodo('div', 'conf-velo');
    const caja = nodo('div', `conf ${tipo}`);
    caja.setAttribute('role', 'alertdialog');
    caja.setAttribute('aria-modal', 'true');

    const ico = nodo('span', 'conf-ico');
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', ICONO[tipo] ?? ICONO.normal);
    svg.append(p);
    ico.append(svg);

    const h = nodo('h3', 'conf-titulo', titulo);
    h.id = 'conf-titulo-' + Date.now();
    caja.setAttribute('aria-labelledby', h.id);
    const cuerpo = llenar(nodo('div', 'conf-texto'), texto);
    const notaN = nota ? llenar(nodo('div', 'conf-nota'), nota) : null;

    let campo = null, campoCaja = null;
    if (motivo) {
      campo = nodo('input');
      campo.type = 'text';
      campo.placeholder = motivo.placeholder ?? '';
      const et = nodo('label', 'conf-campo');
      et.append(nodo('span', '', motivo.etiqueta ?? '¿Por qué?'), campo);
      if (motivo.ayuda) et.append(nodo('small', '', motivo.ayuda));
      campoCaja = et;
    }
    const error = nodo('div', 'conf-error');
    error.hidden = true;

    const no = nodo('button', 'conf-no', textoNo);
    no.type = 'button';
    const si = nodo('button', 'conf-si');
    si.type = 'button';
    const siTexto = nodo('span', '', textoSi);
    si.append(siTexto);
    const pie = nodo('div', 'conf-pie');
    pie.append(no, si);

    const arriba = nodo('div', 'conf-arriba');
    const textos = nodo('div', 'conf-textos');
    textos.append(h, cuerpo);
    arriba.append(ico, textos);
    caja.append(arriba);
    if (notaN) caja.append(notaN);
    if (campo) caja.append(campoCaja);
    caja.append(error, pie);
    velo.append(caja);
    document.body.append(velo);

    let ocupado = false;
    const cerrar = (valor) => {
      document.removeEventListener('keydown', tecla, true);
      velo.classList.add('sale');
      setTimeout(() => velo.remove(), 180);
      previo?.focus?.();
      resolver(valor);
    };
    const fallar = (msg) => {
      ocupado = false;
      si.disabled = false; no.disabled = false;
      si.classList.remove('trabajando');
      error.textContent = msg;
      error.hidden = false;
      campo?.focus();
    };
    const aceptar = async () => {
      if (ocupado) return;
      if (motivo?.requerido && !campo.value.trim()) { fallar('Escribe el motivo: queda en la bitácora.'); return; }
      if (!accion) { cerrar({ motivo: campo?.value.trim() ?? '' }); return; }
      ocupado = true;
      si.disabled = true; no.disabled = true;
      si.classList.add('trabajando');
      error.hidden = true;
      try {
        const r = await accion(campo?.value.trim() ?? '');
        if (r?.error) { fallar(r.detalle ?? r.error); return; }
        cerrar(true);
      } catch (e) { fallar(e.message); }
    };

    // Escape cancela y no llega al panel lateral de atrás (que también se
    // cierra con Escape): se atrapa antes, en la fase de captura.
    const tecla = (e) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); if (!ocupado) cerrar(false); }
      else if (e.key === 'Enter' && e.target === campo) { e.preventDefault(); aceptar(); }
      else if (e.key === 'Tab') {
        // El foco se queda dentro de la ventana.
        const f = [...caja.querySelectorAll('button:not([disabled]),input')];
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', tecla, true);
    no.addEventListener('click', () => { if (!ocupado) cerrar(false); });
    si.addEventListener('click', aceptar);
    velo.addEventListener('mousedown', (e) => { if (e.target === velo && !ocupado) cerrar(false); });

    // En lo destructivo el foco arranca en «Mejor no»: un Enter distraído no
    // debe borrar nada. Si hay motivo, arranca ahí para escribirlo.
    (campo ?? (tipo === 'peligro' ? no : si)).focus();
  });
}
