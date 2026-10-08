// Días que no cierran el salón, pero cambian lo que hay que decirle al cliente.
//
// La estrenó Semana Santa: la iglesia no celebra misas esos días, así que
// quien quería misa para su boda no la va a tener. Lo que NO pasa es que la
// fecha deje de venderse — la instrucción del Lic. Barrón fue explícita, y es
// justo lo contrario de lo que uno haría por instinto: se cotiza, se avisa, y
// si el cliente duda se le pasa a un asesor. Lo que se quiere es vender.
//
// Por eso la pantalla enseña «Se vende igual» en verde y no como advertencia.
import { api, error, puede } from './api.js';
import { el, limpiar, cargando, fechaLarga } from './ui.js';

const hoyISO = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')].join('-');
};

export async function especiales(raiz) {
  limpiar(raiz);
  const cont = el('div', { class: 'esp-pag' });
  raiz.appendChild(cont);

  let verPasadas = false;
  const cabecera = el('header', { class: 'esp-cab' });
  const cuerpo = el('div');
  cont.append(cabecera, cuerpo);

  async function pintar() {
    limpiar(cuerpo);
    cuerpo.appendChild(cargando('lista'));
    let d;
    try {
      d = await api.fechasEspeciales(true);
    } catch {
      limpiar(cuerpo);
      cuerpo.appendChild(error('No se pudieron leer las fechas especiales.'));
      return;
    }
    limpiar(cuerpo);

    const hoy = hoyISO();
    // Lo que ya pasó se esconde: son siete años sembrados y la lista entera
    // entierra lo que de verdad se está vendiendo.
    const todas = d.fechas ?? [];
    const lista = verPasadas ? todas : todas.filter((f) => f.hasta >= hoy);

    if (!lista.length) {
      cuerpo.appendChild(el('p', { class: 'esp-vacio', text: 'No hay fechas marcadas.' }));
    } else {
      const caja = el('div', { class: 'esp-lista' });
      for (const f of lista) caja.appendChild(tarjeta(f, f.hasta < hoy));
      cuerpo.appendChild(caja);
    }

    if (puede('respuestas')) cuerpo.appendChild(nueva());
  }

  function tarjeta(f, pasada) {
    const aviso = el('span', { class: 'esp-guardado' });
    // `text` y no `value`: en un textarea el contenido inicial es su texto, y
    // un atributo value lo ignora en silencio — el campo sale vacio y parece
    // que la fila no tenia aviso.
    const texto = el('textarea', { rows: '3', text: f.aviso });
    const notas = el('textarea', { rows: '2', text: f.notas ?? '',
      placeholder: 'Notas para el equipo. El agente no las dice.' });

    const guardar = async (campos, boton) => {
      if (boton) boton.disabled = true;
      aviso.className = 'esp-guardado';
      try {
        await api.editarFechaEspecial({ id: f.id, ...campos });
        aviso.textContent = 'Guardado.';
        Object.assign(f, campos);
        setTimeout(() => { aviso.textContent = ''; }, 2500);
      } catch (e) {
        aviso.className = 'esp-guardado mal';
        aviso.textContent = e.message;
      } finally { if (boton) boton.disabled = false; }
    };

    const acciones = el('div', { class: 'esp-acciones' });
    if (puede('respuestas')) {
      const btn = el('button', { class: 'primario', text: 'Guardar',
        onclick: () => guardar({ aviso: texto.value, notas: notas.value }, btn) });
      acciones.append(btn, aviso);
    } else {
      texto.disabled = true; notas.disabled = true;
    }

    return el('article', { class: 'esp-tarjeta' + (f.activa ? '' : ' apagada') + (pasada ? ' pasada' : '') }, [
      el('div', { class: 'esp-arriba' }, [
        el('b', { text: f.titulo }),
        el('span', { class: 'esp-rango',
          text: `${fechaLarga(f.desde)} — ${fechaLarga(f.hasta)}` }),
        el('span', { class: 'esp-sello ' + (f.se_cotiza ? 'vende' : 'cierra'),
          text: f.se_cotiza ? 'Se vende igual' : 'No se vende' }),
      ]),
      el('label', { class: 'esp-campo' }, [
        el('span', { text: 'Lo que el agente le dice al cliente' }), texto,
      ]),
      el('label', { class: 'esp-campo' }, [
        el('span', { text: 'Notas internas' }), notas,
      ]),
      acciones,
    ]);
  }

  function nueva() {
    const titulo = el('input', { type: 'text', placeholder: 'Nombre, p. ej. «Puente de noviembre 2027»' });
    const desde = el('input', { type: 'date' });
    const hasta = el('input', { type: 'date' });
    const aviso = el('textarea', { rows: '3',
      placeholder: 'Lo que el agente le tiene que decir a quien pida esa fecha.' });
    const vende = el('input', { type: 'checkbox', checked: '' });
    const dicho = el('span', { class: 'esp-guardado' });

    const crear = el('button', { class: 'primario', text: 'Agregar', onclick: async () => {
      crear.disabled = true;
      dicho.className = 'esp-guardado';
      try {
        await api.crearFechaEspecial({
          titulo: titulo.value, desde: desde.value, hasta: hasta.value,
          aviso: aviso.value, se_cotiza: vende.checked,
        });
        titulo.value = ''; aviso.value = '';
        await pintar();
      } catch (e) {
        dicho.className = 'esp-guardado mal';
        dicho.textContent = e.message;
      } finally { crear.disabled = false; }
    } });

    return el('section', { class: 'esp-nueva' }, [
      el('b', { text: 'Marcar otra fecha' }),
      el('p', { class: 'esp-ayuda', text:
        'Las Semanas Santas ya están puestas hasta 2032 y se calculan solas. Esto es ' +
        'para lo demás: un puente, una obra, un día que el salón abre distinto.' }),
      el('div', { class: 'esp-campos' }, [titulo, desde, hasta]),
      aviso,
      el('label', { class: 'esp-check' }, [vende, el('span', { text: 'La fecha se sigue vendiendo (solo se avisa)' })]),
      el('div', { class: 'esp-acciones' }, [crear, dicho]),
    ]);
  }

  const filtro = el('button', { class: 'fantasma', text: 'Ver también las que ya pasaron',
    onclick: () => {
      verPasadas = !verPasadas;
      filtro.textContent = verPasadas ? 'Ver solo las que vienen' : 'Ver también las que ya pasaron';
      pintar();
    } });

  cabecera.append(
    el('h1', { text: 'Fechas especiales' }),
    el('p', { class: 'esp-sub', text:
      'Días que no cierran el salón pero cambian lo que hay que decir. El agente lo ' +
      'avisa al cotizar, y la fecha se vende igual.' }),
    el('div', { class: 'esp-controles' }, [filtro]));

  pintar();
}
