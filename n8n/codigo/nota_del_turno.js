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
  const r = $('traer_especial').first().json ?? {};
  especial = r.fecha_especial ?? null;
} catch (e) { especial = null; }

// Los cuatro salones, tal como estan HOY en el panel. No se copian aqui a
// mano: si Agustin corrige una direccion en el panel, el mensaje siguiente ya
// sale con la buena.
let salones = [];
try {
  salones = $('traer_salones').all().map((x) => x.json).filter((x) => x && x.clave);
} catch (e) { salones = []; }

// Lo que este lead tiene esperando respuesta de la encargada.
//
// El endpoint devuelve los pendientes de todos los salones; el filtro por
// lead se hace aqui para no depender de que el panel ya tenga ese parametro.
let avisosDelLead = [];
try {
  const crudo = $('traer_avisos').all().map((x) => x.json);
  const lista = crudo.length === 1 && Array.isArray(crudo[0].avisos) ? crudo[0].avisos : crudo;
  avisosDelLead = lista.filter((a) => a && String(a.lead_id) === String(p.lead_id)
    && a.estado === 'pendiente');
} catch (e) { avisosDelLead = []; }

const partes = [];

// ── De qué salón es esta conversación ───────────────────────────────────────
//
// Cada salon tiene su propio numero de WhatsApp. Quien escribe al de Esmeralda
// espera que le contesten de Esmeralda, no «de Salones Agustin Barron» — eso
// es el grupo entero y a el no le dice nada.
//
// Manda la FUENTE, no el campo «Salón». El campo dice que salon QUIERE el
// cliente y se corrige a mitad de conversacion; la linea por la que escribio
// no cambia nunca, y es la que define con quien cree estar hablando.
//
// Va lo primero de la nota a proposito. El prompt trae su propia frase de
// presentacion, y entre dos instrucciones el modelo sigue a la mas enfatica y
// a la que tiene mas cerca.
const NOMBRE_SALON = {
  norma: 'Norma Eventos', esmeralda: 'Esmeralda Eventos',
  santacruz: 'Santa Cruz Eventos', quetzal: 'Quetzal Eventos',
};
let laLinea = null;
try {
  laLinea = NOMBRE_SALON[$('salon_del_numero').first().json.salon_fuente] ?? null;
} catch (e) { laLinea = null; }
if (laLinea) {
  partes.push(`Esta conversación entró por el canal de ${laLinea}: el cliente `
    + `escribió a ESE salón. Si te presentas, di «Soy Maya, de ${laLinea}» `
    + '— nunca «de Salones Agustín Barrón», que es el grupo entero. '
    + 'Si el cliente acaba pidiendo otro salón, atiéndelo igual: lo que no '
    + 'cambia es con quién cree que está hablando.');
}

// Lo que el Director ya entendio, dicho con todas sus letras.
//
// Sin esto el agente solo ve el texto crudo y vuelve a interpretarlo por su
// cuenta, a veces peor: el cliente escribio «quisiera cotizar unos 15», el
// Director lo normalizo bien a XV anos, y el agente —que no lo veia— contesto
// «¿para que tipo de evento serian esos 15 invitados?». Preguntar por algo que
// el cliente acaba de decir es lo que mas cara de tonto le pone.
const EVENTO = {
  xv: 'unos XV años', boda: 'una boda', graduacion: 'una graduación',
  posada: 'una posada', cumpleanos: 'un cumpleaños', babyshower: 'un baby shower',
};
const SALON = {
  norma: 'Norma Eventos', esmeralda: 'Esmeralda Eventos',
  santacruz: 'Santa Cruz Eventos', quetzal: 'Quetzal Eventos',
};
// Lo de este turno manda sobre lo que ya estaba guardado en el lead, que es
// lo acumulado de la conversacion. `anotado` solo trae lo que se dijo AHORA.
const a = p.anotado ?? {};
const guardado = p.campos ?? {};
const tipo = a.tipo_evento ?? (guardado['Tipo de evento'] ? String(guardado['Tipo de evento']).toLowerCase() : null);
const salon = a.salon ?? (guardado['Salón'] ? String(guardado['Salón']) : null);
const cuantos = a.invitados ?? (Number(guardado['Invitados']) || null);

const sabido = [];
if (tipo) sabido.push(`es ${EVENTO[tipo] ?? tipo}`);
if (salon) sabido.push(`el salón es ${SALON[salon] ?? salon}`);
if (cuantos) sabido.push(`son ${cuantos} invitados`);

// Y lo que NO ha dicho, dicho tambien. Sin esta mitad el agente rellena el
// hueco con lo que encuentre en el texto: con «quisiera cotizar unos 15» dio
// por hecho que eran quince invitados y contesto «tus XV años para unos 15
// invitados». El 15 era el evento, no la gente.
const faltan = [];
if (!tipo) faltan.push('qué tipo de evento es');
if (!cuantos) faltan.push('cuántos invitados son');

