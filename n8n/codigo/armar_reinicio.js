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
  fecha_evento: 352874,
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
  'Fecha del evento': 'Fecha del evento',
  'Invitados': 'Invitados',
  'Paquete cotizado': 'Paquete cotizado',
};

const comoTexto = (nombre, valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  // La fecha viene en epoch y una nota con «1797055200» no le sirve a nadie.
  if (nombre === 'Fecha del evento') {
    const n = Number(valor);
    if (Number.isFinite(n) && n > 0) return new Date(n * 1000).toISOString().slice(0, 10);
  }
  return String(valor);
};

const habia = [];
for (const nombre of Object.keys(NOMBRE)) {
  const t = comoTexto(nombre, campos[nombre]);
  if (t !== null) habia.push(`${nombre}: ${t}`);
}

const nota = habia.length
  ? 'Se reinició la conversación con «/*». Los campos quedaron en blanco. '
    + 'Lo que había antes:\n' + habia.join('\n')
  : 'Se reinició la conversación con «/*». El lead no tenía datos capturados.';

// Vaciar un campo en Kommo depende del TIPO, y no esta documentado junto:
//
//   `values: []`            -> rechazado siempre. «TooFew: exactly 1 element»
//   `{ value: null }`       -> funciona en texto, numero y select
//   `{ value: null }` en fecha -> rechazado. «NotNullable» + «InvalidDateFormat»
//   `{ value: 0 }` en fecha -> aceptado, y es lo unico que acepta
//
// El 0 deja la fecha en el 1-ene-1970 en vez de vacia. Es feo en la ficha de
// Kommo, pero `formatLead` lo traduce a null y nada aguas abajo lo ve como
// una fecha de verdad. Probado contra la cuenta, campo por campo.
const FECHA = CAMPO.fecha_evento;
const cuerpo = {
  custom_fields_values: Object.values(CAMPO).map((field_id) => ({
    field_id,
    values: [{ value: field_id === FECHA ? 0 : null }],
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
