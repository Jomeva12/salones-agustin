// Las imágenes que el agente le puede mandar a un cliente.
//
// Dos clases, y conviene verlas juntas porque se confunden: la LÁMINA de un
// paquete (la hoja con todo lo que incluye, que acompaña a la cotización) y la
// foto de una CORTESÍA (una cosa concreta: el Espejo de Bienvenida, el Aro
// iluminado). La cortesía no pertenece a un paquete — el Espejo aparece en el
// Onix, el Plata y el Oro y es la misma foto.
//
// Los archivos viven en el Drive de Kommo, no aquí: el adjunto del salesbot
// solo acepta un uuid de archivo de Kommo y descarta cualquier otra URL.
import { api, error, salonActual, puede } from './api.js';
import { el, limpiar, cargando } from './ui.js';

const ETIQUETA = {
  babyshower: 'Baby shower',
  despedida: 'Despedida de soltera',
  bautizo: 'Bautizo',
};

// Al tocar una imagen se abre a pantalla completa en vez de descargarse: la
// URL de Kommo viene con content-disposition attachment, asi que un enlace
// normal se la baja al disco sin enseñarla.
function verImagen(pieza, alCambiar) {
  const img = el('img', { src: pieza.url, alt: pieza.titulo });
  const titulo = el('div', { class: 'vis-titulo' }, [
    el('b', { text: pieza.titulo }),
    el('span', { text: pieza.donde }),
  ]);

  const acciones = el('div', { class: 'vis-acciones' });
  acciones.appendChild(el('a', { class: 'vis-btn', href: pieza.url,
    download: '', target: '_blank', rel: 'noopener', text: 'Descargar' }));

  let entrada = null;
  if (puede('precios')) {
    entrada = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: '' });
    const aviso = el('span', { class: 'vis-aviso' });
    const boton = el('button', { class: 'primario', text: 'Reemplazar',
      onclick: () => entrada.click() });
    entrada.addEventListener('change', async () => {
      const f = entrada.files?.[0];
      if (!f) return;
      boton.disabled = true;
      aviso.className = 'vis-aviso';
      aviso.textContent = 'Subiendo a Kommo…';
      try {
        const r = await api.reemplazarImagen(pieza.tipo, pieza.id, f);
        // El navegador tiene cacheada la anterior con la misma URL cuando
        // Kommo reusa el nombre: el sello la obliga a volver a pedirla.
        const nueva = r.url + (r.url.includes('?') ? '&' : '?') + 'v=' + Date.now();
        img.src = nueva;
        aviso.textContent = 'Listo. Ya es la que manda el agente.';
        alCambiar?.(r.url);
      } catch (e) {
        aviso.className = 'vis-aviso mal';
        aviso.textContent = e.message;
      } finally {
        boton.disabled = false;
        entrada.value = '';
      }
    });
    acciones.append(boton, entrada, aviso);
  }

  const caja = el('div', { class: 'vis-caja', onclick: (ev) => ev.stopPropagation() },
    [img, el('div', { class: 'vis-pie' }, [titulo, acciones])]);

  const cerrar = () => { capa.remove(); document.removeEventListener('keydown', tecla); };
  const tecla = (ev) => { if (ev.key === 'Escape') cerrar(); };
  const capa = el('div', { class: 'visor', role: 'dialog', 'aria-modal': 'true',
    'aria-label': pieza.titulo, onclick: cerrar }, [
    el('button', { class: 'vis-cerrar', 'aria-label': 'Cerrar', text: '×', onclick: cerrar }),
    caja,
  ]);
  document.addEventListener('keydown', tecla);
  document.body.appendChild(capa);
  capa.querySelector('.vis-cerrar').focus();
}

function ficha(pieza) {
  const img = el('img', { src: pieza.url, alt: pieza.titulo, loading: 'lazy' });
  const boton = el('button', { class: 'lam-foto', type: 'button',
    'aria-label': `Ver ${pieza.titulo}`,
    onclick: () => verImagen(pieza, (url) => { img.src = url + '?v=' + Date.now(); }) },
    [img]);
  const texto = [el('b', { text: pieza.titulo })];
  if (pieza.pie) texto.push(el('span', { class: 'lam-etq', text: pieza.pie }));
  if (pieza.marca) texto.push(el('span', { class: 'lam-marca', text: pieza.marca }));
  return el('figure', { class: 'lam-pieza' }, [boton, el('figcaption', {}, texto)]);
}

export async function laminas(raiz) {
  limpiar(raiz);
  raiz.appendChild(cargando('lista'));

  let d;
  try {
    d = await api.imagenes();
  } catch {
    limpiar(raiz);
    raiz.appendChild(error('No se pudieron leer las imágenes.'));
    return;
  }

  limpiar(raiz);
  const cont = el('div', { class: 'laminas-pag' });

  const total = (d.laminas ?? []).length;
  const cort = (d.cortesias ?? []).length;
  cont.appendChild(el('header', { class: 'lam-cab' }, [
    el('h1', { text: 'Imágenes' }),
    el('p', { class: 'lam-sub', text:
      `${total} láminas de paquete y ${cort} fotos de cortesías. Es exactamente lo ` +
      'que el agente puede mandarle hoy a un cliente. Toca una para verla completa.' }),
  ]));

  // El selector de arriba manda: si hay un salón elegido, solo se ve el suyo.
  const soloEste = salonActual();
  const salones = (d.salones ?? []).filter((s) => !soloEste || s.clave === soloEste);

  for (const s of salones) {
    const suyas = (d.laminas ?? []).filter((x) => x.salon === s.clave);
    const suyasC = (d.cortesias ?? []).filter((x) => x.salon === s.clave);

    const cuenta = suyas.length
      ? `${suyas.length} láminas` + (suyasC.length ? ` · ${suyasC.length} cortesías` : '')
      : 'sin cargar';
    cont.appendChild(el('div', { class: 'lam-salon-cab' }, [
      el('h2', { text: s.nombre }),
      el('span', { class: 'lam-cuenta' + (suyas.length ? '' : ' falta'), text: cuenta }),
    ]));

    if (!suyas.length && !suyasC.length) {
      cont.appendChild(el('p', { class: 'lam-vacio', text:
        'Este salón todavía no tiene imágenes cargadas.' }));
      continue;
    }

    const rejilla = el('div', { class: 'lam-rejilla' });
    for (const x of suyas) {
      rejilla.appendChild(ficha({
        tipo: 'paquete', id: x.id, url: x.url, donde: s.nombre,
        titulo: x.paquete.replace(/^Paquete /, ''),
        pie: ETIQUETA[x.etiqueta] ?? '',
      }));
    }
    for (const x of suyasC) {
      rejilla.appendChild(ficha({
        tipo: 'cortesia', id: x.id, url: x.url, donde: s.nombre,
        titulo: x.titulo || x.clave,
        marca: 'cortesía',
      }));
    }
    cont.appendChild(rejilla);
  }

  cont.appendChild(el('p', { class: 'lam-nota', text:
    'Las cortesías están cargadas pero todavía no se envían: falta decidir cuál gana ' +
    'cuando el agente cotiza, porque las nombra dentro de la propia cotización.' }));

  raiz.appendChild(cont);
}