if (sabido.length) {
  partes.push(`Esto ya lo dijo el cliente y NO se lo vuelvas a preguntar: ${sabido.join(', ')}.`
    + (faltan.length ? ` Y esto NO lo ha dicho todavía, así que no te lo inventes: ${faltan.join(' ni ')}.` : ''));
}

// ── Lo que está esperando de la encargada ───────────────────────────────────
//
// El 6-nov-2026 una clienta con contrato pregunto por el 75%, por el pastel
// que no le incluyeron y si cancelaba. Maya escalo las tres cosas —bien— y le
// dijo «en cuanto me responda, te aviso». Una hora despues la clienta escribio
// «Y de lo demas???» y Maya le contesto «¿a que tipo de evento te refieres?».
//
// Maya no tenia forma de saber que seguia habiendo algo abierto. Para ella
// cada turno empieza de cero salvo lo que recuerde del chat, y «lo demas» no
// se entiende sin saber que hay tres preguntas en la cola de la encargada.
//
// Va justo despues de quien es ella y antes que todo lo demas: si hay algo
// esperando, eso manda sobre cualquier otra cosa que pudiera decir.
if (avisosDelLead.length) {
  const cuales = avisosDelLead
    .map((a) => `«${String(a.motivo || a.texto || 'una consulta').slice(0, 90)}»`)
    .join(' y ');
  partes.push(`YA ESCALASTE ESTO Y SIGUE SIN RESPUESTA: ${cuales}. `
    + 'El cliente está esperando eso, no otra cosa. '
    + 'Si pregunta «¿y lo demás?», «¿ya te contestaron?» o algo que no entiendas, '
    + 'se refiere a esto: dile que sigues esperando a la encargada y que en '
    + 'cuanto te conteste le avisas. '
    + 'NO le preguntes qué tipo de evento es, ni cuántos invitados, ni le '
    + 'ofrezcas cotizar: ya es cliente o ya está en medio de algo, y empezar '
    + 'de cero le dice que no lo estás siguiendo. '
    + 'Y no vuelvas a escalar lo mismo: ya está pedido.');
}

// ── Dónde está cada salón ───────────────────────────────────────────────────
//
// El 6-nov-2026 un cliente escribio «Ubicacion», «La ubicacion», «Señorita»,
// y Maya le contesto CUATRO veces «¿quieres que te pase la direccion exacta?»
// sin dársela nunca. Hubo que apagarle la IA a mano.
//
// No era terquedad del modelo: no tenia de donde sacarla. La direccion y el
// enlace de Maps viven en el panel desde el principio, pero ninguna de sus
// herramientas los devolvia y el prompt no los nombraba. Un agente al que le
// preguntan algo que no puede contestar y que ademas tiene la regla de
// «termina con una pregunta» solo puede hacer una cosa: ofrecerlo otra vez.
//
// Asi que no se le da una herramienta mas que puede o no llamar: se le ponen
// las cuatro direcciones delante, en cada turno. Lo que esta en el contexto
// no se inventa y no hace falta pedirlo.
const comoSeLlama = (x) => String(x ?? '').toLowerCase().replace(/\s+/g, '');
function buscarSalon(quien) {
  if (!quien) return null;
  const q = comoSeLlama(quien);
  return salones.find((s) => comoSeLlama(s.clave) === q || comoSeLlama(s.nombre) === q)
    ?? salones.find((s) => comoSeLlama(s.nombre).startsWith(q)) ?? null;
}
// El de la conversacion: el que se esta hablando, y si no, el de la linea.
const elDeAhora = buscarSalon(salon) ?? buscarSalon(laLinea);
const comoSeDice = (s, marca) => `${s.nombre}${marca ? ' (el de esta conversación)' : ''}: `
  + `${s.direccion || 'sin dirección cargada'}`
  + (s.maps_url ? ` · mapa: ${s.maps_url}` : '');

if (salones.length) {
  const orden = elDeAhora
    ? [elDeAhora, ...salones.filter((s) => s.clave !== elDeAhora.clave)]
    : salones;
  partes.push('Direcciones y mapas — '
    + orden.map((s, i) => comoSeDice(s, i === 0 && Boolean(elDeAhora))).join(' | ')
    + '. Esto es material de consulta: lo tienes por si lo piden, NO para '
    + 'sacarlo por tu cuenta. Si el cliente NO ha preguntado por la '
    + 'ubicación, no la menciones — nada de «por cierto, estamos en». '
    + 'Si SÍ pregunta dónde está, por la ubicación, la dirección o cómo '
    + 'llegar —aunque escriba solo «ubicación»—, dale la dirección Y el '
    + 'enlace del mapa EN ESE MISMO MENSAJE, y no le preguntes si quiere '
    + 'que se los pases: eso es justo lo que acaba de pedirte. '
    + 'Da solo la del salón del que estén hablando, no las cuatro.');
}

