// Portada. Héroe con los números del negocio y debajo dos columnas: lo que
// falta vender y lo que viene. Quien la abre cada mañana es el Lic. Barrón,
// que quiere saber cómo va el negocio, no interpretar un tablero.
import { api, error, salonActual, usuarioActual } from './api.js';
import { el, limpiar, cargando, abrirCajon, DIAS, MESES, diaDeSemana, animarNumero } from './ui.js';

const CORTO = { norma: 'Norma', esmeralda: 'Esmeralda', santacruz: 'Santa Cruz', quetzal: 'Quetzal' };
const partes = (iso) => iso.split('-').map(Number);
const mayus = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const TURNO = { manana: 'por la mañana', tarde: 'por la tarde', noche: 'por la noche' };
const HUECO = (h = []) => h.map((t) => TURNO[t]).join(' o ');

/** «hoy», «mañana», «este sábado», «el viernes 2 de octubre». */
function cuando(iso, hoyISO) {
  const d = dias(hoyISO, iso);
  if (d === 0) return 'hoy';
  if (d === 1) return 'mañana';
  const [, m, dd] = partes(iso);
  const nombre = DIAS[diaDeSemana(iso)];
  return d < 7 ? `este ${nombre}` : `el ${nombre} ${dd} de ${MESES[m - 1]}`;
}

const saludoDeLaHora = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
};

export async function hoy(raiz) {
  limpiar(raiz);
  const cont = el('div', { class: 'portada' });
  raiz.append(cont);
  cont.append(cargando());

  let d;
  try { d = await api.hoy(salonActual()); }
  catch (e) { limpiar(cont).append(error('No se pudo cargar: ' + e.message)); return; }

  limpiar(cont);
  cont.append(hero(d));
  cont.append(el('div', { class: 'portada-cuerpo' }, [proximasSemanas(d), loQueViene(d)]));
}

// ── héroe: el saludo, lo de hoy y los números ───────────────────────────────
function hero(d) {
  const quien = usuarioActual();
  const nombre = quien && quien !== 'Auxiliar de redes' ? quien.replace('Lic. ', '') : null;
  const [y, m, dd] = partes(d.hoy);

  const frase = el('div', { class: 'frase' });
  if (d.de_hoy.length) {
    frase.append(
      el('b', { text: d.de_hoy.length === 1 ? 'Hoy tienes un evento: ' : `Hoy tienes ${d.de_hoy.length} eventos: ` }),
      d.de_hoy.map((e) => `${e.tipo_evento ?? 'evento'} en ${e.salon_nombre.replace(' Eventos', '')}`).join(', ') + '.',
    );
  } else if (d.proximo) {
    frase.append(
      'Hoy no hay eventos. El próximo es ',
      el('span', { class: 'dest', text: cuando(d.proximo.fecha, d.hoy) }),
      ': ',
      el('b', { text: d.proximo.tipo_evento ?? 'un evento' }),
      ` en ${d.proximo.salon_nombre.replace(' Eventos', '')}.`,
    );
  } else {
    frase.append('No hay eventos registrados por ahora.');
  }

  // Esta semana: los siete primeros días de la rejilla.
  const estaSemana = d.proximos_dias.slice(0, 7).flatMap((x) => x.salones);
  const vendidasSemana = estaSemana.filter((c) => !c.libre).length;

  const cifra = (n, rotulo, deTotal) => {
    const num = el('div', { class: 'n' });
    const valor = el('span', { text: '0' });
    num.append(valor);
    if (deTotal) num.append(el('small', { text: `de ${deTotal}` }));
    animarNumero(valor, n);
    return el('div', {}, [num, el('div', { class: 'r', text: rotulo })]);
  };

  return el('div', { class: 'hero' }, [
    el('div', { class: 'arriba' }, [
      el('div', { class: 'dia-rotulo',
        text: `${DIAS[diaDeSemana(d.hoy)]} ${dd} de ${MESES[m - 1]} de ${y}` +
              (d.salon ? ` · ${d.salon.nombre}` : '') }),
      el('div', { class: 'saludo', text: nombre ? `${saludoDeLaHora()}, ${nombre}` : saludoDeLaHora() }),
      frase,
    ]),
    // Tres números para la vista general. El cuarto solo aparece con un salón
    // elegido, donde sí dice algo que los otros no: cuánto le falta por llenar.
    el('div', { class: 'cifras' }, [
      cifra(d.resumen.eventos_30_dias, 'eventos en 30 días'),
      cifra(d.resumen.eventos_totales, 'comprometidos en total'),
      cifra(vendidasSemana, 'fechas con evento en 7 días', estaSemana.length),
      d.salon
        ? cifra(d.resumen.dias_90.libres, 'días libres en 90', d.resumen.dias_90.total)
        : null,
    ].filter(Boolean)),
  ]);
}

