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

// Las fotos de cortesia, por salon. Cada una trae sus pistas: como la nombra
// el cliente, que no es como la nombra el catalogo —nadie escribe «arreglos de
// mesa en prestamo», escriben «centros de mesa»—.
const cortesias = ($json.cortesias ?? []).map((c) => ({
  salon_texto: sinEventos(c.salon_nombre || c.salon),
  url: c.url,
  pistas: String(c.pistas ?? c.titulo ?? '').split(',')
    .map((x) => limpiar(x).trim()).filter(Boolean),
}));

// De qué salón se está hablando. Se exige saberlo SIEMPRE, aunque solo un
// salón tuviera imágenes cargadas: si el agente cotiza Santa Cruz y todavía no
// se subió su lámina, quedarse con la de Norma le manda al cliente la foto de
// otro salón. Preferible sin foto.
//
// `cerca` son las posiciones contra las que se desempata cuando el texto
// nombra varios salones: gana el que esté más pegado. En «Norma está ocupado,
// pero en Santa Cruz el Paquete Plata...» el salón de la oferta es el de al
// lado, no el primero que aparece.
function salonDe(t, cerca = []) {
  const nombrados = [...new Set(salonesTodos)]
    .filter((x) => x && t.includes(x))
    .map((x) => ({
      salon: x,
      dist: cerca.length ? Math.min(...cerca.map((p) => Math.abs(p - t.indexOf(x)))) : 0,
    }))
    .sort((a, b) => a.dist - b.dist);

  if (nombrados.length === 1) return nombrados[0].salon;
  if (nombrados.length > 1) {
    if (nombrados[0].dist === nombrados[1].dist) return null;
    return nombrados[0].salon;
  }
  // No lo nombró. El del lead sirve: lo escribió el Director cuando el cliente
  // lo dijo.
  return sinEventos(fl.campos?.['Salón']) || null;
}

function elegir() {
  const t = limpiar(resp.texto_completo);
  if (!t) return '';

  // 1. Los paquetes que el agente nombró en el mensaje que va a salir.
  const paquetesEnTexto = [...new Set([...grupos.values()]
    .map((g) => g.paquete_texto).filter((x) => x && t.includes(x)))]
    .map((x) => t.indexOf(x));
  if (!paquetesEnTexto.length) return '';

  const salon = salonDe(t, paquetesEnTexto);
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
  // El arte parte dos paquetes en varias laminas: «Baby Shower, Despedidas de
  // Soltera y Bautizos» en tres, y «Aniversarios / Cumpleanos» en dos. El
  // precio y el contenido son los mismos; lo que cambia es a quien se le
  // enseña, asi que lo decide lo que escribio el cliente.
  const PISTA = {
    bautizo:     /bautiz/,
    despedida:   /despedida/,
    babyshower:  /baby ?shower/,
    aniversario: /aniversario|bodas? de (plata|oro|plomo)/,
    cumpleanos:  /cumplea|cumple/,
  };
  for (const img of imgs) {
    const re = PISTA[img.etiqueta];
    if (re && re.test(dicho)) return img.url;
  }
  return '';
}

// Cuando se cotiza manda SIEMPRE la lamina del paquete. Es la unica regla que
// importa de las dos: el agente nombra las cortesias dentro de la propia
// cotizacion —«incluye el Espejo de Bienvenida, el Aro iluminado...»—, asi que
// sin esta prioridad una cotizacion acabaria mandando la foto de una cortesia
// en lugar de la hoja del paquete, que es la que trae el precio.
//
// La foto de una cortesia es para el otro momento: cuando el cliente pregunta
// por una cosa concreta y no se esta cotizando. Ahi la foto vale mas que
// cualquier descripcion.
function elegirCortesia() {
  const dicho = limpiar(fl.chats);
  if (!dicho) return '';

  const salon = salonDe(limpiar(resp.texto_completo));
  if (!salon) return '';

  // Tiene que haberla preguntado EL CLIENTE. Buscarla en lo que escribio el
  // agente daria falsos positivos todo el tiempo, porque las enumera al cotizar.
  const encajan = cortesias.filter((c) => c.salon_texto === salon
    && c.pistas.some((pi) => dicho.includes(pi)));

  // Preguntó por dos: no se adivina cual queria ver.
  const distintas = new Set(encajan.map((c) => c.url));
  return distintas.size === 1 ? [...distintas][0] : '';
}

let url = '';
try { url = elegir() || elegirCortesia(); } catch (e) { url = ''; }

// Se devuelve todo lo que armó formatear_respuesta, con la imagen puesta: así
// los nodos que siguen leen de un solo sitio.
return [{ json: { ...resp, imagen_url: url } }];
