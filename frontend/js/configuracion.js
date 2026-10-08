// Configuración. Por ahora, quién entra al panel y qué puede tocar.
//
// La regla que ordena esta pantalla: quien administra nunca escribe la
// contraseña de otra persona. El servidor genera una temporal, aquí se enseña
// UNA vez para dictarla, y quien la recibe la cambia al entrar. Así nadie
// termina sabiendo la clave de nadie, ni siquiera el Lic. Barrón.
import { api, error, sesion } from './api.js';
import { el, limpiar, cargando } from './ui.js';
import { confirmar } from './confirmar.js';

const ROLES = [
  ['admin', 'Administrador', 'Todo: agenda, precios, servicios y usuarios.'],
  ['encargada', 'Encargada', 'La agenda y los servicios de su salón. No toca precios.'],
  ['consulta', 'Solo consulta', 'Puede ver todo, no puede cambiar nada.'],
];
const ROL_CORTO = Object.fromEntries(ROLES.map(([v, t]) => [v, t]));

let salones = [];

export async function configuracion(raiz) {
  limpiar(raiz);
  const cont = el('div', { class: 'config' });
  raiz.append(cont);

  const yo = sesion();
  if (!yo || yo.rol !== 'admin') {
    cont.append(el('div', { class: 'aviso atencion' }, [
      el('b', { text: 'Esta pantalla es solo para administradores. ' }),
      'Tu cuenta puede ver y mover lo suyo, pero no dar de alta ni cambiar cuentas. ' +
      'Si necesitas una cuenta nueva para alguien, pídeselo a quien administra el panel.',
    ]));
    return;
  }

  cont.append(el('div', { class: 'encabezado-pagina' }, [
    el('h2', { text: 'Configuración' }),
    el('p', { text: 'Quién entra al panel y qué puede tocar cada quien.' }),
  ]));

  const zona = el('div');
  cont.append(zona);
  await pintar(zona);
}

async function pintar(zona) {
  limpiar(zona).append(cargando());
  let lista;
  try {
    [lista, salones] = await Promise.all([api.usuarios(), salones.length ? salones : api.salones()]);
  } catch (e) { limpiar(zona).append(error('No se pudo cargar: ' + e.message)); return; }

  limpiar(zona);
  const admins = lista.filter((u) => u.rol === 'admin' && u.activo).length;

  // El alta, arriba: es lo que se viene a hacer aquí.
  const zonaAlta = el('div');
  const abrir = el('button', {
    class: 'primario', text: '+ Crear cuenta',
    onclick: () => { abrir.hidden = true; zonaAlta.append(formularioAlta(zona, abrir)); },
  });
  zona.append(el('div', { class: 'barra-config' }, [
    el('div', { class: 'cuenta-cuentas' },
      [el('b', { text: String(lista.filter((u) => u.activo).length) }),
       ` cuenta${lista.filter((u) => u.activo).length === 1 ? '' : 's'} activa` +
       `${lista.filter((u) => u.activo).length === 1 ? '' : 's'}`]),
    abrir,
  ]), zonaAlta);

  const tabla = el('div', { class: 'usuarios' });
  for (const u of lista) tabla.append(tarjetaUsuario(u, zona, admins));
  zona.append(tabla);

  zona.append(el('div', { class: 'nota-config' }, [
    el('b', { text: 'Sobre las contraseñas. ' }),
    'El panel no las guarda: guarda un cálculo del que no se puede volver atrás. ',
    'Por eso nadie —ni tú— puede consultar la contraseña de alguien más; lo único ',
    'posible es generar una nueva. Y por eso, cuando aparezca una temporal en ',
    'pantalla, hay que anotarla o dictarla en ese momento: no se vuelve a mostrar.',
  ]));
}

