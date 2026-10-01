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
import { api, error, salonActual } from './api.js';
import { el, limpiar, cargando } from './ui.js';

const ETIQUETA = {
  babyshower: 'Baby shower',
  despedida: 'Despedida de soltera',
  bautizo: 'Bautizo',
};

function ficha({ url, titulo, pie, marca }) {
  const enlace = el('a', { href: url, target: '_blank', rel: 'noopener', class: 'lam-foto' },
    [el('img', { src: url, alt: titulo, loading: 'lazy' })]);
  const texto = [el('b', { text: titulo })];
  if (pie) texto.push(el('span', { class: 'lam-etq', text: pie }));
  if (marca) texto.push(el('span', { class: 'lam-marca', text: marca }));
  return el('figure', { class: 'lam-pieza' },
    [enlace, el('figcaption', {}, texto)]);
}

export async function laminas(raiz) {
  limpiar(raiz);
  raiz.appendChild(cargando('lista'));

  let d;
  try {
    d = await api('/api/imagenes');
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
        url: x.url,
        titulo: x.paquete.replace(/^Paquete /, ''),
        pie: ETIQUETA[x.etiqueta] ?? '',
      }));
    }
    for (const x of suyasC) {
      rejilla.appendChild(ficha({
        url: x.url,
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
