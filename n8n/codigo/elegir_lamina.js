// Decide qué láminas acompañan a la respuesta, y las pega al resto del envío.
//
// Esto NO lo hace el modelo. Si tuviera que copiar una URL de 80 caracteres,
// tarde o temprano se le cae uno — y una URL rota no da error: el mensaje sale
// sin foto y la ejecución queda en verde.
//
// Tampoco se lee de `cotizar`, aunque sea quien ya trae la lámina: un nodo
// Code no puede alcanzar un nodo conectado como herramienta. Por eso el
// catálogo entero llega por el camino principal, desde /api/imagenes, y el
// cruce se hace aquí.
//
// Si el agente ofrece tres salones, van las tres láminas. Antes iba una sola
// —la del salón que quedaba más cerca del nombre del paquete— y el cliente
// veía la hoja de uno y el precio de tres.

const MAX_IMAGENES = 3;

const limpiar = (s) => String(s ?? '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');
const sinEventos = (s) => limpiar(s).replace(/\s*eventos\s*$/, '').trim();

const resp = $('formatear_respuesta').first().json;
const fl = $('formatLead').first().json;

// Todos los salones, tengan lámina o no: reconocer el nombre de uno que aún
// no tiene foto es justo lo que evita mandarle la de otro.
const salonesTodos = [...new Set(($json.salones ?? [])
  .map((s) => sinEventos(s.nombre || s.clave)).filter(Boolean))];

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
      // Los nombres tal cual, para el pie de foto.
      salon_nombre: l.salon_nombre || l.salon,
      paquete_nombre: l.paquete,
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

/** Todas las posiciones donde aparece `aguja` en `t`, como palabra entera. */
function posiciones(t, aguja) {
  if (!aguja) return [];
  const esc = aguja.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('(^|[^a-z0-9])' + esc + '([^a-z0-9]|$)', 'g');
  const out = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    out.push(m.index + m[1].length);
    re.lastIndex = m.index + 1;   // permite solapes
  }
  return out;
}

// Palabras que no distinguen un paquete de otro, asi que no sirven de apodo.
const RELLENO = new Set(['paquete', 'de', 'del', 'la', 'las', 'el', 'los', 'y',
  'boda', 'bodas', 'xv', 'para', 'con', 'o', 'u']);

// Un salón que se acaba de descartar no lleva lámina. «El salón Norma ya está
// ocupado ese día, pero tengo Esmeralda y Santa Cruz con el Paquete Bronce»:
// sin esto, Norma queda pegadísimo a «Bronce» y se cuela su hoja — la del
// único salón que el cliente NO puede tener.
const DESCARTADO = /ocupad|no (esta|está) disponible|no tengo|ya no (hay|queda)|no (hay|queda) (lugar|espacio|disponibilidad)/;
function estaDescartado(t, pos, largo) {
  return DESCARTADO.test(t.slice(pos, pos + largo + 45));
}

// Los paquetes que existen en cada salón. Se busca solo entre los suyos, y no
// entre todos, porque los nombres se solapan: Quetzal llama al suyo «Paquete
// Plata Boda y XV» y los demás «Paquete Plata». Buscando en la bolsa común,
// el «plata» de Esmeralda empataba en la misma posición y ganaba el desempate
// — quedaba el par quetzal+plata, que no existe, y Quetzal se iba sin lámina.
const paquetesDe = new Map();
for (const g of grupos.values()) {
  if (!g.paquete_texto) continue;
  if (!paquetesDe.has(g.salon_texto)) paquetesDe.set(g.salon_texto, new Set());
  paquetesDe.get(g.salon_texto).add(g.paquete_texto);
}

/**
 * Los apodos con que se puede reconocer un paquete dentro de su salón.
 *
 * El nombre exacto no basta: el catálogo dice «Paquete Plata Boda y XV» y el
 * agente escribe «el Paquete Plata para boda». Son el mismo, y por una
 * preposición Quetzal se quedaba sin lámina.
 *
 * Un apodo es una palabra suya que **ningún otro paquete de ese salón usa**.
 * «plata» vale porque en Quetzal solo hay uno con plata; «día» no vale en
 * Esmeralda, que tiene el del Día de las Madres y el del Día del Maestro —
 * ahí los que distinguen son «madres» y «maestro».
 */
