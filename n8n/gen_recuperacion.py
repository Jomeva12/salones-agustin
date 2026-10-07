# -*- coding: utf-8 -*-
"""Genera los dos flujos de recuperacion a las 24 horas.

Son DOS y no uno a proposito. El buscador encuentra N leads; si el mensaje se
armara en ese mismo flujo, dentro de un Loop, cada `$('nodo').first()`
devolveria el primer ciclo en todas las vueltas — y eso no falla, solo manda
el mensaje equivocado, en verde. Llamar a un subflujo por lead deja a cada
ejecucion con un solo item, que es donde `.first()` significa lo que parece.
"""
import json, io, uuid, os

CRED_KOMMO = {"httpHeaderAuth": {"id": "YrRdSRPkquUkNRAB", "name": "kommo_salones"}}
CRED_PG    = {"postgres":       {"id": "NaGMrunSEarhp4cc", "name": "postgres_salones"}}
CRED_AI    = {"openAiApi":      {"id": "aLFrGO9FtcPzpgXL", "name": "INCAD"}}

AQUI = os.path.dirname(os.path.abspath(__file__))
leer_js = lambda n: io.open(os.path.join(AQUI, "js", n), encoding="utf-8").read()
leer_md = lambda n: io.open(os.path.join(AQUI, "prompts", n), encoding="utf-8").read()

KOMMO = "https://administracioneventos6.kommo.com/api/v4"
ENVIAR = "znqsX6lvLCqIQ2LB"          # enviar_mensaje_salones
MEMORIA_V = "v6"

# Etapas donde NO se recupera.
#
#   112261039  Cita agendada      ya viene; perseguirlo es de mas. Lo que toca
#                                 ahi es RECORDARLE la cita, que es otro flujo.
#   112261047  Con la encargada   hay una persona atendiendolo
#   112261051  Fecha apartada     hay dinero de por medio
#   112261055  Contratado         el agente ya termino su trabajo
#   142 / 143  Realizado, Perdido el lead esta cerrado
#
# «Visito el salon» NO esta en la lista, y es a proposito: el Lic. Barron pidio
# justo que ahi siguiera. Son los que van, dicen «dejame pensarlo» y se bajan
# —y a esos, segun el, las encargadas no les dan seguimiento—.
SIN_RECUPERAR = [112261039, 112261047, 112261051, 112261055, 142, 143]

CAMPO_ESTADO = 352884
EN_FRIO = 281652


class Flujo:
    def __init__(self, nombre):
        self.nombre, self.nodos, self.con = nombre, [], {}

    def add(self, nombre, tipo, ver, params, pos, cred=None, extra=None):
        n = {"parameters": params, "id": str(uuid.uuid4()), "name": nombre,
             "type": tipo, "typeVersion": ver, "position": pos}
        if cred:
            n["credentials"] = cred
        if extra:
            n.update(extra)
        self.nodos.append(n)
        return nombre

    def une(self, a, b, tipo="main", salida=0):
        self.con.setdefault(a, {}).setdefault(tipo, [])
        while len(self.con[a][tipo]) <= salida:
            self.con[a][tipo].append([])
        self.con[a][tipo][salida].append({"node": b, "type": tipo, "index": 0})

    def json(self):
        return {"name": self.nombre, "nodes": self.nodos, "connections": self.con,
                # Sin zona horaria, el cron correria en UTC y los avisos
                # saldrian de madrugada en Monterrey.
                "settings": {"executionOrder": "v1", "timezone": "America/Monterrey"}}


def cond(izq, der, op="equals", tipo="string"):
    return {"options": {"caseSensitive": False, "leftValue": "",
                        "typeValidation": "loose", "version": 3},
            "conditions": [{"id": str(uuid.uuid4()), "leftValue": izq, "rightValue": der,
                            "operator": {"type": tipo, "operation": op}}],
            "combinator": "and"}


# ═══════════════════════════ A. el buscador ════════════════════════════════
a = Flujo("salones_recuperacion")

a.add("cada_hora", "n8n-nodes-base.scheduleTrigger", 1.2,
      # De 9 a 20, hora de Monterrey: a nadie se le escribe de madrugada.
      {"rule": {"interval": [{"field": "cronExpression", "expression": "0 9-20 * * *"}]}},
      [-400, 0])

BUSCAR = """WITH ultimo AS (
  SELECT DISTINCT ON (lead_id) lead_id, agente, enviada, creado_en
    FROM conversacion_turnos
   ORDER BY lead_id, creado_en DESC
)
SELECT lead_id
  FROM ultimo
 WHERE enviada
   AND agente NOT IN ('seguimiento', 'aviso_reinicio')
   AND creado_en < now() - interval '24 hours'
   AND creado_en > now() - interval '7 days'
 ORDER BY creado_en
 LIMIT 10;"""

