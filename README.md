# Salones Agustín Barrón — panel y API

Proyecto embebido para los cuatro salones de eventos de Guadalupe, Nuevo León.
Administra paquetes, precios y disponibilidad, y expone la API que consume el
agente de WhatsApp desde n8n.

**Cero dependencias de npm.** Node 22 trae la base de datos (`node:sqlite`) y el
servidor HTTP adentro. No hay `npm install`.

---

## Arrancar

```bash
npm start
```

Panel en <http://localhost:4300> · API en `/api/salud`.

Si la base todavía no existe:

```bash
npm run reset      # exporta la semilla desde el Excel y crea salones.db
```

`npm run reset` es **destructivo**: rehace la base desde cero. Los datos vivos se
editan por el panel, no volviendo a correr esto.

---

## Estructura

```
salones_agustin/
├── backend/
│   ├── db/
│   │   ├── esquema.sql          las 12 tablas, con sus restricciones
│   │   ├── exportar_seed.py     Excel  →  seed/*.json   (se corre una vez)
│   │   ├── migrar.mjs           seed/*.json  →  salones.db
│   │   ├── seed/                datos semilla en JSON plano
│   │   └── salones.db           la base (no se versiona)
│   ├── api/logica.mjs           toda la regla de negocio
│   └── server.js                http + ruteo + archivos estáticos
├── frontend/
│   ├── index.html · app.css
│   └── js/  app.js · ui.js · api.js
│             hoy.js · cotizar.js · agenda.js · catalogo.js
├── pruebas/
│   ├── agente.mjs               corre conversaciones contra el API, sin n8n
│   └── conversaciones/*.json    casos reales de WhatsApp
└── package.json
```

El lado Node no lee Excel: `exportar_seed.py` deja JSON plano y por eso el
proyecto no necesita ninguna librería.

---

## Lo que el modelo resuelve

El precio de un evento depende de **cinco** variables, no de cuatro. Las cuatro
conocidas son salón, tipo de evento, número de invitados y día de la semana. La
quinta —la que más mueve el precio y la que no existía como dato— es **cuántos
meses faltan para el evento**.

En el Excel esa regla vivía escrita en prosa, en 73 redacciones distintas.
Aquí es la tabla `escalon`, con la distancia en dos enteros:

| Escalón | Faltan | Como lo llamaba el Excel |
|---|---|---|
| Mismo mes del evento | 0 | «el mes en curso» |
| Falta 1 mes | 1 | «el mes siguiente al en curso» |
| Faltan 2 meses | 2 | «el mes **tercero**» |
| Faltan 3 a 5 meses | 3–5 | «del **cuarto al sexto** mes» |
| Faltan 6 meses o más | 6+ | «del **séptimo** en adelante» |

> Los nombres del archivo original son **ordinales**, no distancias: cuentan el
> mes en curso como el primero. Quien lea «del cuarto al sexto mes» y escriba
> `meses >= 4 AND meses <= 6` se equivoca por uno en ambos extremos. La columna
> `escalon.evidencia` guarda el ejemplo textual del que se dedujo cada ventana.

### Las dos restricciones que sostienen todo

- **`tarifa`** — un trigger impide que dos tarifas vigentes cubran el mismo
  tramo de invitados para la misma llave. El problema de «la misma búsqueda
  devuelve cuatro precios distintos» no se corrige: **no se puede insertar**.
- **`compromiso`** — `UNIQUE (salon_id, fecha, turno)`. Un recinto, un evento
  por turno. El doble booking tampoco se puede insertar.

### Disponibilidad: tres estados, no dos

La agenda solo guarda lo **comprometido**. Que no haya fila no prueba que el día
esté libre: puede ser que nadie lo haya reportado. Por eso `control_agenda`
guarda hasta dónde revisó su agenda cada encargada.

| Situación | Respuesta |
|---|---|
| Hay compromiso | `ocupada` |
| No hay, y la fecha ≤ confirmada_hasta | `libre` |
| No hay, y la fecha > confirmada_hasta | `no_confirmada` → derivar |

Hoy la agenda de Quetzal llega solo hasta **2027-04-20** aunque se venda 2028.
Sin este tercer estado, el sistema ofrecería veinte meses de disponibilidad
inventada.

---

## Fechas que no cierran el salón pero cambian lo que se dice

La tabla `fecha_especial` marca rangos de días con algo que el cliente tiene
que saber y que no se ve en el precio. La estrenó **Semana Santa**: la iglesia
no celebra misas esos días, así que quien quería misa para su boda no la va a
tener.

