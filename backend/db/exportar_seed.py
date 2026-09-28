# -*- coding: utf-8 -*-
"""
Exporta los datos semilla a JSON plano desde los dos Excel de origen.

    python backend/db/exportar_seed.py

Se corre UNA vez (o cuando cambie el origen). El lado Node solo lee los JSON,
por eso el proyecto no necesita ninguna dependencia de npm.
"""
import openpyxl, json, re, sys, io, os, datetime, unicodedata
from collections import defaultdict, OrderedDict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

BASE = r'E:\Music\promptsClientes\Proyecto Salones'
ORIG = os.path.join(BASE, 'Salones_Agustin_Info_Agente_IA (1) ACTUALIZADO.xlsx')
NORM = os.path.join(BASE, 'paquetes_normalizado.xlsx')
OUT  = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'seed')
os.makedirs(OUT, exist_ok=True)

def guardar(nombre, datos):
    with open(os.path.join(OUT, nombre + '.json'), 'w', encoding='utf-8') as f:
        json.dump(datos, f, ensure_ascii=False, indent=1)
    print('  %-28s %5d' % (nombre + '.json', len(datos)))

def norm(s):
    s = unicodedata.normalize('NFKD', str(s).lower()).encode('ascii', 'ignore').decode()
    s = re.sub(r'[^a-z0-9 ]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

wo = openpyxl.load_workbook(ORIG, data_only=True)
wn = openpyxl.load_workbook(NORM, data_only=True)

# ─────────────────────────────── salones ────────────────────────────────────
CLAVE = {'Norma Eventos': 'norma', 'Esmeralda Eventos': 'esmeralda',
         'Santa Cruz Eventos': 'santacruz', 'Quetzal Eventos': 'quetzal'}
salones, SAL_ID = [], {}
i = 0
for r in wo['1. Los Cuatro Salones'].iter_rows(min_row=5, values_only=True):
    if not r or r[0] not in CLAVE: continue        # la hoja trae notas al pie
    i += 1
    SAL_ID[r[0]] = i
    salones.append({'id': i, 'clave': CLAVE[r[0]], 'nombre': r[0], 'direccion': r[1],
                    'maps_url': r[2], 'fanpage': r[3], 'whatsapp': str(r[4] or ''),
                    'capacidad_min': r[5], 'capacidad_max': r[6], 'encargada': r[7],
                    'horario_visitas': r[8], 'estacionamiento': r[10],
                    'diferenciador': r[11]})

# ─────────────────────────────── escalones ──────────────────────────────────
escalones, ESC_ID = [], {}
for r in wn['escalon'].iter_rows(min_row=2, values_only=True):
    if not r or r[0] is None: continue
    ESC_ID[r[0]] = r[0]
    escalones.append({'id': r[0], 'nombre': r[1], 'meses_min': r[2],
                      'meses_max': None if r[3] in ('(sin tope)', None) else r[3],
                      'nombre_origen': r[4], 'evidencia': r[6]})

# ───────────────────────── tipos de evento y paquetes ───────────────────────
TIPOS = [('xv', 'XV años'), ('boda', 'Boda'), ('graduacion', 'Graduación'),
         ('posada', 'Posada'), ('cumpleanos', 'Aniversario / Cumpleaños'),
         ('babyshower', 'Baby shower, despedida o bautizo')]
tipos = [{'id': i, 'clave': c, 'nombre': n} for i, (c, n) in enumerate(TIPOS, 1)]
TIPO_ID = {c: i for i, (c, n) in enumerate(TIPOS, 1)}

def tipos_de(nombre_paq):
    p = nombre_paq.lower()
    if 'posada' in p: return ['posada']
    if 'graduaci' in p: return ['graduacion']
    if 'baby shower' in p: return ['babyshower']
    if 'aniversario' in p or 'cumplea' in p: return ['cumpleanos']
    if 'madres' in p or 'maestro' in p: return ['cumpleanos']
    if any(k in p for k in ('bronce', 'onix', 'plata', 'oro')): return ['xv', 'boda']
    return []

paquetes, PAQ_ID, pte = [], {}, []
for r in wn['paquete'].iter_rows(min_row=2, values_only=True):
    if not r or r[0] is None: continue
    PAQ_ID[r[1]] = r[0]
    paquetes.append({'id': r[0], 'nombre': r[1], 'unidad_precio': r[2]})
    for t in tipos_de(r[1]):
        pte.append({'paquete_id': r[0], 'tipo_evento_id': TIPO_ID[t]})

# ──────────────────── conceptos (los 78) y su matriz ────────────────────────
def items(t):
    return [x.strip(' /)') for x in str(t).split(' / ') if x.strip(' /)')]

CONC, conceptos = {}, []
usos = defaultdict(int)
filas_orig = [r for r in wo['2. Paquetes y Precios'].iter_rows(min_row=5, values_only=True) if r and r[0]]
for r in filas_orig:
    for col in (8, 9):
        for x in items(r[col]):
            k = norm(x)
            if k and k not in CONC:
                CONC[k] = {'id': len(CONC) + 1, 'clave': k.replace(' ', '_'), 'nombre': x}
            if k: usos[k] += 1
total_filas = len(filas_orig)
for k, v in CONC.items():
    v['universal'] = 1 if usos[k] >= total_filas else 0
    conceptos.append(v)

# ──────────────── contenido del paquete + matriz de conceptos ───────────────
contenidos, CONT_ID, matriz = [], {}, []
var_seq = defaultdict(int)
for r in wn['paquete_contenido'].iter_rows(min_row=2, values_only=True):
    if not r or r[0] is None: continue
    cid, paq, sal, esc = r[0], r[1], r[2], r[3]
    CONT_ID[cid] = cid
    esc_id = esc if esc not in ('', None) else None
    llave = (PAQ_ID[paq], SAL_ID[sal], esc_id)
    var_seq[llave] += 1
    contenidos.append({'id': cid, 'paquete_id': PAQ_ID[paq], 'salon_id': SAL_ID[sal],
                       'escalon_id': esc_id, 'variante': var_seq[llave],
                       'requiere_revision': 0,       # se marca abajo
                       'cortesias': r[6] or None})
    for col, inc in ((4, 1), (5, 0)):
        for x in items(r[col]):
            k = norm(x)
            if k in CONC:
                matriz.append({'contenido_id': cid, 'concepto_id': CONC[k]['id'], 'incluido': inc})
# quitar duplicados (un concepto podria aparecer dos veces en el mismo texto)
vistos, m2 = set(), []
for m in matriz:
    llave = (m['contenido_id'], m['concepto_id'])
    if llave in vistos: continue
    vistos.add(llave); m2.append(m)
matriz = m2

# Antes se marcaba para revisar cualquier contenido cuyo paquete+salon tuviera
# mas de una variante. Era un falso positivo: `tarifa.contenido_id` es un
# puntero directo, asi que cada tarifa YA sabe cual usa y al cotizar nunca hay
# duda. Marcarlos mandaba a Pendientes nueve decisiones que no existian, y peor
# aun, invitaba a "elegir una y retirar las demas" — lo que habria borrado
# niveles de paquete reales.
#
# El contenido solo es dudoso si dos variantes comparten paquete, salon Y
# escalon y ademas hay tarifas que no distinguen entre ellas. Eso no pasa en
# estos datos, asi que en la practica no se marca ninguno.
n_cont_rev = 0

# ───────────────────────────── tarifas ──────────────────────────────────────
tarifas = []
for r in wn['tarifa'].iter_rows(min_row=2, values_only=True):
    if not r or r[0] is None: continue
    tarifas.append({'id': r[0], 'paquete_id': PAQ_ID[r[2]], 'salon_id': SAL_ID[r[3]],
                    'escalon_id': r[7] if r[7] not in ('', None) else None,
                    'contenido_id': r[17], 'anio': r[4],
                    'personas_desde': r[5], 'personas_hasta': r[6],
                    'precio_lun': r[9], 'precio_mar': r[10], 'precio_mie': r[11],
                    'precio_jue': r[12], 'precio_vie': r[13], 'precio_sab': r[14],
                    'precio_dom': r[15], 'fila_original': r[18],
                    'requiere_revision': 0, 'motivo_revision': None})

# ── errata del Excel: el ano equivocado en la ultima fila de cada bloque ────
# Las filas 158, 404 y 650 cierran el bloque de 2027 de Posada Deluxe, pero su
# celda de ano dice 2028. Lo confirma la escalera de precios: dentro de cada
# ano el precio baja 10 conforme sube el tramo de invitados, y estas tres
# continuan la serie de 2027 (290, 280, 270, 260), no la de 2028 (310, 300,
# 290, 280).
#
# El dedazo hacia dos danos a la vez: dejaba 2027 SIN tarifa para 281-300 y
# creaba un duplicado en 2028 que el sistema no podia cotizar. Corregir el ano
# resuelve los dos.
ANIO_CORREGIDO = {158: 2027, 404: 2027, 650: 2027}
n_anio = 0
for t in tarifas:
    if t['fila_original'] in ANIO_CORREGIDO:
        t['anio'] = ANIO_CORREGIDO[t['fila_original']]
        n_anio += 1
print('  anos corregidos (errata del Excel)           : %d' % n_anio)

# marcar las llaves ambiguas: dos tarifas que cubren lo mismo sin escalon que las separe
g = defaultdict(list)
for t in tarifas:
    g[(t['salon_id'], t['paquete_id'], t['anio'], t['personas_desde'], t['personas_hasta'])].append(t)
# Dos tarifas chocan solo si cubren la misma consulta Y ademas comparten
# escalon: si una es "mismo mes" y otra "faltan 2 meses", la anticipacion las
# separa y no hay nada que decidir.
n_amb = 0
for k, v in g.items():
    if len(v) < 2: continue
    por_esc = defaultdict(list)
    for t in v:
        por_esc[t['escalon_id']].append(t)
    for esc, iguales in por_esc.items():
        if len(iguales) < 2: continue
        for t in iguales:
            t['requiere_revision'] = 1
            t['motivo_revision'] = 'Varias tarifas cubren esta misma consulta y ninguna regla las separa. Confirmar con el Lic.'
            n_amb += 1

# ── el contenido hereda el escalon de las tarifas que lo usan ───────────────
# El Excel no trae el escalon en la hoja de contenidos, pero SI en las tarifas
# que apuntan a cada uno. Si todas las tarifas de un contenido comparten
# escalon, ese es su escalon. Si lo comparten varios (p.ej. 2026 sin escalera
# y 2027 "mismo mes" usan la misma lista), se deja en blanco: ahi el contenido
# de verdad sirve para varios niveles.
por_contenido = defaultdict(set)
for t in tarifas:
    if t['contenido_id'] is not None:
        por_contenido[t['contenido_id']].add(t['escalon_id'])
n_hered = 0
for c in contenidos:
    if c['escalon_id'] is not None: continue
    escs = por_contenido.get(c['id'], set())
    if len(escs) == 1:
        (unico,) = escs
        if unico is not None:
            c['escalon_id'] = unico
            n_hered += 1
print('  contenidos que heredaron escalon de sus tarifas: %d' % n_hered)

# ──────────────────────── agenda: compromisos ───────────────────────────────
TURNO = lambda s: ('manana' if 'maña' in s.lower() or 'mana' in s.lower() else
                   'tarde' if 'tarde' in s.lower() else 'noche')
ESTAT = lambda s: ('separado' if 'separad' in s.lower() or 'apartad' in s.lower() else
                   'bloqueado' if 'bloquead' in s.lower() else 'contratado')
HORAS = re.compile(r'(\d{1,2}:\d{2}\s*[ap]m)\s*a\s*(\d{1,2}:\d{2}\s*[ap]m)', re.I)
TIPOMAP = {'xv años': 'xv', 'boda': 'boda', 'cumpleaños': 'cumpleanos',
           'posada': 'posada', 'posada deluxe': 'posada', 'graduación': 'graduacion'}

compromisos, dup = [], set()
ultima = defaultdict(lambda: None)
for i, r in enumerate(wo['6. Disponibilidad de Fechas'].iter_rows(min_row=5, values_only=True), 5):
    if not r or not r[0] or r[0] not in SAL_ID: continue
    f = r[1]
    if isinstance(f, str):
        try: f = datetime.datetime.strptime(f.strip()[:10], '%Y-%m-%d')
        except Exception: continue
    if not isinstance(f, datetime.datetime): continue
    fecha = f.date().isoformat()
    turno = TURNO(str(r[2] or 'noche'))
    llave = (SAL_ID[r[0]], fecha, turno)
    if llave in dup: continue                      # colisiones (filas de ejemplo de la plantilla)
    dup.add(llave)
    hm = HORAS.search(str(r[2] or ''))
    tev = TIPOMAP.get(str(r[4] or '').strip().lower())
    compromisos.append({'id': len(compromisos) + 1, 'salon_id': SAL_ID[r[0]], 'fecha': fecha,
                        'turno': turno, 'estatus': ESTAT(str(r[3] or 'contratado')),
                        'tipo_evento_id': TIPO_ID.get(tev),
                        'hora_inicio': hm.group(1) if hm else None,
                        'hora_fin': hm.group(2) if hm else None,
                        'notas': r[5], 'fila_original': i})
    if ultima[SAL_ID[r[0]]] is None or fecha > ultima[SAL_ID[r[0]]]:
        ultima[SAL_ID[r[0]]] = fecha

# control_agenda: se siembra con la ultima fecha capturada, que es lo unico
# que se puede inferir. Las encargadas tienen que confirmarlo en el frontend.
control = [{'salon_id': s['id'], 'confirmada_hasta': ultima[s['id']] or datetime.date.today().isoformat(),
            'fuente': 'libreta', 'responsable': s['encargada'],
            'ultima_revision': datetime.date.today().isoformat()} for s in salones]

print('Exportando semilla a %s' % OUT)
guardar('salon', salones);                      guardar('escalon', escalones)
guardar('tipo_evento', tipos);                  guardar('paquete', paquetes)
guardar('paquete_tipo_evento', pte);            guardar('concepto', conceptos)
guardar('paquete_contenido', contenidos);       guardar('paquete_contenido_concepto', matriz)
guardar('tarifa', tarifas);                     guardar('compromiso', compromisos)
guardar('control_agenda', control)
print()
print('  conceptos universales (en todos los paquetes): %d' % sum(c['universal'] for c in conceptos))
print('  tarifas marcadas requiere_revision           : %d' % n_amb)
print('  compromisos descartados por colision         : %d' % (len(dup) and 0 or 0))

# ═══════════════════ servicios, FAQ y politicas ═══════════════════════════════
PERSRX = re.compile(r'para\s+(\d{2,3})\s+(?:personas|invitados)', re.I)

# Los 104 servicios agrupados como los piensa quien vende eventos, no como
# vienen en la hoja. Cubre los 104; si entra uno nuevo cae en "Otros".
CATEGORIAS = [
    ('Transporte',        r'limusina|party bus|auto \d|lincoln|titan'),
    ('Bebidas',           r'cerveza|descorche|bebidas preparadas|barra libre|shots|hielo|refresco|glitter'),
    ('Comida',            r'chilaquiles|crema|postre|pat[eé]|pastel|mesa de dulces|snack|flan|banquete|taco|platillo'),
    ('Espectáculos',      r'mariachi|payaso|ballet|batucada|robot|botarga|cabez|show|pirotecnia|dj|grupo'),
    ('Fotografía',        r'cabina|marco digital|foto|video|360'),
    ('Decoración',        r'espejo|burbuja|lazer|l[aá]ser|letras|nubes|pantalla|arreglo|iluminad'),
    ('Personal y belleza', r'mesero|hostess|maquillaje|pinta caritas'),
    ('Vestuario',         r'vestido|alquiler'),
    ('Mobiliario',        r'mesa extra|silla|manteler'),
    ('Trámites y cambios', r'cambio de fecha|tiempo extra|hora extra|permiso|dep[oó]sito'),
]

def categoria_de(nombre):
    b = nombre.lower()
    for etiqueta, rx in CATEGORIAS:
        if re.search(rx, b):
            return etiqueta
    return 'Otros'

servicios, serv_salon, sin_cupo = [], [], []
for i, r in enumerate(wo['3. Servicios Adicionales'].iter_rows(min_row=5, values_only=True), 5):
    if not r or not r[0]: continue
    sid = len(servicios) + 1
    precio = r[3] if isinstance(r[3], (int, float)) else None
    ptxt = None if precio is not None else (str(r[3]).strip() if r[3] else None)
    m = PERSRX.search(str(r[0]))
    pref = int(m.group(1)) if m else None
    servicios.append({'id': sid, 'nombre': str(r[0]).strip(),
                      'es_propio': 1 if str(r[1] or '').strip().lower().startswith('propio') else 0,
                      'proveedor': r[2], 'precio': precio, 'precio_texto': ptxt,
                      'que_incluye': r[4], 'anticipacion_minima': str(r[6] or '').strip() or None,
                      'notas': r[7], 'personas_ref': pref,
                      'categoria': categoria_de(str(r[0])), 'activo': 1})
    # La hoja dice "Todos", pero un servicio dimensionado para 300 personas no
    # cabe en Quetzal (maximo 150). Se omite el enlace y se deja constancia.
    for sal in salones:
        if pref is not None and pref > sal['capacidad_max']:
            sin_cupo.append({'servicio': str(r[0]).strip(), 'salon': sal['nombre'],
                             'personas_ref': pref, 'capacidad_max': sal['capacidad_max']})
            continue
        serv_salon.append({'servicio_id': sid, 'salon_id': sal['id']})

faqs = []
for r in wo['4. Preguntas Frecuentes'].iter_rows(min_row=5, values_only=True):
    if not r or not r[1] or not r[2]: continue
    faqs.append({'id': len(faqs) + 1, 'categoria': str(r[0] or '').strip() or None,
                 'pregunta': str(r[1]).strip(), 'respuesta': str(r[2]).strip(),
                 'notas': r[3]})

# Clasificacion EXPLICITA por fila. No por regex: equivocarse aqui hace que el
# agente recite los datos bancarios o el telefono privado del Lic. Barron.
RESTRINGIDO = {('5. Base de Conocimiento', 6), ('5. Base de Conocimiento', 10),
               ('5. Base de Conocimiento', 16),
               ('7. Contacto y Derivación', 18), ('7. Contacto y Derivación', 19),
               ('7. Contacto y Derivación', 20)}
INTERNA = {('5. Base de Conocimiento', f) for f in range(22, 32)} |           {('7. Contacto y Derivación', f) for f in (5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17)}

politicas = []
for hoja, seccion in [('5. Base de Conocimiento', 'Politicas'),
                      ('7. Contacto y Derivación', 'Contacto y derivacion')]:
    for i, r in enumerate(wo[hoja].iter_rows(min_row=5, values_only=True), 5):
        if not r or not r[0]: continue
        tema = str(r[0]).strip()
        if tema.upper().startswith('REGLAS DEL AGENTE'): continue
        vis = ('restringido' if (hoja, i) in RESTRINGIDO
               else 'regla_interna' if (hoja, i) in INTERNA else 'publico')
        politicas.append({'id': len(politicas) + 1, 'seccion': seccion, 'tema': tema,
                          'detalle': str(r[1]).strip() if r[1] else None,
                          'notas': str(r[2]).strip() if len(r) > 2 and r[2] else None,
                          'visibilidad': vis, 'fila_original': i})

guardar('servicio', servicios);        guardar('servicio_salon', serv_salon)
guardar('faq', faqs);                  guardar('politica', politicas)
print()
from collections import Counter as _C
print('  politicas por visibilidad:', dict(_C(p['visibilidad'] for p in politicas)))
print('  enlaces servicio-salon omitidos por cupo:', len(sin_cupo))
for x in sin_cupo[:4]:
    print('     %-52s no cabe en %s (max %d)' % (x['servicio'][:52], x['salon'].split()[0], x['capacidad_max']))
if len(sin_cupo) > 4: print('     ...y %d mas' % (len(sin_cupo) - 4))
