# Flujos de n8n

Los flujos viven aqui como JSON y se importan a n8n **por URL**, no subiendo
archivos: asi lo que corre en produccion es lo que esta versionado, y un
cambio se revisa en el diff como cualquier otro codigo.

## Importar o actualizar un flujo

En n8n: abrir el flujo (o crear uno nuevo) -> menu `...` -> **Import from
URL...** -> pegar la URL cruda del archivo:

```
https://raw.githubusercontent.com/Jomeva12/salones-agustin/main/n8n/salones_receptor.json
```

Importar SOBRESCRIBE el lienzo con lo que diga el JSON. Si alguien toco el
flujo a mano en n8n, ese cambio se pierde: hay que traerlo primero al archivo.

## salones_receptor

La puerta de entrada. Recibe del intermediario, traduce el payload de Kommo a
campos limpios y descarta lo que no debe contestarse.

| Nodo | Que hace |
|---|---|
| Entrada del intermediario | Webhook POST. Responde al TERMINAR, no al recibir |
| Leer el mensaje | Traduce `message[add][0][...]` a campos limpios |
| Aqui entra el Director | Marcador: aqui se engancha el resto |

Dos decisiones que no son obvias:

**Responde al terminar** (`responseMode: lastNode`). Asi el 200 significa que
el flujo corrio. Si revienta, n8n devuelve 500 y el intermediario reintenta
con su espera creciente. Respondiendo al recibir, un fallo se perderia en
silencio y el mensaje quedaria marcado como entregado.

**Descarta los `outgoing`.** Lo que escribe la encargada o el propio agente
tambien dispara el webhook. Sin este filtro el agente se contestaria a si
mismo.

## La URL del webhook

El intermediario llama a n8n por la red interna de Easypanel, sin salir a
internet:

```
http://automatizaciones_n8n:5678/webhook/salones-entrada-64dcb347
```

Ese valor va en `N8N_WEBHOOK_URL` del intermediario, y solo surte efecto
cuando se quite `SOLO_REGISTRAR=true`.


## salones_principal

El flujo principal. Esqueleto: el cableado completo con los prompts en
provisional, porque primero se prueba que el mensaje recorra todo el camino.

```
new_message -> es_mensaje_entrante -> formatear
  -> guardar_en_buffer -> esperar_rafaga (15 s) -> leer_rafaga -> soy_el_ultimo
  -> marcar_consumidos -> traer_lead -> formatLead -> ia_activa
  -> director -> enrutar -> {ventas | cliente | seguimiento} -> enviar_respuesta
```

Cuatro agentes, cada uno con su modelo (OpenAI `INCAD`) y su memoria Postgres.

### El buffer de rafagas, sin candado

Junta los mensajes seguidos para contestar una sola vez. Quien contesta es la
ejecucion del **ultimo** mensaje: las anteriores consultan si llego algo mas
nuevo y se apagan solas.

Revolution resuelve esto con una fila de `procesando` en Supabase. Ese candado
ya dejo una conversacion muda con todo en verde: la fila se quedo trabada y
nadie lo vio, porque no hay ejecucion en rojo que mirar. Aqui no hay candado
que trabar — una fila sin consumir es trabajo pendiente, y si una ejecucion
muere a medias el siguiente mensaje se lleva todo lo que quedo.

La tabla `buffer_mensajes` la crea el intermediario al arrancar.

### Detalles que no son obvios

**Los INSERT van parametrizados, no interpolados.** El cliente escribe signos
`$` cuando habla de precios, y un `$` pegado a una comilla rompe la consulta;
el error ademas apunta a la linea siguiente y cuesta encontrarlo.

**El interruptor de la IA es el campo de Kommo,** no una tabla aparte. Llega
gratis en la misma llamada que trae el lead, y es lo que la encargada ve y
apaga.

**Una memoria por agente y por lead.** Si compartieran clave de sesion, el
agente de seguimiento leeria como suyo lo que dijo ventas.
