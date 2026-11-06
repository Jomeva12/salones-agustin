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
  // TEXTO, no fecha. El viejo 352874 era `date` y ya esta borrado.
  //
  // Un campo de fecha de Kommo no se puede vaciar desde el API: `values: []`
  // da TooFew, `null` da NotNullable, y lo unico que acepta es 0 — que la
  // ficha pinta «31/12/1969» y parece un sistema roto. Como el tipo de un
  // campo tampoco se puede cambiar, se creo uno nuevo de texto.
  //
  // El formato es «2027-03-20 (sábado)»: en ISO al principio para que
  // ordenar alfabeticamente sea ordenar cronologicamente, y el dia de la
  // semana al lado para quien lo lee en la ficha.
  fecha_evento: 611320,
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

// Hoy en Monterrey. Nunca el reloj del servidor: n8n corre en UTC y al cruzar
// la medianoche eso cambia que fechas cuentan como pasadas.
const HOY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Monterrey', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const esFechaReal = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/** El cliente escribio el anio, o lo puso el modelo de su cosecha? */
function dijoElAnio(fecha, texto) {
  return new RegExp('(^|[^0-9])' + fecha.slice(0, 4) + '([^0-9]|$)').test(String(texto ?? ''));
}

/**
 * El anio no se adivina: se pregunta.
 *
 * El cliente escribio «6 de marzo» y el modelo devolvio «2024-03-06»: un
 * miercoles de hace dos anios. Eso se escribio en Kommo como fecha del evento
 * y el agente se lo confirmo tan seguro —«tus XV serian el miercoles 6 de
 * marzo de 2024»— porque el dia de la semana SI era correcto. Un dato
 * inventado con un detalle verdadero al lado es el mas dificil de ver.
 *
 * La primera version de este guardia tomaba el proximo anio en que esa fecha
 * no hubiera pasado. Estaba mal, y lo dijo el Lic.: «10 de diciembre» puede
 * ser 2026 o 2027, y entre uno y otro cambia el escalon de anticipacion —o
 * sea, el precio. Adivinar bien la mitad de las veces es cotizar mal la otra
 * mitad, y el cliente se entera tarde.
 *
 * Asi que cuando el anio no esta en lo que el cliente escribio, aqui no sale
 * ninguna fecha: sale el aviso de que falta, con los dos anios concretos que
 * el agente tiene que ofrecerle.
 */
function anios(mesDia, cuantos = 2) {
  const out = [];
  const desde = Number(HOY.slice(0, 4));
  for (let y = desde; y <= desde + 5 && out.length < cuantos; y++) {
    const cand = `${y}-${mesDia}`;
    // El 29 de febrero no existe todos los anios: se ofrecen los que si.
    if (esFechaReal(cand) && cand >= HOY) out.push(y);
  }
  return out;
}

let fechaDicha = null;   // la fecha buena, lista para Kommo
let faltaAnio = null;    // «10 de diciembre», con los anios que se le ofrecen
let fechaPasada = null;  // el cliente escribio un anio que ya paso

const loQueDijo = $('formatLead').first().json.chats;

/**
 * El cliente esta hablando de una VISITA, no de su evento.
 *
 * «Me gustaria ir a conocer Esmeralda el sabado 24 de octubre» y el Director
 * devolvio eso como `fecha_evento`. Si el cliente hubiera dicho el anio, esa
 * fecha se habria escrito en Kommo encima de la del evento —en esa misma
 * conversacion la boda era el 12 de junio de 2027— y nadie se entera hasta
 * que alguien cotiza con la fecha equivocada.
 *
 * El prompt del Director ya lo dice; esto es el seguro. Se pide que hable de
 * visita Y que no nombre el evento, para no tragarse un «quiero ir a conocerlo
 * antes de mi boda del 20 de marzo», donde la fecha SI es la del evento.
 */
const HABLA_DE_VISITA = /\b(ir a conocer|visitar|pasar a ver|conocer el sal[oó]n|agendar (una )?(cita|visita)|hacer (una )?cita)\b/i;
const NOMBRA_EL_EVENTO = /\b(mi|nuestra|la) (boda|fiesta|evento|celebraci[oó]n|xv|quince)\b|\bes para\b/i;
const esVisita = HABLA_DE_VISITA.test(loQueDijo) && !NOMBRA_EL_EVENTO.test(loQueDijo);

