// A qué etapa del embudo le toca estar a este lead.
//
// Hasta el 6-nov-2026 NADIE movia las etapas: 2.196 de 2.198 leads estaban en
// «Nuevo», incluidos los que ya tenian fecha, invitados, cotizacion y hasta
// extras elegidos. El subflujo de envio declaraba un `status_id` y lo mandaba
// siempre en cero, con un comentario que decia «para no mover ninguna etapa
// por accidente». Se dejo para despues y nunca se retomo.
//
// El resultado es que el tablero no sirve para nada: una conversacion muy
// avanzada se ve igual que la que llego hace un minuto, y con ciento y pico
// al dia el equipo las pierde de vista.
//
// Aqui NO decide el modelo. Decide lo que paso:
//
//   · se sabe el tipo de evento o cuantos invitados  -> Calificando
//   · salio la cotizacion con su hoja de informes    -> Cotizado
//   · hay una cita pedida a la encargada             -> Cita agendada
//
// Lo que NO pone Maya, porque no le toca:
//   · «Fecha apartada ($500)» y «Contratado - pagando» los pone quien cobra.
//   · «Con la encargada» lo decidio Jorge: Maya escala muchas veces al dia y
//     esa columna se llenaria de dudas sueltas, ademas de empujar leads por
//     delante de «Cita agendada».
//   · De «Visitó el salón» en adelante manda la persona, no el sistema.

const ETAPA = {
  entrantes:   { id: 112259467, orden: 10 },
  nuevo:       { id: 112259471, orden: 10 },
  calificando: { id: 112259475, orden: 20 },
  ocupada:     { id: 112259479, orden: 30 },
  cotizado:    { id: 112259483, orden: 40 },
  cita:        { id: 112261039, orden: 50 },
};
// El orden de cada etapa que existe, para no retroceder nunca.
const ORDEN = {
  112259467: 10, 112259471: 10, 112259475: 20, 112259479: 30, 112259483: 40,
  112261039: 50, 112261043: 60, 113813683: 70, 113813431: 80, 112261047: 90,
  112261051: 100, 112261055: 110, 142: 10000, 143: 11000,
};
// A partir de aqui manda una persona: ni se avanza ni se toca.
const DE_AQUI_NO_PASA = 60;

const fl = $('formatLead').first().json;
const p = $('armar_patch').first().json;
const lamina = $('elegir_lamina').first().json;

// ── Qué sabemos ya ──────────────────────────────────────────────────────────
const a = p.anotado ?? {};
const campos = p.campos ?? {};
const hayTipo = Boolean(a.tipo_evento || campos['Tipo de evento']);
const hayInvitados = Boolean(a.invitados || Number(campos['Invitados']));

// Cotizo de verdad: salio al menos una hoja de informes o una foto con el
// mensaje. Es la señal mas dura que hay —la pega el codigo, no el modelo— y
// no depende de como lo haya redactado.
let cotizo = false;
try {
  cotizo = JSON.parse(lamina.imagenes || '[]').filter(Boolean).length > 0;
} catch (e) { cotizo = false; }

// Una cita pedida deja un aviso con `cita_id` en el panel.
let hayCita = Boolean(campos['Fecha y hora de la cita']);
try {
  const crudo = $('traer_avisos').all().map((x) => x.json);
  const lista = crudo.length === 1 && Array.isArray(crudo[0].avisos) ? crudo[0].avisos : crudo;
  if (lista.some((x) => x && String(x.lead_id) === String(fl.lead_id) && x.cita_id)) hayCita = true;
} catch (e) { /* sin avisos, se queda como estaba */ }

// ── A dónde le toca ─────────────────────────────────────────────────────────
let destino = null;
if (hayTipo || hayInvitados) destino = ETAPA.calificando;
if (cotizo) destino = ETAPA.cotizado;
if (hayCita) destino = ETAPA.cita;

const actual = Number(fl.etapa_id) || null;
const ordenActual = ORDEN[actual] ?? 0;

// Solo se avanza. Si vuelve a pedir precio estando en «Cita agendada», no se
// le baja a «Cotizado»: perder un avance real por un mensaje suelto deja el
// tablero peor que no moverlo.
const mover = Boolean(destino)
  && ordenActual < DE_AQUI_NO_PASA
  && destino.orden > ordenActual;

return [{
  json: {
    lead_id: fl.lead_id,
    etapa_actual: actual,
    etapa_destino: destino ? destino.id : null,
    mover,
    // Para poder leer la ejecucion sin deducir nada.
    porque: !destino ? 'todavia no hay nada que diga otra etapa'
      : !mover ? (ordenActual >= DE_AQUI_NO_PASA
          ? 'de aqui en adelante manda una persona'
          : 'ya esta igual o mas adelante')
      : hayCita ? 'hay una cita pedida'
      : cotizo ? 'salio la cotizacion'
      : 'ya se sabe tipo de evento o invitados',
    cuerpo: destino ? { status_id: destino.id } : {},
  },
}];