La instrucción del Lic. Barrón fue explícita y vale la pena dejarla escrita,
porque la tentación es hacer lo contrario: **eso no frena la venta.** Se
cotiza igual, se le avisa al cliente, y si duda se le pasa a un asesor que
tiene margen para mejorarle la oferta. Lo que se quiere es vender.

Por eso la columna se llama `se_cotiza` y nace en `1`. Un día que de verdad no
se pueda vender se pone en `0` y queda dicho a propósito, no por descuido.

Las semanas santas **se calculan**, no se teclean: la Pascua se mueve cada año
y una lista escrita a mano caduca sin avisar. `migracion_fechas_especiales.mjs`
siembra los siete años que vienen y es idempotente — volver a correrla no pisa
un texto que alguien haya corregido.

| | Semana Santa 2027 | Semana Santa 2028 |
|---|---|---|
| Domingo de Ramos | 21 de marzo | 9 de abril |
| Sábado de Gloria | 27 de marzo | 15 de abril |
| Domingo de Pascua | 28 de marzo | 16 de abril |

Lo leen tres rutas: `cotizar` y `disponibilidad` devuelven `fecha_especial`
completo, y `dias-disponibles` marca cada día solo con el título, porque
repetir el aviso entero en una lista de cuatro sábados la vuelve ilegible.

## API

| Método y ruta | Para qué |
|---|---|
| `GET /api/salud` | latido, fecha en Monterrey y conteos |
| `GET /api/hoy` | portada: lo que viene, fechas por vender, apartados por vencer |
| `GET /api/salones` | los cuatro, con su `confirmada_hasta` |
| `GET /api/catalogo` | tipos de evento, escalones, paquetes, conceptos |
| `POST /api/cotizar` | **precio y disponibilidad juntos** |
| `GET /api/disponibilidad?fecha=&turno=` | los cuatro salones en una fecha |
| `GET /api/agenda?desde=&hasta=` | compromisos del rango (calendario) |
| `POST /api/compromisos` | registrar contratado / separado / bloqueado |
| `PUT /api/control-agenda` | «revisé mi agenda hasta aquí» |
| `GET /api/tarifas?salon=&paquete=&anio=` | rejilla de precios |
| `GET /api/contenido?id=` | qué incluye y qué no, por conceptos |
| `GET /api/servicios?salon=&q=` | servicios adicionales que **caben** en ese salón |
| `GET /api/faq?q=` | preguntas frecuentes |
| `GET /api/politicas?incluir=` | políticas, filtradas por visibilidad |
| `GET /api/revisar` | todo lo pendiente de confirmar |
| `PUT /api/tarifas` | corregir precios de una tarifa |
| `POST /api/tarifas/resolver` | elegir un precio y retirar las otras versiones |
| `PUT /api/contenido-conceptos` | cambiar qué incluye y qué no un paquete |
| `POST /api/conceptos` | dar de alta un concepto nuevo |
| `PUT /api/compromisos` | corregir un evento de la agenda |
| `DELETE /api/compromisos` | cancelar un evento y liberar la fecha |
| `GET /api/servicio?id=` | ficha de un servicio con sus salones |
| `PUT /api/servicios` | cambiar un servicio |
| `POST /api/servicios` | dar de alta un servicio |
| `GET /api/bitacora?limite=` | quién cambió qué y cuándo |

### `POST /api/cotizar`

El agente manda **solo lo que dijo el cliente**. Nunca calcula el escalón, el
día, el tramo ni elige el paquete: si lo hiciera, volveríamos a tener un modelo
de lenguaje interpretando la regla.

```json
{ "tipo_evento": "boda", "fecha_evento": "2026-12-12", "personas": 200 }
```

Sin `salon` contesta por los cuatro, así la venta cruzada sale de la misma
llamada. La respuesta trae `dia_semana`, `meses_anticipacion`, el `escalon`
aplicado, el `tramo_personas` usado y `precio_vigente_hasta` —porque el escalón
se mueve con el calendario y la cotización caduca.

**Nunca devuelve una lista vacía.** Sin cobertura responde
`cotizacion: "sin_paquete"` con su motivo y `accion: "derivar_encargada"`. Una
lista vacía es la invitación a que el agente se invente un precio.

### Visibilidad de las políticas

