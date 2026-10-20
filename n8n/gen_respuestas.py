# -*- coding: utf-8 -*-
"""Genera salones_respuestas: la encargada contesta en el grupo y Maya se lo
dice al cliente.

Lo pidio el Lic. Barron el 20-oct-2026. Hasta hoy el grupo era de una sola
direccion: Maya avisaba y alguien tenia que abrir Kommo para contestarle al
cliente. Con esto, responder al aviso en Telegram basta.

La pieza que lo hace posible la regala Telegram. Un bot en un grupo, por
privacidad, NO recibe la conversacion: recibe los comandos, las menciones y
las RESPUESTAS A SUS PROPIOS MENSAJES. Y eso es justo el gesto que el Lic.
queria hacer. Dos consecuencias buenas:

  - No hay que abrirle el grupo al bot. Lee lo que se le contesta y nada mas.
  - No puede confundir un comentario suelto con una respuesta, porque los
    comentarios sueltos no le llegan.

El amarre es `reply_to_message.message_id` contra el `message_id` que se
guardo al publicar el aviso. Sin adivinar de que cliente se hablaba.
"""
import json, io, uuid, os

CRED_PANEL = {"httpHeaderAuth": {"id": "NmEwnWxyfdqJcNvw", "name": "panel_salones"}}
CRED_TG    = {"telegramApi":    {"id": "GDSbyhs4W4QvYa4P", "name": "salones_bot"}}
CRED_AI    = {"openAiApi":      {"id": "aLFrGO9FtcPzpgXL", "name": "INCAD"}}
CRED_PG    = {"postgres":       {"id": "NaGMrunSEarhp4cc", "name": "postgres_salones"}}
PANEL = "http://automatizaciones_salones-panel:4300"
ENVIAR = "znqsX6lvLCqIQ2LB"   # enviar_mensaje_salones

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


def booleana(ident, expr, valor=True):
    return {"id": ident,
            "operator": {"type": "boolean",
                         "operation": "true" if valor else "false",
                         "singleValue": True},
            "leftValue": expr, "rightValue": ""}


def condiciones(*conds):
    return {"options": {"version": 2, "caseSensitive": True, "typeValidation": "loose"},
            "combinator": "and", "conditions": list(conds)}


add("escuchar_grupo", "n8n-nodes-base.telegramTrigger", 1.2,
    {"updates": ["message"], "additionalFields": {}},
    [-760, 0], cred=CRED_TG)

LEER = r'''// Lo unico que interesa de lo que llega: a que mensaje contestaron.
//
// El bot solo recibe respuestas a sus propios mensajes (por la privacidad de
// Telegram), pero tambien le llegan comandos y mensajes de servicio —alguien
// entra al grupo, se cambia el titulo—. Nada de eso trae reply_to_message, y
// aqui se descarta sin ruido.
const m = $json.message ?? $json;
const re = m.reply_to_message;

// Quien contesta. Telegram no siempre manda apellido, y el usuario puede no
// tener @, asi que se arma con lo que haya antes de caer en «alguien».
const q = m.from ?? {};
const quien = [q.first_name, q.last_name].filter(Boolean).join(' ')
  || (q.username ? '@' + q.username : '')
  || 'alguien del grupo';

return [{
  json: {
    es_respuesta: Boolean(re && (m.text ?? '').trim()),
    chat_id: String(m.chat?.id ?? ''),
    // A QUE mensaje contesto: esta es la llave que identifica el aviso.
    mensaje_respondido: re?.message_id ?? null,
    // El id de SU mensaje, para colgarle el acuse debajo.
    mi_mensaje: m.message_id ?? null,
    texto: (m.text ?? '').trim(),
    quien,
    // El propio bot responde en el grupo (el acuse). Sin esto se contestaria
    // a si mismo en bucle.
    del_bot: Boolean(q.is_bot),
  },
}];'''
add("leer_respuesta", "n8n-nodes-base.code", 2, {"jsCode": LEER}, [-560, 0])

add("es_respuesta", "n8n-nodes-base.if", 2.2,
    {"conditions": condiciones(booleana("resp", "={{ $json.es_respuesta }}", True),
                               booleana("nobot", "={{ $json.del_bot }}", False)),
     "options": {}},
    [-360, 0])