/**
 * El cliente contesta solo el anio a la pregunta de arriba.
 *
 * «10 de diciembre» -> se le pregunta 2026 o 2027 -> contesta «2027». En ese
 * mensaje ya no esta el dia, asi que el guardia del dia lo rechazaba y la
 * fecha no llegaba nunca a Kommo: el agente cotizaba bien de memoria y el
 * lead se quedaba vacio.
 *
 * Se acepta cuando el anio SI esta escrito y el dia no es 1. Ese 1 es la
 * frontera: es lo que el modelo pone cuando el cliente solo dijo el mes
 * —«diciembre de 2027» -> 2027-12-01—, que es justo lo que no queremos dar
 * por bueno. A cambio, quien de verdad quiera el dia 1 tendra que decirlo una
 * segunda vez; sale mas barato que guardar un dia inventado.
 */
function contestoElAnio(iso, texto) {
  return !dijoElDia(iso, texto)
    && dijoElAnio(iso, texto)
    && Number(iso.slice(8, 10)) !== 1;
}

if (!esVisita
    && /^\d{4}-\d{2}-\d{2}$/.test(datos.fecha_evento ?? '')
    && esFechaReal(datos.fecha_evento)
    && (dijoElDia(datos.fecha_evento, loQueDijo)
        || contestoElAnio(datos.fecha_evento, loQueDijo))) {
  const iso = datos.fecha_evento;
  const mesDia = iso.slice(5);
  if (!dijoElAnio(iso, loQueDijo)) {
    faltaAnio = {
      dia_mes: `${Number(iso.slice(8, 10))} de ${MES[Number(iso.slice(5, 7)) - 1]}`,
      opciones: anios(mesDia),
    };
  } else if (iso < HOY) {
    fechaPasada = enLetras(iso);
  } else {
    fechaDicha = iso;
  }
}

