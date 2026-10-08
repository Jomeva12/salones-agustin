# -*- coding: utf-8 -*-
"""Genera salones_avisos: el que avisa a la encargada y el que insiste.

Un solo flujo para las dos cosas, porque la diferencia entre «primer aviso» y
«recordatorio» es una columna de la fila, no un cronograma aparte. Correr dos
crones contra la misma tabla seria dos formas de equivocarse.
"""
import json, io, uuid, os

CRED_PANEL = {"httpHeaderAuth": {"id": "NmEwnWxyfdqJcNvw", "name": "panel_salones"}}
CRED_TG    = {"telegramApi":   {"id": "GDSbyhs4W4QvYa4P", "name": "salones_bot"}}
PANEL = "http://automatizaciones_salones-panel:4300"
GRUPO = "-5410906335"   # por ahora uno solo; el Lic. tiene cuatro oficinas

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
const RECORDAR_CADA_MIN = 30;

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

const salida = [];
for (const a of ($input.first().json.avisos ?? [])) {
  const primero = !a.ultimo_aviso_en;
  const desdeUltimo = minutosDesde(a.ultimo_aviso_en);

  if (!primero) {
    if (!laboral) continue;
    if (desdeUltimo === null || desdeUltimo < RECORDAR_CADA_MIN) continue;
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
    a.lead_id
      ? `https://administracioneventos6.kommo.com/leads/detail/${a.lead_id}`
      : null,
  ].filter((x) => x !== null);

  salida.push({ json: { id: a.id, primero, texto: lineas.join('\n') } });
}

return salida;'''

add("a_quien_toca", "n8n-nodes-base.code", 2, {"jsCode": DECIDIR}, [0, 0])

add("mandar_al_grupo", "n8n-nodes-base.telegram", 1.2,
    {"chatId": GRUPO,
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
     "jsonBody": "={{ JSON.stringify({ id: $('a_quien_toca').item.json.id, recordado: true }) }}",
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