// ── una cuenta ──────────────────────────────────────────────────────────────
function tarjetaUsuario(u, zona, admins) {
  const yo = sesion();
  const propia = u.usuario === yo.usuario;
  const bloqueado = u.bloqueado_hasta && Date.parse(u.bloqueado_hasta + 'Z') > Date.now();
  const ultimoAdmin = u.rol === 'admin' && u.activo && admins <= 1;

  const chips = el('div', { class: 'chips' }, [
    el('span', { class: `chip ${u.rol}`, text: ROL_CORTO[u.rol] }),
    u.salon ? el('span', { class: 'chip', text: nombreSalon(u.salon) }) : null,
    propia ? el('span', { class: 'chip tu', text: 'tú' }) : null,
    !u.activo ? el('span', { class: 'chip apagada', text: 'desactivada' }) : null,
    u.debe_cambiar && u.activo
      ? el('span', { class: 'chip duda', text: 'no ha estrenado su contraseña' }) : null,
    bloqueado ? el('span', { class: 'chip duda', text: 'bloqueada por intentos' }) : null,
  ].filter(Boolean));

  const zonaForm = el('div');
  const acciones = el('div', { class: 'fila', style: 'margin-top:12px' });
  const card = el('div', { class: `tarjeta cuenta${u.activo ? '' : ' apagada'}` }, [
    el('div', { class: 'cabeza-cuenta' }, [
      el('div', {}, [
        el('div', { class: 'nombre', text: u.nombre }),
        el('div', { class: 'usuario', text: '@' + u.usuario }),
      ]),
      el('div', { class: 'acceso', text: u.ultimo_acceso ? `Entró el ${fecha(u.ultimo_acceso)}` : 'Nunca ha entrado' }),
    ]),
    chips, acciones, zonaForm,
  ]);

  const soloUno = (fn) => { acciones.hidden = true; limpiar(zonaForm).append(fn()); };
  const volver = () => { acciones.hidden = false; limpiar(zonaForm); };

  acciones.append(el('button', { text: 'Cambiar rol o salón',
    onclick: () => soloUno(() => formularioEditar(u, zona, volver, ultimoAdmin)) }));
  acciones.append(el('button', { text: 'Generar contraseña nueva', onclick: async () => {
    let respuesta = null;
    const hecho = await confirmar({
      tipo: 'normal',
      titulo: `¿Generar una contraseña nueva para ${u.nombre}?`,
      texto: 'Su contraseña actual deja de servir en el momento, y si tiene una sesión abierta se le cierra.',
      nota: 'Tendrás que dictarle la nueva: se muestra una sola vez.',
      confirmar: 'Sí, generar una nueva',
      accion: async () => { respuesta = await api.claveUsuario({ usuario: u.usuario }); return respuesta; },
    });
    if (hecho) mostrarClave(zona, respuesta, `Contraseña nueva para ${u.nombre}.`);
  } }));
  if (bloqueado) {
    acciones.append(el('button', { text: 'Quitar el bloqueo', onclick: async (e) => {
      e.target.disabled = true;
      await api.desbloquearUsuario({ usuario: u.usuario });
      pintar(zona);
    } }));
  }
  if (u.activo && !propia) {
    acciones.append(el('button', { style: 'color:var(--ocupada)', text: 'Desactivar', onclick: async () => {
      const hecho = await confirmar({
        titulo: `¿Desactivar a ${u.nombre}?`,
        texto: 'No se borra: la cuenta se apaga y se le cierra la sesión. Lo que ya hizo sigue firmado ' +
          'con su nombre en la bitácora. Se puede reactivar cuando quieras.',
        nota: ultimoAdmin ? 'Es la única cuenta de administrador activa: el servidor no va a dejar desactivarla.' : null,
        confirmar: `Sí, desactivar a ${u.nombre}`,
        accion: () => api.editarUsuario({ usuario: u.usuario, activo: false }),
      });
      if (hecho) pintar(zona);
    } }));
  }
  if (!u.activo) {
    acciones.append(el('button', { text: 'Reactivar', onclick: async (e) => {
      e.target.disabled = true;
      const r = await api.editarUsuario({ usuario: u.usuario, activo: true });
      if (r.error) { e.target.disabled = false; return; }
      pintar(zona);
    } }));
  }
  return card;
}