a.add("buscar_callados", "n8n-nodes-base.postgres", 2.6,
      # El ultimo turno de cada lead. Si el cliente hubiera contestado habria
      # un turno mas nuevo, asi que "el ultimo tiene mas de 24 h" es lo mismo
      # que "lleva mas de 24 h sin hablar".
      #
      # agente <> 'seguimiento' es lo que impide insistir: se recupera una vez
      # y no se vuelve. El tope de 7 dias evita que al encender esto por
      # primera vez salga a escribirle a todo el historico.
      #
      # LIMIT 10 por el pool de plantillas: son 20 filas y cada envio toma una
      # por parte. Sin tope, una tanda grande dejaria al flujo principal sin
      # plantillas y mudo.
      {"operation": "executeQuery", "query": BUSCAR, "options": {}},
      [-200, 0], cred=CRED_PG)

a.add("uno_por_uno", "n8n-nodes-base.executeWorkflow", 1.3,
      {"workflowId": {"__rl": True, "value": "XCjUoeCFF7OJLQao", "mode": "list",
                      "cachedResultName": "salones_recuperacion_lead",
                      "cachedResultUrl": "/workflow/XCjUoeCFF7OJLQao"},
       "workflowInputs": {
           "mappingMode": "defineBelow",
           "value": {"lead_id": "={{ $json.lead_id }}"},
           "matchingColumns": [], "schema": [
               {"id": "lead_id", "displayName": "lead_id", "required": False,
                "defaultMatch": False, "display": True, "canBeUsedToMatch": True,
                "type": "string"}],
           "attemptToConvertTypes": False, "convertFieldsToString": True},
       "options": {"waitForSubWorkflow": True}},
      [0, 0],
      # Un lead que falle no puede llevarse por delante a los demas de la tanda.
      extra={"onError": "continueRegularOutput"})

a.une("cada_hora", "buscar_callados")
a.une("buscar_callados", "uno_por_uno")


# ═══════════════════════════ B. un solo lead ═══════════════════════════════
b = Flujo("salones_recuperacion_lead")

b.add("inicio", "n8n-nodes-base.executeWorkflowTrigger", 1.1,
      {"workflowInputs": {"values": [{"name": "lead_id"}]}}, [-600, 0])

b.add("traer_lead", "n8n-nodes-base.httpRequest", 4.2,
      {"url": "=" + KOMMO + "/leads/{{ $json.lead_id }}",
       "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
       "options": {"response": {"response": {"responseFormat": "json"}}}},
      [-400, 0], cred=CRED_KOMMO)

FORMATLEAD = r'''// Mismo aplanado que el flujo principal, sin la parte del mensaje: aqui no
// hay mensaje del cliente, justamente porque dejo de escribir.
const crudo = $input.first().json ?? {};
const l = crudo.data ?? crudo;
const campos = {};
for (const c of (l.custom_fields_values ?? [])) {
  const v = (c.values ?? [])[0] ?? {};
  campos[c.field_name] = v.value ?? v.enum_id ?? null;
}
return [{ json: {
  lead_id: String(l.id ?? $('inicio').first().json.lead_id),
  etapa_id: l.status_id ?? null,
  campos,
  // Lo que el agente vera como "lo que dijo el cliente". No es un mensaje:
  // es la instruccion de por que se le esta escribiendo.
  chats: '',
}}];'''
b.add("formatLead", "n8n-nodes-base.code", 2, {"jsCode": FORMATLEAD}, [-200, 0])

SE_PUEDE = ("={{ " + str(SIN_RECUPERAR) + ".includes($json.etapa_id) === false"
            " && String($json.campos['Stop IA']) !== 'true' }}")
b.add("se_puede", "n8n-nodes-base.if", 2.3,
      # Las dos guardas juntas: ni etapa cerrada ni «Stop IA» marcado. La
      # segunda importa mas aqui que en el flujo principal — si la encargada
      # detuvo la IA para hablar ella, un recordatorio automatico la pisaria.
      {"conditions": cond(SE_PUEDE, "true", tipo="boolean"),
       "looseTypeValidation": True, "options": {}}, [0, 0])

b.add("seguimiento", "@n8n/n8n-nodes-langchain.agent", 3.1,
      {"promptType": "define",
       "text": "=Han pasado 24 horas sin respuesta de este cliente. Escribele "
               "un mensaje breve para retomar la conversacion donde se quedo.",
       "options": {"systemMessage": leer_md("seguimiento.md")}}, [220, -60])
b.add("modelo_seguimiento", "@n8n/n8n-nodes-langchain.lmChatOpenAi", 1.3,
      {"model": {"__rl": True, "value": "gpt-4.1-mini", "mode": "list",
                 "cachedResultName": "gpt-4.1-mini"}, "options": {}},
      [160, 140], cred=CRED_AI)
b.add("memoria_seguimiento", "@n8n/n8n-nodes-langchain.memoryPostgresChat", 1.3,
      # La clave de ventas, no una propia: sin el historial de la venta no hay
      # nada que "retomar", y escribiria como si fuera el primer contacto.
      {"sessionIdType": "customKey",
       "sessionKey": "={{ $('formatLead').first().json.lead_id }}-ventas-" + MEMORIA_V,
       "contextWindowLength": 30}, [330, 140], cred=CRED_PG)
