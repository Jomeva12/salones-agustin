// Cotizar. Quien atiende el WhatsApp tiene al cliente esperando: le dicen qué
// festejan, qué día y cuántos vienen, y necesita el precio y en qué salón cabe
// en la misma respuesta. La pantalla sigue ese orden en tres pasos numerados:
//   1. los datos del cliente  →  2. salón y paquete  →  3. copiar el mensaje.
import { api, pesos, error } from './api.js';
import { el, limpiar, cargando, DIAS, MESES, diaDeSemana, abrirCajon, copiar, animarNumero, selectorFecha, iso } from './ui.js';

const ETIQUETA = { libre: 'disponible', ocupada: 'ya tiene evento', no_confirmada: 'falta confirmar' };
const SALONES = [
  ['', 'Los cuatro'], ['norma', 'Norma'], ['esmeralda', 'Esmeralda'],
  ['santacruz', 'Santa Cruz'], ['quetzal', 'Quetzal'],
];
const partes = (iso) => iso.split('-').map(Number);
const mayus = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const fechaLarga = (iso) => {
  const [y, m, d] = partes(iso);
  return mayus(`${DIAS[diaDeSemana(iso)]} ${d} de ${MESES[m - 1]} de ${y}`);
};
const fechaCorta = (iso) => { const [, m, d] = partes(iso); return `${d} de ${MESES[m - 1]}`; };
const esFinde = (iso) => [0, 5, 6].includes(diaDeSemana(iso));

/** Una fila de píldoras que se comporta como un select. */
function pildoras(opciones, inicial) {
  let valor = inicial;
  const caja = el('div', { class: 'pildoras', role: 'radiogroup' });
  const pintar = () => {
    for (const b of caja.children) {
      const on = b.dataset.valor === valor;
      b.classList.toggle('sel', on);
      b.setAttribute('aria-checked', on);
    }
  };
  for (const [v, texto] of opciones) {
    caja.append(el('button', {
      type: 'button', role: 'radio', class: 'pildora', 'data-valor': v, text: texto,
      onclick: () => { valor = v; pintar(); },
    }));
  }
  pintar();
  return { caja, get valor() { return valor; },
    get texto() { return opciones.find(([v]) => v === valor)?.[1] ?? ''; } };
}

export async function cotizar(raiz) {
  limpiar(raiz);
  const cont = el('div', { class: 'cotizador' });
  raiz.append(cont);

  cont.append(el('div', { class: 'titulo' }, [
    el('h2', { text: 'Cotizar' }),
    el('p', { text: 'Con lo que el cliente te dijo por WhatsApp, el sistema busca el paquete que le toca, el precio exacto y en qué salones está libre la fecha. Tú eliges y copias el mensaje.' }),
  ]));

  let cat;
  try { cat = await api.catalogo(); }
  catch (e) { cont.append(error('No se pudo cargar el catálogo: ' + e.message)); return; }

  const tipo = pildoras(cat.tipos_evento.map((t) => [t.clave, t.nombre]), cat.tipos_evento[0]?.clave);
  const salon = pildoras(SALONES, '');
  // El calendario propio (el mismo de MediaHub): sin días pasados y con el
  // fin de semana resaltado, que es lo que cambia el precio.
  const ahora = new Date();
  const fecha = selectorFecha({ min: iso(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()),
    placeholder: 'Elige el día del evento' });
  const personas = el('input', { type: 'number', min: '1', max: '400', value: '150', step: '10' });

  // El día de la semana en cuanto se elige la fecha: cotizar un miércoles a
  // precio de sábado costó $6,000 de más en una conversación real.
  const pistaFecha = el('span', { class: 'pista', text: 'el día de la semana cambia el precio' });
  fecha.addEventListener('input', () => {
    if (!fecha.value) { pistaFecha.textContent = 'el día de la semana cambia el precio'; pistaFecha.className = 'pista'; return; }
    const finde = esFinde(fecha.value);
    pistaFecha.textContent = `${mayus(DIAS[diaDeSemana(fecha.value)])} · ${finde ? 'fin de semana' : 'entre semana, sale más accesible'}`;
    pistaFecha.className = `pista ${finde ? 'finde' : 'semana'}`;
  });

  const salida = el('div');
  const boton = el('button', { class: 'primario grande', text: 'Cotizar' });

  const correr = async () => {
    if (!fecha.value) {
      limpiar(salida).append(el('div', { class: 'aviso atencion', style: 'margin-top:20px',
        text: 'Falta la fecha del evento. Sin fecha, cualquier precio es falso.' }));
      fecha.focus();
      return;
    }
    boton.disabled = true;
    limpiar(salida).append(el('div', { style: 'margin-top:20px' }, [cargando('tarjetas')]));
    try {
      const r = await api.cotizar({
        salon: salon.valor || null, tipo_evento: tipo.valor,
        fecha_evento: fecha.value, personas: Number(personas.value),
      });
      limpiar(salida).append(pintar(r, tipo.texto));
    } catch (e) {
      limpiar(salida).append(el('div', { style: 'margin-top:20px' }, [error(e.message)]));
    } finally { boton.disabled = false; }
  };
  boton.addEventListener('click', correr);
  for (const c of [fecha, personas]) {
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter') correr(); });
  }

  const campo = (texto, control, pista) => el('label', { class: 'pregunta' }, [
    el('span', { class: 'etq', text: texto }), control, pista,
  ]);

  cont.append(el('section', { class: 'bloque-cot' }, [
    paso(1, 'Datos del cliente', 'lo que te dijo por WhatsApp'),
    el('div', { class: 'cuerpo' }, [
      el('div', { class: 'pregunta' }, [el('span', { class: 'etq', text: '¿Qué van a festejar?' }), tipo.caja]),
      el('div', { class: 'campos' }, [
        campo('¿Qué día?', fecha, pistaFecha),
        campo('¿Cuántos invitados?', personas, el('span', { class: 'pista', text: 'aproximado está bien · Quetzal recibe hasta 150' })),
      ]),
      el('div', { class: 'pregunta' }, [
        el('span', { class: 'etq' }, ['¿En cuál salón? ', el('em', { text: 'opcional' })]),
        salon.caja,
      ]),
    ]),
    el('div', { class: 'pie' }, [
      boton,
      el('div', { class: 'nota', text: 'Con «Los cuatro», si un salón está ocupado ya tienes la alternativa a la mano.' }),
    ]),
  ]));
  cont.append(salida);
  fecha.focus();
}