# La salida falsa no va a ningun lado a proposito: en un grupo se habla de
# muchas cosas, y lo que no es una respuesta a un aviso no es asunto de este
# flujo.
add("buscar_aviso", "n8n-nodes-base.httpRequest", 4.2,
    {"url": ("=" + PANEL + "/api/avisos/por-mensaje?chat={{ $json.chat_id }}"
             "&mensaje={{ $json.mensaje_respondido }}"),
     "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
     "options": {"response": {"response": {"responseFormat": "json"}}}},
    [-160, 0], cred=CRED_PANEL)

add("era_un_aviso", "n8n-nodes-base.if", 2.2,
    {"conditions": condiciones(booleana("enc", "={{ $json.encontrado }}", True)),
     "options": {}},
    [40, 0])

# El contexto se arma con codigo y no dentro de la expresion del agente: un
# ternario con concatenacion dentro de {{ }} ya tumbo un agente de este
# proyecto con «invalid syntax», y eso tarda en verse porque solo revienta
# cuando alguien escribe.
CONTEXTO = r'''// Lo que el redactor necesita saber, en texto plano.
const a = $json.aviso;
const r = $('leer_respuesta').first().json;

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// El dia de la semana se calcula, no se le pregunta al modelo: el Lic. pidio
// que toda fecha venga con su dia, y un modelo haciendo calendario se
// equivoca. Se parte la cadena a mano porque new Date('2027-03-03') se
// interpreta en UTC y en Monterrey cae el dia anterior.
function enLetras(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso ?? '')) return iso ?? '';
  const [y, m, d] = iso.split('-').map(Number);
  const f = new Date(Date.UTC(y, m - 1, d));
  return `${DIAS[f.getUTCDay()]} ${d} de ${MESES[m - 1]} de ${y}`;
}

// La hora en 12 h y con franja: es como habla la gente aqui, y como habla
// Maya.
function enPalabras(hhmm) {
  const p = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!p) return hhmm ?? '';
  const h = Number(p[1]), min = p[2];
  const doce = h % 12 === 0 ? 12 : h % 12;
  const franja = h < 12 ? 'de la mañana' : (h < 19 ? 'de la tarde' : 'de la noche');
  return `${doce}${min === '00' ? '' : ':' + min} ${franja}`;
}

const lineas = [`Lo que le preguntaste al salón: ${a.texto}`];
lineas.push(`Motivo: ${a.motivo}`);
if (a.salon_nombre) lineas.push(`Salón: ${a.salon_nombre}`);
if (a.cita_fecha) {
  lineas.push(`La visita de la que se habla: ${enLetras(a.cita_fecha)}`
    + (a.cita_hora ? ` a las ${enPalabras(a.cita_hora)}` : ' (sin hora)')
    + ` — estado: ${a.cita_estado ?? 'solicitada'}`);
}
// Un aviso ya atendido no se oculta: quien contesta tarde merece que su
// respuesta llegue igual, pero Maya tiene que saber que puede estar
// repitiendole algo al cliente.
if ($json.ya_atendido) {
  lineas.push('OJO: este aviso ya estaba marcado como atendido. Puede que al '
    + 'cliente ya se le haya dicho algo parecido.');
}

return [{
  json: {
    aviso_id: a.id,
    lead_id: a.lead_id,
    chat_id: r.chat_id,
    mi_mensaje: r.mi_mensaje,
    quien: r.quien,
    respuesta: r.texto,
    contexto: lineas.join('\n'),
  },
}];'''
add("armar_contexto", "n8n-nodes-base.code", 2, {"jsCode": CONTEXTO}, [240, -100])

