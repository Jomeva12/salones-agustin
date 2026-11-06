// De que salon es este cliente, segun por donde escribio.
//
// Desde el 5-nov-2026 cada salon tiene su propio numero de WhatsApp. El numero
// NO viaja en el webhook —Kommo solo manda `origin: waba`—, pero si queda
// grabado en el lead como `source_id`, y eso es lo que se mira aqui.
//
// Con eso se hacen tres cosas en el mismo PATCH:
//
//   1. Se llena el campo «Salón» del lead. Ademas de dejarlo visible en la
//      ficha, es lo que lee `nota_del_turno`: a partir de ahi Maya ya sabe de
//      que salon le hablan sin tener que preguntarlo.
//   2. Se le pone de responsable el usuario de ese salon. Antes todos los
//      leads caian en «Asesora Ana», que es el usuario de la integracion: con
//      todo del mismo dueño, ninguna encargada distinguia los suyos.
//   3. Se le pone la ETIQUETA del salon, para filtrar por sede en cualquier
//      vista de Kommo.
//
// Esto corre ANTES del filtro de pruebas, a proposito. Que Maya no le conteste
// a un cliente no quita que su lead tenga que caer donde toca; si el enrutado
// viviera despues del filtro, hoy los leads reales seguirian todos sin dueño.

const FUENTES = {
  // WhatsApp, un numero por salon.
  22494: 'norma',      // +52 1 81 8692 6400
  22564: 'esmeralda',  // +52 1 81 8691 7220
  22496: 'santacruz',  // +52 1 81 2004 1207
  22498: 'quetzal',    // +52 1 81 1010 7131
  // Facebook. Cada pagina crea DOS canales, el privado y los comentarios.
  // Esmeralda no tiene pagina conectada: tres paginas para cuatro salones.
  21772: 'norma',     21774: 'norma',
  21764: 'santacruz', 21766: 'santacruz',
  21768: 'quetzal',   21770: 'quetzal',
};

const ENUM_SALON = {
  norma: 281622, esmeralda: 281624, santacruz: 281626, quetzal: 281628,
};
const USUARIO = {
  norma: 16027263, esmeralda: 16027259, santacruz: 16027243, quetzal: 16027255,
};
// Mismo texto que el campo «Salón», para que la ficha no diga dos cosas
// parecidas con dos palabras distintas.
const ETIQUETA = {
  norma: 'Norma Eventos', esmeralda: 'Esmeralda Eventos',
  santacruz: 'Santa Cruz Eventos', quetzal: 'Quetzal Eventos',
};
const CAMPO_SALON = 352870;

// El usuario con el que entra la integracion. Un lead que lo tiene de
// responsable es un lead que nadie ha tocado todavia: ese si se reasigna.
// Si ya lo tiene una encargada —o el propio Lic.—, aqui no se toca.
const INTEGRACION = 13666384;

const msg = $('formatear').first().json;
const lead = $('traer_lead_fuente').first().json ?? {};

// El contacto es la PERSONA; el lead es su solicitud. En Kommo tienen dueño y
// etiquetas por separado, y hasta el 6-nov-2026 esto solo tocaba el lead: los
// 2.867 contactos seguian todos en «Asesora Ana». Una encargada que filtraba
// por sus contactos no veia ninguno.
let contacto = {};
try { contacto = $('traer_contacto').first().json ?? {}; } catch (e) { contacto = {}; }

const salon = FUENTES[Number(lead.source_id)] ?? null;

// Lo que ya tiene el lead. Si Kommo no contesto, `lead.id` no existe y de
// aqui no sale ningun PATCH: se sigue sin enrutar, que es lo correcto —
// escribir a ciegas seria peor.
const campos = lead.custom_fields_values ?? [];
const yaTieneSalon = campos.some(
  (c) => Number(c.field_id) === CAMPO_SALON && (c.values ?? []).length > 0);
const dueno = Number(lead.responsible_user_id) || null;
const etiquetas = (lead._embedded ?? {}).tags ?? [];

const valores = [];
const cuerpo = {};
const hecho = [];

if (lead.id && salon) {
  // El campo solo se rellena si esta vacio. Si ya hay algo, lo puso el
  // Director con lo que dijo el cliente —o una encargada a mano—, y eso manda
  // sobre el numero por el que entro: se puede escribir al WhatsApp de Norma
  // preguntando por Santa Cruz.
  if (!yaTieneSalon) {
    valores.push({ field_id: CAMPO_SALON, values: [{ enum_id: ENUM_SALON[salon] }] });
    hecho.push('salón');
  }
  if (!dueno || dueno === INTEGRACION) {
    cuerpo.responsible_user_id = USUARIO[salon];
    hecho.push('responsable');
  }

  // La etiqueta, al reves que el campo, SI va siempre — mientras no este ya
  // puesta. El campo dice que salon quiere el cliente y se puede corregir; la
  // etiqueta dice por donde entro, y eso no cambia: es de quien fue el
  // anuncio y de quien es la linea. Por eso tampoco se le quita ninguna.
  //
  // OJO: un PATCH con `_embedded.tags` REEMPLAZA la lista entera. Mandar solo
  // la nueva borraria en silencio las que ya tuviera, asi que se reenvian
  // todas. Las que ya existen van por `id` y la nueva por `name`: con el
  // nombre, Kommo reusa la etiqueta si ya la creo antes y no la duplica.
  const nombre = ETIQUETA[salon];
  if (!etiquetas.some((t) => String(t.name).toLowerCase() === nombre.toLowerCase())) {
    cuerpo._embedded = {
      tags: [...etiquetas.map((t) => ({ id: t.id })), { name: nombre }],
    };
    hecho.push('etiqueta');
  }
}

if (valores.length) cuerpo.custom_fields_values = valores;

// ── Y lo mismo para la persona ──────────────────────────────────────────────
//
// Mismas dos reglas que en el lead: el dueño solo si nadie lo ha tocado, y la
// etiqueta siempre que no este ya. Un contacto puede tener leads de dos
// salones distintos —alguien que pregunto por Norma y despues por Quetzal—;
// se queda con el primero que lo reclamo, igual que el lead.
const etiquetasContacto = (contacto._embedded ?? {}).tags ?? [];
const duenoContacto = Number(contacto.responsible_user_id) || null;
const cuerpoContacto = {};
const hechoContacto = [];

if (contacto.id && salon) {
  if (!duenoContacto || duenoContacto === INTEGRACION) {
    cuerpoContacto.responsible_user_id = USUARIO[salon];
    hechoContacto.push('responsable');
  }
  const nom = ETIQUETA[salon];
  if (!etiquetasContacto.some((t) => String(t.name).toLowerCase() === nom.toLowerCase())) {
    cuerpoContacto._embedded = {
      tags: [...etiquetasContacto.map((t) => ({ id: t.id })), { name: nom }],
    };
    hechoContacto.push('etiqueta');
  }
}

return [{
  json: {
    ...msg,
    lead_id: String(lead.id ?? msg.lead_id),
    source_id: lead.source_id ?? null,
    salon_fuente: salon,
    contacto_id: contacto.id ?? null,
    enrutado_contacto: hechoContacto.join(', ') || null,
    hace_falta_contacto: Object.keys(cuerpoContacto).length > 0,
    cuerpo_contacto: cuerpoContacto,
    // Lo que se va a escribir, dicho en claro por si hay que mirarlo en la
    // ejecucion: «salón, responsable», «responsable», o nada.
    enrutado: hecho.join(', ') || null,
    hace_falta_enrutar: Object.keys(cuerpo).length > 0,
    cuerpo,
  },
}];
