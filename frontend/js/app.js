// Enrutador por hash. Ocho pantallas, sin framework.
import { api, cargarSesion, salir, salonActual, fijarSalon } from './api.js';
import { icono } from './ui.js';
import { ponerGlobo, refrescarAvisos } from './globos.js';
import { hoy } from './hoy.js';
import { cotizar } from './cotizar.js';
import { agenda } from './agenda.js';
import { paquetes } from './paquetes.js';
import { servicios } from './servicios.js';
import { respuestas } from './respuestas.js';
import { pendientes } from './pendientes.js';
import { configuracion } from './configuracion.js';
import { paqueteNuevo } from './paquete_nuevo.js';
import { salones } from './salones.js';
import { politicas } from './politicas.js';
import { especiales } from './especiales.js';
import { laminas } from './laminas.js';
import { citas } from './citas.js';
import { avisos } from './avisos.js';

const VISTAS = {
  '/hoy': hoy,
  '/cotizar': cotizar,
  '/agenda': agenda,
  '/citas': citas,
  '/avisos': avisos,
  '/paquetes': paquetes,
  '/servicios': servicios,
  '/respuestas': respuestas,
  '/pendientes': pendientes,
  '/politicas': politicas,
  '/especiales': especiales,
  '/salones': salones,
  '/imagenes': laminas,
  '/configuracion': configuracion,
  // Cuelga de Paquetes, no del menú: se usa dos veces al año y un ítem más
  // en la barra estorba todos los días.
  '/paquetes/nuevo': paqueteNuevo,
};
const INICIO = '/hoy';

const app = document.getElementById('app');
const menu = document.getElementById('menu');

// Los iconos se inyectan una sola vez, delante del texto del enlace.
for (const a of menu.querySelectorAll('a')) {
  a.prepend(icono(a.dataset.icono));
}

async function enrutar() {
  // La ruta puede traer parámetros («#/paquetes/nuevo?id=5»). Se separan: la
  // parte de antes elige la pantalla y el resto se le pasa.
  const crudo = location.hash.slice(1) || INICIO;
  const [ruta, query] = crudo.split('?');
  const params = Object.fromEntries(new URLSearchParams(query ?? ''));
  const vista = VISTAS[ruta] ?? VISTAS[INICIO];

  for (const a of menu.querySelectorAll('a')) {
    const activo = a.getAttribute('href') === `#${ruta}`;
    a.classList.toggle('on', activo);
    if (activo) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }

  app.scrollTop = 0;
  // En cada cambio de pantalla, no solo al arrancar: si la encargada atiende
  // un aviso y se va a otra pantalla, el numero tiene que haber bajado.
  refrescarAvisos();
  try {
    await vista(app, params);
  } catch (e) {
    // Un «reading 'algo' of undefined» casi siempre es esta pantalla vieja
    // guardada en el navegador hablando con un API ya actualizado. Decirlo
    // ahorra el susto: no se perdió nada, hay que recargar.
    const viejo = /undefined|null/.test(e.message) && /reading/.test(e.message);
    const caja = Object.assign(document.createElement('div'), { className: 'aviso malo' });
    caja.textContent = 'No se pudo abrir esta pantalla: ' + e.message;
    if (viejo) {
      const p = document.createElement('div');
      p.style.marginTop = '8px';
      p.textContent = 'Suele pasar si el panel se actualizó mientras lo tenías abierto. ' +
                      'Recarga la página (Ctrl+R) y vuelve a entrar.';
      caja.append(p);
    }
    app.replaceChildren(caja);
  }
}

// Quién está trabajando ya no se elige: es quien abrió la sesión.
const salon = document.getElementById('salon');
salon.value = salonActual();

const ROL = { admin: 'Administrador', encargada: 'Encargada', consulta: 'Solo consulta' };

async function montarSesion() {
  const s = await cargarSesion();
  if (!s) { location.replace('/entrar'); return; }
  document.getElementById('quien-nombre').textContent = s.nombre;
  document.getElementById('quien-rol').textContent = ROL[s.rol] ?? s.rol;
  // Una encargada trabaja en su salón y no en los cuatro: se fija y se quita
  // el selector, para que no parezca que puede mirar los demás.
  if (s.salon) {
    fijarSalon(s.salon);
    salon.value = s.salon;
    salon.disabled = true;
    salon.title = 'Tu cuenta está asignada a este salón.';
  }
  // Lo que no puede tocar, no se le ofrece. El servidor lo rechaza igual,
  // pero un botón que siempre falla es una trampa.
  document.body.dataset.rol = s.rol;
  const linkConfig = menu.querySelector('a[href="#/configuracion"]');
  if (linkConfig) linkConfig.hidden = s.rol !== 'admin';
  for (const [area, on] of Object.entries(s.permisos ?? {})) {
    document.body.classList.toggle(`no-${area}`, !on);
  }
}
document.getElementById('salir').addEventListener('click', salir);
salon.addEventListener('change', () => {
  fijarSalon(salon.value);
  document.body.dataset.salon = salon.value || 'todos';
  enrutar();
});
document.body.dataset.salon = salonActual() || 'todos';

window.addEventListener('hashchange', enrutar);

// Pie del sidebar y globo de pendientes.
montarSesion()
  .then(() => api.salud())
  .then((s) => {
    const pie = document.getElementById('pie');
    pie.replaceChildren(
      Object.assign(document.createElement('div'), { textContent: s.hoy_monterrey }),
      Object.assign(document.createElement('div'), { textContent: `${s.tarifas} precios · ${s.compromisos} eventos` }),
    );
    return api.revisar();
  })
  .then((r) => {
    // Pendientes se cuenta una sola vez: `revisar` recorre las mil tarifas y
    // lo que cuenta no cambia solo. Avisos si, en cada pantalla.
    ponerGlobo('/pendientes', (r.tarifas?.length ?? 0) + (r.contenidos?.length ?? 0));
  })
  .catch(() => {
    document.getElementById('pie').textContent = 'Sin conexión con el servidor';
  })
  .finally(enrutar);