REDACTOR = """Eres Maya, la asistente de los Salones Agustin Barron. Le pediste un dato al salon por el grupo interno y acaban de contestarte. Tu trabajo ahora es pasarle eso al cliente por WhatsApp.

LO QUE NO PUEDES HACER, y es lo unico que importa de verdad:

**No anadas ni un dato que no te hayan dado.** Ni una hora, ni un precio, ni una condicion, ni un «ademas». Si la respuesta es escueta, tu mensaje es escueto. Inventar aqui es peor que en cualquier otro sitio: el cliente lo va a leer como una confirmacion del salon, y si no coincide con lo que la encargada tiene apuntado, alguien se presenta un dia que no es.

**No confirmes lo que no te confirmaron.** «Lo estamos viendo» no es «esta listo». Si la respuesta es ambigua, o no contesta a lo que preguntaste, dilo tal cual: que te estan revisando el dato y en cuanto lo tengas se lo pasas.

Si puedes —y debes— escribirlo como hablas tu: calida, de aqui, sin formalismos. La encargada escribe en taquigrafia («si jueves 4 ok») y el cliente no tiene por que leer eso.

Cuando des una fecha, **di el dia de la semana**: «el jueves 23 de octubre». Si en el contexto te viene ya calculada, usala como viene; no la recalcules tu.

A veces lo que llega del grupo NO es una respuesta: es una pregunta de vuelta («¿para cuantos era?», «¿que salon?»). Entonces no le escribes al cliente: contestas tu en el grupo con lo que sabes, y el pendiente sigue abierto.

Responde SIEMPRE con este JSON y nada mas, sin cercos de codigo:

{"tipo": "respuesta", "al_cliente": "el mensaje para el cliente"}

o bien

{"tipo": "pregunta", "al_grupo": "lo que le contestas al salon"}

o bien, si no sabes que hacer con lo que llego:

{"tipo": "ninguno", "al_grupo": "por que no lo pasaste"}"""

add("redactar", "@n8n/n8n-nodes-langchain.agent", 3.1,
    {"promptType": "define",
     "text": ("=Contexto:\n{{ $json.contexto }}\n\n"
              "Lo que acaba de escribir {{ $json.quien }} en el grupo:\n"
              "{{ $json.respuesta }}"),
     "options": {"systemMessage": REDACTOR}},
    [440, -100])

add("modelo_redactor", "@n8n/n8n-nodes-langchain.lmChatOpenAi", 1.3,
    {"model": {"__rl": True, "value": "gpt-4.1-mini", "mode": "list",
               "cachedResultName": "gpt-4.1-mini"}, "options": {}},
    [440, 80], cred=CRED_AI)

# Sin memoria a proposito. La memoria de ventas es la conversacion con el
# CLIENTE; meter ahi el «si jueves 4 ok» de la encargada como si fuera un
# turno del cliente dejaria a Maya creyendo que el cliente dijo eso. Lo que si
# se hace, mas abajo, es anotar en esa memoria lo que Maya acabo diciendo.

LEER_JSON = r'''// El modelo devuelve JSON, pero no siempre limpio: a veces lo envuelve en
// cercos de codigo y a veces le cuelga una frase delante. Esto no es
// desconfianza gratuita: pasa.
const bruto = String($json.output ?? '').trim();

function leer(t) {
  const sinCercos = t.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(sinCercos); } catch (e) { /* se intenta recortar */ }
  const a = sinCercos.indexOf('{'), b = sinCercos.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(sinCercos.slice(a, b + 1)); } catch (e) { /* nada */ }
  }
  return null;
}

const o = leer(bruto);
const ctx = $('armar_contexto').first().json;

// Si no se pudo leer el JSON, NO se le escribe al cliente a ciegas. Se avisa
// en el grupo y el pendiente se queda abierto: es lo unico honesto, porque
// aqui no sabemos si lo que el modelo queria decir era una confirmacion.
if (!o || !o.tipo) {
  return [{ json: { ...ctx, tipo: 'ninguno',
    al_grupo: 'No supe interpretar esa respuesta. ¿Me la puedes escribir de otra forma? '
              + 'El pendiente sigue abierto.' } }];
}

const alCliente = String(o.al_cliente ?? '').trim();
if (o.tipo === 'respuesta' && !alCliente) {
  return [{ json: { ...ctx, tipo: 'ninguno',
    al_grupo: 'No me quedó claro qué decirle al cliente. El pendiente sigue abierto.' } }];
}

return [{ json: { ...ctx, tipo: o.tipo,
                  al_cliente: alCliente,
                  al_grupo: String(o.al_grupo ?? '').trim() } }];'''
add("leer_lo_redactado", "n8n-nodes-base.code", 2, {"jsCode": LEER_JSON}, [640, -100])