if (fechaDicha) {
  // Ya no va como epoch: el campo es de texto. De paso se acabo la clase de
  // error mas tonta que tenia esto — guardar a medianoche UTC hacia que en
  // Monterrey (UTC-6) la ficha mostrara el dia anterior.
  valores.push({
    field_id: CAMPO.fecha_evento,
    values: [{ value: `${fechaDicha} (${enLetras(fechaDicha).split(' ')[0]})` }],
  });
  anotado.fecha_evento = fechaDicha;
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

// SOLO la fecha de este mensaje. El campo del lead no entra aqui.
//
// Antes si entraba, como respaldo para no perder el dia de la semana cuando
// el cliente escribia «¿y cuanto sale?». Ese respaldo acabo diciendo una
// mentira: tras un «/*» la memoria queda limpia pero el campo del lead no
// —Kommo no deja vaciar una fecha—, asi que el agente leia esa fecha vieja y
// se la afirmaba al cliente como suya: «tus XV para el sabado 13 de marzo de
// 2027», cuando nadie habia dicho ninguna fecha en toda la conversacion.
//
// No hacia falta ese respaldo: cuando el agente cotiza, `cotizar` le devuelve
// `dia_semana` y `fecha_especial` de esa misma fecha, y mientras conversa la
// tiene en su propia memoria. Lo unico que aportaba era afirmar lo que nadie
// dijo.
const fechaISO = fechaDicha;

// El tramo de tarifa mas chico que existe es de 50 personas: por debajo de
// ahi no hay nada que cotizar en ningun salon ni ningun paquete.
//
// Sirve de guardia de dos cosas a la vez. Un numero asi de bajo casi nunca es
// la cantidad de invitados: «quisiera cotizar unos 15» son unos XV anos, y el
// Director lo leyo como quince invitados — luego el agente pregunto «de que
// tipo de evento se trata? tus XV anos, boda...» justo despues de que se lo
// dijeran. Y cuando SI son invitados de verdad, lo que toca no es callarse,
// es decirle que el minimo son 50.
const MINIMO_INVITADOS = 50;
const invitados = Number(datos.invitados);
let invitadosBajos = null;
if (Number.isFinite(invitados) && invitados >= MINIMO_INVITADOS) {
  valores.push({ field_id: CAMPO.invitados, values: [{ value: invitados }] });
  anotado.invitados = invitados;
} else if (Number.isFinite(invitados) && invitados > 0) {
  invitadosBajos = invitados;
}

// El interruptor ya no se escribe desde aqui. Cuando el campo se llamaba «IA
// activa» habia que marcarlo en el primer contacto, porque Kommo omite los
// checkbox sin marcar y sin marcarlo no se podia distinguir «nadie lo ha
// tocado» de «la encargada lo apago».
//
// Ahora se llama «Stop IA» y la ausencia significa lo correcto por si sola:
// sin marcar, la IA corre. Marcarlo seria justo lo contrario de lo que se
// quiere en un lead nuevo.

// A quien enruta el Director, ya sacado del JSON.
//
// `enrutar` miraba el texto ENTERO de su salida con «contains», asi que
// bastaba con que la palabra «ventas» apareciera en la razon para que un
// `{"agente":"cliente","razon":"...no procede ventas..."}` acabara en ventas.
// La regla de ventas va primero, asi que gana ella. Todavia no ha pegado,
// pero es cuestion de que el modelo escriba la razon de otra manera.
//
// Aqui el JSON ya esta parseado: se saca el campo y se compara por igualdad.
const AGENTES = ['ventas', 'cliente', 'seguimiento'];
let agente = AGENTES.includes(salida.agente) ? salida.agente : 'ventas';

// ── Quien ya es cliente no vuelve a ventas ──────────────────────────────────
//
// El 6-nov-2026 una clienta CON CONTRATO estuvo cuatro turnos discutiendo el
// 75%, el pastel que no le incluyeron y si cancelaba o no. Los cuatro fueron
// a `cliente`, bien. Una hora despues escribio «Y de lo demas???» —tres
// palabras, sin contexto— y el Director la mando a ventas, que le contesto
// «¿a que tipo de evento te refieres y para cuantas personas?». A una persona
// que estaba decidiendo si cancelaba.
//
// Al prompt del Director ya se le pide que no cambie de agente a media
// conversacion. No basta: un mensaje corto y vago no le da de donde
// agarrarse, y vuelve al caso comun, que es vender. Asi que aqui se garantiza.
//
// Es una puerta de un solo sentido a proposito. Si se equivoca y deja a un
// prospecto en `cliente`, ese agente escala a la encargada y una persona lo
// ve. Al reves —ponerse a vender a quien ya firmo— es lo que acabamos de
// ver, y eso no lo arregla nadie despues.
//
// `seguimiento` no se toca: lo dispara el sistema, no el contenido.
let ultimo = null;
try { ultimo = $('ultimo_agente').first().json.ultimo_agente ?? null; } catch (e) { ultimo = null; }
const volvioAVender = ultimo === 'cliente' && agente === 'ventas';
if (volvioAVender) agente = 'cliente';

return [{
  json: {
    hay_datos: valores.length > 0,
    lead_id: $('formatLead').first().json.lead_id,
    // Ante la duda, ventas: es lo que dice su propio prompt.
    agente,
    // Para poder verlo en la ejecucion sin tener que deducirlo.
    agente_del_director: salida.agente ?? null,
    ultimo_agente: ultimo,
    volvio_a_vender: volvioAVender,
    anotado,
    // Lo acumulado de la conversacion, para que el turno sepa que NO hay que
    // volver a preguntar. `anotado` solo trae lo de este mensaje.
    campos: $('formatLead').first().json.campos ?? {},
    fecha_iso: fechaISO,
    fecha_larga: fechaISO ? enLetras(fechaISO) : null,
    // Dijo el dia y el mes pero no el anio. No se supone ninguno: el agente
    // pregunta, con estas dos opciones concretas.
    falta_anio: faltaAnio,
    // Un numero de invitados por debajo del minimo que se puede cotizar.
    invitados_bajos: invitadosBajos,
    // Escribio un anio que ya paso. Tampoco se da por bueno.
    fecha_pasada: fechaPasada,
    cuerpo: { custom_fields_values: valores },
  },
}];
