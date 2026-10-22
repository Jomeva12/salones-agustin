# -*- coding: utf-8 -*-
"""Saca del Excel del Lic. Barron los bloques que hay que cargar.

Vive en el repo y no en una carpeta temporal a proposito: el JSON que produce
es el que lee la migracion, y si el extractor se pierde nadie puede volver a
generarlo ni comprobar de donde salio cada numero. Ya paso con el generador
del flujo principal de n8n.

Saca del Excel del 22-oct-2026 los tres bloques que faltan por cargar.

    python backend/db/extraer_anexos_excel.py <nuevo.xlsx> <salida.json>

Se extrae del Excel y no se teclea a mano: 31 filas por 4 precios son 124
numeros, y un digito mal en un precio no se ve al revisar.

Los bloques se identifican por su NOTA, que es lo unico que distingue dos
filas con el mismo salon, paquete, personas y anio.
"""
import json, io, sys
from openpyxl import load_workbook

HOJA = '2. Paquetes y Precios'
CLAVE = {'Norma Eventos': 'norma', 'Esmeralda Eventos': 'esmeralda',
         'Santa Cruz Eventos': 'santacruz', 'Quetzal Eventos': 'quetzal'}

# Cada bloque: como reconocerlo y que significa su regla.
BLOQUES = {
    'ventana_ene_mar_2027': {
        'salones': ['Norma Eventos', 'Esmeralda Eventos', 'Santa Cruz Eventos'],
        'paquete': 'Paquete Bronce',
        'anio': '2027',
        'marca': 'se ofrece cuando estemos en los meses de Octubre, Noviembre y Diciembre del 2026',
        'escalon': None,
        'evento_desde': '2027-01-01', 'evento_hasta': '2027-03-31',
        'cotiza_desde': '2026-10-01', 'cotiza_hasta': '2027-03-31',
    },
    'escalon_6_o_mas': {
        'salones': ['Norma Eventos', 'Esmeralda Eventos', 'Santa Cruz Eventos'],
        'paquete': 'Paquete Bronce',
        'anio': '2027',
        'marca': 'se ofrece a partir del septimo mes en adelante',
        'escalon': 'Faltan 6 meses o más',
        'evento_desde': None, 'evento_hasta': None,
        'cotiza_desde': None, 'cotiza_hasta': None,
    },
    'quetzal_bronce_boda_xv_2026': {
        'salones': ['Quetzal Eventos'],
        'paquete': 'Paquete Bronce Boda y XV',
        'anio': '2026',
        'marca': 'se ofrece para los eventos que se lleven a cabo en los meses de Sepiembre',
        'escalon': None,
        'evento_desde': '2026-09-01', 'evento_hasta': '2026-12-31',
        'cotiza_desde': None, 'cotiza_hasta': None,
    },
}


def entero(v):
    if v is None:
        return None
    s = str(v).strip().replace(',', '').replace('$', '')
    try:
        return int(float(s))
    except ValueError:
        return None


wb = load_workbook(sys.argv[1], data_only=True, read_only=True)
ws = wb[HOJA]
crudas = []
for i, f in enumerate(ws.iter_rows(min_row=5, values_only=True), 5):
    if not f or f[0] is None:
        continue
    t = lambda v: '' if v is None else str(v).strip()
    crudas.append({'fila': i, 'salon': t(f[0]), 'paquete': t(f[1]), 'personas': t(f[2]),
                   'anio': t(f[3]), 'vie': entero(f[4]), 'sab': entero(f[5]),
                   'dom': entero(f[6]), 'sem': entero(f[7]), 'nota': t(f[10])})
wb.close()

salida = {}
for nombre, cfg in BLOQUES.items():
    filas = []
    for r in crudas:
        if r['salon'] not in cfg['salones']:
            continue
        if r['paquete'] != cfg['paquete'] or r['anio'] != cfg['anio']:
            continue
        if cfg['marca'] not in r['nota']:
            continue
        # Un precio que no se puede leer NO se carga a medias: se para. Un cero
        # silencioso en un precio es peor que un error ruidoso.
        for col in ('vie', 'sab', 'dom', 'sem'):
            if r[col] is None:
                raise SystemExit(f'fila {r["fila"]}: el precio «{col}» no es un numero')
        filas.append({'fila_excel': r['fila'], 'salon': CLAVE[r['salon']],
                      'paquete': r['paquete'], 'personas': int(r['personas']),
                      'anio': int(r['anio']), 'precio_vie': r['vie'],
                      'precio_sab': r['sab'], 'precio_dom': r['dom'],
                      'precio_semana': r['sem'], 'nota': r['nota']})
    salida[nombre] = {k: v for k, v in cfg.items() if k not in ('salones', 'marca', 'paquete', 'anio')}
    salida[nombre]['paquete'] = cfg['paquete']
    salida[nombre]['filas'] = filas
    porsalon = {}
    for x in filas:
        porsalon[x['salon']] = porsalon.get(x['salon'], 0) + 1
    print(f'{nombre}: {len(filas)} filas · ' +
          ', '.join(f'{k} {v}' for k, v in porsalon.items()))

io.open(sys.argv[2], 'w', encoding='utf-8', newline='\n').write(
    json.dumps(salida, ensure_ascii=False, indent=2) + '\n')
print('\nescrito en', sys.argv[2])
