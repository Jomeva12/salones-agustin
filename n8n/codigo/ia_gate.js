// El porton de los interruptores por salon.
//
// El widget «Control de Maya» (Ajustes de Kommo, solo administradores) guarda
// un interruptor por salon en la tabla `ia_control`. Aqui se decide si Maya le
// contesta a este cliente segun el de SU salon.
//
// De que salon es el cliente:
//
//   1. Por donde escribio. El `source_id` del lead dice de quien es el numero
//      de WhatsApp o la pagina de Facebook, y es lo que apaga la encargada
//      cuando apaga «su» salon. Es estructural: nadie lo edita a mano.
//   2. Si la fuente no esta en el mapa de `salon_del_numero` —Telegram de las
//      pruebas, un canal nuevo—, se mira el campo «Salon» del lead. Sin eso,
//      a esos leads no los cubriria ningun interruptor.
//   3. Si tampoco hay campo, no se sabe de que salon es y Maya contesta. No se
//      adivina: un canal nuevo se añade al mapa de `salon_del_numero`.
//
// Va DESPUES del filtro de pruebas. A quien el modo pruebas ya dejo fuera le
// sale su aviso de «Maya esta en pruebas»; contarlo ademas aqui diria que el
// salon dejo clientes sin respuesta cuando Maya ni siquiera estaba abierta.
//
// Si la tabla no contesta, todo cuenta como encendido. Un fallo de la base no
// puede dejar muda a Maya en los cuatro salones a la vez.
//
// Esto NO sustituye al campo «Stop IA» del lead, que sigue mas adelante en
// `ia_encendida`: aquel calla a Maya con un cliente, este con un salon entero.
// Y solo calla las respuestas: avisos y recuperacion no pasan por aqui.

const CAMPO_SALON = 352870;
const POR_ENUM = {
  281622: 'norma', 281624: 'esmeralda', 281626: 'santacruz', 281628: 'quetzal',
};

// No es `$json`: delante hay una consulta a Postgres y su salida son las filas
// de la tabla, no el mensaje. El mensaje se lee del nodo por su nombre.
const d = $('solo_pruebas').first().json;
const lead = $('traer_lead_fuente').first().json ?? {};

let salon = $('salon_del_numero').first().json.salon_fuente ?? null;
let salonPor = salon ? 'fuente' : null;

if (!salon) {
  const campo = (lead.custom_fields_values ?? [])
    .find((c) => Number(c.field_id) === CAMPO_SALON);
  const enumId = Number(((campo?.values ?? [])[0] ?? {}).enum_id);
  salon = POR_ENUM[enumId] ?? null;
  if (salon) salonPor = 'campo';
}

// Las filas de `ia_control`. Si la consulta fallo llega un item con `error` y
// sin `clave`: no entra en el mapa y el salon cuenta como encendido.
const encendido = {};
for (const it of $input.all()) {
  const f = it.json ?? {};
  if (f.clave) encendido[f.clave] = !(f.encendida === false || f.encendida === 'f');
}

const iaSalonEncendida = !salon || encendido[salon] !== false;

return [{
  json: {
    ...d,
    ia_salon: salon,
    ia_salon_por: salonPor,
    ia_salon_encendida: iaSalonEncendida,
  },
}];
