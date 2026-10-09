// Los globos del menú: el número que cuelga de un ítem del lateral.
//
// Vive aparte de app.js porque lo tocan los dos extremos —el arranque y la
// pantalla de Avisos cuando se atiende uno— y haciéndolo desde app.js habría
// que importarse a sí mismo.
import { api, salonActual } from './api.js';

/** Pone, actualiza o quita el globo de un ítem del menú. */
export function ponerGlobo(ruta, n) {
  const a = document.querySelector(`nav.menu a[href="#${ruta}"]`);
  if (!a) return;
  const viejo = a.querySelector('.globo');
  // Cero no se pinta: un globo con un 0 pide atención para decir que no hay
  // nada que atender.
  if (!n) { viejo?.remove(); return; }
  const globo = viejo ?? Object.assign(document.createElement('span'), { className: 'globo' });
  globo.textContent = String(n);
  if (!viejo) a.append(globo);
}

/**
 * Cuántos avisos están esperando a una persona, y lo cuelga del menú.
 *
 * Se vuelve a pedir en cada cambio de pantalla y cada vez que se atiende uno.
 * Antes el único globo del panel se montaba una sola vez al arrancar: si
 * resolvías algo, el número se quedaba igual hasta recargar, y un contador que
 * miente se deja de mirar.
 *
 * Si falla, el globo se queda como estaba. Un error de red no es una razón
 * para decirle a nadie que ya no hay nada pendiente.
 */
export async function refrescarAvisos() {
  try {
    const d = await api.avisos('pendiente', salonActual() || null);
    ponerGlobo('/avisos', d.pendientes ?? 0);
  } catch (e) { /* se queda el de antes */ }
}
