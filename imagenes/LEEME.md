# Las imágenes

Dos clases distintas, en dos tablas distintas:

- **Láminas de paquete** (`paquete_imagen`) — la hoja de cada paquete en cada
  salón, con su lista de lo que incluye. Es la que acompaña a la cotización.
- **Fotos de cortesías** (`cortesia_imagen`) — la foto de una cosa concreta:
  el Espejo de Bienvenida, el Aro iluminado. No pertenecen a un paquete: el
  Espejo aparece en el Onix, el Plata y el Oro y es la misma foto.

Las dos viven en el **Drive de Kommo**, no aquí. No es preferencia: el adjunto
del salesbot solo acepta un uuid de archivo de Kommo, y cualquier otra URL se
descarta en silencio. La base guarda únicamente la URL.

Los archivos de imagen **no se versionan** — pesan y el repositorio es
público. Lo que sí se versiona es cada `mapa.json` y el `laminas.json`.

## Cómo se sube una tanda

1. Dejar los archivos en `imagenes/<salon>/` (o `.../cortesias/`).
2. Escribir el `mapa.json` de esa carpeta. Una entrada por imagen:
   - lámina: `{archivo, paquete, salon, etiqueta}` — `etiqueta` solo cuando un
     paquete tiene varias láminas (ver abajo).
   - cortesía: `{archivo, cortesia, salon, titulo}`.
3. `node backend/db/subir_imagenes.mjs imagenes/<salon>/mapa.json`
   Sube lo que cambió, se salta lo que ya está igual (compara por sha256) y
   reescribe `imagenes/laminas.json`, que es el manifiesto.
4. En producción, después de un Deploy:
   `node backend/db/aplicar_imagenes.mjs`
   Mete las URLs del manifiesto en la base del servidor. Las imágenes ya están
   en el Drive —son las mismas para toda la cuenta—, así que al contenedor no
   hay que subirle ningún archivo.

## El caso del baby shower

«Baby Shower, Despedidas de Soltera y Bautizos» es **un solo paquete** en
precio y contenido, pero el arte lo parte en **tres** láminas. Por eso existe
`etiqueta`: `babyshower`, `despedida`, `bautizo`. Cuál se manda lo decide lo
que escribió el cliente, no el paquete.

## Qué hay cargado

| Salón | Láminas | Cortesías |
|---|---|---|
| Norma | 12 ✅ | 5 de 8 |
| Esmeralda | 12 ✅ | — |
| Santa Cruz | 12 ✅ | — |
| Quetzal | — | — |

## Qué falta

- **Quetzal**, sus 12 láminas. No calca a los otros: sus paquetes se llaman
  distinto (*Plata Boda y XV*, *Onix Boda y XV*, *Bronce Boda y XV*) y además
  tiene *Aniversarios / Cumpleaños*, que solo existe ahí.
- **Tres cortesías de Norma**: uso del vestido, arreglo de la escalera de
  presentación y arreglo de la mesa principal.
- **Las cortesías de los otros tres salones.** Cada salón tiene las suyas; las
  está generando el cliente.
- **La regla de cuándo se manda una cortesía.** Hoy el selector solo mira
  láminas de paquete, así que las fotos de cortesías están cargadas pero no se
  envían. Falta decidir —y escribir— que **cotizando gana siempre la lámina
  del paquete**: Maya nombra las cortesías dentro de la cotización, y sin esa
  regla cotizar el Plata podría acabar mandando la foto del aro iluminado.

## De qué salón se habla

Lo decide **la fuente del lead**: cada salón tiene su propio WhatsApp, así que
a quien escribe al de Norma se le da información de Norma. Si ese día no hay
disponibilidad se avisa, pero no se cambia de salón por cuenta propia.

Eso **todavía no está implementado**. Hoy el salón sale de lo que el cliente
nombra en el mensaje o del campo Salón del lead, y cuando varios están libres
el agente toma el primero que devuelve el panel — que es el orden de alta, sin
ninguna justificación comercial.

Importa también para las imágenes: sin saber el salón no se manda ninguna, y
hoy esa es la razón más común de que no vaya foto.

## Lo que no son cortesías

De las nueve fotos que llegaron para Norma, cuatro no entraron y conviene
recordar por qué:

- el cartón de Tecate Light es **contenido del paquete**, no cortesía;
- Mariachi, Ballet, Batucada y Payasos son **servicios que se venden aparte**;
- dos son **material de ambiente del salón**, con botón de agendar visita.

Ninguna de las tres categorías tiene todavía su cajón.