// ── alta ────────────────────────────────────────────────────────────────────
function formularioAlta(zona, botonAbrir) {
  const nombre = el('input', { type: 'text', placeholder: 'Nelly Tovar', style: 'width:100%' });
  const usuario = el('input', { type: 'text', placeholder: 'nelly', autocapitalize: 'off', spellcheck: false });
  const rol = el('select', {}, ROLES.map(([v, t]) => el('option', { value: v, text: t })));
  const salon = el('select', {}, [el('option', { value: '', text: 'Los cuatro' })]
    .concat(salones.map((s) => el('option', { value: s.clave, text: s.nombre.replace(' Eventos', '') }))));
  const ayudaRol = el('div', { class: 'ayuda-rol' });
  const aviso = el('div', { class: 'aviso-form' });

  // El nombre de usuario se propone del nombre, pero se puede cambiar: nadie
  // quiere teclear «lic. agustín barrón» para entrar.
  let tocado = false;
  usuario.addEventListener('input', () => { tocado = true; });
  nombre.addEventListener('input', () => {
    if (tocado) return;
    usuario.value = nombre.value.trim().toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 20);
  });

  const ajustar = () => {
    const [, , explica] = ROLES.find(([v]) => v === rol.value);
    ayudaRol.textContent = explica;
    // Solo la encargada queda amarrada a un salón; los otros dos ven los cuatro.
    campoSalon.hidden = rol.value !== 'encargada';
  };
  const campoSalon = el('label', { class: 'campo' }, ['Salón a su cargo', salon]);
  rol.addEventListener('change', ajustar);

  const guardar = el('button', { class: 'primario', text: 'Crear cuenta', onclick: async () => {
    aviso.textContent = '';
    guardar.disabled = true;
    try {
      const r = await api.crearUsuario({
        usuario: usuario.value.trim(), nombre: nombre.value.trim(),
        rol: rol.value, salon: rol.value === 'encargada' ? salon.value : null,
      });
      if (r.error) { aviso.textContent = r.detalle ?? r.error; guardar.disabled = false; return; }
      // La clave se enseña sola, fuera del formulario, y se queda hasta que
      // la cierren: si se fuera con el repintado, se perdería para siempre.
      mostrarClave(zona, r, `Cuenta creada para ${nombre.value.trim()}.`);
    } catch (e) { aviso.textContent = e.message; guardar.disabled = false; }
  } });

  const caja = el('div', { class: 'alta' }, [
    el('div', { class: 'rotulo', text: 'Cuenta nueva' }),
    el('div', { class: 'fila' }, [
      el('label', { class: 'campo ancho' }, ['Nombre completo', nombre]),
      el('label', { class: 'campo' }, ['Usuario (con lo que entra)', usuario]),
    ]),
    el('div', { class: 'fila' }, [
      el('label', { class: 'campo' }, ['Qué puede hacer', rol]),
      campoSalon,
    ]),
    ayudaRol,
    el('div', { class: 'fila', style: 'margin-top:14px' }, [
      guardar,
      el('button', { class: 'fantasma', text: 'Cancelar', onclick: () => {
        caja.remove(); botonAbrir.hidden = false;
      } }),
    ]),
    aviso,
  ]);
  ajustar();
  setTimeout(() => nombre.focus(), 30);
  return caja;
}

