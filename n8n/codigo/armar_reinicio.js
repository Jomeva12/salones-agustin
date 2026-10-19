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
  invitados: 352876,
  paquete: 352880,
};

// Lo que NO se toca, a proposito:
//   352882 «Stop IA»        — si la encargada apago la IA, un /* no la puede
//                             volver a encender. Seria lo contrario de lo que
//                             quiso quien la apago.
//   352884 «Estado de contacto» — es operativo del equipo, no del agente.
//   352874 «Fecha del evento» — porque NO SE PUEDE. La API de Kommo no deja
//     vaciar un campo de tipo fecha. Probado contra la cuenta:
//       values: []             -> «TooFew: exactly 1 element»
//       values: [{value:null}] -> «NotNullable» + «InvalidDateFormat»
//       values: [{value:0}]    -> lo unico que acepta... y la ficha lo pinta
//                                 «31/12/1969», que parece un sistema roto.
//     Entre dejar la fecha anterior y dejar 1969, la anterior hace menos
//     dano: `formatLead` ya ignora una fecha pasada y el Director la
//     reemplaza en cuanto el cliente diga otra. Para vaciarla de verdad hay
//     que borrarla a mano en la ficha de Kommo, que si puede.

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

// Que la fecha se queda se DICE, aqui mismo. Quien lea la nota y vea que los
// demas campos estan en blanco va a dar por hecho que la fecha tambien, y la
// unica forma de que no se lleve la sorpresa es contarselo.
const aclaracion = campos['Fecha del evento']
  ? '\n\nLa fecha del evento se queda como estaba: Kommo no deja vaciarla desde '
    + 'el API. Si hay que quitarla, se borra a mano aquí.'
  : '';

const nota = habia.length
  ? 'Se reinició la conversación con «/*». Los campos quedaron en blanco. '
    + 'Lo que había antes:\n' + habia.join('\n') + aclaracion
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
