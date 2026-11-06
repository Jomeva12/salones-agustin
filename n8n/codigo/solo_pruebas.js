// El freno de mano de Maya.
//
// ───────────────────────────────────────────────────────────────────────────
//  LISTA VACIA = MAYA LE CONTESTA A TODO EL MUNDO.  Asi esta desde el
//  6-nov-2026, que es cuando arranco de verdad.
// ───────────────────────────────────────────────────────────────────────────
//
// Mientras se vinculaban los WhatsApp hacia falta poder escribirle desde un
// numero propio sin que les contestara a los clientes de verdad. No servia
// apagar el webhook: apagado tampoco contesta a quien esta probando.
//
// Para volver a frenarla —una prueba, un arreglo en caliente— se ponen aqui
// ids de lead de Kommo y Maya solo le contesta a esos. Los dos que estuvieron
// hasta hoy:
//
//     '1313384',   // Jorge, por Telegram
//     '2261502',   // Lic. Barrón, por Telegram
//
// Cuando se vincula un canal nuevo no se sabe de antemano que lead va a
// crear: se escribe una vez, el aviso que sale al grupo trae el id y el
// enlace al lead, y se añade aqui.
const SOLO_ESTOS = [];

// No es `$json`: delante hay una peticion a Kommo y su respuesta no
// trae el mensaje. Se lee del nodo por su nombre.
const d = $('formatear').first().json;
const permitido = !SOLO_ESTOS.length
  || SOLO_ESTOS.map(String).includes(String(d.lead_id));

// Quien NO pasa no desaparece: se abre un aviso para que alguien lo atienda a
// mano. Un cliente que escribe y no recibe respuesta —ni humana ni de Maya— es
// un cliente perdido sin que nadie se entere, y eso es peor que no haber
// puesto el filtro. Lo mismo hace Revolution, que anota en `ia_control_saltados`
// a quien se salto la IA.
//
// El aviso lo crea el panel, que ya se encarga de publicarlo en el grupo y de
// no repetirlo con cada mensaje del mismo cliente.
return [{
  json: {
    ...d,
    permitido,
    aviso_texto: permitido ? null
      : `MAYA ESTÁ EN PRUEBAS y no le contestó al lead ${d.lead_id}.`
        + ` Escribió ${d.autor || 'alguien'} por ${d.origen || 'el canal'}:`
        + ` «${String(d.texto || '').slice(0, 160)}». Atiéndelo a mano desde Kommo.`,
  },
}];