/** Cabecera numerada de cada paso, al estilo de los bloques de MediaHub. */
function paso(n, titulo, apunte) {
  return el('header', { class: 'paso' }, [
    el('span', { class: 'n', text: String(n) }),
    el('h3', { text: titulo }),
    apunte ? el('span', { class: 'apunte', text: apunte }) : null,
  ].filter(Boolean));
}

// ── la respuesta ────────────────────────────────────────────────────────────
function pintar(r, tipoNombre) {
  if (r.resultado !== 'ok') {
    const textos = {
      faltan_datos: 'Faltan datos: ' + (r.faltan ?? []).join(', '),
      fecha_pasada: 'Esa fecha ya pasó.',
      tipo_desconocido: 'No reconozco ese tipo de evento.',
      salon_desconocido: 'No reconozco ese salón.',
    };
    return el('div', { class: 'aviso atencion', style: 'margin-top:20px',
      text: textos[r.resultado] ?? r.resultado });
  }

  // Vendible = hay precio Y queda alguna hora en que quepa. «La fecha está
  // libre» daba por perdido un día que todavía tenía horas disponibles.
  const vendible = (s) => s.cotizacion === 'ok' && s.se_puede_ofrecer;
  const vendibles = r.salones.filter(vendible);
  const resto = r.salones.filter((s) => !vendible(s));

  const caja = el('div', { class: 'respuesta-cot' });
  caja.append(resumen(r, tipoNombre, vendibles.length));

  const bloque = el('section', { class: 'bloque-cot' }, [
    paso(2, 'Elige salón y paquete', r.salones.length > 1
      ? (vendibles.length === r.salones.length ? 'los cuatro están libres'
        : vendibles.length ? `${vendibles.length} de ${r.salones.length} se pueden ofrecer`
        : 'ninguno está libre: ofrécele otra fecha')
      : null),
  ]);
  if (!vendibles.length) {
    // Antes esto decía «no se puede» y ahí moría la venta. Casi nunca es
    // cierto: lo que suele estar tomada es LA HORA acostumbrada, y el salón
    // sigue libre otras horas del mismo día.
    const conAlternativa = r.salones.filter((x) => x.cotizacion === 'ok' && x.alternativos);
    bloque.append(el('div', { class: 'aviso-venta mal' }, conAlternativa.length
      ? [
          el('b', { text: `A la hora de siempre (${r.salones.find((x) => x.franja_tipica)?.franja_tipica?.join(' o ') ?? '—'}) no queda lugar.` }),
          ' Pero ',
          el('b', { text: conAlternativa.map((x) => x.salon_nombre.replace(' Eventos', '')).join(' y ') }),
          conAlternativa.length === 1 ? ' sigue libre a otras horas de ese mismo día. ' : ' siguen libres a otras horas de ese mismo día. ',
          'Pregúntale al cliente si le sirve un horario distinto; si no, proponle otra fecha.',
        ]
      : [
          // Con un solo salón elegido, «en ninguno» suena a que se miraron los
          // cuatro. Hay que decir cuál se miró.
          el('b', { text: r.salones.length === 1
            ? `${r.salones[0].salon_nombre.replace(' Eventos', '')} ya no tiene lugar ese día.`
            : 'Ese día ya no queda lugar en ninguno de los cuatro.' }),
          ' Ni a la hora de siempre ni a ninguna otra. ',
          r.salones.length === 1
            ? 'Prueba con «Los cuatro» por si otro salón sí puede, o proponle otra fecha.'
            : 'Conviene proponerle al cliente otro día.',
        ]));
  }
  const rej = el('div', { class: 'rejilla-salones' });
  for (const s of [...vendibles, ...resto]) rej.append(tarjetaSalon(s, r, tipoNombre));
  bloque.append(rej);
  caja.append(bloque);
  return caja;
}

