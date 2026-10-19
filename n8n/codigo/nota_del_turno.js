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

return [{
  json: {
    // Todo lo de armar_patch sigue viaje: `hay_datos` y `guardar_en_kommo`
    // leen de aqui.
    ...p,
    fecha_especial: especial,
    nota_fecha: partes.length ? '\n\n[Sistema] ' + partes.join(' ') : '',
  },
}];
