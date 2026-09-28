// Pantalla de entrada. Hace dos cosas seguidas sin recargar: entrar, y —la
// primera vez— cambiar la contraseña temporal. Se quedan juntas a propósito:
// si el cambio viviera dentro del panel, habría que dejar entrar a alguien
// que todavía no ha estrenado su cuenta.

const caja = document.getElementById('caja');
const campos = document.getElementById('campos');
const cajaError = document.getElementById('error');
const enviar = document.getElementById('enviar');
const sub = document.getElementById('sub');
const nota = document.getElementById('nota');

const el = (t, attrs = {}) => Object.assign(document.createElement(t), attrs);

function fallo(msg) {
  cajaError.className = 'malo';
  cajaError.textContent = msg;
  cajaError.hidden = false;
}
const limpiarError = () => { cajaError.hidden = true; };

async function pedir(ruta, cuerpo) {
  const r = await fetch(ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
    credentials: 'same-origin',
  });
  return r.json();
}

// ── paso 1: usuario y contraseña ────────────────────────────────────────────
function pasoEntrar() {
  sub.textContent = 'Entra para ver y mover la agenda.';
  enviar.textContent = 'Entrar';
  nota.textContent = 'Si no recuerdas tu contraseña, pídele a quien administra el panel que te genere una nueva.';
  campos.replaceChildren(
    el('label', { htmlFor: 'usuario', textContent: 'Usuario' }),
    el('input', { id: 'usuario', name: 'username', type: 'text', autocomplete: 'username',
                  required: true, autocapitalize: 'off', spellcheck: false }),
    el('label', { htmlFor: 'clave', textContent: 'Contraseña' }),
    el('input', { id: 'clave', name: 'password', type: 'password',
                  autocomplete: 'current-password', required: true }),
  );
  document.getElementById('usuario').focus();

  caja.onsubmit = async (e) => {
    e.preventDefault();
    limpiarError();
    enviar.disabled = true;
    enviar.textContent = 'Entrando…';
    try {
      const r = await pedir('/api/entrar', {
        usuario: document.getElementById('usuario').value,
        clave: document.getElementById('clave').value,
      });
      if (r.error) { fallo(r.detalle ?? r.error); return; }
      if (r.debe_cambiar) { pasoCambiar(r.nombre); return; }
      location.replace('/');
    } catch (err) {
      fallo('No se pudo conectar con el servidor: ' + err.message);
    } finally {
      enviar.disabled = false;
      if (enviar.textContent === 'Entrando…') enviar.textContent = 'Entrar';
    }
  };
}

// ── paso 2: estrenar la cuenta ──────────────────────────────────────────────
function pasoCambiar(nombre) {
  limpiarError();
  document.querySelector('.titulo-entrada').textContent = nombre;
  sub.textContent = 'Tu contraseña es temporal. Elige una tuya para terminar de entrar.';
  enviar.textContent = 'Guardar y entrar';
  nota.textContent = 'Al menos 6 caracteres. Puede ser lo que quieras: números, letras, ' +
                     'palabras con acentos o símbolos.';

  const actual = el('input', { id: 'actual', type: 'password', autocomplete: 'current-password', required: true });
  const nueva = el('input', { id: 'nueva', type: 'password', autocomplete: 'new-password', required: true });
  const repite = el('input', { id: 'repite', type: 'password', autocomplete: 'new-password', required: true });
  campos.replaceChildren(
    el('div', { className: 'paso', textContent: 'Primera vez' }),
    el('label', { textContent: 'La contraseña temporal que te dieron' }), actual,
    el('label', { textContent: 'Tu contraseña nueva' }), nueva,
    el('label', { textContent: 'Escríbela otra vez' }), repite,
  );
  actual.focus();

  caja.onsubmit = async (e) => {
    e.preventDefault();
    limpiarError();
    // Se comprueba aquí para no gastar un viaje al servidor en un dedazo.
    if (nueva.value !== repite.value) { fallo('Las dos contraseñas nuevas no son iguales.'); return; }
    enviar.disabled = true;
    try {
      const r = await pedir('/api/cambiar-clave', { actual: actual.value, nueva: nueva.value });
      if (r.error) { fallo(r.detalle ?? r.error); return; }
      location.replace('/');
    } catch (err) {
      fallo('No se pudo conectar con el servidor: ' + err.message);
    } finally { enviar.disabled = false; }
  };
}

// Si ya hay sesión abierta no tiene caso pedirla otra vez.
(async () => {
  try {
    const r = await fetch('/api/yo', { credentials: 'same-origin' }).then((x) => x.json());
    if (r.usuario && !r.debe_cambiar) { location.replace('/'); return; }
    if (r.usuario && r.debe_cambiar) { pasoCambiar(r.nombre); return; }
  } catch { /* sin servidor, que al menos se vea el formulario */ }
  pasoEntrar();
})();