/** Lo que el sistema dedujo, y cuánto dura el precio. */
function resumen(r, tipoNombre, nVendibles) {
  const tramo = r.salones.find((s) => s.recomendado)?.recomendado?.tramo_personas;
  const quedan = dias(r.hoy, r.precio_vigente_hasta);
  const finde = esFinde(r.fecha);

  const dato = (valor, rotulo) => {
    const n = el('div', { class: 'n' });
    if (typeof valor === 'number') {
      const v = el('span', { text: '0' });
      n.append(v); animarNumero(v, valor);
    } else { n.classList.add('texto'); n.append(el('span', { text: valor })); }
    return el('div', { class: 'dato' }, [n, el('div', { class: 'r', text: rotulo })]);
  };

  return el('div', { class: 'resumen-cot' }, [
    el('div', { class: 'principal' }, [
      el('div', { class: 'dia-rotulo', text: `${tipoNombre} · ${r.personas} invitados` }),
      el('div', { class: 'fecha', text: fechaLarga(r.fecha) }),
      el('div', { class: 'datos' }, [
        dato(finde ? 'Fin de semana' : 'Entre semana', 'tarifa del día'),
        dato(r.meses_anticipacion, r.meses_anticipacion === 1 ? 'mes de anticipación' : 'meses de anticipación'),
        tramo ? dato(tramo, 'invitados, rango de la tarifa') : null,
        r.salones.length > 1 ? dato(nVendibles, `de ${r.salones.length} salones libres`) : null,
      ].filter(Boolean)),
    ]),
    vigencia(r, quedan),
  ]);
}

/**
 * A qué hora se puede. Es lo que faltaba: el precio no depende de la hora, así
 * que la cotización siempre vale; lo que hay que resolver con el cliente es el
 * horario. Se enseñan las horas de costumbre, cuáles están libres, y —si
 * ninguna lo está— qué otras horas del mismo día siguen disponibles.
 */
/**
 * Lo que ese paquete no trae y se puede vender aparte, ya con precio.
 *
 * «No incluye» servia solo para evitar el reclamo. Cruzado con el catalogo de
 * servicios se vuelve el upsell de esta cotizacion: quien vende ya no tiene
 * que acordarse de que el Bronce no trae pista y que la pista son $4,400.
 */
