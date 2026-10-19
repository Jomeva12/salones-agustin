// Lo que hay que hacer en Kommo cuando alguien manda «/*».
//
// Borrar la memoria sola no alcanza: el Director lee los campos del lead y
// arrastra la fecha y el salon de la conversacion anterior, asi que el
// «empezamos de cero» era mentira a medias.
//
// Pero esto borra datos de verdad, y ya paso en otro cliente: un «/*» cayo en
// un lead que resulto ser una clienta real y le limpio los campos en plena
// cotizacion. Por eso ANTES de borrar se deja una nota en el lead con lo que
// habia. Si alguna vez vuelve a pasar, el dato se recupera leyendo la nota en
// vez de reconstruirlo preguntandole al cliente.

const CAMPO = {
  salon: 352870,
  tipo_evento: 352872,
  fecha_evento: 611320,   // el de TEXTO; ver armar_patch_kommo.js
  invitados: 352876,
  paquete: 352880,
};

// Lo que NO se toca, a proposito:
//   352882 «Stop IA»        — si la encargada apago la IA, un /* no la puede
//                             volver a encender. Seria lo contrario de lo que
//                             quiso quien la apago.
//   352884 «Estado de contacto» — es operativo del equipo, no del agente.

const lead = $('formatLead').first().json;
const campos = lead.campos ?? {};

// El nombre que Kommo le da a cada campo, para leer lo que habia. Se mira por
// nombre porque es lo que trae `formatLead`, ya aplanado.
const NOMBRE = {
  'Salón': 'Salón',
  'Tipo de evento': 'Tipo de evento',
  'Fecha del evento (texto)': 'Fecha del evento',
  'Invitados': 'Invitados',
  'Paquete cotizado': 'Paquete cotizado',
};

// Ya no hay que traducir epochs: la fecha es texto y se lee tal cual. Antes
// esto convertia «1797055200» a algo legible, porque una nota con ese numero
// no le sirve a nadie.
const comoTexto = (_nombre, valor) =>
  (valor === null || valor === undefined || valor === '' ? null : String(valor));

// La clave es como se llama el campo en Kommo; el valor, como se escribe en
// la nota. No siempre coinciden: el de la fecha se llama «Fecha del evento
// (texto)» por el tipo, y ese parentesis no le dice nada a quien la lee.
const habia = [];
for (const [enKommo, etiqueta] of Object.entries(NOMBRE)) {
  const t = comoTexto(enKommo, campos[enKommo]);
  if (t !== null) habia.push(`${etiqueta}: ${t}`);
}

const nota = habia.length
  ? 'Se reinició la conversación con «/*». Los campos quedaron en blanco. '
    + 'Lo que había antes:\n' + habia.join('\n')
  : 'Se reinició la conversación con «/*». El lead no tenía datos capturados.';

// Vaciar un campo en Kommo es mandarlo con `{ value: null }`. Sirve en texto,
// numero y select, que son los cuatro que quedan; `values: []` lo rechaza
// siempre, con «TooFew: exactly 1 element».
const cuerpo = {
  custom_fields_values: Object.values(CAMPO).map((field_id) => ({
    field_id, values: [{ value: null }],
  })),
};

return [{
  json: {
    lead_id: lead.lead_id,
    tenia_datos: habia.length > 0,
    nota,
    cuerpo,
  },
}];