add("que_hacer", "n8n-nodes-base.switch", 3.2,
    {"rules": {"values": [
        {"conditions": {"options": {"version": 2, "caseSensitive": True,
                                    "typeValidation": "loose"},
                        "combinator": "and",
                        "conditions": [{"id": "r",
                                        "operator": {"type": "string", "operation": "equals"},
                                        "leftValue": "={{ $json.tipo }}",
                                        "rightValue": "respuesta"}]},
         "outputKey": "al cliente"},
        {"conditions": {"options": {"version": 2, "caseSensitive": True,
                                    "typeValidation": "loose"},
                        "combinator": "and",
                        "conditions": [{"id": "g",
                                        "operator": {"type": "string", "operation": "notEquals"},
                                        "leftValue": "={{ $json.tipo }}",
                                        "rightValue": "respuesta"}]},
         "outputKey": "al grupo"}]},
     "options": {}},
    [840, -100])

# El turno se registra ANTES de enviar, igual que en el flujo principal, y se
# marca como enviado despues. Si no se registrara, el reloj de recuperacion
# seguiria contando desde el ultimo turno de ANTES del escalado: un cliente que
# acaba de recibir la respuesta entraria en «callado desde hace mas de 24 h» y
# le llegaria un seguimiento encima.
#
# `cliente_dijo` va en null a proposito: el cliente no dijo nada, hablo la
# encargada. Sus palabras exactas se guardan en aviso.respuesta, que es su
# sitio; mezclarlas aqui haria que cualquier informe de conversaciones las
# contara como algo que dijo el cliente.
add("registrar_turno", "n8n-nodes-base.postgres", 2.6,
    {"operation": "executeQuery",
     "query": ("INSERT INTO conversacion_turnos\n"
               "  (lead_id, msg_id, origen, autor, cliente_dijo, en_rafaga, agente,\n"
               "   respuesta, etapa_id, campos, partes)\n"
               "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)\n"
               "RETURNING id;"),
     "options": {"queryReplacement":
                 "={{ [ $('leer_lo_redactado').item.json.lead_id, null, 'grupo',"
                 " $('leer_lo_redactado').item.json.quien, null, 0, 'respuesta_grupo',"
                 " $('leer_lo_redactado').item.json.al_cliente, null, '{}',"
                 " JSON.stringify([$('leer_lo_redactado').item.json.al_cliente]) ] }}"}},
    [1060, -320], cred=CRED_PG)

add("enviar_al_cliente", "n8n-nodes-base.executeWorkflow", 1.2,
    {"workflowId": {"__rl": True, "value": ENVIAR, "mode": "list",
                    "cachedResultName": "enviar_mensaje_salones"},
     "workflowInputs": {"mappingMode": "defineBelow", "value": {
         "cuantas_partes": "={{ 1 }}",
         "parte1": "={{ $json.al_cliente }}",
         "parte2": "", "parte3": "", "parte4": "",
         "lead_id": "={{ $json.lead_id }}",
         "imagen_url": "", "mensaje_cliente": "",
         "proximo_paso": "={{ 0 }}", "status_id": "={{ 0 }}",
         "imagenes": "[]", "partes": "[]"}},
     "options": {"waitForSubWorkflow": True}},
    [1060, -200])

add("marcar_enviada", "n8n-nodes-base.postgres", 2.6,
    {"operation": "executeQuery",
     "query": "UPDATE conversacion_turnos SET enviada = true WHERE id = $1;",
     "options": {"queryReplacement":
                 "={{ [$('registrar_turno').first().json.id] }}"}},
    [1260, -320], cred=CRED_PG)

add("cerrar_aviso", "n8n-nodes-base.httpRequest", 4.2,
    {"method": "PUT", "url": PANEL + "/api/avisos",
     "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
     "sendBody": True, "specifyBody": "json",
     "jsonBody": ("={{ JSON.stringify({"
                  " id: $('leer_lo_redactado').item.json.aviso_id,"
                  " respuesta: $('leer_lo_redactado').item.json.respuesta,"
                  " respondido_por: $('leer_lo_redactado').item.json.quien,"
                  " respuesta_al_cliente: $('leer_lo_redactado').item.json.al_cliente"
                  " }) }}"),
     "options": {"response": {"response": {"responseFormat": "json"}}}},
    [1260, -200], cred=CRED_PANEL)