function seAgrega(s) {
  const lista = s.se_puede_agregar ?? [];
  if (!lista.length) return null;

  const caja = el('div', { class: 'agregables' });
  const abrir = el('button', {
    type: 'button', class: 'abre-agregables',
    'aria-expanded': 'false',
    onclick: () => {
      const ab = cuerpo.hidden;
      cuerpo.hidden = !ab;
      abrir.setAttribute('aria-expanded', String(ab));
      abrir.classList.toggle('abierto', ab);
    },
  }, [
    el('b', { text: `Se le puede agregar (${lista.length})` }),
    el('span', { class: 'flecha', text: '\u203a' }),
  ]);

  const cuerpo = el('div', { class: 'cuerpo-agregables', hidden: true });
  for (const a of lista) {
    cuerpo.append(el('div', { class: 'agregable' }, [
      el('div', { class: 'que' }, [
        el('b', { text: a.servicio }),
        a.opciones > 1
          ? el('span', { class: 'ops', text: `${a.opciones} opciones` })
          : null,
        a.es_propio ? null : el('span', { class: 'chip neutro', text: 'proveedor' }),
      ].filter(Boolean)),
      el('div', { class: 'cuanto' }, [
        a.desde ? el('small', { text: 'desde ' }) : null,
        el('b', { text: a.precio === null ? 'a cotizar' : pesos(a.precio) }),
      ].filter(Boolean)),
    ]));
  }
  cuerpo.append(el('div', { class: 'pie-agregables',
    text: 'Son los conceptos que este paquete marca como no incluidos y que ' +
          'existen en el catalogo de servicios. Los precios son de la lista vigente.' }));

  caja.append(abrir, cuerpo);
  return caja;
}

function horarios(s) {
  const caja = el('div', { class: 'horarios' });
  caja.append(el('div', { class: 'rot' }, [
    `Evento de ${s.duracion_horas} h`,
    s.minutos_estancia ? el('span', { text: ` · entra ${s.minutos_estancia} min antes` }) : null,
    // Cuando el paquete impone su propia ventana (las posadas de viernes a
    // domingo van de 7 am a 5 pm) hay que decir ESA, no el cierre del salón:
    // si no, el renglón contradice los horarios que se listan debajo.
    s.fuente_horario === 'paquete' && !s.horario_libre
      ? el('span', { text: ` · solo de ${s.franja_tipica[0]} a ${s.franja_tipica[1]}` })
      : el('span', { text: ` · cierra a la ${s.cierre_maximo}` }),
  ].filter(Boolean)));

  if (s.sin_horario) {
    caja.append(el('div', { class: 'sin-horario' },
      ['Ese día hay un evento sin hora capturada, así que no se puede calcular. ',
       'Confírmalo con la encargada antes de ofrecer.']));
    return caja;
  }

  const tiras = el('div', { class: 'tiras' });
  for (const h of s.horarios) {
    tiras.append(el('button', {
      type: 'button',
      class: `tira ${h.libre ? 'si' : 'no'}`,
      title: h.libre ? 'Disponible' : `Ocupado por ${h.ocupado_por}${h.choca_con ? ` (${h.choca_con})` : ''}`,
      onclick: () => navigator.clipboard?.writeText(`de ${h.de} a ${h.a}`),
    }, [
      el('b', { text: h.de }),
      el('span', { text: `a ${h.a}` }),
    ]));
  }
  caja.append(tiras);

  // La regla del paquete no es obvia: quien vende tiene que poder decírsela
  // al cliente sin buscarla en el Excel.
  if (s.fuente_horario === 'paquete') {
    caja.append(el('div', { class: 'regla-horario' }, s.horario_libre
      ? [
          el('b', { text: 'Este paquete se puede a cualquier hora hoy. ' }),
          'De lunes a jueves no tiene restricción: mañana, tarde o noche. ',
          'En viernes, sábado y domingo solo de 7:00 am a 5:00 pm.',
        ]
      : [
          el('b', { text: 'Este paquete tiene horario propio. ' }),
          `En viernes, sábado y domingo solo se puede de ${s.franja_tipica[0]} a ${s.franja_tipica[1]}. `,
          'De lunes a jueves, a cualquier hora.',
        ]));
  }

  if (!s.se_puede_ofrecer && s.alternativos) {
    caja.append(el('div', { class: 'alterno' }, [
      el('b', { text: 'Pero el salón sí está libre más temprano. ' }),
      `Cabe un evento de ${s.duracion_horas} h empezando entre las `,
      el('b', { text: s.alternativos.desde }), ' y las ', el('b', { text: s.alternativos.hasta }),
      '. No es la hora de costumbre: pregúntale al cliente si le sirve.',
    ]));
  }
  if (!s.se_puede_ofrecer && !s.alternativos) {
    caja.append(el('div', { class: 'alterno mal' },
      ['Ese día ya no cabe otro evento de ', el('b', { text: `${s.duracion_horas} h` }),
       ', contando las 2 horas de aseo entre uno y otro.']));
  }
  if (s.disponibilidad === 'no_confirmada') {
    caja.append(el('div', { class: 'alterno duda' },
      ['La encargada solo ha revisado su agenda hasta el ',
       el('b', { text: s.disponibilidad_detalle?.confirmada_hasta ?? '—' }),
       '. Confírmale la fecha antes de prometerla.']));
  }
  return caja;
}

