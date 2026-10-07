-- ============================================================================
--  Salones Agustín Barrón — esquema de la base embebida (SQLite)
--
--  Adaptaciones frente al diseño original en Postgres:
--    · Los ENUM se vuelven CHECK.
--    · EXCLUDE USING gist se vuelve un TRIGGER (ver al final).
--    · Las fechas van como TEXT en ISO-8601 (YYYY-MM-DD), que ordena bien.
--
--  Regla de oro del modelo: una consulta de cotización debe resolver
--  UNA sola fila. Todo lo que impide eso está protegido por una restricción.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ─────────────────────────── catálogo base ──────────────────────────────────

CREATE TABLE salon (
  id                INTEGER PRIMARY KEY,
  clave             TEXT    NOT NULL UNIQUE,      -- norma, esmeralda, santacruz, quetzal
  nombre            TEXT    NOT NULL UNIQUE,
  direccion         TEXT    NOT NULL,
  maps_url          TEXT,
  -- Las redes se guardan como URL COMPLETA con https://. El cliente las
  -- dictó como «facebook.com/X», y sin protocolo no son URLs: el enlace
  -- del panel resolvía contra el propio panel, y Kommo las rechaza al
  -- pedir una URL de red social válida.
  fanpage           TEXT,   -- Facebook
  instagram         TEXT,
  tiktok            TEXT,
  whatsapp          TEXT,
  capacidad_min     INTEGER NOT NULL,
  capacidad_max     INTEGER NOT NULL,
  encargada         TEXT    NOT NULL,
  encargada_wa      TEXT,
  horario_visitas   TEXT,
  estacionamiento   TEXT,
  diferenciador     TEXT,
  activo            INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  -- Tiempo que hay que dejar libre entre un evento y el siguiente para el
  -- aseo. Vive aquí y no en el trigger porque es una decisión del negocio:
  -- si un salón necesita más, se cambia el número y la regla se mueve sola.
  minutos_aseo   INTEGER NOT NULL DEFAULT 120 CHECK (minutos_aseo >= 0),
  CHECK (capacidad_min <= capacidad_max)
);

-- La escalera de anticipación. Antes vivía escrita en prosa dentro de Notas.
-- meses_min/meses_max son la DISTANCIA REAL al evento, no el ordinal del
-- archivo original (el archivo llama "cuarto al sexto mes" a lo que en
-- realidad son 3 a 5 meses de distancia).
CREATE TABLE escalon (
  id            INTEGER PRIMARY KEY,
  nombre        TEXT    NOT NULL,
  meses_min     INTEGER NOT NULL CHECK (meses_min >= 0),
  meses_max     INTEGER,                            -- NULL = sin tope
  nombre_origen TEXT,                               -- como lo llamaba el Excel
  evidencia     TEXT,                               -- el ejemplo del que se dedujo
  CHECK (meses_max IS NULL OR meses_max >= meses_min)
);

CREATE TABLE tipo_evento (
  id     INTEGER PRIMARY KEY,
  clave  TEXT NOT NULL UNIQUE,                      -- xv, boda, graduacion, posada...
  nombre TEXT NOT NULL
);

CREATE TABLE paquete (
  id            INTEGER PRIMARY KEY,
  nombre        TEXT NOT NULL UNIQUE,
  unidad_precio TEXT NOT NULL CHECK (unidad_precio IN ('total','por_persona')),
  activo        INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  -- 1 = se está capturando y todavía no está completo. NO se cotiza: un
  -- paquete a medias con precios a medias es peor que ninguno.
  borrador      INTEGER NOT NULL DEFAULT 0 CHECK (borrador IN (0,1)),
  -- Paquetes que solo sirven para una fecha del año: «Dia de las Madres»
  -- es el 10 de mayo y nada mas. Estaba solo en el nombre del paquete,
  -- asi que el sistema los ofrecia para cualquier cumpleaños.
  -- JSON: {mes, dia, margen_dias, nombre}
  fecha_fija    TEXT
);

