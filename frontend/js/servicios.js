// Los 104 servicios adicionales, agrupados por categoría. En una tabla plana
// son un muro; por categoría se encuentran como se piensan.
import { api, pesos, error, usuarioActual, salonActual, fijarSalon } from './api.js';
import { el, limpiar, cargando, abrirCajon, cerrarCajon } from './ui.js';
import { confirmar } from './confirmar.js';

const CATEGORIAS = ['Bebidas', 'Comida', 'Decoración', 'Espectáculos', 'Fotografía',
  'Mobiliario', 'Personal y belleza', 'Transporte', 'Trámites y cambios', 'Vestuario', 'Otros'];
const TODOS = [['norma', 'Norma'], ['esmeralda', 'Esmeralda'],
  ['santacruz', 'Santa Cruz'], ['quetzal', 'Quetzal']];
const SALONES = [['', 'Todos'], ...TODOS];
const ORIGEN = [['', 'Todos'], ['1', 'Del salón'], ['0', 'De proveedor']];
// Casi todo se pide con una semana. Lo que pide más se avisa en la tarjeta.
const ANTICIPACION_NORMAL = '1 semana';

let filtroCat = '';
let filtroOrigen = '';

/** Una fila de botones que se comporta como un select. */
function pildoras(opciones, actual, alElegir, clase = 'pildoras') {
  return el('div', { class: clase, role: 'radiogroup' }, opciones.map(([v, t]) => el('button', {
    type: 'button', role: 'radio', 'aria-checked': String(actual === v),
    class: `pildora${actual === v ? ' sel' : ''}`, text: t, onclick: () => alElegir(v),
  })));
}

export async function servicios(raiz) {
  limpiar(raiz);
  filtroCat = '';
  filtroOrigen = '';
  let salon = salonActual();
  const cont = el('div');
  raiz.append(cont);
  cont.append(el('div', { class: 'titulo' }, [
    el('h2', { text: 'Servicios' }),
    el('p', { text: 'Todo lo que se contrata aparte del paquete. Al elegir un salón solo aparecen los que caben: una barra libre para 300 no se ofrece donde caben 150.' }),
  ]));

  const buscar = el('input', { type: 'search', placeholder: 'Buscar: mariachi, limusina, pastel…' });
  const zonaSalon = el('div');
  const zonaOrigen = el('div');
  const categorias = el('div', { class: 'filtros-cat' });
  const salida = el('div');

  const pintarFiltros = () => {
    limpiar(zonaSalon).append(pildoras(SALONES, salon, (v) => {
      salon = v; filtroCat = ''; fijarSalon(v); pintarFiltros(); recargar();
    }));
    limpiar(zonaOrigen).append(pildoras(ORIGEN, filtroOrigen, (v) => {
      filtroOrigen = v; pintarFiltros(); recargar();
    }));
  };
  pintarFiltros();

  cont.append(el('section', { class: 'bloque-cot barra-serv' }, [
    el('div', { class: 'fila-buscar' }, [
      buscar,
      el('button', { class: 'primario', text: '+ Nuevo servicio', onclick: () => editor(null, recargar) }),
    ]),
    el('div', { class: 'fila-filtros' }, [
      el('div', { class: 'filtro-grupo' }, [el('span', { class: 'etq', text: 'Salón' }), zonaSalon]),
      el('div', { class: 'filtro-grupo' }, [el('span', { class: 'etq', text: 'Quién lo da' }), zonaOrigen]),
    ]),
    categorias,
  ]));
  cont.append(salida);

  let reloj;
  buscar.addEventListener('input', () => { clearTimeout(reloj); reloj = setTimeout(recargar, 250); });

  async function recargar() {
    limpiar(salida).append(cargando('tarjetas'));
    try {
      const todas = await api.servicios(salon, buscar.value);
      const filas = filtroOrigen === '' ? todas : todas.filter((s) => String(s.es_propio) === filtroOrigen);
      pintarCategorias(filas, categorias, recargar);
      limpiar(salida);
      const visibles = filtroCat ? filas.filter((s) => s.categoria === filtroCat) : filas;
      if (!visibles.length) {
        salida.append(el('div', { class: 'bloque-cot vacio', text: 'No encontré servicios con ese filtro.' }));
        return;
      }
      const grupos = new Map();
      for (const s of visibles) {
        if (!grupos.has(s.categoria)) grupos.set(s.categoria, []);
        grupos.get(s.categoria).push(s);
      }
      // Las categorías con más servicios primero, igual que en los filtros.
      for (const [cat, lista] of [...grupos].sort((a, b) => b[1].length - a[1].length)) {
        const rej = el('div', { class: 'rejilla-serv escalona' });
        for (const s of lista) rej.append(tarjeta(s, recargar));
        const propios = lista.filter((s) => s.es_propio).length;
        salida.append(el('section', { class: 'bloque-cot grupo-serv' }, [
          el('header', { class: 'cab-bloque' }, [
            el('h3', { text: cat }),
            el('span', { class: 'cuenta-paq', text: `${lista.length} · ${propios} del salón` }),
          ]),
          rej,
        ]));
      }
      salida.append(el('div', { class: 'pie-cal', style: 'margin-top:14px',
        text: salon
          ? `${filas.length} servicios caben en ${SALONES.find(([v]) => v === salon)[1]}.`
          : `${filas.length} servicios en total.` }));
    } catch (e) { limpiar(salida).append(error(e.message)); }
  }
  await recargar();
}

