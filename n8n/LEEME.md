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