CREATE TABLE paquete_tipo_evento (
  paquete_id     INTEGER NOT NULL REFERENCES paquete(id)     ON DELETE CASCADE,
  tipo_evento_id INTEGER NOT NULL REFERENCES tipo_evento(id) ON DELETE CASCADE,
  PRIMARY KEY (paquete_id, tipo_evento_id)
);

-- ──────────────────── contenido del paquete, por concepto ───────────────────
-- Los 78 conceptos que cubren todo el catálogo. En el frontend esto es una
-- lista de casillas, no un campo de texto: así no vuelven a aparecer
-- "Cámaras" y "Camaras" como si fueran cosas distintas.
CREATE TABLE concepto (
  id        INTEGER PRIMARY KEY,
  clave     TEXT NOT NULL UNIQUE,                   -- normalizado, sin acentos
  nombre    TEXT NOT NULL,                          -- como se le muestra al cliente
  universal INTEGER NOT NULL DEFAULT 0 CHECK (universal IN (0,1))
);

-- Una variante de contenido = (paquete, salón, escalón). El contenido cambia
-- por salón (cada uno tiene sus instalaciones) y por escalón (el paquete caro
-- incluye vestido y espejo; el de urgencia no).
CREATE TABLE paquete_contenido (
  id            INTEGER PRIMARY KEY,
  paquete_id    INTEGER NOT NULL REFERENCES paquete(id) ON DELETE CASCADE,
  salon_id      INTEGER NOT NULL REFERENCES salon(id)   ON DELETE CASCADE,
  escalon_id    INTEGER          REFERENCES escalon(id),
  -- Lo normal es una variante por (paquete, salón, escalón). Hay 11 casos
  -- donde el Excel trae varias y no existe regla que las separe: se numeran
  -- y se marcan para que el frontend pida a la encargada que las depure.
  variante      INTEGER NOT NULL DEFAULT 1,
  requiere_revision INTEGER NOT NULL DEFAULT 0 CHECK (requiere_revision IN (0,1)),
  cortesias     TEXT,
  reglas_horario TEXT,
  nota_original TEXT,                               -- la prosa, solo lectura
  UNIQUE (paquete_id, salon_id, escalon_id, variante)
);

CREATE TABLE paquete_contenido_concepto (
  contenido_id INTEGER NOT NULL REFERENCES paquete_contenido(id) ON DELETE CASCADE,
  concepto_id  INTEGER NOT NULL REFERENCES concepto(id)          ON DELETE CASCADE,
  incluido     INTEGER NOT NULL CHECK (incluido IN (0,1)),       -- 1=incluye 0=NO incluye
  PRIMARY KEY (contenido_id, concepto_id)
);

-- ───────────────────────────── las tarifas ──────────────────────────────────
CREATE TABLE tarifa (
  id              INTEGER PRIMARY KEY,
  paquete_id      INTEGER NOT NULL REFERENCES paquete(id),
  salon_id        INTEGER NOT NULL REFERENCES salon(id),
  escalon_id      INTEGER          REFERENCES escalon(id),
  contenido_id    INTEGER          REFERENCES paquete_contenido(id),
  anio            INTEGER NOT NULL,
  personas_desde  INTEGER NOT NULL,
  personas_hasta  INTEGER NOT NULL,
  precio_lun      REAL, precio_mar REAL, precio_mie REAL, precio_jue REAL,
  precio_vie      REAL, precio_sab REAL, precio_dom REAL,
  vigente_desde   TEXT NOT NULL DEFAULT (date('now')),
  vigente_hasta   TEXT,
  -- 1 = la fila viene de una nota que no se pudo decodificar, o choca con
  -- otra. El API NO la usa para cotizar en firme: deriva a la encargada.
  requiere_revision INTEGER NOT NULL DEFAULT 0 CHECK (requiere_revision IN (0,1)),
  motivo_revision TEXT,
  fila_original   INTEGER,                          -- trazabilidad al Excel
  CHECK (personas_desde <= personas_hasta),
  CHECK (personas_desde > 0)
);

CREATE INDEX idx_tarifa_busqueda
  ON tarifa (salon_id, anio, paquete_id, personas_desde, personas_hasta);