// ── editar ──────────────────────────────────────────────────────────────────
function formularioEditar(u, zona, volver, ultimoAdmin) {
  const nombre = el('input', { type: 'text', value: u.nombre, style: 'width:100%' });
  const rol = el('select', {}, ROLES.map(([v, t]) => el('option', { value: v, text: t })));
  rol.value = u.rol;
  const salon = el('select', {}, [el('option', { value: '', text: '—' })]
    .concat(salones.map((s) => el('option', { value: s.clave, text: s.nombre.replace(' Eventos', '') }))));
  salon.value = u.salon ?? '';
  const campoSalon = el('label', { class: 'campo' }, ['Salón a su cargo', salon]);
  const aviso = el('div', { class: 'aviso-form' });
  const ajustar = () => { campoSalon.hidden = rol.value !== 'encargada'; };
  rol.addEventListener('change', ajustar);
  ajustar();

  const guardar = el('button', { class: 'primario', text: 'Guardar', onclick: async () => {
    aviso.textContent = '';
    guardar.disabled = true;
    try {
      const r = await api.editarUsuario({
        usuario: u.usuario, nombre: nombre.value.trim(), rol: rol.value,
        salon: rol.value === 'encargada' ? salon.value : null,
      });
      if (r.error) { aviso.textContent = r.detalle ?? r.error; guardar.disabled = false; return; }
      pintar(zona);
    } catch (e) { aviso.textContent = e.message; guardar.disabled = false; }
  } });

  return el('div', { class: 'edita' }, [
    el('div', { class: 'fila' }, [
      el('label', { class: 'campo ancho' }, ['Nombre completo', nombre]),
      el('label', { class: 'campo' }, ['Qué puede hacer', rol]),
      campoSalon,
    ]),
    ultimoAdmin
      ? el('div', { class: 'ayuda-rol' },
          ['Es la única cuenta de administrador activa. Para bajarle el rol, primero hay que ',
           'crear o ascender otra, o el panel se queda sin quien administre usuarios.'])
      : null,
    el('div', { class: 'fila', style: 'margin-top:12px' }, [
      guardar, el('button', { class: 'fantasma', text: 'Cancelar', onclick: volver }),
    ]),
    el('div', { style: 'font-size:12.5px;color:var(--tinta-3);margin-top:9px' },
      ['Si cambia el rol o el salón, se le cierra la sesión que tenga abierta: si no, ',
       'seguiría trabajando con los permisos de antes hasta mañana.']),
    aviso,
  ].filter(Boolean));
}

// ── contraseña nueva ────────────────────────────────────────────────────────
/**
 * La contraseña temporal, una sola vez. Se muestra arriba del todo y con un
 * botón para copiarla, porque es el único momento en que existe en claro.
 */
function mostrarClave(zona, r, titulo) {
  const clave = el('code', { class: 'clave-temporal', text: r.clave_temporal });
  const copiar = el('button', { text: 'Copiar', onclick: async () => {
    try { await navigator.clipboard.writeText(r.clave_temporal); copiar.textContent = 'Copiada'; }
    catch { copiar.textContent = 'Selecciónala y cópiala'; }
  } });
  const caja = el('div', { class: 'clave-caja' }, [
    el('div', { class: 'titulo', text: titulo }),
    el('div', { class: 'par' }, [
      el('div', {}, [el('span', { class: 'et', text: 'Usuario' }), el('code', { text: r.usuario })]),
      el('div', {}, [el('span', { class: 'et', text: 'Contraseña temporal' }), clave]),
      copiar,
    ]),
    el('div', { class: 'pie' },
      ['Dísela ahora: no se vuelve a mostrar y el panel no la guarda. ',
       'Al entrar le va a pedir que la cambie por una suya.']),
    el('button', { class: 'primario', style: 'margin-top:14px', text: 'Listo, ya la anoté',
      onclick: () => pintar(zona) }),
  ]);
  limpiar(zona).append(caja);
}

// ── utilidades ──────────────────────────────────────────────────────────────
const nombreSalon = (clave) =>
  (salones.find((s) => s.clave === clave)?.nombre ?? clave).replace(' Eventos', '');

const fecha = (iso) => {
  const [f, h] = String(iso).split(' ');
  const [y, m, d] = f.split('-');
  return `${Number(d)}/${Number(m)}/${y}${h ? ' a las ' + h.slice(0, 5) : ''}`;
};
