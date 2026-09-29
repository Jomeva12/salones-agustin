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

const MAX_PARTES = 2;   // por ahora dos; el subflujo admite hasta cuatro
const CORTE = 600;

// Nunca se corta a media frase: si no hay frontera de parrafo, va entera.
// Un mensaje largo de una sola pieza molesta menos que uno cortado a la mitad.
function partir(t) {
  if (t.length <= CORTE) return [t];
  const parrafos = t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  if (parrafos.length < 2) return [t];
  const partes = [];
  let actual = '';
  for (const p of parrafos) {
    if (!actual) { actual = p; continue; }
    if (partes.length === MAX_PARTES - 1 || (actual + p).length <= CORTE) {
      actual += '\n\n' + p;
    } else {
      partes.push(actual);
      actual = p;
    }
  }
  if (actual) partes.push(actual);
  return partes.slice(0, MAX_PARTES);
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
    // El subflujo solo acepta imagenes del dominio de Kommo. Sin imagen por ahora.
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