-- Equivalente al EXCLUDE de Postgres: dentro de la misma llave, dos tarifas
-- vigentes y ya revisadas no pueden cubrir el mismo tramo de invitados.
-- Es lo que vuelve IMPOSIBLE el problema de "la misma búsqueda devuelve
-- cuatro precios distintos".
CREATE TRIGGER tarifa_sin_traslape_ins
BEFORE INSERT ON tarifa
WHEN NEW.vigente_hasta IS NULL AND NEW.requiere_revision = 0
BEGIN
  SELECT RAISE(ABORT, 'Traslape: ya existe una tarifa vigente para ese salon/paquete/anio/escalon que cubre ese tramo de invitados')
  WHERE EXISTS (
    SELECT 1 FROM tarifa t
     WHERE t.paquete_id = NEW.paquete_id
       AND t.salon_id   = NEW.salon_id
       AND t.anio       = NEW.anio
       AND IFNULL(t.escalon_id,-1) = IFNULL(NEW.escalon_id,-1)
       AND t.vigente_hasta IS NULL
       AND t.requiere_revision = 0
       AND NEW.personas_desde <= t.personas_hasta
       AND t.personas_desde   <= NEW.personas_hasta
  );
END;

CREATE TRIGGER tarifa_sin_traslape_upd
BEFORE UPDATE ON tarifa
WHEN NEW.vigente_hasta IS NULL AND NEW.requiere_revision = 0
BEGIN
  SELECT RAISE(ABORT, 'Traslape: esa tarifa se encima con otra vigente')
  WHERE EXISTS (
    SELECT 1 FROM tarifa t
     WHERE t.id <> NEW.id
       AND t.paquete_id = NEW.paquete_id
       AND t.salon_id   = NEW.salon_id
       AND t.anio       = NEW.anio
       AND IFNULL(t.escalon_id,-1) = IFNULL(NEW.escalon_id,-1)
       AND t.vigente_hasta IS NULL
       AND t.requiere_revision = 0
       AND NEW.personas_desde <= t.personas_hasta
       AND t.personas_desde   <= NEW.personas_hasta
  );
END;

-- ──────────────────────────── la agenda ─────────────────────────────────────
-- Solo lo COMPROMETIDO. Lo que no está aquí se considera libre, pero
-- únicamente hasta donde control_agenda dice que la agenda fue revisada.
CREATE TABLE compromiso (
  id             INTEGER PRIMARY KEY,
  salon_id       INTEGER NOT NULL REFERENCES salon(id) ON DELETE CASCADE,
  fecha          TEXT    NOT NULL,                  -- YYYY-MM-DD
  turno          TEXT    NOT NULL CHECK (turno IN ('manana','tarde','noche')),
  estatus        TEXT    NOT NULL CHECK (estatus IN ('contratado','separado','bloqueado')),
  tipo_evento_id INTEGER REFERENCES tipo_evento(id),
  hora_inicio    TEXT,                             -- como lo escribe el equipo: «8:00 pm»
  hora_fin       TEXT,
  -- Lo mismo, pero como instantes comparables. El fin cae al día siguiente
  -- cuando el evento cruza la medianoche, que es el caso normal aquí.
  inicio_at      TEXT,                             -- YYYY-MM-DD HH:MM
  fin_at         TEXT,
  vence          TEXT,                              -- apartados de $500: 7 días
  notas          TEXT,
  capturado_por  TEXT,
  capturado_at   TEXT NOT NULL DEFAULT (datetime('now')),
  fila_original  INTEGER,
  -- Ya NO hay UNIQUE (salon_id, fecha, turno): un salón puede dar varios
  -- eventos el mismo día. Lo que no puede es encimarlos ni dejarlos sin
  -- tiempo de aseo, y eso lo vigilan los triggers de abajo, que sí saben de
  -- horas. Un UNIQUE por día no podría distinguir un evento de mediodía de
  -- uno de noche.
  CHECK (fecha LIKE '____-__-__'),
  CHECK ((inicio_at IS NULL) = (fin_at IS NULL)),
  -- Un tramo que termina antes de empezar significa que alguien guardó el fin
  -- sin saltar de día al cruzar la medianoche.
  CHECK (inicio_at IS NULL OR fin_at > inicio_at)
);

