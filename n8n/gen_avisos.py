# -*- coding: utf-8 -*-
"""Genera salones_avisos: el que avisa a la encargada y el que insiste.

Un solo flujo para las dos cosas, porque la diferencia entre «primer aviso» y
«recordatorio» es una columna de la fila, no un cronograma aparte. Correr dos
crones contra la misma tabla seria dos formas de equivocarse.
"""
import json, io, uuid, os

CRED_PANEL = {"httpHeaderAuth": {"id": "NmEwnWxyfdqJcNvw", "name": "panel_salones"}}
# OJO: este NO es el bot de los clientes.
#
# Un bot de Telegram admite UN SOLO webhook, y registrarlo revoca el anterior
# sin avisar a nadie. Los avisos salian por `salones_bot`, que es tambien el
# canal de clientes de Kommo; el 20-oct-2026 se le engancho un Telegram
# Trigger para leer las respuestas del grupo y Kommo se quedo 22 horas sin
# recibir un solo mensaje, sin un error en ningun sitio.
#
# Desde entonces los grupos van por un bot propio que NO esta en Kommo y que
# no debe estarlo nunca.
CRED_TG    = {"telegramApi":   {"id": "AY1IgMOTyaZAKGvU", "name": "salones_avisos_bot"}}
PANEL = "http://automatizaciones_salones-panel:4300"
GENERAL = "-5410906335"   # los avisos que no son de ningun salon
# Cada salon tiene el suyo en la columna `telegram_grupo`, que viaja con el
# aviso desde el panel. Se edita alli y no aqui: un grupo que se convierte en
# supergrupo cambia de id solo, y entonces los avisos dejan de entregarse sin
# que nadie se entere.

nodos, con = [], {}


def add(nombre, tipo, ver, params, pos, cred=None, extra=None):
    n = {"parameters": params, "id": str(uuid.uuid4()), "name": nombre,
         "type": tipo, "typeVersion": ver, "position": pos}
    if cred:
        n["credentials"] = cred
    if extra:
        n.update(extra)
    nodos.append(n)
    return nombre


def une(a, b, tipo="main", salida=0):
    con.setdefault(a, {}).setdefault(tipo, [])
    while len(con[a][tipo]) <= salida:
        con[a][tipo].append([])
    con[a][tipo][salida].append({"node": b, "type": tipo, "index": 0})


# Cada 5 minutos y no cada 30: el PRIMER aviso sale a cualquier hora y no debe
# esperar media hora. Los recordatorios se espacian solos, mirando cuando se
# aviso por ultima vez.
add("cada_5_min", "n8n-nodes-base.scheduleTrigger", 1.2,
    {"rule": {"interval": [{"field": "cronExpression", "expression": "*/5 * * * *"}]}},
    [-400, 0])

add("traer_pendientes", "n8n-nodes-base.httpRequest", 4.2,
    {"url": PANEL + "/api/avisos?estado=pendiente",
     "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
     "options": {"response": {"response": {"responseFormat": "json"}}}},
    [-200, 0], cred=CRED_PANEL)

DECIDIR = r'''// Cuales toca avisar ahora, y con que texto.
//
// El primer aviso sale a CUALQUIER hora: el Lic. dijo que si entra algo a las
// 2 de la madrugada quiere verlo. Los recordatorios, en cambio, solo en
// horario laboral — a nadie se le pica costillas mientras duerme.
//
// Miercoles a lunes de 12 a 20. El martes cierran, asi que ese dia no se
// insiste ni una vez.
//
// Y la espera CRECE. Al principio no habia techo: un aviso que nadie atendio
// llego a 71 recordatorios en cuatro dias, el mismo texto cada media hora. Eso
// ya no es insistir, es ruido — y lo que se gasta es la atencion al resto: un
// grupo que repite lo mismo 71 veces se deja de mirar, y el aviso bueno se
// pierde entre los malos.
//
// Las primeras dos horas cada media, que es cuando de verdad se puede
// reaccionar. El resto del dia cada dos. De ahi en adelante, una vez al dia,
// para que no desaparezca: sigue habiendo alguien esperando.
function esperaMin(veces) {
  if (veces < 4) return 30;
  if (veces < 10) return 120;
  return 1440;
}

const ahora = $now;                 // ya viene en la zona del flujo (Monterrey)
const laboral = ahora.weekday !== 2 && ahora.hour >= 12 && ahora.hour < 20;

const MOTIVO = {
  sin_dato: 'Falta un dato',
  cita: 'Quiere agendar una visita',
  disponibilidad: 'Pregunta por disponibilidad',
  apartado: 'Quiere apartar la fecha',
  descuento: 'Pide descuento',
  contratar: 'Quiere contratar',
  queja: 'Se queja o reclama',
  humano: 'Pide hablar con una persona',
  // Nace con Semana Santa: el cliente duda por la fecha y el asesor
  // tiene margen para mejorarle la oferta. No es un problema, es una
  // venta que todavia se puede cerrar.
  oportunidad: 'Se puede mejorar la oferta',
};

const minutosDesde = (iso) => {
  if (!iso) return null;
  const t = Date.parse(iso.replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 60000) : null;
};

const enPalabras = (min) => {
  if (min === null) return '';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ${min % 60} min` : `${Math.floor(h / 24)} d`;
};

// El grupo de los avisos que no son de ningun salon.
const GENERAL = '__GENERAL__';

const salida = [];
for (const a of ($input.first().json.avisos ?? [])) {
  const primero = !a.ultimo_aviso_en;
  const desdeUltimo = minutosDesde(a.ultimo_aviso_en);

  if (!primero) {
    if (!laboral) continue;
    if (desdeUltimo === null || desdeUltimo < esperaMin(Number(a.recordatorios ?? 0))) continue;
  }

  const espera = enPalabras(minutosDesde(a.creado_en));
  const encabezado = primero
    ? `🔔 *${MOTIVO[a.motivo] ?? a.motivo}*`
    : `⏰ *Sigue pendiente* — ${MOTIVO[a.motivo] ?? a.motivo}`;

  const lineas = [
    encabezado,
    a.salon_nombre ? `_${a.salon_nombre}_${a.encargada ? ' · ' + a.encargada : ''}` : null,
    '',
    a.texto,
    '',
    primero ? null : `La clienta lleva ${espera} esperando.`,
    // Pasado un dia sin que nadie lo toque, lo probable es que ya no aplique
    // —la conversacion siguio, o se atendio por fuera— y nadie se acuerda de
    // cerrarlo. Decir COMO se cierra es lo unico que rompe el bucle.
    Number(a.recordatorios ?? 0) >= 10
      ? 'Van ' + a.recordatorios + ' recordatorios. Si ya se atendio o ya no aplica, '
        + 'cierralo en el panel con «Ya lo atendi» y deja de aparecer.'
      : null,
    a.lead_id
      ? `https://administracioneventos6.kommo.com/leads/detail/${a.lead_id}`
      : null,
  ].filter((x) => x !== null);

  // Cada aviso sale por el grupo de SU salon. El general queda de red: un
  // aviso puede no tener salon —el cliente escribio algo que hay que escalar
  // antes de decir a cual va— y sin destino no lo veria nadie. Un aviso que no
  // aparece en ninguna pantalla es un cliente esperando en el vacio.
  salida.push({ json: {
    id: a.id,
    primero,
    grupo: a.grupo || GENERAL,
    sin_grupo_propio: !a.grupo,
    texto: lineas.join('\n'),
  } });
}

return salida;'''

