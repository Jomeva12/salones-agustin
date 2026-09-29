// Convierte lo que entendio el Director en el PATCH de campos de Kommo.
//
// Solo el Director escribe en Kommo. Si cada agente parchara el mismo lead se
// pisarian entre ellos y no habria forma de saber quien puso que.
//
// Regla de oro: solo se escribe lo que el cliente DIJO. Un campo que el
// Director no pudo determinar se queda como esta. Sobrescribir con null
// borraria lo que una encargada capturo a mano.

const CAMPO = {
  salon: 352870,
  tipo_evento: 352872,
  fecha_evento: 352874,
  invitados: 352876,
};

// Los select de Kommo guardan enum_id, no texto.
const ENUM_SALON = {
  norma: 281622, esmeralda: 281624, santacruz: 281626, quetzal: 281628,
};
const ENUM_TIPO = {
  xv: 281630, boda: 281632, graduacion: 281634,
  posada: 281636, cumpleanos: 281638, babyshower: 281640,
};

// Del JSON del Director, aunque venga envuelto en cercos de codigo.
let salida = $json.output ?? '';
if (typeof salida === 'string') {
  salida = salida.trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  try { salida = JSON.parse(salida); } catch (e) { salida = {}; }
}
const datos = (salida && salida.datos) || {};

const valores = [];
const anotado = {};

if (ENUM_SALON[datos.salon]) {
  valores.push({ field_id: CAMPO.salon, values: [{ enum_id: ENUM_SALON[datos.salon] }] });
  anotado.salon = datos.salon;
}
if (ENUM_TIPO[datos.tipo_evento]) {
  valores.push({ field_id: CAMPO.tipo_evento, values: [{ enum_id: ENUM_TIPO[datos.tipo_evento] }] });
  anotado.tipo_evento = datos.tipo_evento;
}
if (/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha_evento ?? '')) {
  // Kommo guarda las fechas como epoch. Se usa mediodia UTC a proposito: a
  // las 00:00 UTC en Monterrey (UTC-6) todavia es el dia anterior, y la
  // fecha del evento aparecería corrida un dia.
  const epoch = Math.floor(Date.parse(datos.fecha_evento + 'T12:00:00Z') / 1000);
  valores.push({ field_id: CAMPO.fecha_evento, values: [{ value: epoch }] });
  anotado.fecha_evento = datos.fecha_evento;
}
const invitados = Number(datos.invitados);
if (Number.isFinite(invitados) && invitados > 0) {
  valores.push({ field_id: CAMPO.invitados, values: [{ value: invitados }] });
  anotado.invitados = invitados;
}

return [{
  json: {
    hay_datos: valores.length > 0,
    lead_id: $('formatLead').first().json.lead_id,
    anotado,
    cuerpo: { custom_fields_values: valores },
  },
}];
