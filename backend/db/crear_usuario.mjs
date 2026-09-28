// ============================================================================
//  Alta y reseteo de cuentas.
//
//      node backend/db/crear_usuario.mjs --listar
//      node backend/db/crear_usuario.mjs --usuario agustin --nombre "Lic. Agustín Barrón" --rol admin
//      node backend/db/crear_usuario.mjs --usuario nelly --nombre "Nelly Tovar" --rol encargada --salon norma
//      node backend/db/crear_usuario.mjs --usuario agustin --reset
//      node backend/db/crear_usuario.mjs --usuario nelly --desactivar
//
//  La contraseña NO se escribe aquí ni se guarda en ningún archivo: el script
//  genera una temporal, la imprime una sola vez y marca la cuenta para que la
//  persona tenga que cambiarla al entrar. Si se pierde, se corre --reset y
//  sale otra; no hay forma de recuperar la anterior, y así debe ser.
// ============================================================================
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derivar, claveTemporal, cerrarTodas } from '../api/acceso.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = join(AQUI, 'salones.db');
if (!existsSync(DB)) { console.error('No existe salones.db'); process.exit(1); }

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const bandera = (n) => process.argv.includes(`--${n}`);

const db = new DatabaseSync(DB);

if (bandera('listar') || process.argv.length <= 2) {
  const filas = db.prepare(
    `SELECT u.usuario, u.nombre, u.rol, s.clave AS salon, u.activo, u.debe_cambiar,
            u.ultimo_acceso
       FROM usuario u LEFT JOIN salon s ON s.id = u.salon_id ORDER BY u.rol, u.usuario`).all();
  if (!filas.length) {
    console.log('Todavía no hay ninguna cuenta.\n');
    console.log('Crea la de administrador así:');
    console.log('  node backend/db/crear_usuario.mjs --usuario agustin \\');
    console.log('       --nombre "Lic. Agustín Barrón" --rol admin');
  } else {
    console.table(filas.map((f) => ({
      usuario: f.usuario, nombre: f.nombre, rol: f.rol, salon: f.salon ?? '(todos)',
      estado: f.activo ? (f.debe_cambiar ? 'debe cambiar clave' : 'activa') : 'desactivada',
      ultimo_acceso: f.ultimo_acceso ?? 'nunca',
    })));
  }
  process.exit(0);
}

const usuario = (arg('usuario') ?? '').trim().toLowerCase();
if (!usuario) { console.error('Falta --usuario'); process.exit(1); }
const existente = db.prepare('SELECT * FROM usuario WHERE usuario = ?').get(usuario);

// ── desactivar ──────────────────────────────────────────────────────────────
if (bandera('desactivar') || bandera('activar')) {
  if (!existente) { console.error(`No existe la cuenta «${usuario}».`); process.exit(1); }
  const activo = bandera('activar') ? 1 : 0;
  db.prepare('UPDATE usuario SET activo = ? WHERE id = ?').run(activo, existente.id);
  if (!activo) cerrarTodas(db, existente.id);   // y se le cierra la sesión abierta
  console.log(`«${usuario}» ${activo ? 'activada' : 'desactivada'}.`);
  process.exit(0);
}

// ── crear o resetear ────────────────────────────────────────────────────────
const clave = claveTemporal();
const { sal, hash } = derivar(clave);

if (existente) {
  if (!bandera('reset')) {
    console.error(`Ya existe «${usuario}». Para darle una contraseña nueva usa --reset.`);
    process.exit(1);
  }
  db.prepare(
    `UPDATE usuario SET sal = ?, clave_hash = ?, debe_cambiar = 1, intentos = 0,
            bloqueado_hasta = NULL, activo = 1 WHERE id = ?`).run(sal, hash, existente.id);
  cerrarTodas(db, existente.id);
  console.log(`\nContraseña nueva para «${usuario}» (${existente.nombre}).`);
} else {
  const nombre = arg('nombre');
  const rol = arg('rol') ?? 'consulta';
  if (!nombre) { console.error('Falta --nombre'); process.exit(1); }
  if (!['admin', 'encargada', 'consulta'].includes(rol)) {
    console.error('--rol debe ser admin, encargada o consulta'); process.exit(1);
  }
  let salonId = null;
  const salon = arg('salon');
  if (salon) {
    const s = db.prepare('SELECT id FROM salon WHERE clave = ?').get(salon);
    if (!s) { console.error(`No existe el salón «${salon}».`); process.exit(1); }
    salonId = s.id;
  }
  if (rol === 'encargada' && !salonId) {
    console.error('Una encargada necesita --salon: es lo que delimita lo que puede mover.');
    process.exit(1);
  }
  db.prepare(
    `INSERT INTO usuario (usuario, nombre, sal, clave_hash, rol, salon_id, creado_por)
     VALUES (?,?,?,?,?,?,?)`
  ).run(usuario, nombre, sal, hash, rol, salonId, 'crear_usuario.mjs');
  console.log(`\nCuenta creada: «${usuario}» — ${nombre} (${rol}${salon ? ', ' + salon : ''}).`);
}

console.log('\n  ┌──────────────────────────────────────────────┐');
console.log(`  │  usuario:     ${usuario.padEnd(31)}│`);
console.log(`  │  contraseña:  ${clave.padEnd(31)}│`);
console.log('  └──────────────────────────────────────────────┘');
console.log('\nEs temporal y de un solo uso: al entrar, el panel va a pedir cambiarla.');
console.log('No queda guardada en ningún lado. Si se pierde, corre el script con --reset.\n');
