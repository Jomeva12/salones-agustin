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
  -> director -> enrutar -> {ventas | cliente | seguimiento}
  -> registrar_turno -> enviar_respuesta
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

### El registro, que por ahora ES el producto

`registrar_turno` guarda cada turno en `conversacion_turnos`: lo que dijo el
cliente, que agente contesto, que redacto, y una foto de los campos del lead
en ese momento.

Mientras `enviar_respuesta` siga siendo un marcador, esa tabla es el unico
lugar donde se lee lo que el agente HABRIA contestado. Nadie lo recibe.

La foto de `campos` no es un extra: sin ella, revisar meses despues por que
cotizo lo que cotizo es imposible, porque los campos de Kommo ya cambiaron.

Para leer lo ultimo:

```sql
SELECT creado_en, agente, cliente_dijo, respuesta
  FROM conversacion_turnos
 ORDER BY creado_en DESC
 LIMIT 20;
```

## Trabajar con la API de n8n

Hay una API key en `.n8n_key` (fuera del repositorio). Los comandos la leen
sin que el valor quede escrito:

```bash
curl -H "X-N8N-API-KEY: $(tr -d '
' < .n8n_key)"   https://automatizaciones-n8n.hpzji3.easypanel.host/api/v1/workflows

# Actualizar salones_principal desde el archivo versionado
curl -X PUT ".../api/v1/workflows/eXHsmGJcQ2VNgvEs"   -H "X-N8N-API-KEY: $(tr -d '
' < .n8n_key)"   -H "content-type: application/json" --data-binary @put.json
```

El PUT solo acepta `name`, `nodes`, `connections` y `settings`; con cualquier
otra clave responde 400.

## Los prompts

Viven en `n8n/prompts/*.md` y el generador los lee. Asi se revisan en el diff
como cualquier cambio, en vez de quedar escondidos dentro de un nodo.

| Agente | Tamano | Que hace |
|---|---|---|
| director | 1.4 KB | Enruta y extrae datos. No le habla al cliente |
| ventas | 3.2 KB | Califica, cotiza, invita a visitar |
| cliente | 1.4 KB | Atiende a quien ya contrato. No vende |
| seguimiento | 0.7 KB | Reescribe a quien dejo de contestar |

**Seis kilobytes los cuatro.** Los de Revolution suman 92 KB. La diferencia no
es estilo: alli los precios, los escalones y las reglas viven dentro del
prompt; aqui viven en el panel y el agente los consulta. Un prompt corto es
consecuencia de tener herramientas, no una virtud aparte.

### La clave de sesion lleva version

`{lead}-{agente}-{MEMORIA_V}`. Cuando cambia lo que el agente PUEDE hacer
-sus herramientas o su prompt-, se sube la version y empieza con memoria
limpia.

No es cosmetico. Con las herramientas caidas el agente contesto "tengo un
problema con el sistema"; eso quedo en su historial y, ya arregladas las
herramientas, **seguia repitiendo la disculpa sin intentar llamarlas**. Ese
fallo no da error: da una excusa educada para siempre.

## El Director escribe en Kommo

Despues de clasificar, el Director pasa por `armar_patch` -> `hay_datos` ->
`guardar_en_kommo`, que parcha los campos del lead.

**Solo el Director escribe.** Si cada agente parchara el mismo lead se
pisarian entre ellos y no habria forma de saber quien puso que. Los demas
agentes solo leen.

**Solo se escribe lo que el cliente dijo.** Un campo que el Director no pudo
determinar se queda como esta. Sobrescribir con null borraria lo que una
encargada capturo a mano, y eso no se nota hasta que alguien busca el dato.

**Las fechas van a mediodia UTC.** Kommo las guarda como epoch; a las 00:00
UTC en Monterrey (UTC-6) todavia es el dia anterior, y la fecha del evento
aparecería corrida un dia.

IDs de los campos, por si hay que tocarlos:

| Campo | id | Opciones |
|---|---|---|
| Salon | 352870 | norma 281622, esmeralda 281624, santacruz 281626, quetzal 281628 |
| Tipo de evento | 352872 | xv 281630, boda 281632, graduacion 281634, posada 281636, cumpleanos 281638, babyshower 281640 |
| Fecha del evento | 352874 | fecha (epoch) |
| Invitados | 352876 | numero |
| Paquete cotizado | 352880 | Plata 281642, Onix 281644, Bronce 281646, Oro 281648 |
| IA activa | 352882 | casilla |
| Estado de contacto | 352884 | Activo 281650, En frio 281652 |
