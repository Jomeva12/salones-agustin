// ============================================================================
//  Toda la regla de negocio vive aquí. Ni el agente de IA ni el frontend
//  calculan el escalón, el tramo de invitados o qué paquete corresponde:
//  mandan lo que dijo el cliente y este módulo resuelve.
// ============================================================================

const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
const DIA_NOMBRE = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Hoy en Monterrey. Nunca el reloj del servidor: n8n corre en UTC y al
 *  cruzar la medianoche eso cambia el escalón y con él el precio. */
export function hoyMonterrey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Monterrey', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

const partes = (iso) => iso.split('-').map(Number);

/** Meses de distancia entre dos fechas ISO, contando solo año y mes. */
export function mesesEntre(desdeISO, hastaISO) {
  const [ay, am] = partes(desdeISO), [by, bm] = partes(hastaISO);
  return (by * 12 + bm) - (ay * 12 + am);
}

/** Día de la semana 0..6 sin que la zona horaria lo mueva. */
export function diaSemana(iso) {
  const [y, m, d] = partes(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const esFechaValida = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// ──────────────────────────── horarios ──────────────────────────────────────

/**
 * «8:00 pm» → «20:00». El equipo captura la hora a mano y escribe de todo,
 * incluido «13:00 pm», que es un 13:00 con un pm de sobra: cuando la hora ya
 * viene en 24 el sufijo se ignora en vez de rechazar la fila.
 */
export function hora24(txt) {
  if (txt === null || txt === undefined || txt === '') return null;
  const m = String(txt).trim().toLowerCase().match(/^(\d{1,2})\s*[:.]?\s*(\d{2})?\s*(a\.?m|p\.?m)?/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  const suf = m[3] ? m[3].replace(/\./g, '') : null;
  if (suf === 'pm' && h < 12) h += 12;
  if (suf === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const sumarDias = (iso, n) => {
  const [y, m, d] = partes(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};

/**
 * El evento como un tramo de tiempo, no como una fecha. Un XV de 8:00 pm a
 * 1:00 am dura cinco horas y termina al día siguiente; si el fin se guardara
 * en la misma fecha serían menos diecinueve, y cualquier cuenta de traslape
 * daría al revés.
 */
export function ventana(fecha, horaInicio, horaFin) {
  const i = hora24(horaInicio), f = hora24(horaFin);
  if (!i || !f) return { inicio_at: null, fin_at: null };
  return {
    inicio_at: `${fecha} ${i}`,
    fin_at: `${f <= i ? sumarDias(fecha, 1) : fecha} ${f}`,
  };
}

/**
 * La hora como la lee el equipo. Un solo formato, un solo lugar: si mañana se
 * decide escribirlas en 24 h, se cambia aquí y cambia en toda la aplicación.
 * «13:00 pm» → «1:00 pm»; «20:00» → «8:00 pm»; basura → null.
 */
export function normalizarHora(txt) {
  const h = hora24(txt);
  return h ? hora12(h) : null;
}

/** Formato para leer: «8:00 pm» a partir de «20:00». */
export function hora12(h24) {
  if (!h24) return null;
  const [h, m] = h24.slice(-5).split(':').map(Number);
  const suf = h < 12 ? 'am' : 'pm';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${suf}`;
}

/**
 * Las horas que se pueden elegir, de media en media. Se capturan escogiendo y
 * no escribiendo: el texto libre fue justo lo que dejó «13:00 pm» en la base.
 */
export function horasElegibles(paso = 30) {
  const out = [];
  for (let m = 0; m < 24 * 60; m += paso) {
    const h24 = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    out.push({ valor: hora12(h24), h24 });
  }
  return out;
}

// ─────────────────────────── disponibilidad ─────────────────────────────────

/**
 * Horario estándar por turno. Sale de los datos: los cuatro salones usan
 * 8:00 pm – 1:00 am en la mayoría de sus eventos. Es lo que se supone cuando
 * el cliente pide una fecha sin decir la hora.
 */
export const TURNO_HORARIO = {
  manana: ['09:00', '13:00'],
  tarde:  ['13:00', '17:00'],
  noche:  ['20:00', '01:00'],
};

const aMs = (t) => new Date(t.replace(' ', 'T') + ':00').getTime();

/**
 * Tres estados, no dos. "No hay fila" solo significa libre hasta donde la
 * encargada confirmó haber revisado su agenda; más allá es "no confirmada".
 *
 * Y "ocupada" ya no es "ese día hay algo": un salón puede dar dos eventos el
 * mismo día mientras entre uno y otro quepa el aseo. Lo que decide es si el
 * tramo pedido choca, no si la fecha está usada.
 */
export function disponibilidadSalon(db, salonId, fecha, turno = 'noche', horas = null) {
  const [hi, hf] = horas ?? TURNO_HORARIO[turno] ?? TURNO_HORARIO.noche;
  const pedido = ventana(fecha, hi, hf);
  const aseo = db.prepare('SELECT minutos_aseo m FROM salon WHERE id = ?').get(salonId)?.m ?? 120;

  // ±2 días: un evento que arranca de noche termina al día siguiente, y con
  // el aseo encima alcanza la madrugada.
  const vecinos = db.prepare(
    `SELECT c.id, c.fecha, c.estatus, c.hora_inicio, c.hora_fin, c.inicio_at, c.fin_at,
            t.nombre AS tipo_evento
       FROM compromiso c LEFT JOIN tipo_evento t ON t.id = c.tipo_evento_id
      WHERE c.salon_id = ?
        AND c.fecha BETWEEN date(?, '-2 day') AND date(?, '+2 day')
      ORDER BY c.inicio_at, c.fecha`).all(salonId, fecha, fecha);

  const choca = vecinos.find((o) => {
    // Sin horas de un lado o del otro no hay hueco que medir: ese día se
    // considera tomado. Estorbar una venta es más barato que venderla dos veces.
    if (!pedido.inicio_at || !o.inicio_at) return o.fecha === fecha;
    return aMs(pedido.inicio_at) < aMs(o.fin_at) + aseo * 60000
        && aMs(o.inicio_at) < aMs(pedido.fin_at) + aseo * 60000;
  });

  // Lo que ya hay ese día aunque no choque: el agente tiene que poder decir
  // «sí cabes, pero ese día ya hay una boda por la tarde».
  const mismoDia = vecinos
    .filter((o) => o.fecha === fecha && o.id !== choca?.id)
    .map((o) => ({ tipo_evento: o.tipo_evento, de: o.hora_inicio, a: o.hora_fin, estatus: o.estatus }));

  if (choca) {
    return {
      estado: 'ocupada',
      estatus: choca.estatus,
      tipo_evento: choca.tipo_evento,
      choca_con: { fecha: choca.fecha, de: choca.hora_inicio, a: choca.hora_fin },
      minutos_aseo: aseo,
      motivo: choca.hora_inicio
        ? `Ese salón tiene ${choca.tipo_evento ?? 'un evento'} el ${choca.fecha} de ` +
          `${choca.hora_inicio} a ${choca.hora_fin}, y entre evento y evento hacen falta ` +
          `${aseo / 60} horas de aseo.`
        : `Ese salón ya tiene ${choca.tipo_evento ?? 'un evento'} ese día.`,
    };
  }
  const ctl = db.prepare('SELECT confirmada_hasta, fuente FROM control_agenda WHERE salon_id = ?')
    .get(salonId);
  if (!ctl || fecha > ctl.confirmada_hasta) {
    return {
      estado: 'no_confirmada',
      horario: [hi, hf],
      otros_del_dia: mismoDia,
      confirmada_hasta: ctl?.confirmada_hasta ?? null,
      motivo: 'La agenda de este salón solo está revisada hasta ' +
              (ctl?.confirmada_hasta ?? 'una fecha sin registrar') + '.',
    };
  }
  return {
    estado: 'libre',
    horario: [hi, hf],
    // Puede estar libre Y tener otro evento ese día: son compatibles.
    otros_del_dia: mismoDia,
    confirmada_hasta: ctl.confirmada_hasta,
    fuente: ctl.fuente,
  };
}

/**
 * La jornada vendible de un salón. El fin NO es una costumbre: la política
 * «Costo de la hora extra» dice literalmente que «sin excepción, todos los
 * eventos terminan a más tardar a la 1:00 am, por reglamento municipal».
 * Se lee de salon.cierre_maximo para que se pueda mover si el reglamento lo
 * hace, pero aquí el valor por omisión es ese tope.
 */
export const JORNADA = ['08:00', '01:00'];

/**
 * A partir de 6 meses de distancia el catalogo cambia de forma: el Bronce
 * simplemente NO tiene tarifa (sus escalones llegan hasta "3 a 5 meses"),
 * y Plata, Onix y Oro solo existen ahi.
 *
 * La instruccion del Lic. Barron para ese tramo:
 *   1. Ofrecer PRIMERO el Plata, aunque no sea el mas barato.
 *   2. Si no le alcanza, el Onix.
 *   3. Si tampoco, el Bronce del escalon "3 a 5 meses" mas $10,000.
 *
 * El punto 3 es la unica parte del sistema donde un precio no sale del Excel
 * sino de una regla: el recargo NO se le explica al cliente, se le cotiza el
 * total. Por eso viaja marcado, para que la pantalla no lo desglose por error.
 *
 * Ojo con el nombre: "a partir del septimo mes en relacion al actual" son 6
 * meses de DISTANCIA, porque cuenta el mes en curso como el primero. Es la
 * misma trampa ordinal que tienen los escalones.
 */
export const LARGO_PLAZO_MESES = 6;
// El orden de venta, SIEMPRE, sin importar la anticipacion: Plata primero
// aunque no sea el mas barato, luego Onix, luego Bronce, y el Oro al final
// (es mas caro que el Plata, no cabe en una escalera descendente; queda
// disponible pero sin encabezar).
//
// Donde se nota de verdad es en Quetzal: sus paquetes "Boda y XV" no tienen
// escalera, asi que los tres compiten en cualquier consulta. En los otros tres
// salones el Plata solo existe a 6 meses o mas.
export const ORDEN_LARGO_PLAZO = ['Plata', 'Onix', 'Bronce', 'Oro'];
export const RECARGO_BRONCE_LARGO_PLAZO = 10000;

/** Lo que dura el evento más corto que vale la pena agendar. */
const MINIMO_HUECO_MIN = 180;

/**
 * Los huecos REALES de un día, no «cabe o no cabe». Un salón puede dar tres,
 * cuatro o cinco eventos en un día si las horas cuadran; lo que decide no es
 * un cupo sino dónde quedan los espacios una vez que a cada evento se le suma
 * el aseo por los dos lados.
 */
export function huecosDelDia(db, salonId, fecha) {
  const sal = db.prepare('SELECT minutos_aseo m, cierre_maximo c FROM salon WHERE id = ?').get(salonId);
  const aseo = sal?.m ?? 120;
  const cierre = sal?.c ?? JORNADA[1];
  const ini = new Date(`${fecha}T${JORNADA[0]}:00`).getTime();
  const fin = new Date(`${sumarDias(fecha, 1)}T${cierre}:00`).getTime();

  const eventos = db.prepare(
    `SELECT c.id, c.fecha, c.estatus, c.turno, c.hora_inicio, c.hora_fin,
            c.inicio_at, c.fin_at, c.horario_exacto, c.notas, t.nombre AS tipo_evento
       FROM compromiso c LEFT JOIN tipo_evento t ON t.id = c.tipo_evento_id
      WHERE c.salon_id = ?
        AND c.fecha BETWEEN date(?, '-1 day') AND date(?, '+1 day')
      ORDER BY c.inicio_at, c.fecha`).all(salonId, fecha, fecha);

  // Los del día, para enseñarlos. Un evento que arranca la víspera y termina
  // de madrugada también estorba, pero no es «de este día».
  const delDia = eventos.filter((e) => e.fecha === fecha);

  // Sin horas no hay nada que medir: el día se toma entero.
  const sinHora = delDia.some((e) => !e.inicio_at);
  if (sinHora) {
    return { eventos: delDia, huecos: [], minutos_aseo: aseo, motivo_sin_huecos: 'sin_horario' };
  }
  const hayAproximados = delDia.some((e) => e.inicio_at && !e.horario_exacto);

  const ms = (t) => new Date(t.replace(' ', 'T') + ':00').getTime();
  // Cada evento bloquea su tramo más el aseo a cada lado.
  const ocupados = eventos
    .filter((e) => e.inicio_at)
    .map((e) => [ms(e.inicio_at) - aseo * 60000, ms(e.fin_at) + aseo * 60000])
    .filter(([a, b]) => b > ini && a < fin)
    .sort((a, b) => a[0] - b[0]);

  const huecos = [];
  let cursor = ini;
  for (const [a, b] of ocupados) {
    if (a > cursor) huecos.push([cursor, Math.min(a, fin)]);
    cursor = Math.max(cursor, b);
    if (cursor >= fin) break;
  }
  if (cursor < fin) huecos.push([cursor, fin]);

  const comoHora = (t) => {
    const d = new Date(t);
    return hora12(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
  };
  return {
    eventos: delDia,
    minutos_aseo: aseo,
    // El horario de alguno salio del turno, no de una captura: los huecos
    // valen, pero conviene confirmarlos.
    horario_aproximado: hayAproximados,
    huecos: huecos
      .filter(([a, b]) => b - a >= MINIMO_HUECO_MIN * 60000)
      .map(([a, b]) => ({
        de: comoHora(a), a: comoHora(b),
        horas: Math.round((b - a) / 360000) / 10,
        // Cruza la medianoche: hay que decirlo o parece un hueco al revés.
        de_madrugada: new Date(b).getDate() !== new Date(a).getDate(),
      })),
  };
}

/**
 * La ventana que impone el paquete para ese dia de la semana, si la tiene.
 *
 * Vive en paquete_contenido.reglas_horario porque es del paquete, no del tipo
 * de evento: una posada de martes no tiene restriccion y una de sabado si.
 */
function reglaHorarioDelPaquete(db, contenidoId, fecha) {
  if (!contenidoId) return null;
  const fila = db.prepare('SELECT reglas_horario FROM paquete_contenido WHERE id = ?')
    .get(contenidoId);
  if (!fila?.reglas_horario) return null;
  let r;
  try { r = JSON.parse(fila.reglas_horario); } catch { return null; }
  const dow = diaSemana(fecha);
  const v = (r.ventanas ?? []).find((x) => (x.dias ?? []).includes(dow));
  if (v) return { de: v.de, a: v.a, texto: r.fuente ?? null, libre: false };
  // Ese dia no tiene ventana propia. Si el paquete declara que el resto de la
  // semana es LIBRE, esa es su regla y manda igual: la nota de las posadas
  // dice «de lunes a jueves, a cualquier horario: matutino, vespertino y
  // nocturno». Caer en la franja de noche del tipo de evento seria ignorarla,
  // y justo entre semana es cuando el negocio quiere colocarlas.
  if (r.resto === 'libre') return { de: JORNADA[0], a: null, texto: r.fuente ?? null, libre: true };
  return null;
}

/**
 * A qué horas se puede ofrecer un evento de cierta duración, ese día, en ese
 * salón. Aquí es donde se juntan las tres reglas:
 *
 *   1. La DURACIÓN viene del paquete (paquete_contenido.horas_salon).
 *   2. El CIERRE es tope municipal: la última hora de inicio posible es
 *      cierre_maximo menos la duración. Cinco horas contra la 1:00 am dan las
 *      8:00 pm, que es justo la hora que más se repite en los 154 eventos ya
 *      capturados. No es casualidad, es la misma regla.
 *   3. La COSTUMBRE del tipo de evento acota por abajo: unos XV años no
 *      empiezan a las 9 de la mañana aunque el salón esté vacío.
 *
 * Devuelve cada hora posible y si está libre, y cuando no, por qué. Lo que NO
 * hace es decir «no se puede»: el precio no depende de la hora, así que la
 * cotización sigue valiendo aunque esa noche esté tomada.
 */
export function horariosPosibles(db, salonId, fecha, tipoEvento, horas, minutosEstancia = 0, contenidoId = null) {
  const sal = db.prepare('SELECT minutos_aseo m, cierre_maximo c FROM salon WHERE id = ?').get(salonId);
  const aseo = sal?.m ?? 120;
  const cierre = sal?.c ?? '01:00';
  const dur = horas ?? 5;

  const aMin = (h) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
  const deMin = (m) => {
    const d = ((m % 1440) + 1440) % 1440;
    return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`;
  };
  // El cierre cae de madrugada: cuenta como el día siguiente.
  const cierreMin = aMin(cierre) + (aMin(cierre) < 12 * 60 ? 1440 : 0);
  const ultimoInicio = cierreMin - dur * 60;

  const t = tipoEvento
    ? db.prepare('SELECT inicio_min, inicio_max FROM tipo_evento WHERE clave = ?').get(tipoEvento)
    : null;

  // El paquete manda sobre la costumbre del tipo de evento. Las posadas traen
  // su propia regla: «en viernes, sabado y domingo solo de 7:00 am a 5:00 pm».
  // Ofrecerlas de noche esos dias, como se hacia, es justo lo contrario de lo
  // permitido. De lunes a jueves no tienen restriccion propia.
  const regla = reglaHorarioDelPaquete(db, contenidoId, fecha);
  let desde, hasta, fuenteHorario;
  if (regla) {
    desde = aMin(regla.de);
    // Sin tope propio, el limite es el cierre del salon; con ventana, el
    // evento tiene que CABER dentro de ella, no solo empezar.
    hasta = regla.libre ? ultimoInicio : Math.min(aMin(regla.a) - dur * 60, ultimoInicio);
    fuenteHorario = 'paquete';
  } else {
    desde = aMin(t?.inicio_min ?? '08:00');
    hasta = Math.min(aMin(t?.inicio_max ?? '23:00'), ultimoInicio);
    fuenteHorario = t ? 'tipo_evento' : 'jornada';
  }
  if (hasta < desde) return { horarios: [], ultimo_inicio: deMin(ultimoInicio), duracion_horas: dur };

  // Lo que ya está tomado ese día, con el aseo y la estancia previa incluidos.
  const ms = (x) => new Date(x.replace(' ', 'T') + ':00').getTime();
  const ocupados = db.prepare(
    `SELECT c.fecha, c.inicio_at, c.fin_at, c.horario_exacto, c.hora_inicio, c.hora_fin,
            t.nombre AS tipo
       FROM compromiso c LEFT JOIN tipo_evento t ON t.id = c.tipo_evento_id
      WHERE c.salon_id = ? AND c.fecha BETWEEN date(?, '-1 day') AND date(?, '+1 day')`)
    .all(salonId, fecha, fecha);
  // Solo los de ESTE día bloquean por falta de horario. El barrido trae ±1 día
  // porque un evento de noche termina al día siguiente, pero un evento sin
  // hora del día de al lado no dice nada sobre este: darlo por ocupado dejaba
  // días enteros invendibles sin tener ahí ningún evento.
  // Ahora solo bloquea el dia entero lo que no tiene NI turno. Un evento que
  // solo dice «Noche» ya ocupa su ventana (7 pm a 1 am) y deja libre el dia.
  const sinHora = ocupados.some((o) => o.fecha === fecha && !o.inicio_at);
  // Los acotados por turno se marcan aparte: el hueco existe, pero conviene
  // confirmarlo con la encargada antes de prometerlo.
  const aproximados = ocupados.filter((o) => o.fecha === fecha && o.inicio_at && !o.horario_exacto);

  const base = new Date(`${fecha}T00:00:00`).getTime();
  const cabe = (m) => {
    // El cliente entra media hora antes: el salón se ocupa desde ahí.
    const arranca = base + (m - minutosEstancia) * 60000;
    const termina = base + (m + dur * 60) * 60000;
    if (sinHora) return { tipo: null };
    return ocupados.find((o) =>
      o.inicio_at && arranca < ms(o.fin_at) + aseo * 60000 && ms(o.inicio_at) < termina + aseo * 60000);
  };
  const fila = (m) => {
    const choca = cabe(m);
    return {
      de: hora12(deMin(m)),
      a: hora12(deMin(m + dur * 60)),
      libre: !choca,
      ocupado_por: choca ? (choca.tipo ?? 'otro evento') : null,
      choca_con: choca?.hora_inicio ? `${choca.hora_inicio}–${choca.hora_fin}` : null,
    };
  };

  const horarios = [];
  // De media en media hora: es como se captura y como se ofrece.
  for (let m = desde; m <= hasta; m += 30) horarios.push(fila(m));

  // Y lo que cabe FUERA de la hora acostumbrada. No se ofrece solo, pero el
  // vendedor tiene que poder verlo: «a las 8 no, pero de 11 a 4 el salón está
  // libre» es una venta, y decir «no se puede» es perderla.
  const alternativos = [];
  for (let m = aMin(JORNADA[0]); m <= ultimoInicio; m += 60) {
    if (m >= desde && m <= hasta) continue;
    if (!cabe(m)) alternativos.push(fila(m));
  }

  return {
    horarios,
    // Solo los extremos: una lista de doce horas no la lee nadie.
    alternativos: alternativos.length
      ? { desde: alternativos[0].de, hasta: alternativos[alternativos.length - 1].de,
          cuantos: alternativos.length, ejemplos: alternativos.slice(0, 3) }
      : null,
    duracion_horas: dur,
    minutos_estancia: minutosEstancia,
    ultimo_inicio: hora12(deMin(ultimoInicio)),
    cierre_maximo: hora12(cierre),
    franja_tipica: regla
      ? [hora12(regla.de), regla.libre ? hora12(cierre) : hora12(regla.a)]
      : (t ? [hora12(t.inicio_min), hora12(t.inicio_max)] : null),
    // De donde sale la franja: del paquete (regla propia) o de la costumbre
    // del tipo de evento. La pantalla lo explica distinto en cada caso.
    fuente_horario: fuenteHorario,
    regla_paquete: regla ? regla.texto : null,
    horario_libre: !!regla?.libre,
    // Sin horario en algún evento del día no se puede calcular nada.
    sin_horario: sinHora,
    // Hay eventos cuyo horario se dedujo del turno, no se capturo: los huecos
    // de ese dia son buenos pero no firmes.
    horario_aproximado: aproximados.length > 0,
    aproximados: aproximados.map((o) => ({ tipo: o.tipo, turno_ventana: [o.inicio_at.slice(11), o.fin_at.slice(11)] })),
  };
}

// ────────────────────── cambio de fecha ────────────────────────

/**
 * Lo que cuesta mover un evento de fecha.
 *
 * La escala estaba en la politica 9 como parrafo, o sea como algo que alguien
 * tenia que recordar y calcular a mano. Son numeros: aqui se calculan.
 *
 *   mas de 18 meses  ->  sin costo
 *   12 a 18 meses    ->  $5,000
 *   6 a 12 meses     ->  $10,000
 *   menos de 6 meses ->  $15,000
 *
 * Y si el cambio cruza de año se agrega otro cargo. La politica dice «$5,000
 * o hasta $10,000 dependiendo del paquete contratado» sin decir de que
 * depende, asi que eso NO se calcula: se devuelve el rango y se manda a
 * confirmar con la encargada. Inventar el numero seria peor que no darlo.
 */
export const ESCALA_CAMBIO_FECHA = [
  { desde: 18, hasta: null, costo: 0,     texto: 'falta mas de 18 meses' },
  { desde: 12, hasta: 18,   costo: 5000,  texto: 'faltan de 12 a 18 meses' },
  { desde: 6,  hasta: 12,   costo: 10000, texto: 'faltan de 6 a 12 meses' },
  { desde: 0,  hasta: 6,    costo: 15000, texto: 'falta menos de 6 meses' },
];
export const EXTRA_CAMBIO_DE_ANIO = [5000, 10000];

export function costoCambioFecha({ fechaOriginal, fechaNueva, hoy }) {
  const HOY = hoy ?? hoyMonterrey();
  if (!esFechaValida(fechaOriginal) || !esFechaValida(fechaNueva)) {
    return { error: 'fechas invalidas' };
  }
  if (fechaOriginal === fechaNueva) return { sin_cambio: true, costo: 0 };

  // La escala mide cuanto falta para la fecha ORIGINAL, contada desde hoy.
  // Confirmado por el Lic. Barron: lo que se cobra depende de con cuanta
  // anticipacion avisa el cliente que quiere mover, no de a donde lo mueve.
  // Asi, mover un evento de la semana que viene cuesta lo mismo lo lleve a
  // marzo o a diciembre.
  const meses = mesesEntre(HOY, fechaOriginal);
  const tramo = ESCALA_CAMBIO_FECHA.find(
    (t) => meses >= t.desde && (t.hasta === null || meses < t.hasta));

  const anioViejo = Number(fechaOriginal.slice(0, 4));
  const anioNuevo = Number(fechaNueva.slice(0, 4));
  const cruzaAnio = anioViejo !== anioNuevo;

  return {
    meses_para_el_evento: meses,
    tramo: tramo?.texto ?? null,
    costo: tramo?.costo ?? 0,
    cruza_anio: cruzaAnio,
    // Rango, no numero: la politica no dice de que paquete depende.
    extra_anio: cruzaAnio ? EXTRA_CAMBIO_DE_ANIO : null,
    total_min: (tramo?.costo ?? 0) + (cruzaAnio ? EXTRA_CAMBIO_DE_ANIO[0] : 0),
    total_max: (tramo?.costo ?? 0) + (cruzaAnio ? EXTRA_CAMBIO_DE_ANIO[1] : 0),
    hay_que_confirmar: cruzaAnio,
    detalle: `Mover del ${fechaOriginal} al ${fechaNueva}: ${tramo?.texto ?? 'sin tramo'}` +
             `, ${tramo?.costo ? '$' + tramo.costo.toLocaleString('es-MX') : 'sin costo'}.` +
             (cruzaAnio
               ? ` Ademas cambia de ${anioViejo} a ${anioNuevo}, lo que agrega entre ` +
                 `$5,000 y $10,000 segun el paquete: confirmalo con la encargada.`
               : ''),
  };
}

// ───────────────────────────── cotización ───────────────────────────────────

/**
 * Resuelve precio y disponibilidad juntos. Separarlos es lo que hace que un
 * cliente que mueve la fecha de sábado a viernes reciba una respuesta falsa:
 * el precio cambia y el salón disponible también, pero no al mismo tiempo.
 */
export function cotizar(db, { salon, tipo_evento, fecha_evento, personas, turno = 'noche', hoy }) {
  const faltan = [];
  if (!tipo_evento) faltan.push('tipo_evento');
  if (!esFechaValida(fecha_evento)) faltan.push('fecha_evento');
  if (!Number.isInteger(personas) || personas <= 0) faltan.push('personas');
  if (faltan.length) {
    return {
      resultado: 'faltan_datos', faltan,
      mensaje_sugerido: 'Para darte el precio exacto necesito la fecha del evento, ' +
                        'cuántos invitados calculas y qué tipo de evento es.',
    };
  }

  const HOY = hoy ?? hoyMonterrey();
  if (fecha_evento < HOY) {
    return { resultado: 'fecha_pasada', hoy: HOY, mensaje_sugerido: 'Esa fecha ya pasó, ¿la confirmamos?' };
  }

  const dow = diaSemana(fecha_evento);
  const col = `precio_${DIAS[dow]}`;
  const meses = mesesEntre(HOY, fecha_evento);
  const anio = partes(fecha_evento)[0];

  const tipoRow = db.prepare('SELECT id, nombre FROM tipo_evento WHERE clave = ?').get(tipo_evento);
  if (!tipoRow) {
    return { resultado: 'tipo_desconocido', tipo_evento };
  }

  const salones = salon
    ? db.prepare('SELECT id, clave, nombre FROM salon WHERE clave = ? AND activo = 1').all(salon)
    : db.prepare('SELECT id, clave, nombre FROM salon WHERE activo = 1 ORDER BY id').all();
  if (!salones.length) return { resultado: 'salon_desconocido', salon };

  // El 1º del mes que entra: es cuando el escalón se mueve, porque la
  // distancia se cuenta por año y mes, no por días.
  const proximo = primeroDelMesQueEntra(HOY);
  // Si para entonces el evento ya pasó, no hay siguiente cotización.
  const mesesProx = proximo <= fecha_evento ? mesesEntre(proximo, fecha_evento) : null;

  const sql = `
    SELECT t.id, t.requiere_revision, t.motivo_revision, t.personas_desde, t.personas_hasta,
           p.fecha_fija,
           p.nombre AS paquete, p.unidad_precio, e.nombre AS escalon,
           t.contenido_id, pc.cortesias, pc.horas_salon, pc.minutos_estancia,
           ${col} AS precio
      FROM tarifa t
      JOIN paquete p              ON p.id = t.paquete_id
      LEFT JOIN paquete_contenido pc ON pc.id = t.contenido_id
      JOIN paquete_tipo_evento pt ON pt.paquete_id = p.id
      LEFT JOIN escalon e         ON e.id = t.escalon_id
     WHERE t.salon_id = ?
       -- Un borrador nunca se cotiza, y un paquete retirado tampoco. Sin esto
       -- un paquete a medio capturar se le ofrecería a un cliente real.
       AND p.borrador = 0 AND p.activo = 1
       AND pt.tipo_evento_id = ?
       AND t.anio = ?
       AND ? BETWEEN t.personas_desde AND t.personas_hasta
       -- Con escalón: tiene que caer dentro de la ventana.
       -- Sin escalón: solo vale si ese paquete no tiene escalera en ese año.
       -- Si la tiene, una fila sin clasificar aplicaría a CUALQUIER anticipación
       -- y ganaría por barata, subcotizando el evento.
       AND (CASE WHEN t.escalon_id IS NOT NULL
                 THEN (? >= e.meses_min AND (e.meses_max IS NULL OR ? <= e.meses_max))
                 ELSE NOT EXISTS (SELECT 1 FROM tarifa t2
                                   WHERE t2.salon_id = t.salon_id
                                     AND t2.paquete_id = t.paquete_id
                                     AND t2.anio = t.anio
                                     AND t2.escalon_id IS NOT NULL
                                     AND t2.vigente_hasta IS NULL)
            END)
       AND t.vigente_hasta IS NULL
       AND ${col} IS NOT NULL
     ORDER BY ${col} ASC`;
  const st = db.prepare(sql);

  const resultados = salones.map((s) => {
    const disp = disponibilidadSalon(db, s.id, fecha_evento, turno);
    let filas = st.all(s.id, tipoRow.id, anio, personas, meses, meses);
    // Fuera los paquetes de fecha fija que no son de ESTE dia. Va ANTES de la
    // comprobacion de abajo: si el filtro deja la lista vacia, la respuesta
    // correcta es «no hay paquete», no reventar buscando el primero.
    filas = filas.filter((f) => aplicaEnLaFecha(f.fecha_fija, fecha_evento));

    if (!filas.length) {
      return {
        salon: s.clave, salon_nombre: s.nombre, disponibilidad: disp.estado,
        cotizacion: 'sin_paquete',
        motivo: `${s.nombre} no tiene tarifa de ${tipoRow.nombre} para ${anio} con ${personas} invitados.`,
        accion: 'derivar_encargada',
      };
    }
    const dudosas = filas.filter((f) => f.requiere_revision);
    const firmes = filas.filter((f) => !f.requiere_revision);

    if (!firmes.length) {
      return {
        salon: s.clave, salon_nombre: s.nombre, disponibilidad: disp.estado,
        cotizacion: 'requiere_confirmacion',
        motivo: dudosas[0]?.motivo_revision ?? 'Hay tarifas que necesitan revisión.',
        accion: 'derivar_encargada',
      };
    }
    const opciones = firmes.map((f) => ({
      paquete: f.paquete,
      unidad: f.unidad_precio,
      precio: f.precio,
      total: f.unidad_precio === 'por_persona' ? Math.round(f.precio * personas) : f.precio,
      tramo_personas: `${f.personas_desde}-${f.personas_hasta}`,
      escalon: f.escalon ?? 'aplica todo el año',
      // Las cortesías van siempre: en las conversaciones reales el equipo
      // las menciona en todas las cotizaciones.
      cortesias: f.cortesias ?? null,
      contenido_id: f.contenido_id,
      // La duración es del paquete, y es lo que decide a qué hora puede
      // empezar el evento: no es lo mismo ofrecer 4 horas que 5.
      horas_salon: f.horas_salon ?? 5,
      minutos_estancia: f.minutos_estancia ?? 0,
    })).sort((a, b) => a.total - b.total);

    // El orden de venta manda siempre: Plata primero, aunque no sea el mas
    // barato. Antes esto solo pasaba a 6 meses o mas, pero en Quetzal los
    // paquetes no tienen escalera y ahi tambien debe aplicar.
    ordenarParaVender(opciones);

    // El Bronce con recargo, en cambio, SOLO existe a 6 meses o mas: es el
    // relleno de un hueco del catalogo, no una regla de orden.
    if (meses >= LARGO_PLAZO_MESES) bronceConRecargo(db, opciones, {
      salonId: s.id, tipoEventoId: tipoRow.id, anio, personas, col,
    });

    // La lámina de cada paquete en este salón, para que el agente la mande
    // junto con el precio. Se adjunta DESPUÉS de armar las opciones para que
    // también la lleven las que agrega bronceConRecargo.
    //
    // Va como lista y no como una sola URL porque un paquete puede tener
    // varias: «Baby Shower, Despedidas de Soltera y Bautizos» es uno solo en
    // precio y contenido, pero el arte lo parte en tres. Cuál de las tres toca
    // lo decide quien sabe qué pidió el cliente, no la cotización.
    const laminas = {};
    for (const r of db.prepare(
      `SELECT p.nombre, i.etiqueta, i.url
         FROM paquete_imagen i JOIN paquete p ON p.id = i.paquete_id
        WHERE i.salon_id = ?`).all(s.id)) {
      (laminas[r.nombre] ??= []).push({ etiqueta: r.etiqueta, url: r.url });
    }
    for (const o of opciones) o.imagenes = laminas[o.paquete] ?? [];

    // ¿Y si el cliente se tarda en decidir? El escalón se mueve con el
    // calendario, así que la misma consulta el mes que entra puede dar otro
    // precio. Se calcula en vez de suponerlo: en 2026 no hay escalera en
    // ninguna tarifa y avisar de un cambio que no va a pasar es mentir.
    let cambio = null;
    if (mesesProx !== null) {
      const luegoTodos = st.all(s.id, tipoRow.id, anio, personas, mesesProx, mesesProx)
        .filter((f) => !f.requiere_revision)
        .map((f) => ({
          paquete: f.paquete,
          total: f.unidad_precio === 'por_persona' ? Math.round(f.precio * personas) : f.precio,
          escalon: f.escalon,
        }));
      // Hay que comparar EL MISMO paquete, no el mas barato de cada mes.
      // Antes se tomaba el mas barato de los dos lados y, desde que el orden
      // de venta pone al Plata primero, eso comparaba el Plata de hoy contra
      // el Bronce del mes que entra: inventaba bajadas de $34,000.
      const recomendado = opciones[0];
      const luego = luegoTodos.find((x) => x.paquete === recomendado.paquete);
      if (luego && luego.total !== recomendado.total) {
        cambio = {
          desde: primeroDelMesQueEntra(HOY),
          total: luego.total,
          paquete: luego.paquete,
          escalon: luego.escalon,
          diferencia: luego.total - recomendado.total,
          // Aquí el precio BAJA al acercarse la fecha: es un descuento por
          // urgencia, no un recargo. Decirlo al revés empuja a vender mal.
          sube: luego.total > recomendado.total,
        };
      }
    }

    // Los horarios se calculan con la duración del paquete recomendado, que
    // es el que se va a ofrecer. El precio NO depende de la hora: por eso la
    // cotización vale aunque esa noche esté tomada, y lo que cambia es a qué
    // hora se puede. Antes esto devolvía «no se puede» y se perdía la venta.
    const rec = opciones[0];
    const horario = horariosPosibles(
      db, s.id, fecha_evento, tipo_evento, rec.horas_salon, rec.minutos_estancia,
      rec.contenido_id);
    const libres = horario.horarios.filter((h) => h.libre);

    return {
      salon: s.clave, salon_nombre: s.nombre,
      disponibilidad: disp.estado,
      disponibilidad_detalle: disp,
      cotizacion: 'ok',
      // Por omision, el mas economico primero, como pide la hoja de reglas.
      // PERO a 6 meses o mas manda la instruccion del Lic. Barron: ahi va
      // primero el Plata aunque no sea el mas barato. Ver aplicarLargoPlazo.
      recomendado: rec,
      opciones,
      hay_dudosas: dudosas.length > 0,
      // Lo que ese paquete no trae y se puede vender aparte, ya con precio.
      se_puede_agregar: sePuedeAgregar(db, rec.contenido_id, personas),
      // null = el precio no se mueve con el calendario para este caso.
      cambio_de_precio: cambio,
      ...horario,
      // Lo que de verdad decide si se puede vender ese día a ese cliente.
      se_puede_ofrecer: libres.length > 0,
      horas_libres: libres.map((h) => h.de),
    };
  });

  // Vendible = hay precio Y queda al menos una hora en que quepa. Mirar solo
  // «la fecha está libre» daba por perdido un día que todavía tenía huecos.
  const vendibles = resultados.filter((r) => r.cotizacion === 'ok' && r.se_puede_ofrecer);

  return {
    resultado: 'ok',
    hoy: HOY,
    fecha: fecha_evento,
    dia_semana: DIA_NOMBRE[dow],
    anio,
    meses_anticipacion: meses,
    turno,
    personas,
    tipo_evento: tipoRow.nombre,
    // El escalón se mueve con el calendario: esta cotización caduca.
    precio_vigente_hasta: finDeMes(HOY),
    salones: resultados,
    vendibles: vendibles.length,
  };
}

/** El 1º del mes siguiente, que es cuando el escalón puede cambiar. */
function primeroDelMesQueEntra(iso) {
  const [y, m] = partes(iso);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/**
 * Reordena para el tramo de 6 meses o mas y agrega el Bronce con recargo.
 *
 * El Bronce no tiene tarifa a esa distancia, asi que se toma la del escalon
 * "3 a 5 meses" y se le suman $10,000. Es el unico precio del sistema que no
 * viene del Excel; va marcado con `recargo` para que quede rastro.
 */
const rango = (p) => {
  const i = ORDEN_LARGO_PLAZO.findIndex((n) => p.includes(n));
  return i === -1 ? ORDEN_LARGO_PLAZO.length : i;
};

/** El orden de venta: Plata, Onix, Bronce, Oro. A igualdad, el mas barato. */
export function ordenarParaVender(opciones) {
  opciones.sort((a, b) => rango(a.paquete) - rango(b.paquete) || a.total - b.total);
}

function bronceConRecargo(db, opciones, { salonId, tipoEventoId, anio, personas, col }) {
  const yaHayBronce = opciones.some((o) => o.paquete.includes('Bronce'));
  if (yaHayBronce) return;

  const base = db.prepare(
    `SELECT t.id, p.nombre AS paquete, p.unidad_precio, t.contenido_id,
            pc.cortesias, pc.horas_salon, pc.minutos_estancia, ${col} AS precio
       FROM tarifa t
       JOIN paquete p              ON p.id = t.paquete_id
       LEFT JOIN paquete_contenido pc ON pc.id = t.contenido_id
       JOIN paquete_tipo_evento pt ON pt.paquete_id = p.id
       JOIN escalon e              ON e.id = t.escalon_id
      WHERE t.salon_id = ? AND pt.tipo_evento_id = ? AND t.anio = ?
        AND ? BETWEEN t.personas_desde AND t.personas_hasta
        AND p.nombre LIKE '%Bronce%'
        AND e.meses_min = 3 AND e.meses_max = 5
        AND t.vigente_hasta IS NULL AND t.requiere_revision = 0
        AND ${col} IS NOT NULL
      ORDER BY ${col} ASC LIMIT 1`).get(salonId, tipoEventoId, anio, personas);
  if (!base) return;

  const unitario = base.unidad_precio === 'por_persona';
  const totalBase = unitario ? Math.round(base.precio * personas) : base.precio;
  opciones.push({
    paquete: base.paquete,
    unidad: base.unidad_precio,
    precio: base.precio,
    total: totalBase + RECARGO_BRONCE_LARGO_PLAZO,
    tramo_personas: null,
    escalon: 'Faltan 6 meses o mas',
    cortesias: base.cortesias ?? null,
    contenido_id: base.contenido_id,
    horas_salon: base.horas_salon ?? 5,
    minutos_estancia: base.minutos_estancia ?? 0,
    // El recargo NO se le explica al cliente: se le cotiza el total. Viaja
    // aparte para que quien vende lo sepa y la pantalla no lo desglose.
    recargo: RECARGO_BRONCE_LARGO_PLAZO,
    _rango: ORDEN_LARGO_PLAZO.findIndex((n) => base.paquete.includes(n)),
    recargo_interno: true,
    motivo_recargo: 'El Bronce no tiene tarifa a 6 meses o mas. Se toma la de ' +
                    '"3 a 5 meses" con $10,000 de recargo, por instruccion del Lic. Barron. ' +
                    'No se le explica al cliente: se le da el total.',
  });
  // El Bronce se agrego al final: hay que volver a ordenar para que quede en
  // su sitio de la escalera, delante del Oro.
  ordenarParaVender(opciones);
  for (const o of opciones) delete o._rango;
}

/**
 * Un paquete de fecha fija solo aplica ese dia del año.
 *
 * «Dia de las Madres» es el 10 de mayo; ofrecerlo para un cumpleaños de marzo
 * no tiene sentido. El margen deja abrir la ventana si algun dia se decide
 * aceptar el fin de semana cercano.
 */
function aplicaEnLaFecha(fechaFija, fechaEvento) {
  if (!fechaFija) return true;                 // el paquete sirve todo el año
  let r;
  try { r = JSON.parse(fechaFija); } catch { return true; }
  const [, m, d] = partes(fechaEvento);
  if (!r.margen_dias) return m === r.mes && d === r.dia;
  // Con margen se compara por distancia en dias dentro del mismo año.
  const anio = partes(fechaEvento)[0];
  const dia = Date.UTC(anio, m - 1, d);
  const fiesta = Date.UTC(anio, r.mes - 1, r.dia);
  return Math.abs(dia - fiesta) <= r.margen_dias * 86400000;
}

/** Último día del mes en curso: hasta ahí el escalón no se mueve. */
function finDeMes(iso) {
  const [y, m] = partes(iso);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`;
}

/**
 * Lo que ese paquete NO trae y se puede vender aparte.
 *
 * Antes «no incluye» solo servia para evitar el reclamo. Cruzado con el
 * catalogo de servicios se vuelve el upsell de esa cotizacion, ya con precio:
 * «el Bronce no trae pista iluminada, se agrega por $4,400».
 *
 * Varios servicios vienen por tramo de invitados, asi que se elige la variante
 * que alcanza para los que vienen. Cuando hay varias opciones sin tramo
 * (tres limusinas, cuatro sorpresas) se da la mas barata como «desde».
 */
export function sePuedeAgregar(db, contenidoId, personas) {
  if (!contenidoId) return [];
  const filas = db.prepare(
    `SELECT k.id AS concepto_id, k.nombre AS concepto,
            s.id AS servicio_id, s.nombre AS servicio, s.precio, s.personas_ref,
            s.es_propio, s.anticipacion_minima
       FROM paquete_contenido_concepto x
       JOIN concepto k          ON k.id = x.concepto_id
       JOIN concepto_servicio cs ON cs.concepto_id = k.id
       JOIN servicio s          ON s.id = cs.servicio_id
      WHERE x.contenido_id = ? AND x.incluido = 0 AND s.activo = 1
      ORDER BY k.nombre, s.precio`).all(contenidoId);

  const porConcepto = new Map();
  for (const f of filas) {
    if (!porConcepto.has(f.concepto_id)) porConcepto.set(f.concepto_id, []);
    porConcepto.get(f.concepto_id).push(f);
  }

  const out = [];
  for (const [, ops] of porConcepto) {
    const conTramo = ops.filter((o) => o.personas_ref !== null);
    let elegido, desde = false;
    if (conTramo.length) {
      // La variante mas chica que alcanza; si nadie alcanza, la mas grande.
      elegido = conTramo.find((o) => o.personas_ref >= personas)
             ?? conTramo[conTramo.length - 1];
    } else {
      elegido = ops[0];
      desde = ops.length > 1;   // varias opciones sin tramo: es un «desde»
    }
    out.push({
      concepto: elegido.concepto,
      servicio: elegido.servicio,
      precio: elegido.precio,
      desde,
      opciones: ops.length,
      es_propio: !!elegido.es_propio,
      anticipacion_minima: elegido.anticipacion_minima,
    });
  }
  return out.sort((a, b) => (a.precio ?? 0) - (b.precio ?? 0));
}

/** Qué incluye y qué no, resuelto por conceptos en vez de por texto libre. */
export function contenido(db, contenidoId) {
  const cab = db.prepare(
    `SELECT c.id, p.nombre AS paquete, s.nombre AS salon, e.nombre AS escalon,
            c.cortesias, c.requiere_revision,
            -- La duración ya no es un concepto de texto: es una columna con la
            -- que se puede calcular a qué hora puede empezar el evento.
            c.horas_salon, c.minutos_estancia
       FROM paquete_contenido c
       JOIN paquete p ON p.id = c.paquete_id
       JOIN salon   s ON s.id = c.salon_id
       LEFT JOIN escalon e ON e.id = c.escalon_id
      WHERE c.id = ?`).get(contenidoId);
  if (!cab) return null;
  const filas = db.prepare(
    `SELECT k.nombre, x.incluido FROM paquete_contenido_concepto x
       JOIN concepto k ON k.id = x.concepto_id
      WHERE x.contenido_id = ? ORDER BY x.incluido DESC, k.nombre`).all(contenidoId);
  return {
    ...cab,
    incluye: filas.filter((f) => f.incluido).map((f) => f.nombre),
    no_incluye: filas.filter((f) => !f.incluido).map((f) => f.nombre),
  };
}

/**
 * Parte la frase de cortesías en las cosas que enumera.
 *
 * Las comas de dentro de un paréntesis no separan: «Presentación Elite
 * (… vals en las nubes, lluvia de mariposas …)» es UNA cortesía, no cuatro.
 * Y la «y» que cierra la enumeración separa igual que una coma, porque así se
 * enumera en español: «la mesa principal y el Aro iluminado» son dos.
 */
export function cortesiasSueltas(texto) {
  const t = String(texto ?? '');
  const partes = [];
  let actual = '', hondo = 0;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '(') hondo++;
    else if (ch === ')') hondo = Math.max(0, hondo - 1);
    if (hondo === 0) {
      if (ch === ',') { partes.push(actual); actual = ''; continue; }
      const m = /^\s+(y|e)\s+/i.exec(t.slice(i));
      if (m) { partes.push(actual); actual = ''; i += m[0].length - 1; continue; }
    }
    actual += ch;
  }
  partes.push(actual);
  return partes
    .map((p) => p.trim().replace(/^(el|la|los|las)\s+/i, '').trim())
    .filter(Boolean);
}