const apodosDe = new Map();
for (const [salon, paquetes] of paquetesDe) {
  const cuenta = new Map();
  const palabras = new Map();
  for (const p of paquetes) {
    const ws = [...new Set(p.split(/[^a-z0-9]+/).filter(
      (x) => x.length >= 3 && !RELLENO.has(x)))];
    palabras.set(p, ws);
    for (const w of ws) cuenta.set(w, (cuenta.get(w) ?? 0) + 1);
  }
  const m = new Map();
  for (const p of paquetes) {
    m.set(p, [p, ...palabras.get(p).filter((w) => cuenta.get(w) === 1 && w !== p)]);
  }
  apodosDe.set(salon, m);
}

/** Los pares salón+paquete nombrados DENTRO de un mismo párrafo. */
function paresDelParrafo(t) {
  const marcasSalon = [];
  for (const s of salonesTodos) {
    for (const p of posiciones(t, s)) marcasSalon.push({ salon: s, pos: p, largo: s.length });
  }
  marcasSalon.sort((a, b) => a.pos - b.pos);

  const pares = [];
  for (const ms of marcasSalon) {
    if (estaDescartado(t, ms.pos, ms.largo)) continue;
    let mejor = null;
    for (const [paquete, apodos] of (apodosDe.get(ms.salon) ?? new Map())) {
      for (const apodo of apodos) {
        for (const pos of posiciones(t, apodo)) {
          const d = Math.abs(pos - ms.pos);
          // A igual distancia gana el apodo más largo: «plata boda y xv»
          // empieza donde «plata», y el que describe mejor es el largo.
          if (!mejor || d < mejor.d || (d === mejor.d && apodo.length > mejor.largo)) {
            mejor = { paquete, d, largo: apodo.length };
          }
        }
      }
    }
    if (mejor) pares.push({ salon: ms.salon, paquete: mejor.paquete });
  }
  return pares;
}

/**
 * Los pares salón+paquete que el agente ofreció, en el orden en que aparecen.
 *
 * Se busca **párrafo por párrafo**, y esa es toda la gracia. Dentro de un
 * párrafo, cada salón se empareja con el nombre de paquete más cercano:
 * «Esmeralda y Santa Cruz, cada uno con el Paquete Bronce» son dos pares, y
 * «También está Quetzal con el Paquete Plata» es otro.
 *
 * Buscando en el texto entero se cruzaban los párrafos y salía mal:
 *
 *   «Norma ya está ocupado, pero Esmeralda, Santa Cruz y Quetzal están libres.
 *
 *    Te cotizo Esmeralda... El Paquete Bronce cuesta $59,400.»
 *
 * Ahí Santa Cruz se pegaba al «Bronce» del párrafo siguiente y se mandaba su
 * hoja —con OTRO precio— para un salón que solo se habia mencionado como
 * libre. Nombrar un salón no es ofrecerlo; ofrecerlo es decir qué paquete y
 * cuánto, y eso pasa en la misma frase.
 */
function paresDelTexto(t) {
  const pares = [];
  const vistos = new Set();
  for (const parrafo of t.split(/\n\s*\n/)) {
    for (const par of paresDelParrafo(parrafo)) {
      const clave = par.salon + '|' + par.paquete;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      pares.push(par);
    }
  }
  return pares;
}

/** De un grupo con varias láminas, la que toca según lo que escribió el cliente. */
function deEseGrupo(g) {
  if (g.imagenes.length === 1) return g.imagenes[0].url;
  // El arte parte dos paquetes en varias laminas: «Baby Shower, Despedidas de
  // Soltera y Bautizos» en tres, y «Aniversarios / Cumpleanos» en dos. El
  // precio y el contenido son los mismos; lo que cambia es a quien se le
  // enseña, asi que lo decide lo que escribio el cliente.
  const PISTA = {
    bautizo:     /bautiz/,
    despedida:   /despedida/,
    babyshower:  /baby ?shower/,
    aniversario: /aniversario|bodas? de (plata|oro|plomo)/,
    cumpleanos:  /cumplea|cumple/,
  };
  const dicho = limpiar(fl.chats);
  for (const img of g.imagenes) {
    const re = PISTA[img.etiqueta];
    if (re && re.test(dicho)) return img.url;
  }
  return '';
}

