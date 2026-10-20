// Parte la respuesta del agente en las piezas que espera enviar_mensaje_salones.
//
// Se hace con codigo y no con otro agente a proposito: partir en frontera de
// parrafo es una regla, no un juicio. Un modelo haciendo esto cuesta, tarda, y
// algun dia devuelve algo distinto para el mismo texto.
const bruto = $json.output ?? '';
let texto = typeof bruto === 'string' ? bruto : JSON.stringify(bruto);

// El modelo a veces envuelve la respuesta en cercos de codigo o en un JSON.
texto = texto.trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
if (texto.startsWith('{')) {
  try {
    const o = JSON.parse(texto);
    texto = o.respuesta ?? o.parte1 ?? o.output ?? texto;
  } catch (e) { /* no era JSON: se queda con el texto tal cual */ }
}

// El agente ve las URL de las laminas dentro de la respuesta de `cotizar` y
// se le ha dado por pegarlas en el texto en markdown:
//
//   «Aqui te dejo la imagen: ![Paquete Bronce](https://kommo.cc/K/YG9FBW/...)»
//
// Al cliente le llega el corchetazo crudo Y la foto adjunta, duplicado y feo.
// Se quita aqui y no solo en el prompt porque el prompt es una peticion y
// esto es una garantia: las fotos las adjunta el sistema, no se escriben.
function quitarEnlacesDeImagen(t) {
  return t
    // ![lo que sea](url)  y  [lo que sea](url de kommo)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]\(https?:\/\/(?:kommo\.cc|drive-[a-z0-9-]+\.kommo\.com)[^)]*\)/gi, '')
    // y la URL suelta, sin markdown
    .replace(/https?:\/\/(?:kommo\.cc|drive-[a-z0-9-]+\.kommo\.com)\S*/gi, '')
    // la frase que los presentaba se queda colgando con dos puntos al aire:
    // «Aqui te dejo la imagen:» sin nada detras.
    .replace(/[^\S\r\n]*:[^\S\r\n]*(?=\r?\n|$)/g, '')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .replace(/(\r?\n){3,}/g, '\n\n')
    .trim();
}
texto = quitarEnlacesDeImagen(texto);

// Cuando Maya escala, el mensaje se acaba ahi.
//
// El prompt lo dice en dos sitios —«no le cuelgues una pregunta de relleno» y
// «no cierres con ¿quieres que te pase informacion sobre servicios
// adicionales?»— y el 20-oct-2026 lo hizo cuatro veces seguidas, las cuatro
// justo despues de escalar. El patron: al escalar no tiene nada que
// preguntar, pero la regla de «termina con una pregunta» le pesa mas, y lo
// que tiene a mano para rellenar es la lista de extras. El Lic. pidio que los
// servicios aparte no se ofrezcan.
//
// El primer intento de arreglo buscaba la frase («servicios adicionales»,
// «servicios extra»). Dio 7 de 7 en banco y fallo en vivo al segundo mensaje:
// el modelo escribio «te puedo pasar info de OTROS SERVICIOS... ¿Que te
// interesa?» — ni la palabra prohibida, ni la interrogacion en la misma
// frase. Perseguir la redaccion es perseguir un blanco movil.
//
// Asi que el candado no mira COMO lo dice, mira DONDE lo dice: en un mensaje
// que anuncia que algo se esta confirmando con la encargada, cualquier frase
// POSTERIOR que ofrezca mandar algo es relleno por definicion — el cliente
// espera un dato, no una oferta. Un mensaje que no menciona a la encargada no
// se toca jamas, asi que una cotizacion normal sale intacta.
const ANUNCIA_ESCALADO = /encargada/i;
const OFRECE = /\b(quieres|quisieras|gustar[ií]a|interesa|te paso|te pasar|pasarte|te mando|mandarte|te comparto|compartirte|te env[ií]o|enviarte|te cuento|contarte|te apunto)\b/i;

function cortarRellenoTrasEscalar(t) {
  // Frases con su signo de cierre pegado. En espanol la interrogacion abre
  // con ¿ a media frase, asi que se corta por el signo que cierra la
  // anterior, no por el que abre esta.
  const frases = t.match(/[^.!?]+[.!?]+["»']?\s*|[^.!?]+$/g);
  if (!frases) return t;

  const donde = frases.findIndex((f) => ANUNCIA_ESCALADO.test(f));
  if (donde < 0) return t;   // no esta escalando: aqui no se toca nada

  const quedan = [];
  let cortada = false;
  frases.forEach((f, i) => {
    if (i <= donde) { quedan.push(f); return; }
    if (OFRECE.test(f)) { cortada = true; return; }
    // Una pregunta corta pegada a la oferta que acabamos de quitar es su
    // coletilla: «...te puedo pasar info de otros servicios. ¿Que te
    // interesa?». Sola no dice nada, asi que se va con ella.
    if (cortada && f.includes('?') && f.trim().split(/\s+/).length <= 7) return;
    cortada = false;
    quedan.push(f);
  });

  const limpio = quedan.join('').replace(/\s+$/, '').trim();
  return limpio || t;   // antes dejarlo mudo, que salga entero
}
texto = cortarRellenoTrasEscalar(texto);

const MAX_PARTES = 2;   // por ahora dos; el subflujo admite hasta cuatro

// Se corta por ritmo de WhatsApp, no por longitud: la informacion en un
// mensaje y la pregunta de cierre en otro. Antes se cortaba a los 600
// caracteres, pero una cotizacion tipica ronda los 400 — con esa regla el
// corte en dos casi nunca se activaba.
//
// Nunca se corta a media frase: si no hay frontera de parrafo, va entera. Un
// mensaje largo de una sola pieza molesta menos que uno partido a la mitad.
function partir(t) {
  const parrafos = t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  if (parrafos.length < 2) return [t];
  // El ultimo parrafo se va solo: en las respuestas de Maya es la invitacion
  // a visitar o la pregunta. Lo anterior se junta en el primer mensaje.
  return [parrafos.slice(0, -1).join('\n\n'), parrafos[parrafos.length - 1]]
    .slice(0, MAX_PARTES);
}

const partes = partir(texto);
const fl = $('formatLead').first().json;


return [{
  json: {
    cuantas_partes: partes.length,
    parte1: partes[0] ?? '',
    parte2: partes[1] ?? '',
    parte3: '',
    parte4: '',
    lead_id: fl.lead_id,
    // La pone elegir_lamina, el nodo siguiente: aqui no se puede leer la
    // salida de `cotizar` porque un Code no alcanza a un nodo-herramienta.
    imagen_url: '',
    mensaje_cliente: fl.chats,
    // Declarados en el subflujo pero sin usar en su codigo: van en cero para
    // no mover ninguna etapa por accidente.
    proximo_paso: 0,
    status_id: 0,
    // Que agente redacto. Se guarda aqui porque despues de este nodo
    // $prevNode.name ya seria 'formatear_respuesta'.
    agente: $prevNode.name,
    texto_completo: texto,
  },
}];