CREATE INDEX idx_compromiso_fecha ON compromiso (fecha, salon_id);

-- Un salón puede dar varios eventos el mismo día; lo que no puede es
-- encimarlos ni dejarlos pegados. Entre el fin de uno y el inicio del
-- siguiente tiene que caber el aseo (salon.minutos_aseo, 2 h por omisión).
-- Esto vive en la base y no en el API a propósito: es lo único que hace el
-- doble booking imposible aunque alguien escriba por otra vía.
CREATE TRIGGER compromiso_aseo_ins
BEFORE INSERT ON compromiso
BEGIN
  SELECT RAISE(ABORT, 'aseo: el salon ya tiene un evento encimado o sin tiempo de limpieza entre medio')
  WHERE EXISTS (
    SELECT 1 FROM compromiso o
     WHERE o.salon_id = NEW.salon_id
       
       -- Acota el barrido sin perder al vecino: un evento que arranca de
       -- noche termina al día siguiente, y con el aseo alcanza la madrugada.
       AND o.fecha BETWEEN date(NEW.fecha, '-2 day') AND date(NEW.fecha, '+2 day')
       AND (
            -- Sin horas no hay nada que medir. Ahí se mantiene la regla vieja
            -- de un evento por día: estorbar una captura es más barato que
            -- vender dos veces el mismo salón.
            ((NEW.inicio_at IS NULL OR o.inicio_at IS NULL) AND o.fecha = NEW.fecha)
            OR
            -- Con horas: chocan si se encima alguno de los dos tramos una vez
            -- que a cada uno se le suma el aseo. Se revisa en ambos sentidos
            -- porque el evento nuevo puede caer antes o después del que ya está.
            (NEW.inicio_at IS NOT NULL AND o.inicio_at IS NOT NULL
             AND datetime(NEW.inicio_at) < datetime(o.fin_at,   '+' || (SELECT minutos_aseo FROM salon WHERE id = NEW.salon_id) || ' minutes')
             AND datetime(o.inicio_at)   < datetime(NEW.fin_at, '+' || (SELECT minutos_aseo FROM salon WHERE id = NEW.salon_id) || ' minutes'))
       )
  );
END;

CREATE TRIGGER compromiso_aseo_upd
BEFORE UPDATE OF salon_id, fecha, inicio_at, fin_at ON compromiso
BEGIN
  SELECT RAISE(ABORT, 'aseo: el salon ya tiene un evento encimado o sin tiempo de limpieza entre medio')
  WHERE EXISTS (
    SELECT 1 FROM compromiso o
     WHERE o.salon_id = NEW.salon_id
       AND o.id <> NEW.id
       -- Acota el barrido sin perder al vecino: un evento que arranca de
       -- noche termina al día siguiente, y con el aseo alcanza la madrugada.
       AND o.fecha BETWEEN date(NEW.fecha, '-2 day') AND date(NEW.fecha, '+2 day')
       AND (
            -- Sin horas no hay nada que medir. Ahí se mantiene la regla vieja
            -- de un evento por día: estorbar una captura es más barato que
            -- vender dos veces el mismo salón.
            ((NEW.inicio_at IS NULL OR o.inicio_at IS NULL) AND o.fecha = NEW.fecha)
            OR
            -- Con horas: chocan si se encima alguno de los dos tramos una vez
            -- que a cada uno se le suma el aseo. Se revisa en ambos sentidos
            -- porque el evento nuevo puede caer antes o después del que ya está.
            (NEW.inicio_at IS NOT NULL AND o.inicio_at IS NOT NULL
             AND datetime(NEW.inicio_at) < datetime(o.fin_at,   '+' || (SELECT minutos_aseo FROM salon WHERE id = NEW.salon_id) || ' minutes')
             AND datetime(o.inicio_at)   < datetime(NEW.fin_at, '+' || (SELECT minutos_aseo FROM salon WHERE id = NEW.salon_id) || ' minutes'))
       )
  );