function laminas() {
  const t = limpiar(resp.texto_completo);
  if (!t) return [];
  const out = [];
  for (const par of paresDelTexto(t)) {
    const g = [...grupos.values()].find(
      (x) => x.salon_texto === par.salon && x.paquete_texto === par.paquete);
    if (!g) continue;
    const url = deEseGrupo(g);
    // Ante cualquier duda, ese par se va sin imagen. La lámina equivocada el
    // cliente la lee como la oferta.
    if (!url) continue;
    out.push({ url, pie: `${g.paquete_nombre} · ${g.salon_nombre}` });
    if (out.length === MAX_IMAGENES) break;
  }
  return out;
}

// Cuando se cotiza mandan SIEMPRE las laminas del paquete. Es la unica regla
// que importa de las dos: el agente nombra las cortesias dentro de la propia
// cotizacion —«incluye el Espejo de Bienvenida, el Aro iluminado...»—, asi que
// sin esta prioridad una cotizacion acabaria mandando la foto de una cortesia
// en lugar de la hoja del paquete, que es la que trae el precio.
//
// La foto de una cortesia es para el otro momento: cuando el cliente pregunta
// por una cosa concreta y no se esta cotizando. Ahi la foto vale mas que
// cualquier descripcion.
function cortesia() {
  const dicho = limpiar(fl.chats);
  if (!dicho) return [];
  const t = limpiar(resp.texto_completo);

  // Para una cortesia hace falta saber de que salon se habla, y aqui no hay
  // paquete cerca con que desempatar: si el texto nombra dos, no se adivina.
  const nombrados = salonesTodos.filter((x) => x && t.includes(x));
  const salon = nombrados.length === 1
    ? nombrados[0]
    : (nombrados.length ? null : sinEventos(fl.campos?.['Salón']) || null);
  if (!salon) return [];

  // Tiene que haberla preguntado EL CLIENTE. Buscarla en lo que escribio el
  // agente daria falsos positivos todo el tiempo, porque las enumera al cotizar.
  const encajan = cortesias.filter((c) => c.salon_texto === salon
    && c.pistas.some((pi) => dicho.includes(pi)));

  // Preguntó por dos: no se adivina cual queria ver.
  const distintas = [...new Set(encajan.map((c) => c.url))];
  return distintas.length === 1 ? [{ url: distintas[0], pie: '' }] : [];
}

let fotos = [];
try { fotos = laminas(); if (!fotos.length) fotos = cortesia(); } catch (e) { fotos = []; }

// ── repartir las fotos entre las partes del mensaje ────────────────────────
//
// Kommo adjunta UNA imagen por plantilla, asi que tres laminas son tres
// mensajes. La primera viaja con el texto; las demas van detras, cada una con
// su pie, para que el cliente sepa cual es cual sin tener que adivinar.
const partes = [resp.parte1, resp.parte2, resp.parte3, resp.parte4]
  .filter((x) => x && String(x).trim());
const porParte = partes.map((_, i) => (i === 0 && fotos.length ? fotos[0].url : ''));

for (const foto of fotos.slice(1)) {
  if (partes.length >= 4) break;   // el subflujo admite cuatro y ni una mas
  partes.push(foto.pie || 'Mira también esta.');
  porParte.push(foto.url);
}

return [{
  json: {
    ...resp,
    cuantas_partes: partes.length,
    parte1: partes[0] ?? '',
    parte2: partes[1] ?? '',
    parte3: partes[2] ?? '',
    parte4: partes[3] ?? '',
    // Se mantiene por si algo viejo la lee; la que manda es `imagenes`.
    imagen_url: fotos[0]?.url ?? '',
    // Alineada con las partes: la posicion i es la foto de la parte i+1.
    imagenes: JSON.stringify(porParte),
  },
}];
