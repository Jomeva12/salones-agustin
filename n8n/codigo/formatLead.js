// Aplana los campos personalizados de Kommo a algo legible.
const crudo = $input.first().json ?? {};
const l = crudo.data ?? crudo;
const campos = {};
for (const c of (l.custom_fields_values ?? [])) {
  const v = (c.values ?? [])[0] ?? {};
  let valor = v.value ?? v.enum_id ?? null;
  // Un campo de fecha vaciado se queda en 0, porque Kommo no acepta null ahi
  // (ver armar_reinicio.js). Sin esta linea, 0 viaja como si fuera una fecha
  // y acaba siendo el 1 de enero de 1970 en una cotizacion.
  if (c.field_type === 'date' && Number(valor) === 0) valor = null;
  campos[c.field_name] = valor;
}
const msg = $('formatear').first().json;
const rafaga = $('leer_rafaga').first().json;
return [{ json: {
  lead_id: String(l.id ?? msg.lead_id),
  etapa_id: l.status_id ?? null,
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
