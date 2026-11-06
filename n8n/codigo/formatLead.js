// Aplana los campos personalizados de Kommo a algo legible.
const crudo = $input.first().json ?? {};
const l = crudo.data ?? crudo;
const campos = {};
for (const c of (l.custom_fields_values ?? [])) {
  const v = (c.values ?? [])[0] ?? {};
  let valor = v.value ?? v.enum_id ?? null;
  // Un campo de fecha vaciado se queda en 0, porque Kommo no acepta null ahi.
  // La fecha del evento ya es de texto y no pasa por aqui, pero quedan los
  // del equipo —«Apartado vence el», «Liquidado el»— y un 0 suelto se leeria
  // como el 1 de enero de 1970.
  if (c.field_type === 'date' && Number(valor) === 0) valor = null;
  campos[c.field_name] = valor;
}
const msg = $('formatear').first().json;
const rafaga = $('leer_rafaga').first().json;

// El nombre de la etapa, no solo su numero.
//
// El prompt del Director empieza diciendo «mira PRIMERO la etapa del lead» y
// hasta hoy nunca la recibio: lo unico que le llegaba era el texto del
// cliente. Llevaba semanas obedeciendo una instruccion sobre un dato que no
// tenia, y por eso su rama de «cliente» —la de quien ya contrato, a quien no
// se le vende— no se activo jamas.
//
// Van los ids a mano porque son los del embudo y no cambian solos. Si alguien
// agrega una etapa, aqui sale su numero y se ve que falta.
const ETAPA = {
  112259467: 'Leads Entrantes',
  112259471: 'Nuevo',
  112259475: 'Calificando',
  112259479: 'Fecha ocupada - alternativas',
  112259483: 'Cotizado',
  112261039: 'Cita agendada',
  112261043: 'Visitó el salón',
  113813683: 'Cliente Checando',
  113813431: 'No asistió',
  112261047: 'Con la encargada',
  112261051: 'Fecha apartada ($500)',
  112261055: 'Contratado - pagando',
  142: 'Evento realizado',
  143: 'Venta perdida',
};

// ── Un sticker no es una pregunta ───────────────────────────────────────────
//
// El 6-nov-2026 una clienta, harta, mando el emoji de la cara enojada. Llega
// como `sticker` con el texto VACIO, asi que al agente le llego un turno sin
// nada que responder — y un agente con la regla de «termina con una pregunta»
// y nada que decir solo puede rellenar: «¿quieres que te pase algo mas de
// informacion?». Lo mando dos veces, cada una con su emoji de vuelta, y ella
// mando otro. Ahi acabo la conversacion.
//
// Un sticker se contesta como lo contestaria una persona: no se contesta.
// Esto NO tapa las fotos ni los archivos: si manda la foto de su contrato hay
// que atenderla, y para eso esta la nota de abajo.
const loQueDijo = String(rafaga.chats ?? msg.texto ?? '').trim();
const soloSticker = !loQueDijo && msg.adjunto_tipo === 'sticker';

return [{ json: {
  lead_id: String(l.id ?? msg.lead_id),
  etapa_id: l.status_id ?? null,
  etapa: ETAPA[Number(l.status_id)] ?? null,
  // Lo mira `ia_encendida`: sin esto, el agente contesta al vacio.
  hay_que_responder: !soloSticker,
  // Mando algo sin una palabra, y no es un sticker: una foto, un audio, un
  // archivo. Hay que atenderlo, pero sin inventarse lo que dice.
  adjunto_mudo: !loQueDijo && !soloSticker && Boolean(msg.adjunto_tipo),
  responsable_id: l.responsible_user_id ?? null,
  presupuesto: l.price ?? 0,
  campos,
  // Todo lo que el cliente dijo en la rafaga, ya junto en un solo texto.
  chats: rafaga.chats ?? msg.texto,
  cuantos_mensajes: Number(rafaga.cuantos ?? 1),
  origen: msg.origen,
  autor: msg.autor,
  adjunto_tipo: msg.adjunto_tipo,
  adjunto_url: msg.adjunto_url,
}}];
