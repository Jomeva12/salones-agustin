// ============================================================================
//  Quién entra y qué puede hacer.
//
//  Sin dependencias: scrypt y randomBytes vienen en node:crypto. scrypt está
//  hecho a propósito para contraseñas — es lento y pide memoria, así que
//  probar millones por segundo deja de ser gratis. Un SHA cualquiera no
//  serviría aquí por rápido.
// ============================================================================
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Coste de derivación. 2^15 tarda ~100 ms por intento en esta máquina: ni se
// nota al entrar, y encarece muchísimo probar a ciegas.
const COSTE = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const LARGO_HASH = 64;

export const DURACION_SESION_H = 12;      // una jornada; al día siguiente se vuelve a entrar
const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;

/** Deriva la contraseña. Devuelve {sal, hash} para guardar. */
export function derivar(clave, sal = randomBytes(16)) {
  return { sal, hash: scryptSync(clave, sal, LARGO_HASH, COSTE) };
}

/**
 * Compara en tiempo constante. Un `===` tarda distinto según cuántos bytes
 * coinciden, y eso por sí solo filtra el hash byte por byte.
 */
export function coincide(clave, sal, hashGuardado) {
  const { hash } = derivar(clave, Buffer.from(sal));
  const guardado = Buffer.from(hashGuardado);
  if (hash.length !== guardado.length) return false;
  return timingSafeEqual(hash, guardado);
}

export const LARGO_MINIMO = 6;

/**
 * Lo único que se exige es el largo. Ni composición, ni palabras prohibidas:
 * puede ser solo números, solo letras, con acentos, con espacios o con
 * símbolos, como cada quien la quiera.
 *
 * Es una decisión deliberada del negocio, no un descuido. Aquí lo que frena a
 * quien intente adivinar no es la contraseña sino el bloqueo por intentos
 * (MAX_INTENTOS / BLOQUEO_MIN, arriba): a cinco pruebas cada quince minutos,
 * hasta un PIN de seis dígitos aguanta años. Si algún día se quita ese
 * bloqueo, esta regla tiene que volverse estricta el mismo día.
 */
export function claveDebil(clave) {
  if (typeof clave !== 'string' || [...clave].length < LARGO_MINIMO) {
    return `La contraseña necesita al menos ${LARGO_MINIMO} caracteres.`;
  }
  return null;
}

/**
 * Contraseña temporal legible: se dicta por teléfono sin confundir caracteres.
 * Sin l/1/I ni O/0, que es donde se equivoca todo el mundo.
 */
export function claveTemporal(bloques = 4) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(bloques * 4);
  const partes = [];
  for (let b = 0; b < bloques; b++) {
    let s = '';
    for (let i = 0; i < 4; i++) s += abc[bytes[b * 4 + i] % abc.length];
    partes.push(s);
  }
  return partes.join('-');
}

// ─────────────────────────────── sesiones ───────────────────────────────────

export function abrirSesion(db, usuarioId, agente) {
  const token = randomBytes(32).toString('base64url');
  db.prepare(
    `INSERT INTO sesion (token, usuario_id, expira_at, agente)
     VALUES (?, ?, datetime('now', ?), ?)`
  ).run(token, usuarioId, `+${DURACION_SESION_H} hours`, (agente ?? '').slice(0, 200));
  return token;
}

/** Devuelve el usuario de esa sesión, o null. De paso barre las vencidas. */
export function sesionValida(db, token) {
  if (!token) return null;
  db.prepare("DELETE FROM sesion WHERE expira_at <= datetime('now')").run();
  return db.prepare(
    `SELECT u.id, u.usuario, u.nombre, u.rol, u.debe_cambiar, u.activo,
            s.expira_at, sa.clave AS salon
       FROM sesion s
       JOIN usuario u ON u.id = s.usuario_id
       LEFT JOIN salon sa ON sa.id = u.salon_id
      WHERE s.token = ? AND u.activo = 1`).get(token) ?? null;
}

export const cerrarSesion = (db, token) =>
  db.prepare('DELETE FROM sesion WHERE token = ?').run(token);

/** Al cambiar la contraseña se tiran todas las sesiones de esa persona. */
export const cerrarTodas = (db, usuarioId) =>
  db.prepare('DELETE FROM sesion WHERE usuario_id = ?').run(usuarioId);

// ──────────────────────────── intentos fallidos ─────────────────────────────

export function estaBloqueado(u) {
  if (!u?.bloqueado_hasta) return null;
  const faltan = Math.ceil((Date.parse(u.bloqueado_hasta + 'Z') - Date.now()) / 60000);
  return faltan > 0 ? faltan : null;
}

export function fallo(db, u) {
  const n = u.intentos + 1;
  if (n >= MAX_INTENTOS) {
    db.prepare(
      `UPDATE usuario SET intentos = 0, bloqueado_hasta = datetime('now', ?) WHERE id = ?`
    ).run(`+${BLOQUEO_MIN} minutes`, u.id);
    return BLOQUEO_MIN;
  }
  db.prepare('UPDATE usuario SET intentos = ? WHERE id = ?').run(n, u.id);
  return null;
}

export function acierto(db, u) {
  db.prepare(
    `UPDATE usuario SET intentos = 0, bloqueado_hasta = NULL,
            ultimo_acceso = datetime('now') WHERE id = ?`).run(u.id);
}

// ─────────────────────────────── permisos ───────────────────────────────────

/**
 * Qué puede tocar cada rol. Se decide por lo que la persona HACE, no por
 * pantallas: quien lleva la agenda de un salón no tiene por qué poder mover
 * la lista de precios de los cuatro.
 */
export const PERMISOS = {
  admin:     { agenda: true,  precios: true,  servicios: true,  respuestas: true,  salones: true,  usuarios: true },
  // La encargada contesta clientes todo el dia: es quien antes se entera de
  // que una respuesta quedo vieja. Lo que no toca son precios ni cuentas.
  // La encargada puede corregir los datos DE SU SALON (direccion, WhatsApp,
  // horario de visitas). Lo que no toca son las reglas de operacion, que
  // mandan sobre la agenda y el precio de los cuatro.
  encargada: { agenda: true,  precios: false, servicios: true,  respuestas: true,  salones: true,  usuarios: false },
  consulta:  { agenda: false, precios: false, servicios: false, respuestas: false, salones: false, usuarios: false },
};

export const puede = (usuario, que) => !!PERMISOS[usuario?.rol]?.[que];

// ──────────────────────────────── cookie ────────────────────────────────────

export const COOKIE = 'sesion';

export function leerCookie(req, nombre = COOKIE) {
  const crudo = req.headers.cookie;
  if (!crudo) return null;
  for (const par of crudo.split(';')) {
    const i = par.indexOf('=');
    if (i > 0 && par.slice(0, i).trim() === nombre) return decodeURIComponent(par.slice(i + 1).trim());
  }
  return null;
}

/**
 * HttpOnly para que ningún script de la página pueda leerla, SameSite=Strict
 * para que no viaje desde otro sitio. Secure solo fuera de localhost: si se
 * pusiera siempre, el navegador la descartaría en http y nadie podría entrar.
 */
export function ponerCookie(token, { seguro = false, maxEdad = DURACION_SESION_H * 3600 } = {}) {
  const partes = [
    `${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxEdad}`,
  ];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

export const borrarCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
