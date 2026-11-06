// Maya esta apagada y el cliente sigue escribiendo.
//
// El 6-nov-2026 una clienta mando cuatro veces «¿con cuanto separo?» y
// despues «Adios». La IA se habia apagado a mano un minuto antes —con
// razon, estaba molestandola— y a partir de ahi sus mensajes cayeron en
// `sin_respuesta`, que es un nodo que NO HACE NADA. Nadie se entero.
//
// Esa pregunta valia el lead: se contesta con «$500» y una frase. Pero nadie
// la leyo hasta que Jorge abrio la conversacion a mano, y para entonces ya se
// habia despedido.
//
// Apagar la IA significa «que lo atienda una persona», no «que no lo atienda
// nadie». Asi que a partir de ahora se abre un aviso, igual que se hacia con
// los leads que el filtro de pruebas dejaba fuera. El panel no lo repite con
// cada mensaje del mismo cliente: avisa una vez y lo recuerda hasta que
// alguien lo cierra.
const d = $('formatLead').first().json;
const msg = $('formatear').first().json;

let salon = null;
try { salon = $('salon_del_numero').first().json.salon_fuente ?? null; } catch (e) { salon = null; }

const dijo = String(d.chats || msg.texto || '').trim().slice(0, 200)
  || (msg.adjunto_tipo ? `(mandó ${msg.adjunto_tipo}, sin texto)` : '(sin texto)');

return [{
  json: {
    lead_id: d.lead_id,
    salon,
    texto: `MAYA ESTÁ APAGADA en este lead y el cliente sigue escribiendo.`
      + ` ${d.autor || 'El cliente'} dice: «${dijo}».`
      + ` Nadie le va a contestar si no lo haces tú.`,
  },
}];