/**
 * Hasta cuándo aguanta este precio. Solo aparece si de verdad va a cambiar:
 * el escalón de anticipación existe en 2027 y 2028, pero en 2026 NINGUNA de
 * las 253 tarifas lo tiene, así que ahí avisar de un cambio era una alarma
 * falsa.
 *
 * Y cuando cambia, dice para dónde. Aquí el precio BAJA al acercarse la fecha
 * —es un descuento por urgencia— y un contador en rojo sin decir eso se lee
 * como «va a subir, apúrate», que es justo al revés.
 */
function vigencia(r, quedan) {
  const cambio = r.salones.map((s) => s.cambio_de_precio).find(Boolean);
  if (!cambio) {
    return el('div', { class: 'vigencia estable' }, [
      el('div', { class: 'r', text: 'Este precio no cambia' }),
      el('div', { class: 'cuando chico', text: `Tarifa fija de ${r.anio}` }),
      el('p', { text: 'Para esta fecha el precio no depende de cuánto falte para el evento: ' +
                      'es el mismo hoy que el mes que entra.' }),
    ]);
  }
  const baja = !cambio.sube;
  const monto = '$' + Math.abs(cambio.diferencia).toLocaleString('es-MX');
  return el('div', { class: `vigencia${quedan <= 7 ? ' pronto' : ''}` }, [
    el('div', { class: 'r', text: 'Este precio vale hasta' }),
    el('div', { class: 'cuando', text: fechaCorta(r.precio_vigente_hasta) }),
    el('div', { class: 'quedan', text: quedan <= 0 ? 'vence hoy' : quedan === 1 ? 'queda 1 día' : `quedan ${quedan} días` }),
    el('p', {}, [
      'El ', el('b', { text: fechaCorta(cambio.desde) }), ' pasa a ',
      el('b', { text: '$' + cambio.total.toLocaleString('es-MX') }),
      baja ? ` — ${monto} menos, ` : ` — ${monto} más, `,
      'porque entra el escalón «', cambio.escalon, '».',
      baja
        ? ' Si el cliente espera, le sale más barato: conviene cerrarlo este mes.'
        : ' Después del cambio le sale más caro.',
    ]),
  ]);
}

function tarjetaSalon(s, r, tipoNombre) {
  const vendible = s.cotizacion === 'ok' && s.se_puede_ofrecer;
  const det = s.disponibilidad_detalle ?? {};
  const t = el('article', { class: `tarjeta-salon ${vendible ? 'vendible' : 'apagada'}` });
  t.append(el('div', { class: 'cabecera' }, [
    el('h4', { text: s.salon_nombre.replace(' Eventos', '') }),
    el('span', {
      class: `chip ${s.cotizacion !== 'ok' ? s.disponibilidad : (s.se_puede_ofrecer ? 'libre' : 'ocupada')}`,
      text: s.cotizacion !== 'ok' ? ETIQUETA[s.disponibilidad]
        : s.se_puede_ofrecer
          ? (s.horas_libres.length === 1 ? 'solo una hora libre' : 'hay horario')
          : 'sin horario a esa hora',
    }),
  ]));
  if (s.cotizacion === 'ok') t.append(horarios(s));

  if (s.cotizacion !== 'ok') {
    t.append(el('div', { class: 'sin' }, [
      el('b', { text: 'No hay precio para esta consulta' }), s.motivo,
      el('span', { class: 'deriva', text: 'Pregúntale a la encargada antes de ofrecer algo.' }),
    ]));
    return t;
  }

  // Las opciones como lista elegible: antes solo se podía copiar la más
  // barata y las demás aparecían como texto suelto.
  let elegida = s.opciones[0];
  const regalo = el('div', { class: 'regalo' });
  const pintarRegalo = () => {
    limpiar(regalo);
    if (elegida.cortesias) regalo.append(el('b', { text: 'De cortesía' }), elegida.cortesias);
    regalo.hidden = !elegida.cortesias;
  };
  const lista = el('div', { class: 'opciones', role: 'radiogroup' });
  s.opciones.forEach((o, i) => {
    const fila = el('button', { type: 'button', role: 'radio', class: 'opcion', onclick: () => {
      elegida = o;
      for (const f of lista.children) { f.classList.toggle('sel', f === fila); f.setAttribute('aria-checked', f === fila); }
      pintarRegalo();
    } }, [
      el('span', { class: 'marca-radio' }),
      el('span', { class: 'nombre' }, [
        o.paquete.replace('Paquete ', ''),
        // La etiqueta depende de POR QUÉ está primero. Hasta 5 meses el orden
        // es por precio, así que el primero es el más barato. A 6 meses o más
        // manda la instrucción del Lic. Barrón y el primero es el Plata, que
        // NO es el más barato: llamarlo «accesible» sería mentir.
        i === 0 && s.opciones.length > 1
          ? el('small', { text: o.total === Math.min(...s.opciones.map((x) => x.total))
              ? 'el más accesible' : 'el que conviene ofrecer primero' })
          : null,
      ].filter(Boolean)),
      el('span', { class: 'monto' }, [
        pesos(o.total),
        o.unidad === 'por_persona' ? el('small', { text: `${pesos(o.precio)} c/u` }) : null,
      ].filter(Boolean)),
    ]);
    if (i === 0) { fila.classList.add('sel'); fila.setAttribute('aria-checked', 'true'); }
    lista.append(fila);
  });
  t.append(lista);
  pintarRegalo();
  t.append(regalo);
  // El upsell va justo después de las cortesías: primero lo que se regala,
  // luego lo que se vende.
  const mas = seAgrega(s);
  if (mas) t.append(mas);

  const acciones = el('div', { class: 'acciones' });
  acciones.append(el('button', { text: 'Ver qué incluye', onclick: () => verIncluye(elegida, s) }));
  if (vendible) {
    const b = el('button', { class: 'primario', text: 'Copiar para WhatsApp',
      onclick: () => copiar(mensajeWhatsApp(s, elegida, r), b) });
    acciones.append(b);
  }
  t.append(acciones);
  return t;
}