// Dijo el dia y el mes, pero no el anio. No se elige por el: «10 de
// diciembre» puede ser 2026 o 2027, y entre uno y otro cambia el escalon de
// anticipacion, o sea el precio. Se pregunta, con los dos anios concretos en
// la mano para que no tenga que calcularlos.
if (p.falta_anio) {
  const op = (p.falta_anio.opciones ?? []).join(' o ');
  partes.push(`El cliente dijo «${p.falta_anio.dia_mes}» pero NO dijo el anio. `
    + 'No lo supongas y no cotices todavia: preguntale de que anio '
    + (op ? `—${op}—` : '') + ' y espera a que te conteste. '
    + 'El precio depende de cuantos meses falten, asi que con el anio '
    + 'equivocado la cotizacion entera sale mal.');
}

// Un numero demasiado chico para ser invitados. Casi siempre es otra cosa
// —«unos 15» son XV anos— y cuando de verdad son invitados, hay que decirle
// el minimo en vez de callarse.
if (p.invitados_bajos) {
  partes.push(`El cliente dijo el numero ${p.invitados_bajos}, que NO se guardo como `
    + 'invitados: el minimo que se puede cotizar son 50 personas. Mira si se '
    + 'referia a otra cosa —«unos 15» suele ser XV anos— y si de verdad son '
    + 'sus invitados, diselo: por menos de 50 no hay paquete.');
}

// Escribio un anio que ya paso.
if (p.fecha_pasada) {
  partes.push(`El cliente escribio «${p.fecha_pasada}», que ya paso. `
    + 'Preguntale de que anio es, con tacto: lo mas probable es que se haya '
    + 'equivocado de tecla.');
}

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
} else if (p.fecha_larga) {
  // El «no» va DICHO, no sobreentendido.
  //
  // Callar cuando la fecha no tiene nada especial parecia suficiente, y no lo
  // es: el cliente pregunto «el 20 de marzo cae en Semana Santa?» y la agente
  // le dijo que si. No lo saco de ningun dato —aqui venia null— sino de la
  // propia pregunta. Un modelo lee el silencio como permiso para seguirle la
  // corriente a quien pregunta, asi que el silencio se acabo.
  partes.push('Ese dia NO es Semana Santa ni ninguna fecha especial, y no tiene '
    + 'nada que avisar. Si el cliente da por hecho que si, corrigelo.');
}

// El calendario de la semana, siempre. Esto no es relleno.
//
// El 20-oct-2026 el cliente dijo «quiero ir a conocer el salon el jueves a
// las 4». Era martes 20; el jueves era el 22. Maya mando `fecha: 2026-10-26`
// a `pedir_cita` —lunes— y le escribio «el jueves 26 de octubre». Se creo una
// cita el dia equivocado y el cliente leyo un dia y una fecha que no son el
// mismo dia. Alguien se presenta cuando no toca, o no se presenta cuando si.
//
// Las guardias de fecha que ya existian miran la fecha del EVENTO, que el
// Director normaliza. La fecha de la VISITA no pasa por ahi: el agente la
// resuelve de cabeza, y resolver «el jueves» es aritmetica de calendario, que
// es justo lo que un modelo hace mal y con total aplomo.
//
// Asi que no se le pide que calcule: se le da calculado. Y va SIEMPRE, sin
// mirar si el cliente nombro un dia o no, porque detectarlo seria otro regex
// persiguiendo redacciones —«el jueves», «este jueves», «el proximo jueves»,
// «juebes»— y cada hueco de ese regex es una cita en el dia equivocado.
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// La fecha de hoy EN MONTERREY. Con la del servidor, de madrugada el
// calendario entero sale corrido un dia.
const HOY_ISO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Monterrey', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

// Se parte la cadena a mano: new Date('2026-10-20') se interpreta en UTC y en
// Monterrey eso es el dia anterior.
const [ay, am, ad] = HOY_ISO.split('-').map(Number);
const hoy = new Date(Date.UTC(ay, am - 1, ad));

function largo(f) {
  return `${DIAS[f.getUTCDay()]} ${f.getUTCDate()} de ${MESES[f.getUTCMonth()]}`
    + ` de ${f.getUTCFullYear()}`;
}

// Los proximos siete dias, empezando por mañana: «el jueves» nunca es hoy.
const semana = [];
for (let i = 1; i <= 7; i++) {
  const f = new Date(hoy.getTime() + i * 86400000);
  semana.push(largo(f));
}

partes.push(`Hoy es ${largo(hoy)}. Si el cliente nombra un dia de la semana `
  + 'sin darte la fecha, es uno de estos y no lo calcules tu: '
  + semana.join('; ') + '. '
  + 'Y si dice «el proximo» o nombra un dia que ya paso esta semana, '
  + 'preguntale la fecha en vez de suponerla.');

return [{
  json: {
    // Todo lo de armar_patch sigue viaje: `hay_datos` y `guardar_en_kommo`
    // leen de aqui.
    ...p,
    fecha_especial: especial,
    nota_fecha: partes.length ? '\n\n[Sistema] ' + partes.join(' ') : '',
  },
}];
