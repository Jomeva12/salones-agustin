// La linea «[Sistema]» que acompaña al mensaje del cliente.
//
// Junta dos cosas que el agente no puede deducir y que necesita ANTES de
// cotizar: el dia de la semana de la fecha, y si ese dia tiene algo que
// avisar.
//
// Lo de Semana Santa vivia solo dentro de `cotizar`, asi que mientras el
// agente seguia recabando invitados la fecha pasaba sin que nadie dijera
// nada. El cliente decia «27 de marzo», ella confirmaba tan tranquila, y el
// aviso llegaba dos mensajes despues o no llegaba.

const p = $('armar_patch').first().json;

// La consulta al panel va en «continuar aunque falle»: si el panel no
// contesta, se pierde el aviso de la fecha especial pero la conversacion
// sigue. Quedarse mudo seria peor que no avisar.
let especial = null;
try {
  const r = $input.first().json ?? {};
  especial = r.fecha_especial ?? null;
} catch (e) { especial = null; }

const partes = [];
if (p.fecha_larga) {
  partes.push(`La fecha de la que se habla es el ${p.fecha_larga}. `
    + 'Nombrala siempre asi, con su dia de la semana.');
}
if (especial && especial.aviso) {
  partes.push(`Ese dia es ${especial.titulo}. ${especial.aviso} `
    + (especial.se_puede_cotizar
      ? 'Diselo con tus palabras en cuanto hablen de esa fecha, sin esperar a cotizar, '
        + 'y sigue adelante con normalidad: la fecha se vende igual.'
      : 'Esa fecha NO se puede vender.'));
}

return [{
  json: {
    // Todo lo de armar_patch sigue viaje: `hay_datos` y `guardar_en_kommo`
    // leen de aqui.
    ...p,
    fecha_especial: especial,
    nota_fecha: partes.length ? '\n\n[Sistema] ' + partes.join(' ') : '',
  },
}];