No es un sí o un no: son **tres** casos, y confundirlos filtra los datos
bancarios o hace que el agente recite sus propias instrucciones al cliente.

| Valor | Qué significa | Cuántas |
|---|---|---:|
| `publico` | el agente puede decirlo tal cual | 16 |
| `restringido` | el dato existe pero el agente **nunca** lo da; deriva | 6 |
| `regla_interna` | instrucción para el agente, jamás se recita | 21 |

`GET /api/politicas` devuelve **solo lo público** por defecto. `?incluir=agente`
añade las reglas internas; `?incluir=todo` es para el panel. Lo `restringido`
son los datos bancarios de Banregio, el depósito en garantía, los grupos
internos de WhatsApp y el teléfono y correo privados del Lic. Barrón.
La migración verifica que ninguno de esos quede marcado como público.

### Servicios por capacidad

El Excel dice que los 104 servicios están «disponibles en: Todos», pero una
barra libre para 300 personas no cabe en Quetzal, que topa en 150. La
migración omite esos 12 enlaces: Norma lista 13 opciones de barra libre y
Quetzal solo 7.

### Autenticación

Define `API_TOKEN` y los endpoints piden `Authorization: Bearer <token>`.
Se lee de los headers ya normalizados a minúsculas, que es como los manda n8n.

```bash
API_TOKEN=loquesea npm start
```

---

## En qué salón se trabaja

El panel arranca mostrando los cuatro salones, que es la vista del Lic. Barrón.
Pero cada encargada trabaja en **uno solo**, y ver los cuatro revueltos le
esconde justo lo que necesita.

El selector **«En qué salón»** del sidebar cambia el panel entero, y se elige
solo al identificarse: Nelly → Norma, Karla → Esmeralda, Viridiana → Santa
Cruz, Raquel → Quetzal.

Con un salón elegido:

- **Hoy** deja de ser la misma pantalla filtrada y pasa a ser otra: sus
  eventos, sus fechas libres en orden de cercanía, su agenda. El indicador
  central cambia a **fines de semana libres**, que es el número que separa un
  salón saturado de uno que hay que llenar.
- **Agenda** escribe el evento dentro del día —«XV años · noche»— en vez de
  cuatro puntitos. Se lee como la libreta que viene a reemplazar.
- **Paquetes, Servicios y Pendientes** se filtran a ese salón.
- **Cotizar NO se filtra nunca.** La venta cruzada —ofrecer los otros tres
  cuando uno está ocupado— es petición expresa del Lic. y es la venta que hoy
  más se pierde.

La diferencia no es cosmética. Con los datos de hoy:

| Salón | Encargada | Eventos en 90 días | Fines de semana libres |
|---|---|---:|---|
| Norma | Nelly | 43 | **5 de 39** |
| Esmeralda | Karla | 27 | 11 de 39 |
| Santa Cruz | Viridiana | 16 | 18 de 39 |
| Quetzal | Raquel | 17 | **23 de 39** |

Nelly administra saturación y Raquel necesita llenar. Son trabajos opuestos y
hasta ahora el panel les mostraba exactamente lo mismo.

## El panel

Siete pantallas, en tres bloques. Escrito en el idioma del cliente: nunca dice
«escalón», «tramo» ni «tarifa».

| Pantalla | Para qué | Quién la usa |
|---|---|---|
| **Hoy** | escrita en frases: qué pasa hoy, qué necesita atención, qué falta vender | todos |
| **Cotizar** | las cuatro preguntas → precio y disponibilidad juntos | auxiliares de redes |
| **Agenda** | calendario de los cuatro salones, alta rápida | encargadas |
| **Paquetes** | qué incluye cada uno y sus precios | consulta |
| **Servicios** | los 104 adicionales, filtrados por el salón | consulta |
| **Respuestas** | dudas frecuentes y políticas | consulta |
| **Pendientes** | lo que falta confirmar | administración |

### La portada

Está escrita **en frases, no en tarjetas con números sueltos**. Quien la abre
cada mañana es el Lic. Barrón, que quiere saber cómo va el negocio, no
interpretar un tablero.

**Un héroe oscuro a todo el ancho** y debajo dos columnas.

El héroe lleva la fecha en versalitas, el saludo según la hora, una sola
oración sobre lo de hoy, y una franja con cuatro números: eventos del mes,
eventos comprometidos, cuántas fechas de este fin de semana están vendidas, y
los salones en operación. Con un salón elegido, el cuarto cambia a sus fines de
semana libres.

