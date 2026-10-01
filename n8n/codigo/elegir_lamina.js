// Decide qué lámina acompaña a la respuesta, y la pega al resto del envío.
//
// Esto NO lo hace el modelo. Si tuviera que copiar una URL de 80 caracteres,
// tarde o temprano se le cae uno — y una URL rota no da error: el mensaje sale
// sin foto y la ejecución queda en verde.
//
// Tampoco se lee de `cotizar`, aunque sea quien ya trae la lámina: un nodo
// Code no puede alcanzar un nodo conectado como herramienta. Por eso el
// catálogo entero llega por el camino principal, desde /api/imagenes, y el
// cruce se hace aquí.

const limpiar = (s) => String(s ?? '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');
const sinEventos = (s) => limpiar(s).replace(/\s*eventos\s*$/, '').trim();

const resp = $('formatear_respuesta').first().json;
const fl = $('formatLead').first().json;

// Todos los salones, tengan lámina o no: reconocer el nombre de uno que aún
// no tiene foto es justo lo que evita mandarle la de otro.
const salonesTodos = ($json.salones ?? [])
  .map((s) => sinEventos(s.nombre || s.clave)).filter(Boolean);

// Una entrada por paquete y salón; dentro, sus láminas. Un paquete puede
// tener varias: el de «Baby Shower, Despedidas de Soltera y Bautizos» se
// cotiza igual para los tres, pero el arte lo parte en tres.
const grupos = new Map();
for (const l of ($json.laminas ?? [])) {
  const clave = l.paquete + '|' + l.salon;
  if (!grupos.has(clave)) {
    grupos.set(clave, {
      salon_texto: sinEventos(l.salon_nombre || l.salon),
      paquete_texto: limpiar(l.paquete).replace(/^paquete\s+/, '').trim(),
      imagenes: [],
    });
  }
  grupos.get(clave).imagenes.push({ etiqueta: l.etiqueta, url: l.url });
}

function elegir() {
  const t = limpiar(resp.texto_completo);
  if (!t) return '';

  // 1. De qué salón se está hablando. Se exige saberlo SIEMPRE, aunque solo
  //    un salón tuviera láminas cargadas: si el agente cotiza Santa Cruz y
  //    todavía no se subió su lámina, quedarse con la de Norma le manda al
  //    cliente la foto de otro salón. Preferible sin foto.
  //
  //    Los nombres de salón que aparecen en el texto: gana el que esté más
  //    cerca de un paquete nombrado. En «Norma está ocupado, pero en Santa
  //    Cruz el Paquete Plata...» el salón de la oferta es el de al lado, no
  //    el primero que aparece.
  const paquetesEnTexto = [...new Set([...grupos.values()]
    .map((g) => g.paquete_texto).filter((x) => x && t.includes(x)))]
    .map((x) => t.indexOf(x));
  if (!paquetesEnTexto.length) return '';

  const salonesEnTexto = [...new Set(salonesTodos)]
    .filter((x) => x && t.includes(x))
    .map((x) => ({
      salon: x,
      cerca: Math.min(...paquetesEnTexto.map((p) => Math.abs(p - t.indexOf(x)))),
    }))
    .sort((a, b) => a.cerca - b.cerca);

  let salon = null;
  if (salonesEnTexto.length === 1) salon = salonesEnTexto[0].salon;
  else if (salonesEnTexto.length > 1) {
    if (salonesEnTexto[0].cerca === salonesEnTexto[1].cerca) return '';
    salon = salonesEnTexto[0].salon;
  } else {
    // No lo nombró. El del lead sirve: lo escribió el Director cuando el
    // cliente lo dijo.
    salon = sinEventos(fl.campos?.['Salón']) || null;
  }
  if (!salon) return '';

  // 2. De ese salón, el paquete que Maya nombró.
  const candidatos = [...grupos.values()].filter(
    (g) => g.salon_texto === salon && g.paquete_texto && t.includes(g.paquete_texto));

  // Ante cualquier duda, sin imagen. La lámina equivocada el cliente la lee
  // como la oferta.
  if (candidatos.length !== 1) return '';
  const imgs = candidatos[0].imagenes;
  if (imgs.length === 1) return imgs[0].url;

  // Varias láminas del mismo paquete: cuál toca lo dice el cliente, no el
  // paquete. A quien va a bautizar no se le mandan globos de despedida.
  const dicho = limpiar(fl.chats);
  const PISTA = { bautizo: /bautiz/, despedida: /despedida/, babyshower: /baby ?shower/ };
  for (const img of imgs) {
    const re = PISTA[img.etiqueta];
    if (re && re.test(dicho)) return img.url;
  }
  return '';
}

let url = '';
try { url = elegir(); } catch (e) { url = ''; }

// Se devuelve todo lo que armó formatear_respuesta, con la imagen puesta: así
// los nodos que siguen leen de un solo sitio.
return [{ json: { ...resp, imagen_url: url } }];