add("a_quien_toca", "n8n-nodes-base.code", 2,
    {"jsCode": DECIDIR.replace("__GENERAL__", GENERAL)}, [0, 0])

add("mandar_al_grupo", "n8n-nodes-base.telegram", 1.2,
    {"chatId": "={{ $json.grupo }}",
     "text": "={{ $json.texto }}",
     "additionalFields": {"parse_mode": "Markdown",
                          "appendAttribution": False}},
    [200, 0], cred=CRED_TG,
    # Que un aviso no salga no puede tumbar la tanda entera: los demas tienen
    # que seguir. Por eso continua -- pero el que fallo NO se marca, de eso se
    # encarga el nodo de abajo.
    extra={"onError": "continueRegularOutput"})

# El seguro. Sin esto, un fallo de Telegram marcaba el aviso como entregado y
# la clienta quedaba esperando sin que nadie volviera a verlo: el peor final
# posible, porque el tablero lo da por hecho. Telegram contesta ok=true cuando
# de verdad entrego; cuando falla, el item trae `error` y no trae `ok`.
add("se_entrego", "n8n-nodes-base.if", 2.2,
    {"conditions": {"options": {"version": 2, "caseSensitive": True,
                                "typeValidation": "loose"},
                    "combinator": "and",
                    "conditions": [{"id": "ok",
                                    "operator": {"type": "boolean", "operation": "true", "singleValue": True},
                                    "leftValue": "={{ $json.ok }}", "rightValue": ""}]},
     "options": {}},
    [300, 0])

add("marcar_avisado", "n8n-nodes-base.httpRequest", 4.2,
    {"method": "PUT", "url": PANEL + "/api/avisos",
     "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
     "sendBody": True, "specifyBody": "json",
     # Se guarda el message_id que devolvio Telegram. Es lo que permite
     # reconocer, mas tarde, a QUE aviso esta contestando quien usa
     # «Responder a este mensaje» en el grupo. El chat_id va tambien porque el
     # message_id es unico dentro de un chat, no entre chats: cuando cada
     # salon tenga su grupo, el 923 de Norma y el 923 de Esmeralda serian el
     # mismo numero apuntando a dos leads distintos.
     "jsonBody": ("={{ JSON.stringify({ id: $('a_quien_toca').item.json.id,"
                  " recordado: true,"
                  " telegram_chat_id: $('mandar_al_grupo').item.json.result?.chat?.id,"
                  " telegram_message_id: $('mandar_al_grupo').item.json.result?.message_id"
                  " }) }}"),
     "options": {"response": {"response": {"responseFormat": "json"}}}},
    [460, 0], cred=CRED_PANEL)

une("cada_5_min", "traer_pendientes")
une("traer_pendientes", "a_quien_toca")
une("a_quien_toca", "mandar_al_grupo")
une("mandar_al_grupo", "se_entrego")
# Solo la salida verdadera. La falsa no va a ningun lado a proposito: el
# aviso se queda pendiente y vuelve a intentarse en la siguiente vuelta.
une("se_entrego", "marcar_avisado", salida=0)

DESTINO = r"C:\Users\johan\Desktop\WEB\salones_agustin\n8n"
ruta = os.path.join(DESTINO, "salones_avisos.json")
io.open(ruta, "w", encoding="utf-8").write(json.dumps({
    "name": "salones_avisos",
    "nodes": nodos,
    "connections": con,
    # Sin zona horaria el cron correria en UTC y el «horario laboral» caeria
    # seis horas corrido.
    "settings": {"executionOrder": "v1", "timezone": "America/Monterrey"},
}, ensure_ascii=False, indent=2))
print("salones_avisos ->", len(nodos), "nodos")