**Los próximos tres fines de semana** (columna ancha): el número grande —*21 de
36 fechas siguen sin vender*—, una barra de proporción, y una rejilla de 4
salones × 9 días en tres fichas. Cada salón lleva su marcador al lado del
nombre (*Norma 6/9*, *Quetzal 2/9*), resaltado cuando va lleno. Casilla llena =
vendido, hueca punteada = por vender.

**Lo que viene** (columna angosta): cada día con su ficha de fecha, en color si
es hoy o mañana, y los eventos al lado.

La primera versión tenía 28 elementos visuales en cinco secciones de tarjetas y
ocupaba 760 px en un monitor de 1680. Ésta usa 1340 y tiene tres piezas.

### Cotizar

Mismo lenguaje que la portada. El formulario arriba con las cuatro preguntas en
campos grandes, y la respuesta como un **héroe oscuro** que muestra, antes que
cualquier precio, **el día de la semana en letra grande**. En una conversación
real cotizaron el 17 de marzo de 2027 a precio de sábado cuando cae en
**miércoles**: $6,000 de más, dos veces en el mismo chat.

Bajo el día, un sello dice si es fin de semana o entre semana, y una franja con
los tres datos que el sistema dedujo: meses de anticipación, el rango de
invitados al que corresponde el precio, y en cuántos salones se puede hacer.

Debajo, una tarjeta por salón: las vendibles primero, con borde verde y el
precio en 36 px; las ocupadas en gris. Cada una lleva las cortesías, los
paquetes más completos como alternativa, y los botones de **Ver qué incluye** y
**Copiar para WhatsApp**.

**Hoy** muestra los viernes, sábados y domingos cercanos que todavía tienen
salones libres. Es el inventario que se echa a perder y que el Lic. rellena con
paquetes de urgencia — entre más cerca el evento, más barato el paquete que
aplica.

El botón **Copiar para WhatsApp** arma el mensaje con el formato que ya usan,
listo para pegar.

En pantallas de menos de 860 px el sidebar se vuelve barra inferior: las
encargadas están en el salón con el teléfono.

---

## Editar desde el panel

Precios y contenido de los paquetes se editan en **Paquetes**. Antes de poder
guardar hay que elegir **quién está trabajando** en el sidebar: cada cambio
queda en la tabla `bitacora` con el nombre, el antes y el después.

> La bitácora se escribe desde el API, no con un trigger. Un trigger no puede
> saber quién hizo el cambio, y sin eso una auditoría no sirve de nada.

**Lo que el panel valida y una hoja de cálculo no podía:**

- **Traslapes.** Si un rango de invitados se encima con otro del mismo paquete,
  la base rechaza el cambio y el panel lo explica en vez de guardarlo.
- **Un dígito de menos.** Si un precio queda por debajo de la quinta parte de
  los otros días de la misma fila, avisa: *«¿Le falta un cero?»*. Es el caso
  real del `$4,940` de Santa Cruz que debía ser `$49,400`.
- **Precio que no sube con los invitados.** Si un rango mayor cuesta menos que
  el anterior, lo señala.

**Conceptos.** Los 78 se editan con un control de tres estados por concepto:
*Sí* lo incluye · *No* se cobra aparte · *—* no aplica. Con buscador, y se
pueden dar de alta conceptos nuevos. Nunca vuelven a convivir «Cámaras» y
«Camaras» como si fueran cosas distintas.

**Resolver conflictos.** En **Pendientes**, cada precio en disputa muestra sus
versiones como botones. Se toca el correcto: ese se queda y los demás se
retiran con fecha (`vigente_hasta`), sin borrarse, para no perder el rastro.

### La agenda

Cada evento se puede **corregir** o **cancelar** desde el día en el calendario.

- **Cancelar borra el registro de verdad.** Tenía que ser así: si el evento se
  quedara marcado de algún modo, seguiría ocupando el `UNIQUE(salón, fecha,
  turno)` y la fecha nunca volvería a venderse. El detalle —qué era, quién lo
  canceló y por qué— queda en la bitácora, que es donde vive el historial.
- **Un apartado sin vencimiento se rechaza.** El API no lo deja guardar: un
  apartado de $500 que nadie vigila es una fecha bloqueada para siempre. Al
  elegir «Apartado» el formulario propone hoy + 7 días, que es el plazo que
  marca la política.

### Los servicios

