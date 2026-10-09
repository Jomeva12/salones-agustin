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