// ── las próximas tres semanas ───────────────────────────────────────────────
// Los siete días de cada semana, no solo el fin. El negocio tiene precio para
// lunes a domingo y vende mañana, tarde y noche: un jueves libre también es
// una fecha sin cobrar, y si no se ve, nadie sale a llenarla.
function proximasSemanas(d) {
  const s = el('div', { class: 'bloque' });
  s.append(el('div', { class: 'rotulo', text: 'Los próximos 21 días' }));

  const celdas = d.proximos_dias.flatMap((x) => x.salones);
  if (!celdas.length) return s;
  // Antes esto decía «N de 84 todavía se pueden vender», y era una promesa
  // que el negocio no hace: un salón puede dar tres, cuatro o cinco eventos
  // en un día si las horas cuadran, así que no hay un cupo del cual restar.
  // El encabezado se queda con un hecho —cuántos eventos hay— y el reparto
  // real de huecos se ve al abrir cada día.
  const eventos = celdas.reduce((n, c) => n + (c.eventos ?? 0), 0);
  const vacios = celdas.filter((c) => c.libre).length;
  const nSalones = d.proximos_dias[0].salones.length;
  const nDias = d.proximos_dias.length;

  const cifra = el('div', { class: 'cifra', text: '0' });
  animarNumero(cifra, eventos);
  s.append(el('div', { class: 'marcador' }, [
    cifra,
    el('div', { class: 'glosa' }, [
      eventos === 1 ? 'evento agendado en los próximos ' : 'eventos agendados en los próximos ',
      el('b', { text: `${nDias} días` }), '.',
      el('div', { class: 'detalle', text:
        (vacios === 0
          ? 'Todos los días tienen algo.'
          : nSalones === 1
            ? `${vacios} de esos días siguen sin nada agendado.`
            : `${vacios} siguen sin nada agendado, de ${celdas.length}: los ${nDias} días en cada uno de los ${nSalones} salones.`) +
        ' Toca un día para ver a qué horas está ocupado y qué huecos quedan.' }),
    ]),
  ]));

  const semanas = [];
  for (let i = 0; i < d.proximos_dias.length; i += 7) semanas.push(d.proximos_dias.slice(i, i + 7));
  const salones = d.proximos_dias[0].salones;

  const caja = el('div', { class: 'semanas' });
  const etiquetas = el('div', { class: 'etiquetas' }, [el('div')]);
  salones.forEach((sal, fila) => {
    // Cuántas fechas lleva con evento: dice de un vistazo quién va apretado.
    const suyas = d.proximos_dias.map((x) => x.salones[fila]);
    const suyasVend = suyas.filter((c) => !c.libre).length;
    etiquetas.append(el('div', {}, [
      el('span', { text: CORTO[sal.clave] ?? sal.nombre }),
      el('span', {
        class: `cuenta-salon${suyasVend >= suyas.length * 0.5 ? ' lleno' : ''}`,
        title: `${suyasVend} de ${suyas.length} fechas con evento`,
        text: `${suyasVend}/${suyas.length}`,
      }),
    ]));
  });
  caja.append(etiquetas);

  for (const sem of semanas) {
    const [, m1, d1] = partes(sem[0].fecha);
    const [, m2, d2] = partes(sem[sem.length - 1].fecha);
    // «24–30 sep», o «29 sep–5 oct» cuando la semana cruza de mes.
    const titulo = m1 === m2
      ? `${d1}–${d2} ${MESES[m1 - 1].slice(0, 3)}`
      : `${d1} ${MESES[m1 - 1].slice(0, 3)}–${d2} ${MESES[m2 - 1].slice(0, 3)}`;
    const grupo = el('div', { class: 'grupo' }, [
      el('div', { class: 'cabeza' }, [
        el('div', { class: 'titulo', text: titulo }),
        el('div', { class: 'dias' }, sem.map((x) =>
          el('span', { text: DIAS[diaDeSemana(x.fecha)].slice(0, 2) }))),
      ]),
    ]);
    salones.forEach((sal, fila) => {
      const tr = el('div', { class: 'fila' });
      for (const dia of sem) {
        const c = dia.salones[fila];
        const [, mm, dd] = partes(dia.fecha);
        // El número, no una palomita: con varios eventos posibles al día, un
        // ✓ escondía si ese día había uno o cuatro.
        const clase = c.libre ? 'libre' : (c.cabe_otro ? 'a-medias' : 'vendido');
        tr.append(el('button', {
          type: 'button',
          class: `casilla ${clase}`,
          title: `${CORTO[sal.clave]} · ${DIAS[diaDeSemana(dia.fecha)]} ${dd} de ${MESES[mm - 1]} · ` +
                 (c.libre ? 'sin nada agendado'
                          : `${c.eventos} evento${c.eventos > 1 ? 's' : ''}`) +
                 ' · toca para ver el detalle',
          text: c.libre ? '' : String(c.eventos),
          onclick: () => verDia(dia.fecha, sal),
        }));
      }
      grupo.append(tr);
    });
    caja.append(grupo);
  }
  s.append(caja);

  s.append(el('div', { class: 'leyenda-semanas' }, [
    el('span', {}, [el('div', { class: 'casilla a-medias', text: '2' }), 'cuántos eventos tiene ese día']),
    el('span', {}, [el('div', { class: 'casilla libre' }), 'sin nada agendado']),
    el('span', { class: 'tenue', text: 'Toca cualquier día para ver sus horarios y sus huecos.' }),
  ]));
  return s;
}