b.une("modelo_seguimiento", "seguimiento", "ai_languageModel")
b.une("memoria_seguimiento", "seguimiento", "ai_memory")

b.add("formatear_respuesta", "n8n-nodes-base.code", 2,
      {"jsCode": leer_js("formatear_respuesta.js")}, [440, -60])

REGISTRAR = """INSERT INTO conversacion_turnos
  (lead_id, msg_id, origen, autor, cliente_dijo, en_rafaga, agente,
   respuesta, etapa_id, campos, partes)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)
RETURNING id;"""
b.add("registrar_turno", "n8n-nodes-base.postgres", 2.6,
      {"operation": "executeQuery", "query": REGISTRAR,
       "options": {"queryReplacement":
                   "={{ [ $('formatLead').first().json.lead_id, null, 'recuperacion',"
                   " 'sistema', null, 0, $json.agente, $json.texto_completo,"
                   " $('formatLead').first().json.etapa_id,"
                   " JSON.stringify($('formatLead').first().json.campos),"
                   " JSON.stringify([$json.parte1, $json.parte2].filter(Boolean)) ] }}"}},
      [640, -60], cred=CRED_PG)

_F = "$('formatear_respuesta').first().json."
b.add("enviar_mensaje", "n8n-nodes-base.executeWorkflow", 1.3,
      {"workflowId": {"__rl": True, "value": ENVIAR, "mode": "list",
                      "cachedResultName": "enviar_mensaje_salones",
                      "cachedResultUrl": "/workflow/" + ENVIAR},
       "workflowInputs": {
           "mappingMode": "defineBelow",
           "value": dict({c: "={{ " + _F + c + " }}" for c in
                          ["cuantas_partes", "parte1", "parte2", "parte3", "parte4",
                           "imagen_url", "mensaje_cliente", "proximo_paso", "status_id"]},
                         **{"lead_id": "={{ " + _F + "lead_id.toString() }}"}),
           "matchingColumns": [],
           "schema": [{"id": c, "displayName": c, "required": False,
                       "defaultMatch": False, "display": True, "canBeUsedToMatch": True,
                       "type": "number" if c in ("cuantas_partes", "proximo_paso", "status_id")
                               else "string"}
                      for c in ["cuantas_partes", "parte1", "parte2", "parte3", "parte4",
                                "lead_id", "imagen_url", "mensaje_cliente",
                                "proximo_paso", "status_id"]],
           "attemptToConvertTypes": False, "convertFieldsToString": True},
       "options": {}},
      [840, -60],
      # Igual que en el principal: si revienta el envio, el turno queda con
      # enviada = false y ahi se ve. Reventar aqui no aporta nada.
      extra={"onError": "continueRegularOutput"})

b.add("marcar_enviada", "n8n-nodes-base.postgres", 2.6,
      {"operation": "executeQuery",
       "query": "UPDATE conversacion_turnos SET enviada = true WHERE id = $1;",
       "options": {"queryReplacement":
                   "={{ [$('registrar_turno').first().json.id] }}"}},
      [1040, -60], cred=CRED_PG)

b.add("marcar_en_frio", "n8n-nodes-base.httpRequest", 4.2,
      # El campo existe desde que se armo la cuenta: "En frio (+24 h sin
      # responder)". Es lo que deja ver en Kommo, sin abrir el chat, a quien
      # ya se le insistio una vez.
      {"method": "PATCH",
       "url": "=" + KOMMO + "/leads/{{ $('formatLead').first().json.lead_id }}",
       "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
       "sendBody": True, "specifyBody": "json",
       "jsonBody": '={{ JSON.stringify({ custom_fields_values: [ { field_id: '
                   + str(CAMPO_ESTADO) + ', values: [ { enum_id: ' + str(EN_FRIO)
                   + ' } ] } ] }) }}',
       "options": {"response": {"response": {"responseFormat": "json"}}}},
      [1240, -60], cred=CRED_KOMMO)

b.add("no_aplica", "n8n-nodes-base.noOp", 1, {}, [220, 160])

b.une("inicio", "traer_lead")
b.une("traer_lead", "formatLead")
b.une("formatLead", "se_puede")
b.une("se_puede", "seguimiento", salida=0)
b.une("se_puede", "no_aplica", salida=1)
b.une("seguimiento", "formatear_respuesta")
b.une("formatear_respuesta", "registrar_turno")
b.une("registrar_turno", "enviar_mensaje")
b.une("enviar_mensaje", "marcar_enviada")
b.une("marcar_enviada", "marcar_en_frio")

DESTINO = r"C:\Users\johan\Desktop\WEB\salones_agustin\n8n"
for f in (a, b):
    ruta = os.path.join(DESTINO, f.nombre + ".json")
    io.open(ruta, "w", encoding="utf-8").write(
        json.dumps(f.json(), ensure_ascii=False, indent=2))
    print(f.nombre, "->", len(f.nodos), "nodos")