# Que Maya recuerde lo que dijo. Sin esto, el siguiente mensaje del cliente la
# encuentra sin memoria de haberle confirmado la visita, y se contradice o lo
# vuelve a preguntar. Se escribe un unico turno de ella en la memoria de
# ventas, la misma que usa el agente (sessionKey {lead}-ventas-v9).
#
# Va en continuar-aunque-falle: si esto se rompe, el cliente YA recibio su
# respuesta y eso es lo que importa. Una memoria incompleta se nota; un
# cliente sin contestar, mas.
add("anotar_en_su_memoria", "n8n-nodes-base.postgres", 2.6,
    {"operation": "executeQuery",
     "query": ("INSERT INTO n8n_chat_histories (session_id, message) "
               "VALUES ($1, $2::jsonb)"),
     # Los parametros van como ARRAY, que es el estilo del resto del proyecto.
     # Antes iban como cadena separada por comas y eso era un fallo seguro: el
     # segundo valor es un JSON, y sus propias comas lo habrian partido en
     # trozos.
     "options": {"queryReplacement":
                 "={{ [ $('leer_lo_redactado').item.json.lead_id + '-ventas-v9',"
                 " JSON.stringify({ type: 'ai', data: {"
                 " content: $('leer_lo_redactado').item.json.al_cliente,"
                 " additional_kwargs: {}, response_metadata: {} } }) ] }}"}},
    [1460, -200], cred=CRED_PG, extra={"onError": "continueRegularOutput"})

add("acuse_en_grupo", "n8n-nodes-base.telegram", 1.2,
    {"chatId": "={{ $('leer_lo_redactado').item.json.chat_id }}",
     "text": ("=Listo, ya se lo dije al cliente:\n\n"
              "{{ $('leer_lo_redactado').item.json.al_cliente }}"),
     "replyToMessageId": "={{ $('leer_lo_redactado').item.json.mi_mensaje }}",
     "additionalFields": {"appendAttribution": False,
                          "reply_to_message_id":
                          "={{ $('leer_lo_redactado').item.json.mi_mensaje }}"}},
    [1660, -200], cred=CRED_TG, extra={"onError": "continueRegularOutput"})

# La otra rama: lo que llega no es una respuesta para el cliente, asi que se
# contesta en el grupo y el pendiente NO se cierra.
add("contestar_en_grupo", "n8n-nodes-base.telegram", 1.2,
    {"chatId": "={{ $json.chat_id }}",
     "text": "={{ $json.al_grupo }}",
     "replyToMessageId": "={{ $json.mi_mensaje }}",
     "additionalFields": {"appendAttribution": False,
                          "reply_to_message_id": "={{ $json.mi_mensaje }}"}},
    [1060, 40], cred=CRED_TG, extra={"onError": "continueRegularOutput"})

une("escuchar_grupo", "leer_respuesta")
une("leer_respuesta", "es_respuesta")
une("es_respuesta", "buscar_aviso", salida=0)
une("buscar_aviso", "era_un_aviso")
une("era_un_aviso", "armar_contexto", salida=0)
une("armar_contexto", "redactar")
une("redactar", "leer_lo_redactado")
une("leer_lo_redactado", "que_hacer")
une("que_hacer", "registrar_turno", salida=0)
une("que_hacer", "contestar_en_grupo", salida=1)
une("registrar_turno", "enviar_al_cliente")
une("enviar_al_cliente", "marcar_enviada")
une("marcar_enviada", "cerrar_aviso")
une("cerrar_aviso", "anotar_en_su_memoria")
une("anotar_en_su_memoria", "acuse_en_grupo")

con.setdefault("redactar", {})["ai_languageModel"] = [[
    {"node": "modelo_redactor", "type": "ai_languageModel", "index": 0}]]

DESTINO = os.path.dirname(os.path.abspath(__file__))
ruta = os.path.join(DESTINO, "salones_respuestas.json")
io.open(ruta, "w", encoding="utf-8").write(json.dumps({
    "name": "salones_respuestas",
    "nodes": nodos,
    "connections": con,
    "settings": {"executionOrder": "v1", "timezone": "America/Monterrey"},
}, ensure_ascii=False, indent=2))
print("salones_respuestas ->", len(nodos), "nodos")