// ── el detalle de un día, en el panel de la derecha ─────────────────────────
// Lo que importa no es «cabe / no cabe» sino DÓNDE cabe: a qué horas está
// tomado y qué tramos quedan, ya descontando el aseo por los dos lados.
async function verDia(fecha, sal) {
  const [, m, dd] = partes(fecha);
  const cuerpo = abrirCajon(
    `${mayus(DIAS[diaDeSemana(fecha)])} ${dd} de ${MESES[m - 1]}`,
    sal.nombre.replace(' Eventos', ''),
  );
  cuerpo.append(cargando());

  let d;
  try { d = await api.dia(fecha, sal.clave); }
  catch (e) { limpiar(cuerpo).append(error('No se pudo cargar: ' + e.message)); return; }

  limpiar(cuerpo);

  // Lo agendado, en orden.
  if (!d.eventos.length) {
    cuerpo.append(el('div', { class: 'dia-vacio' }, [
      el('b', { text: 'Todo el día libre.' }),
      ` Nadie ha agendado nada en ${sal.nombre.replace(' Eventos', '')} este día.`,
    ]));
  } else {
    cuerpo.append(el('div', { class: 'rotulo', text: d.eventos.length === 1 ? 'El evento del día' : `Los ${d.eventos.length} eventos del día` }));
    const lista = el('div', { class: 'dia-eventos' });
    for (const e of d.eventos) {
      lista.append(el('div', { class: `dia-ev ${e.estatus}` }, [
        el('div', { class: 'hora' }, e.hora_inicio
          ? [el('b', { text: e.hora_inicio }), el('span', { text: e.hora_fin ?? '' })]
          : [el('b', { text: 'Sin hora' })]),
        el('div', { class: 'que' }, [
          el('div', { class: 'tipo', text: e.tipo_evento ?? 'Evento' }),
          e.estatus === 'separado'
            ? el('span', { class: 'chip duda', text: 'apartado' })
            : e.estatus === 'bloqueado' ? el('span', { class: 'chip', text: 'bloqueado' }) : null,
          e.notas ? el('div', { class: 'notas', text: e.notas }) : null,
        ].filter(Boolean)),
      ]));
    }
    cuerpo.append(lista);
  }

  // Los huecos. Es lo que se viene a buscar aquí.
  cuerpo.append(el('div', { class: 'rotulo', style: 'margin-top:26px', text: 'Qué queda libre' }));
  if (d.motivo_sin_huecos === 'sin_horario') {
    cuerpo.append(el('div', { class: 'aviso atencion' }, [
      'Uno de los eventos de este día no tiene horario capturado. Sin saber a qué hora es, ',
      'no se puede calcular dónde quedan los huecos, así que el día se toma completo. ',
      'Ponle hora desde ', el('b', { text: 'Agenda' }), ' y aparecerán.',
    ]));
  } else if (!d.huecos.length) {
    cuerpo.append(el('div', { class: 'dia-vacio' },
      ['No queda ningún tramo de al menos 3 horas libres, contando las ',
       el('b', { text: `${d.minutos_aseo / 60} horas de aseo` }), ' entre un evento y otro.']));
  } else {
    const h = el('div', { class: 'huecos' });
    for (const x of d.huecos) {
      h.append(el('div', { class: 'hueco' }, [
        el('div', { class: 'tramo' }, [
          el('b', { text: x.de }), el('span', { text: '→' }), el('b', { text: x.a }),
          x.de_madrugada ? el('span', { class: 'chip', text: 'termina de madrugada' }) : null,
        ].filter(Boolean)),
        el('div', { class: 'cuanto', text: `${x.horas} h` }),
      ]));
    }
    cuerpo.append(h);
    cuerpo.append(el('div', { class: 'pie-huecos', text:
      `Ya descontadas las ${d.minutos_aseo / 60} horas de aseo antes y después de cada evento. ` +
      `La jornada vendible va de ${d.jornada[0]} a ${d.jornada[1]}.` }));
  }

  if (!d.agenda_confirmada) {
    cuerpo.append(el('div', { class: 'aviso atencion', style: 'margin-top:18px' }, [
      `${d.salon.encargada} revisó su agenda hasta el ${d.confirmada_hasta ?? '—'}. `,
      'De ahí en adelante puede haber eventos en su libreta que todavía no se capturan, ',
      'así que estos huecos hay que confirmárselos antes de prometerlos.',
    ]));
  }

  cuerpo.append(el('a', { class: 'ver-mas', href: '#/agenda', style: 'margin-top:22px',
    text: 'Abrir la agenda para registrar o mover →' }));
}