function pintarCategorias(filas, caja, recargar) {
  const cuenta = new Map();
  for (const s of filas) cuenta.set(s.categoria, (cuenta.get(s.categoria) ?? 0) + 1);
  limpiar(caja);
  const hacer = (valor, texto, n) => el('button', {
    type: 'button', class: `filtro-cat${filtroCat === valor ? ' sel' : ''}`,
    onclick: () => { filtroCat = filtroCat === valor ? '' : valor; recargar(); },
  }, [texto, el('b', { text: String(n) })]);
  caja.append(hacer('', 'Todas', filas.length));
  for (const [c, n] of [...cuenta].sort((a, b) => b[1] - a[1])) caja.append(hacer(c, c, n));
}

function tarjeta(s, recargar) {
  const especial = s.anticipacion_minima
    && ![ANTICIPACION_NORMAL, 'En cualquier momento'].includes(s.anticipacion_minima);
  return el('button', { class: `serv${s.es_propio ? ' propio' : ''}`, onclick: () => editor(s.id, recargar) }, [
    el('div', { class: 'nom', text: s.nombre }),
    el('div', { class: 'pre', text: s.precio !== null ? pesos(s.precio) : (s.precio_texto ?? '—') }),
    s.que_incluye ? el('div', { class: 'inc', text: s.que_incluye }) : null,
    el('div', { class: 'etiquetas-serv' }, [
      el('span', { class: `chip ${s.es_propio ? 'propio' : 'neutro'}`, text: s.es_propio ? 'Del salón' : 'Proveedor' }),
      s.personas_ref ? el('span', { class: 'chip neutro', text: `para ${s.personas_ref}` }) : null,
      especial ? el('span', { class: 'chip duda', title: 'Con cuánto tiempo hay que pedirlo', text: s.anticipacion_minima }) : null,
    ]),
  ]);
}

