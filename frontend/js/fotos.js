// Las fotos de cada salón: cómo se ve el lugar.
//
// No son las láminas. La lámina dice qué incluye el paquete y lleva el
// precio; estas dicen cómo se ve, y se mandan después, cuando el cliente
// contesta que sí quiere verlas.
//
// Lo importante de esta pantalla es el ORDEN. De las veinte que puede haber
// de un salón, el agente manda las tres primeras — así que mover una al
// principio es decidir qué ve el cliente. Por eso las tres primeras salen
// marcadas: para que quien ordena sepa cuáles está eligiendo.
import { api, error, salonActual, puede } from './api.js';
import { el, limpiar, cargando } from './ui.js';

const CUANTAS_MANDA = 3;

export async function fotos(raiz) {
  limpiar(raiz);
  const cont = el('div', { class: 'fts-pag' });
  raiz.appendChild(cont);

  let salon = salonActual() || 'norma';
  const cabecera = el('header', { class: 'fts-cab' });
  const cuerpo = el('div');
  cont.append(cabecera, cuerpo);

  async function pintar() {
    limpiar(cuerpo);
    cuerpo.appendChild(cargando('lista'));
    let d;
    try {
      d = await api.fotosSalon(salon, true);
    } catch {
      limpiar(cuerpo);
      cuerpo.appendChild(error('No se pudieron leer las fotos.'));
      return;
    }
    limpiar(cuerpo);

    const todas = d.fotos ?? [];
    const activas = todas.filter((f) => f.activa);

    cuerpo.appendChild(el('p', { class: 'fts-cuenta', text:
      activas.length
        ? `${todas.length} fotos · ${activas.length} activas. El agente manda las ` +
          `${Math.min(CUANTAS_MANDA, activas.length)} primeras.`
        : `${todas.length} fotos, ninguna activa. El agente no mandará ninguna.` }));

    if (!todas.length) {
      cuerpo.appendChild(el('p', { class: 'fts-vacio', text: 'Este salón todavía no tiene fotos.' }));
    } else {
      const rejilla = el('div', { class: 'fts-rejilla' });
      let puesto = 0;
      for (const f of todas) {
        if (f.activa) puesto++;
        rejilla.appendChild(tarjeta(f, f.activa && puesto <= CUANTAS_MANDA ? puesto : null));
      }
      cuerpo.appendChild(rejilla);
    }

    if (puede('precios')) cuerpo.appendChild(subir());
  }

  function tarjeta(f, puesto) {
    const img = el('img', { src: f.url, alt: f.titulo || f.nombre || 'Foto del salón',
      loading: 'lazy', onclick: () => ver(f) });

    const acciones = el('div', { class: 'fts-acciones' });
    if (puede('precios')) {
      const toca = async (cuerpoPeticion, boton) => {
        if (boton) boton.disabled = true;
        try { await api.cambiarFotoSalon(cuerpoPeticion); await pintar(); }
        catch (e) { alert(e.message); if (boton) boton.disabled = false; }
      };
      const arriba = el('button', { class: 'fantasma', title: 'Subir', 'aria-label': 'Subir',
        text: '↑', onclick: () => toca({ id: f.id, mover: 'arriba' }, arriba) });
      const abajo = el('button', { class: 'fantasma', title: 'Bajar', 'aria-label': 'Bajar',
        text: '↓', onclick: () => toca({ id: f.id, mover: 'abajo' }, abajo) });
      const prender = el('button', { class: 'fantasma',
        text: f.activa ? 'Quitar' : 'Usar',
        title: f.activa ? 'Dejar de mandarla' : 'Volver a mandarla',
        onclick: () => toca({ id: f.id, activa: !f.activa }, prender) });
      const borrar = el('button', { class: 'fantasma peligro', text: '×', title: 'Borrar',
        'aria-label': 'Borrar', onclick: async () => {
          if (!confirm('¿Borrar esta foto? El archivo se queda en Kommo, pero sale del panel.')) return;
          try { await api.borrarFotoSalon(f.id); await pintar(); }
          catch (e) { alert(e.message); }
        } });
      acciones.append(arriba, abajo, prender, borrar);
    }

    return el('figure', { class: 'fts-tarjeta' + (f.activa ? '' : ' apagada') }, [
      img,
      puesto ? el('span', { class: 'fts-puesto', text: String(puesto) }) : null,
      !f.activa ? el('span', { class: 'fts-fuera', text: 'No se manda' }) : null,
      acciones,
    ]);
  }

  // A pantalla completa: la miniatura no deja ver si la foto está bien.
  function ver(f) {
    const cerrar = () => { capa.remove(); document.removeEventListener('keydown', tecla); };
    const tecla = (ev) => { if (ev.key === 'Escape') cerrar(); };
    const capa = el('div', { class: 'visor', role: 'dialog', 'aria-modal': 'true',
      'aria-label': f.titulo || 'Foto del salón', onclick: cerrar }, [
      el('button', { class: 'vis-cerrar', 'aria-label': 'Cerrar', text: '×', onclick: cerrar }),
      el('div', { class: 'vis-caja', onclick: (ev) => ev.stopPropagation() }, [
        el('img', { src: f.url, alt: f.titulo || 'Foto del salón' }),
      ]),
    ]);
    document.addEventListener('keydown', tecla);
    document.body.appendChild(capa);
    capa.querySelector('.vis-cerrar').focus();
  }

  function subir() {
    const entrada = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp',
      multiple: '', hidden: '' });
    const dicho = el('span', { class: 'fts-dicho' });
    const boton = el('button', { class: 'primario', text: 'Agregar fotos',
      onclick: () => entrada.click() });

    entrada.addEventListener('change', async () => {
      const archivos = [...(entrada.files ?? [])];
      if (!archivos.length) return;
      boton.disabled = true;
      let bien = 0, mal = 0;
      for (const [i, a] of archivos.entries()) {
        dicho.className = 'fts-dicho';
        dicho.textContent = `Subiendo ${i + 1} de ${archivos.length}…`;
        // De una en una y no en paralelo: cada foto abre una sesión en el
        // Drive de Kommo, y lanzarlas todas a la vez es la forma segura de
        // que la cuenta empiece a devolver errores.
        try { await api.subirFotoSalon(salon, a); bien++; }
        catch { mal++; }
      }
      entrada.value = '';
      boton.disabled = false;
      dicho.className = 'fts-dicho' + (mal ? ' mal' : '');
      dicho.textContent = mal
        ? `${bien} subidas, ${mal} no se pudieron (¿repetidas, o no son imagen?).`
        : `${bien} ${bien === 1 ? 'foto subida' : 'fotos subidas'}.`;
      await pintar();
    });

    return el('section', { class: 'fts-subir' }, [
      el('b', { text: 'Agregar fotos a este salón' }),
      el('p', { class: 'fts-ayuda', text:
        'JPG, PNG o WebP. Entran al final de la lista; para que el agente las mande, ' +
        'súbelas con las flechas hasta las primeras posiciones. Una foto repetida se rechaza sola.' }),
      el('div', { class: 'fts-acciones' }, [boton, entrada, dicho]),
    ]);
  }

  const selSalon = el('select', { onchange: () => { salon = selSalon.value; pintar(); } });
  try {
    for (const s of (await api.salones()) ?? []) {
      selSalon.appendChild(el('option', { value: s.clave, text: s.nombre,
        selected: s.clave === salon ? '' : null }));
    }
  } catch { /* si falla, queda el salón por omisión */ }

  cabecera.append(
    el('h1', { text: 'Fotos del salón' }),
    el('p', { class: 'fts-sub', text:
      'Cómo se ve el lugar. El agente las ofrece después de mandar la lámina del paquete, ' +
      'y manda las primeras de esta lista — así que el orden decide qué ve el cliente.' }),
    el('div', { class: 'fts-controles' }, [selSalon]));

  pintar();
}
