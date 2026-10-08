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
// El modelo inventa el dia cuando el cliente solo dijo el mes: «diciembre de
// 2027» salio como 2027-12-01 y se escribio en Kommo. Por eso, ademas del
// formato, se exige que el numero del dia aparezca en lo que el cliente
// escribio. Si el dia venia arrastrado de un mensaje anterior, ese mensaje ya
// lo escribio en su turno, asi que no se pierde nada.
function dijoElDia(fecha, texto) {
  const dia = Number(fecha.slice(8, 10));
  const t = String(texto ?? '');
  if (new RegExp('(^|[^0-9])0?' + dia + '([^0-9]|$)').test(t)) return true;
  return dia === 1 && /\bprimero\b/i.test(t);
}

if (/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha_evento ?? '')
    && dijoElDia(datos.fecha_evento, $('formatLead').first().json.chats)) {
  // Kommo guarda las fechas como epoch. Se usa mediodia UTC a proposito: a
  // las 00:00 UTC en Monterrey (UTC-6) todavia es el dia anterior, y la
  // fecha del evento aparecería corrida un dia.
  const epoch = Math.floor(Date.parse(datos.fecha_evento + 'T12:00:00Z') / 1000);
  valores.push({ field_id: CAMPO.fecha_evento, values: [{ value: epoch }] });
  anotado.fecha_evento = datos.fecha_evento;
}
// ─────────────────────────────────────────────────────────────────────────
// La fecha, ya con su dia de la semana, lista para que el agente la nombre.
//
// El Lic. quiere que nunca se diga «el 20 de marzo» a secas, sino «el sabado
// 20 de marzo». Pero esto NO se le puede pedir al prompt: sacar el dia de la
// semana de una fecha es aritmetica, y el modelo la falla sin avisar. Peor
// aun, la falla con seguridad — diria «viernes 20 de marzo» con el mismo tono
// con que dice el precio, y el cliente le cree.
//
// Asi que se calcula aqui y se le entrega hecha. El modelo solo la copia.
// Con acentos: esto lo copia el agente tal cual y sale al chat del cliente.
const DIA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
             'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// En español la fecha va «20 de marzo de 2027». «Marzo 20 de 2027» es orden
// de ingles y en el chat se nota raro.
function enLetras(iso) {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), d = Number(iso.slice(8, 10));
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DIA[dow]} ${d} de ${MES[m - 1]} de ${y}`;
}

// Primero la de este mensaje; si en este turno no dijo fecha, la que ya traia
// el lead. Sin esto, en cuanto el cliente escribe «¿y cuanto sale?» el agente
// se queda sin el dia de la semana y vuelve a decir la fecha pelada.
let fechaISO = anotado.fecha_evento ?? null;
if (!fechaISO) {
  const epoch = Number($('formatLead').first().json.campos?.['Fecha del evento']);
  // Se guarda a mediodia UTC justamente para que el dia no se corra al pasarla
  // a texto. Ver el comentario de arriba.
  if (Number.isFinite(epoch) && epoch > 0) {
    fechaISO = new Date(epoch * 1000).toISOString().slice(0, 10);
  }
}

const invitados = Number(datos.invitados);
if (Number.isFinite(invitados) && invitados > 0) {
  valores.push({ field_id: CAMPO.invitados, values: [{ value: invitados }] });
  anotado.invitados = invitados;
}

// El interruptor ya no se escribe desde aqui. Cuando el campo se llamaba «IA
// activa» habia que marcarlo en el primer contacto, porque Kommo omite los
// checkbox sin marcar y sin marcarlo no se podia distinguir «nadie lo ha
// tocado» de «la encargada lo apago».
//
// Ahora se llama «Stop IA» y la ausencia significa lo correcto por si sola:
// sin marcar, la IA corre. Marcarlo seria justo lo contrario de lo que se
// quiere en un lead nuevo.

return [{
  json: {
    hay_datos: valores.length > 0,
    lead_id: $('formatLead').first().json.lead_id,
    anotado,
    fecha_iso: fechaISO,
    fecha_larga: fechaISO ? enLetras(fechaISO) : null,
    cuerpo: { custom_fields_values: valores },
  },
}];