/** Ficha editable. Con id edita; sin id da de alta uno nuevo. */
async function editor(id, recargar) {
  const nuevo = id === null;
  const cuerpo = abrirCajon(nuevo ? 'Nuevo servicio' : 'Servicio',
    nuevo ? 'Se ofrecerá en los salones que marques' : null);
  // Mismo panel en tres pisos que Paquetes: el botón de guardar siempre a la
  // vista, no al final de un formulario largo.
  cuerpo.closest('.cajon')?.classList.add('form');
  cuerpo.classList.add('cajon-cuerpo');
  const panel = el('div', { class: 'cajon-panel' });
  cuerpo.append(panel);
  if (!nuevo) panel.append(cargando());

  let s = { nombre: '', precio: null, precio_texto: '', es_propio: 1, que_incluye: '',
    anticipacion_minima: ANTICIPACION_NORMAL, notas: '', categoria: 'Otros', activo: 1,
    salones: TODOS.map(([c]) => c), personas_ref: null };
  if (!nuevo) {
    try { s = await api.servicio(id); }
    catch (e) { limpiar(panel).append(error(e.message)); return; }
    const h3 = cuerpo.closest('.cajon')?.querySelector('.cajon-top h3');
    if (h3) h3.textContent = s.nombre;
  }
  limpiar(panel);

  const nombre = el('input', { type: 'text', value: s.nombre });
  const categoria = el('select', {}, CATEGORIAS.map((c) => el('option', { value: c, text: c })));
  categoria.value = CATEGORIAS.includes(s.categoria) ? s.categoria : 'Otros';
  const precio = el('input', { type: 'number', min: '0', step: '50',
    value: s.precio === null ? '' : String(s.precio) });
  const precioTexto = el('input', { type: 'text', placeholder: 'Ej. $5,000 a $10,000',
    value: s.precio_texto ?? '' });
  let esPropio = String(s.es_propio ? 1 : 0);
  const zonaOrigen = el('div');
  const pintarOrigen = () => limpiar(zonaOrigen).append(pildoras(
    [['1', 'Lo da el salón'], ['0', 'Lo da un proveedor']], esPropio,
    (v) => { esPropio = v; pintarOrigen(); }));
  pintarOrigen();
  const incluye = el('textarea', { rows: '4' });
  incluye.value = s.que_incluye ?? '';
  const anticipacion = el('input', { type: 'text', value: s.anticipacion_minima ?? '' });
  const notas = el('textarea', { rows: '3' });
  notas.value = s.notas ?? '';

  // Los salones como interruptores: se ve de un golpe dónde se ofrece.
  const marcados = new Set(s.salones ?? []);
  const zonaSalones = el('div');
  const pintarSalones = () => limpiar(zonaSalones).append(el('div', { class: 'pildoras' },
    TODOS.map(([clave, txt]) => el('button', {
      type: 'button', role: 'checkbox', 'aria-checked': String(marcados.has(clave)),
      class: `pildora${marcados.has(clave) ? ' sel' : ''}`, text: (marcados.has(clave) ? '✓ ' : '') + txt,
      onclick: () => { marcados.has(clave) ? marcados.delete(clave) : marcados.add(clave); pintarSalones(); },
    }))));
  pintarSalones();

  const aviso = el('span', { class: 'estado' });
  const falla = (t) => { aviso.style.color = 'var(--ocupada)'; aviso.textContent = t; };
  const guardar = el('button', { class: 'primario', text: nuevo ? 'Crear servicio' : 'Guardar cambios',
    onclick: async () => {
      if (!usuarioActual()) { falla('Primero elige quién eres.'); return; }
      const datos = {
        nombre: nombre.value.trim(), categoria: categoria.value,
        precio: precio.value === '' ? null : Number(precio.value),
        precio_texto: precioTexto.value.trim(),
        es_propio: esPropio === '1',
        que_incluye: incluye.value.trim(),
        anticipacion_minima: anticipacion.value.trim(),
        notas: notas.value.trim(),
        salones: TODOS.map(([c]) => c).filter((c) => marcados.has(c)),
      };
      if (!datos.salones.length) {
        falla('Marca al menos un salón, si no el servicio no le aparece a nadie.');
        return;
      }
      guardar.disabled = true;
      try {
        const r = nuevo ? await api.crearServicio(datos)
          : await api.editarServicio({ ...datos, id: s.id });
        if (r.error) { falla(r.detalle ?? r.error); guardar.disabled = false; return; }
        cerrarCajon();
        recargar();
      } catch (e) { falla(e.message); guardar.disabled = false; }
    } });

  const seccion = (titulo, hijos) => el('section', { class: 'seccion-form' }, [
    el('h4', { text: titulo }), ...hijos]);
  const campo = (texto, control, ayuda) => el('label', { class: 'campo' }, [
    texto, control, ayuda ? el('span', { class: 'ayuda-campo', text: ayuda }) : null]);

  panel.append(
    seccion('Lo que ve el cliente', [
      campo('Cómo se llama', nombre),
      el('div', { class: 'fila' }, [
        campo('Categoría', categoria),
        campo('Precio', precio),
      ]),
      campo('Si el precio es un rango', precioTexto, 'Solo cuando no hay un precio fijo: «$5,000 a $10,000».'),
      campo('Qué incluye', incluye),
    ]),
    seccion('Cómo se da', [
      el('div', { class: 'campo' }, ['Quién lo da', zonaOrigen]),
      campo('Con cuánto tiempo hay que pedirlo', anticipacion),
      campo('Notas internas', notas),
    ]),
    seccion('Dónde se ofrece', [
      zonaSalones,
      s.personas_ref ? el('div', { class: 'aviso info', style: 'margin-top:10px',
        text: `Está dimensionado para ${s.personas_ref} personas. Si lo marcas en un salón más chico, ahí aparecerá de todos modos.` }) : null,
    ]),
    el('div', { class: 'barra-guardar' }, [guardar, ...(nuevo ? [] : [bajaBoton(s, recargar, falla)]), aviso]),
  );
  nombre.focus();
}

function bajaBoton(s, recargar, falla) {
  return el('button', { class: 'peligro', text: 'Dejar de ofrecerlo',
    onclick: async () => {
      if (!usuarioActual()) { falla('Primero elige quién eres.'); return; }
      // Antes se retiraba al primer clic; ahora pregunta.
      const hecho = await confirmar({
        titulo: '¿Dejar de ofrecer este servicio?',
        texto: [el('b', { text: s.nombre }), '. El agente deja de ofrecerlo en los cuatro salones.'],
        nota: 'No se borra: se puede volver a activar más adelante.',
        confirmar: 'Sí, dejar de ofrecerlo', cancelar: 'No, dejarlo',
        accion: () => api.editarServicio({ id: s.id, activo: false }),
      });
      if (hecho) { cerrarCajon(); recargar(); }
    } });
}