END;

CREATE INDEX idx_compromiso_ventana ON compromiso (salon_id, inicio_at);

-- Cuatro filas. La pieza que convierte "no hay fila" de una adivinanza
-- en una afirmación verificable.
CREATE TABLE control_agenda (
  salon_id           INTEGER PRIMARY KEY REFERENCES salon(id) ON DELETE CASCADE,
  confirmada_hasta   TEXT NOT NULL,                 -- YYYY-MM-DD
  fuente             TEXT NOT NULL CHECK (fuente IN ('sistema','libreta')),
  responsable        TEXT,
  ultima_revision    TEXT NOT NULL DEFAULT (date('now'))
);

-- ─────────────────────────── auditoría ──────────────────────────────────────
-- Quién cambió qué precio y cuándo. En una hoja de cálculo es imposible;
-- aquí sale gratis y es lo que salva una discusión sobre una cotización vieja.
CREATE TABLE bitacora (
  id         INTEGER PRIMARY KEY,
  tabla      TEXT NOT NULL,
  registro   INTEGER,
  accion     TEXT NOT NULL CHECK (accion IN ('alta','cambio','baja')),
  antes      TEXT,
  despues    TEXT,
  usuario    TEXT,
  detalle    TEXT,
  creado_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_bitacora_fecha ON bitacora (creado_at DESC);

-- La bitácora se escribe desde el API, no con un trigger: el trigger no puede
-- saber QUIÉN hizo el cambio, y sin eso la auditoría no sirve para nada.

-- ============================================================================
--  Servicios adicionales, preguntas frecuentes y políticas
-- ============================================================================

CREATE TABLE servicio (
  id                  INTEGER PRIMARY KEY,
  nombre              TEXT    NOT NULL,
  es_propio           INTEGER NOT NULL CHECK (es_propio IN (0,1)),
  proveedor           TEXT,
  precio              REAL,                  -- NULL si viene como rango
  precio_texto        TEXT,                  -- «$5,000 a $10,000»
  que_incluye         TEXT,
  anticipacion_minima TEXT,
  notas               TEXT,
  categoria           TEXT,                  -- agrupa los 104 como los piensa el cliente
  activo              INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  -- Número de personas que menciona el nombre («barra libre para 300»).
  -- Sirve para no ofrecer en Quetzal (máx. 150) un servicio de 300.
  personas_ref        INTEGER
);

CREATE TABLE servicio_salon (
  servicio_id INTEGER NOT NULL REFERENCES servicio(id) ON DELETE CASCADE,
  salon_id    INTEGER NOT NULL REFERENCES salon(id)    ON DELETE CASCADE,
  PRIMARY KEY (servicio_id, salon_id)
);

CREATE TABLE faq (
  id        INTEGER PRIMARY KEY,
  categoria TEXT,
  pregunta  TEXT NOT NULL,
  respuesta TEXT NOT NULL,
  notas     TEXT
);

-- Políticas y reglas. La visibilidad NO es un booleano: hay tres casos y
-- confundirlos filtra los datos bancarios o hace que el agente recite sus
-- propias instrucciones al cliente.
--   publico       → el agente puede decirlo tal cual
--   restringido   → el dato existe pero el agente NUNCA lo da; deriva
--   regla_interna → instrucción para el agente, jamás se recita
CREATE TABLE politica (
  id          INTEGER PRIMARY KEY,
  seccion     TEXT NOT NULL,
  tema        TEXT NOT NULL,
  detalle     TEXT,
  notas       TEXT,
  visibilidad TEXT NOT NULL CHECK (visibilidad IN ('publico','restringido','regla_interna')),
  fila_original INTEGER
);

CREATE INDEX idx_politica_vis ON politica (visibilidad);

-- ────────────────────────────── acceso ──────────────────────────────────────
-- Hasta ahora «quién está trabajando» era un menú que cada quien elegía solo:
-- la bitácora registraba lo que la persona decía ser, no quién era. Con esto
-- la atribución sale de la sesión y deja de ser una declaración voluntaria.

CREATE TABLE usuario (
  id            INTEGER PRIMARY KEY,
  usuario       TEXT    NOT NULL UNIQUE COLLATE NOCASE,   -- con lo que entra
  nombre        TEXT    NOT NULL,                         -- como aparece en la bitácora
  -- scrypt: la contraseña nunca se guarda, ni cifrada. Se guarda el resultado
  -- de derivarla, y al entrar se deriva otra vez y se comparan.
  sal           BLOB    NOT NULL,
  clave_hash    BLOB    NOT NULL,
  rol           TEXT    NOT NULL CHECK (rol IN ('admin','encargada','consulta')),
  -- Una encargada ve y mueve su salón; NULL = todos (admin y consulta).
  salon_id      INTEGER REFERENCES salon(id) ON DELETE SET NULL,
  activo        INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  -- La contraseña con la que se crea la cuenta es de un solo uso.
  debe_cambiar  INTEGER NOT NULL DEFAULT 1 CHECK (debe_cambiar IN (0,1)),
  intentos      INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TEXT,
  ultimo_acceso TEXT,
  creado_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  creado_por    TEXT
);

CREATE TABLE sesion (
  token      TEXT    PRIMARY KEY,          -- aleatorio, 256 bits
  usuario_id INTEGER NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  creada_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  expira_at  TEXT    NOT NULL,
  agente     TEXT
);
CREATE INDEX idx_sesion_usuario ON sesion (usuario_id);

-- Lo que un paquete NO incluye no es una lista de carencias: es su catalogo de
-- venta adicional. «El Bronce no trae pista iluminada» y «la pista cuesta
-- $4,400» vivian en dos tablas que nadie cruzaba, asi que quien cotizaba tenia
-- que acordarse de memoria.
--
-- Es muchos-a-muchos porque varios servicios vienen por tramo de invitados
-- (Pastel para 100/150/200...): un concepto enlaza con todas sus variantes y
-- al cotizar se elige la que corresponde.
CREATE TABLE concepto_servicio (
  concepto_id INTEGER NOT NULL REFERENCES concepto(id) ON DELETE CASCADE,
  servicio_id INTEGER NOT NULL REFERENCES servicio(id) ON DELETE CASCADE,
  -- 'curado' = puesto a mano. El emparejamiento automatico por parecido de
  -- texto proponia «Mesas VIP -> Servicio de chilaquiles», asi que no se usa.
  origen      TEXT NOT NULL DEFAULT 'curado' CHECK (origen IN ('curado','sugerido')),
  PRIMARY KEY (concepto_id, servicio_id)
);

-- La lamina de cada paquete, en el Drive de Kommo. Aqui solo vive la URL: el
-- adjunto del salesbot exige un uuid de archivo de Kommo, asi que la imagen
-- no puede estar alojada en el panel ni en ningun otro lado.
--
-- Es tabla aparte y no una columna de paquete_contenido porque alli la clave
-- incluye el escalon, y un paquete puede necesitar varias laminas sin que eso
-- tenga que ver con la anticipacion: «Baby Shower, Despedidas de Soltera y
-- Bautizos» es un solo paquete en precio y contenido, pero el arte lo parte en
-- tres y a quien va a bautizar no se le enseñan globos de despedida. Eso es lo
-- que distingue `etiqueta`; NULL es la lamina unica del paquete.
CREATE TABLE paquete_imagen (
  id            INTEGER PRIMARY KEY,
  paquete_id    INTEGER NOT NULL REFERENCES paquete(id) ON DELETE CASCADE,
  salon_id      INTEGER NOT NULL REFERENCES salon(id)   ON DELETE CASCADE,
  etiqueta      TEXT,
  url           TEXT NOT NULL,
  archivo_uuid  TEXT NOT NULL,
  nombre        TEXT,
  -- Para no resubir una lamina que no cambio, y para notar cuando si cambio.
  sha256        TEXT NOT NULL,
  subida_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX paquete_imagen_unica
  ON paquete_imagen (paquete_id, salon_id, COALESCE(etiqueta, ''));

-- La foto de una cortesia, por salon. Separada de paquete_imagen porque una
-- cortesia no pertenece a un paquete: el Espejo de Bienvenida aparece en el
-- Onix, el Plata y el Oro, y es la misma foto.
--
-- La clave es un identificador estable (espejo_bienvenida, aro_iluminado...)
-- y no el texto de cortesias, que viene del Excel y cambia de redaccion entre
-- paquetes.
CREATE TABLE cortesia_imagen (
  id            INTEGER PRIMARY KEY,
  clave         TEXT NOT NULL,
  salon_id      INTEGER NOT NULL REFERENCES salon(id) ON DELETE CASCADE,
  -- Como se le nombra al cliente, para que el agente lo diga igual.
  titulo        TEXT,
  url           TEXT NOT NULL,
  archivo_uuid  TEXT NOT NULL,
  nombre        TEXT,
  sha256        TEXT NOT NULL,
  subida_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX cortesia_imagen_unica ON cortesia_imagen (clave, salon_id);

-- Las citas de visita y los ensayos, juntos.
--
-- Van en la misma tabla porque ocupan el mismo recurso: el tiempo de la
-- encargada en ese salon. Lo que cambia es que la visita trae un lead de Kommo
-- detras y el ensayo no — el ensayo es con alguien que YA contrato, un mes
-- antes de su evento, para repasar la logistica.
--
-- `estado` arranca en 'solicitada' a proposito: el agente nunca confirma una
-- cita, solo la pide. Quien confirma es la encargada, y por eso la solicitud
-- queda como una fila que se ve y no como un mensaje que se pierde en el chat.
CREATE TABLE cita (
  id           INTEGER PRIMARY KEY,
  salon_id     INTEGER NOT NULL REFERENCES salon(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL DEFAULT 'visita' CHECK (tipo IN ('visita','ensayo')),
  fecha        TEXT NOT NULL,
  hora         TEXT NOT NULL,
  minutos      INTEGER NOT NULL DEFAULT 60,
  -- El lead de Kommo, para poder devolverle la hora confirmada al CRM.
  lead_id      TEXT,
  nombre       TEXT,
  telefono     TEXT,
  estado       TEXT NOT NULL DEFAULT 'solicitada'
               CHECK (estado IN ('solicitada','confirmada','asistio','no_asistio','cancelada')),
  notas        TEXT,
  creada_por   TEXT,
  creada_at    TEXT NOT NULL DEFAULT (datetime('now')),
  confirmada_at TEXT
);
CREATE INDEX cita_dia    ON cita (salon_id, fecha, hora);
CREATE INDEX cita_estado ON cita (estado, fecha);
CREATE INDEX cita_lead   ON cita (lead_id);

-- Lo que el agente no pudo resolver y le toca a una persona.
--
-- Existe porque la regla del Lic. Barron es que NUNCA se deje al cliente sin
-- informacion: si el agente no tiene un dato, no se apaga — avisa y sigue
-- conversando. Ese aviso tiene que ser una fila que se ve, y no solo un
-- mensaje en el grupo de WhatsApp, porque un mensaje a las 2 de la madrugada
-- se pierde entre los demas y nadie sabe cuales quedaron sin atender.
--
-- `recordatorios` y `ultimo_aviso_en` son del motor que insiste: el primer
-- aviso sale a cualquier hora, los recordatorios solo en horario laboral.
CREATE TABLE aviso (
  id             INTEGER PRIMARY KEY,
  salon_id       INTEGER REFERENCES salon(id),
  lead_id        TEXT,
  motivo         TEXT NOT NULL,
  texto          TEXT NOT NULL,
  estado         TEXT NOT NULL DEFAULT 'pendiente'
                 CHECK (estado IN ('pendiente','atendido')),
  creado_en      TEXT NOT NULL DEFAULT (datetime('now')),
  ultimo_aviso_en TEXT,
  recordatorios  INTEGER NOT NULL DEFAULT 0,
  atendido_en    TEXT,
  atendido_por   TEXT
);
CREATE INDEX aviso_pendientes ON aviso (estado, creado_en);
CREATE INDEX aviso_lead       ON aviso (lead_id);