async function verIncluye(o, s) {
  const cuerpo = abrirCajon(o.paquete, `${s.salon_nombre} · precio para ${o.tramo_personas} invitados`);
  cuerpo.append(cargando());
  try {
    const d = await api.contenido(o.contenido_id);
    limpiar(cuerpo);
    if (o.cortesias) {
      cuerpo.append(el('div', { class: 'regalo', style: 'margin-bottom:16px' },
        [el('b', { text: 'De cortesía' }), o.cortesias]));
    }
    cuerpo.append(el('h4', { style: 'font-size:14px;margin-bottom:8px', text: `Incluye (${d.incluye.length})` }));
    cuerpo.append(el('ul', { class: 'incluye' }, d.incluye.map((x) => el('li', { text: x }))));
    if (d.no_incluye.length) {
      cuerpo.append(el('h4', { style: 'font-size:14px;margin:20px 0 8px', text: `No incluye (${d.no_incluye.length})` }));
      cuerpo.append(el('ul', { class: 'incluye no' }, d.no_incluye.map((x) => el('li', { text: x }))));
      cuerpo.append(el('p', { style: 'margin-top:12px;font-size:12.5px;color:var(--tinta-3)',
        text: 'Lo que no incluye se puede contratar aparte. Míralo en Servicios.' }));
    }
  } catch (e) { limpiar(cuerpo).append(error(e.message)); }
}

/** El mensaje listo para pegar, con el formato que el equipo ya usa. */
function mensajeWhatsApp(s, o, r) {
  const l = [];
  l.push(`${o.paquete} ✨`);
  l.push(s.salon_nombre);
  l.push(fechaLarga(r.fecha));
  l.push(`Paquete para ${r.personas} invitados`);
  // Con recargo interno NUNCA se desglosa el precio por invitado: el
  // desglose no cuadraria con el total y delataria los $10,000 que, por
  // instruccion del Lic. Barron, no se le explican al cliente.
  l.push(o.unidad === 'por_persona' && !o.recargo_interno
    ? `${pesos(o.precio)} por invitado — total ${pesos(o.total)}`
    : `Por tan solo ${pesos(o.total)}`);
  if (o.cortesias) { l.push(''); l.push(`Este paquete te regala 🎁 ${o.cortesias}`); }
  l.push('');
  l.push('Separa tu fecha con $500 💛');
  // Instruccion del Lic. Barron: toda cotizacion cierra invitando a visitar.
  l.push('Ven a conocernos y descubre de qué manera puedes obtener más cortesías ✨');
  return l.join('\n');
}
