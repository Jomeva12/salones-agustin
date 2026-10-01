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

// ── la lamina del paquete cotizado ────────────────────────────────────────
//
// La URL no pasa nunca por el modelo. Si tuviera que copiar 80 caracteres,
// tarde o temprano se le cae uno — y una URL rota no da error: el mensaje
// sale sin foto y la ejecucion queda en verde. Asi que la elige este codigo,
// cruzando lo que Maya escribio con lo que devolvio `cotizar`.
const limpiar = (s) => String(s ?? '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

function elegirLamina(textoAgente, dijoElCliente) {
  let corridas = [];
  // En el flujo de recuperacion no existe el nodo `cotizar`; sin imagen y ya.
  try { corridas = $('cotizar').all(); } catch (e) { return ''; }

  const t = limpiar(textoAgente);
  const candidatos = new Map();

  for (const c of corridas) {
    const salones = c.json?.salones ?? [];
    // Un salon ocupado se nombra para decir que NO se puede, y aun asi su
    // nombre queda en el texto: «Norma esta ocupado, pero en Santa Cruz...».
    // Si no se descartara, esa frase daria dos candidatos y ninguna imagen.
    const vendibles = salones.filter(
      (s) => s.se_puede_ofrecer !== false && s.disponibilidad !== 'ocupada');
    const mirar = vendibles.length ? vendibles : salones;

    for (const sal of mirar) {
      // Si solo queda un salon vendible no hace falta que Maya lo nombre; si
      // quedan varios, si: es lo unico que distingue el Plata de Norma del de
      // Santa Cruz, que son laminas distintas.
      const nombre = limpiar(sal.salon_nombre || sal.salon).replace(/\s*eventos\s*$/, '').trim();
      const donde = nombre ? t.indexOf(nombre) : -1;
      if (mirar.length > 1 && donde < 0) continue;

      for (const o of (sal.opciones ?? [])) {
        const imgs = o.imagenes ?? [];
        if (!imgs.length) continue;
        const paq = limpiar(o.paquete).replace(/^paquete\s+/, '').trim();
        const aqui = paq ? t.indexOf(paq) : -1;
        if (aqui < 0) continue;
        // Cuando quedan varios candidatos gana el salon nombrado mas cerca del
        // paquete: en «en Santa Cruz el Paquete Plata» van pegados, y en la
        // mencion de pasada a otro salon no.
        const cerca = donde < 0 ? 0 : Math.abs(aqui - donde);
        const ya = candidatos.get(imgs[0].url);
        if (!ya || cerca < ya.cerca) candidatos.set(imgs[0].url, { imgs, cerca });
      }
    }
  }

  // Ante la duda, sin imagen. Mandar la lamina equivocada es peor que no
  // mandar ninguna: el cliente la lee como la oferta.
  if (!candidatos.size) return '';
  const orden = [...candidatos.values()].sort((a, b) => a.cerca - b.cerca);
  if (orden.length > 1 && orden[0].cerca === orden[1].cerca) return '';
  const imgs = orden[0].imgs;
  if (imgs.length === 1) return imgs[0].url;

  // Varias laminas para un mismo paquete. Cual toca lo dice el cliente, no el
  // paquete: «Baby Shower, Despedidas de Soltera y Bautizos» se cotiza igual
  // para los tres, pero a quien va a bautizar no se le manda globos rosas.
  const dicho = limpiar(dijoElCliente);
  const PISTA = { bautizo: /bautiz/, despedida: /despedida/, babyshower: /baby ?shower/ };
  for (const img of imgs) {
    const re = PISTA[img.etiqueta];
    if (re && re.test(dicho)) return img.url;
  }
  return '';
}

let laminaUrl = '';
try { laminaUrl = elegirLamina(texto, fl.chats); } catch (e) { laminaUrl = ''; }

return [{
  json: {
    cuantas_partes: partes.length,
    parte1: partes[0] ?? '',
    parte2: partes[1] ?? '',
    parte3: '',
    parte4: '',
    lead_id: fl.lead_id,
    // Solo viaja en la parte 1, que es la del precio. El subflujo descarta
    // cualquier URL que no sea del Drive de esta cuenta de Kommo.
    imagen_url: laminaUrl,
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