// ── lo que viene ────────────────────────────────────────────────────────────
function loQueViene(d) {
  const s = el('div', { class: 'bloque' });
  s.append(el('div', { class: 'rotulo', text: 'Lo que viene' }));
  if (!d.proximos.length) {
    s.append(el('div', { class: 'vacio', text: 'Sin eventos próximos.' }));
    return s;
  }
  const porFecha = new Map();
  for (const e of d.proximos.slice(0, 10)) {
    if (!porFecha.has(e.fecha)) porFecha.set(e.fecha, []);
    porFecha.get(e.fecha).push(e);
  }
  for (const [fecha, eventos] of porFecha) {
    const [, , dd] = partes(fecha);
    const pronto = dias(d.hoy, fecha) <= 2;
    const lista = el('div', { class: 'eventos' }, [
      el('div', { class: 'relativo', text: mayus(cuando(fecha, d.hoy)) }),
    ]);
    for (const e of eventos) {
      lista.append(el('div', { class: 'ev-linea' }, [
        d.salon ? null : el('span', { class: 'sal', text: e.salon_nombre.replace(' Eventos', '') }),
        el('span', { class: 'tipo', text: e.tipo_evento ?? 'Evento' }),
        e.estatus === 'separado' ? el('span', { class: 'chip duda', text: 'apartado' }) : null,
        el('span', { class: 'turno', text: e.turno }),
      ].filter(Boolean)));
    }
    s.append(el('div', { class: `jornada${pronto ? ' pronto' : ''}` }, [
      el('div', { class: 'ficha-fecha' }, [
        el('div', { class: 'num', text: String(dd) }),
        el('div', { class: 'dow', text: DIAS[diaDeSemana(fecha)].slice(0, 3) }),
      ]),
      lista,
    ]));
  }
  s.append(el('a', { class: 'ver-mas', href: '#/agenda', text: 'Ver el calendario completo →' }));
  return s;
}