Se editan y se dan de alta desde **Servicios**: nombre, categoría, precio (o
rango en texto, para los que no tienen uno fijo), quién lo da, qué incluye, con
cuánto tiempo hay que pedirlo, y **en qué salones se ofrece**.

Ese último punto es un candado con marcha atrás: la migración desvincula los 12
servicios que no caben por capacidad, pero si el Lic. decide que sí, basta
marcar la casilla. **Dejar de ofrecerlo** apaga el servicio sin borrarlo.

---

## Zona horaria

`meses_anticipacion` se calcula **siempre** en `America/Monterrey`, dentro del
API. n8n corre en UTC: a las 19:00 de Monterrey ya es el día siguiente en UTC, y
el último día del mes eso cambia el escalón y con él el precio.

---

## Correcciones aplicadas al origen

Van en `build.py`, así que sobreviven a `npm run reset` y también quedan en el
Excel normalizado. Las dos están documentadas en su hoja **REVISAR**.

**1. Una errata del archivo original.** Fila 574 (Santa Cruz · Bronce · 100
invitados · 2027): el domingo decía **$4,940** y dice **$49,400**. En ese
paquete el domingo siempre queda 1,500 por debajo del viernes, y el viernes de
esa fila es 50,900.

**2. Herencia de escalón por precio idéntico.** Si una fila no tiene escalón
—porque su nota está redactada de una forma que el decodificador no lee— pero
calza **exactamente** con otra de otro salón que sí lo tiene (mismo paquete,
año, tramo de invitados y los tres precios de fin de semana), hereda su
escalón.

Eso recuperó **15 tarifas de Santa Cruz / Bronce 2027**, cuyos precios son
céntimo por céntimo los de Norma. No eran «tres versiones a elegir una»: eran
los tres escalones de la escalera. Descartar dos de cada tres habría borrado
dos tercios de la política de precios de ese salón.

Con eso Santa Cruz vuelve a poder ofrecer el descuento por cercanía, que es
como se llenan las fechas que se quedan sin vender:

| Faltan | Paquete | Precio |
|---:|---|---:|
| 0 meses | Bronce | $33,400 |
| 1 mes | Bronce | $35,400 |
| 2 meses | Bronce | $37,400 |
| 3 a 5 | Bronce | $52,400 |
| 6 o más | Onix | $69,400 |

Las tarifas marcadas bajaron de **21 a 6**, y las decisiones pendientes de
**8 a 3**.

## Lo que falta confirmar con el Lic. Barrón

Está todo en la pantalla **Por revisar** y en `GET /api/revisar`. Mientras siga
ahí, el cotizador no lo usa: deriva a la encargada en vez de arriesgar un precio.

1. **La Posada Deluxe de 281–300 invitados en 2028.** Es lo único que queda
   en disputa, y el patrón es demasiado limpio para ser un error de captura:

   | Salón | Precios por invitado | Diferencia |
   |---|---|---:|
   | Norma | $260 · $280 | +20 |
   | Esmeralda | $260 · $280 | +20 |
   | Santa Cruz | $250 · $270 | +20 |

   Exactamente +$20 en los tres salones. Huele a dos escalones, no a un
   duplicado, pero no hay evidencia de cuál corresponde a qué ventana de
   anticipación y ningún otro salón sirve de referencia. Elegir al azar son
   **$6,000 de diferencia** en una posada de 300 personas.
2. **24 contenidos duplicados.** Misma llave de paquete, salón y escalón con
   varias variantes de contenido.
3. **El hueco de 2026.** Quetzal no tiene tarifa de boda ni de XV para 2026.
4. **Los tramos de invitados.** Se asumió que cada tamaño cubre desde el
   siguiente al anterior: «150» cubre de 101 a 150. Los rangos de las posadas
   se hicieron contiguos para que ningún número de invitados quede sin precio.
5. **Hasta dónde está confirmada cada agenda**, y quién la actualiza. No es una
   pregunta técnica y es la que decide si el sistema dice la verdad en seis
   meses.

---

## Origen de los datos

`backend/db/exportar_seed.py` lee dos archivos:

- `Salones_Agustin_Info_Agente_IA (1) ACTUALIZADO.xlsx` — el original del cliente
- `paquetes_normalizado.xlsx` — el catálogo ya normalizado

Ambos en `E:\Music\promptsClientes\Proyecto Salones\`. Cada `tarifa` y cada
`compromiso` guarda su `fila_original`, para poder volver al Excel y resolver
cualquier discusión.
