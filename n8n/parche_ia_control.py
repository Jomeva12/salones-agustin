"""Mete en salones_principal el porton de los interruptores por salon (widget «Control de Maya»).

    le_contesto [si] -> ia_control_leer -> ia_gate -> ia_salon_encendida -> [si] guardar_en_buffer
                                                                          -> [no] ia_saltado

salones_principal no tiene generador: se construyo por parches. Este script es el parche, y deja
`n8n/salones_principal.json` identico a lo que corre.

    python n8n/parche_ia_control.py --seco        arma el flujo y dice que cambiaria, sin subir nada
    python n8n/parche_ia_control.py               lo sube (apagar -> guardar -> encender) y actualiza el JSON
    python n8n/parche_ia_control.py --restaurar   quita el porton y deja le_contesto -> guardar_en_buffer

Antes de tocar nada comprueba que lo que corre es lo versionado, y guarda un respaldo en para-subir/.
El codigo del porton vive en n8n/codigo/ia_gate.js. Las tablas las crea el flujo salones_ia_control_api.
"""
import datetime, io, json, os, sys, urllib.request, urllib.error

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = 'https://automatizaciones-n8n.hpzji3.easypanel.host/api/v1'
WID = 'eXHsmGJcQ2VNgvEs'
ARCHIVO = os.path.join(RAIZ, 'n8n', 'salones_principal.json')
PG = {"postgres": {"id": "NaGMrunSEarhp4cc", "name": "postgres_salones"}}
NUEVOS = ['ia_control_leer', 'ia_gate', 'ia_salon_encendida', 'ia_saltado']
_key = [l.strip() for l in open(os.path.join(RAIZ, '.n8n_key'), encoding='utf-8').read().splitlines() if l.strip()][-1]


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method, headers={'X-N8N-API-KEY': _key, 'Content-Type': 'application/json', 'accept': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=120) as resp: return resp.status, json.loads(resp.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, e.read().decode()[:1500]


def forma(w):
    return {'name': w['name'], 'nodes': w['nodes'], 'connections': w['connections'], 'settings': w.get('settings') or {}}


def iguales(a, b):
    na = {n['name']: n for n in a['nodes']}; nb = {n['name']: n for n in b['nodes']}
    dif = [k for k in sorted(set(na) | set(nb)) if json.dumps((na.get(k) or {}).get('parameters'), sort_keys=True) != json.dumps((nb.get(k) or {}).get('parameters'), sort_keys=True)]
    return dif, json.dumps(a['connections'], sort_keys=True) == json.dumps(b['connections'], sort_keys=True)


def nodos_nuevos():
    js = io.open(os.path.join(RAIZ, 'n8n', 'codigo', 'ia_gate.js'), encoding='utf-8').read().strip()
    return [
        {"parameters": {"operation": "executeQuery", "query": "SELECT clave, encendida FROM ia_control;", "options": {}},
         "id": "c0a1e001-1a01-4c01-8a01-1a0c0e000001", "name": "ia_control_leer", "type": "n8n-nodes-base.postgres", "typeVersion": 2.6, "position": [160, -220],
         "credentials": PG, "alwaysOutputData": True, "executeOnce": True, "onError": "continueRegularOutput"},
        {"parameters": {"jsCode": js}, "id": "c0a1e001-1a01-4c01-8a01-1a0c0e000002", "name": "ia_gate", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [340, -220]},
        {"parameters": {"conditions": {"options": {"version": 2, "caseSensitive": True, "typeValidation": "loose"}, "combinator": "and",
                                       "conditions": [{"id": "ia", "operator": {"type": "boolean", "operation": "true", "singleValue": True}, "leftValue": "={{ $json.ia_salon_encendida }}", "rightValue": ""}]}, "options": {}},
         "id": "c0a1e001-1a01-4c01-8a01-1a0c0e000003", "name": "ia_salon_encendida", "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [520, -220]},
        # Parametrizado, no interpolado: el cliente escribe signos de pesos y uno pegado a una comilla rompe la consulta.
        {"parameters": {"operation": "executeQuery", "query": "INSERT INTO ia_control_saltados (lead_id, clave, autor, origen, texto)\nVALUES ($1, $2, $3, $4, $5);",
                        "options": {"queryReplacement": "={{ [$json.lead_id, $json.ia_salon, $json.autor || '', $json.origen || '', String($json.texto || '').slice(0, 300)] }}"}},
         "id": "c0a1e001-1a01-4c01-8a01-1a0c0e000004", "name": "ia_saltado", "type": "n8n-nodes-base.postgres", "typeVersion": 2.6, "position": [700, -120], "credentials": PG},
    ]


def poner(w):
    w = json.loads(json.dumps(w))
    w['nodes'] = [n for n in w['nodes'] if n['name'] not in NUEVOS] + nodos_nuevos()
    c = w['connections']
    assert [x['node'] for x in c['le_contesto']['main'][0]] in (['guardar_en_buffer'], ['ia_control_leer']), c['le_contesto']
    c['le_contesto']['main'][0] = [{"node": "ia_control_leer", "type": "main", "index": 0}]
    c['ia_control_leer'] = {"main": [[{"node": "ia_gate", "type": "main", "index": 0}]]}
    c['ia_gate'] = {"main": [[{"node": "ia_salon_encendida", "type": "main", "index": 0}]]}
    c['ia_salon_encendida'] = {"main": [[{"node": "guardar_en_buffer", "type": "main", "index": 0}], [{"node": "ia_saltado", "type": "main", "index": 0}]]}
    return w


def quitar(w):
    w = json.loads(json.dumps(w))
    w['nodes'] = [n for n in w['nodes'] if n['name'] not in NUEVOS]
    c = w['connections']
    for k in NUEVOS: c.pop(k, None)
    c['le_contesto']['main'][0] = [{"node": "guardar_en_buffer", "type": "main", "index": 0}]
    return w


if __name__ == '__main__':
    seco, restaurar = '--seco' in sys.argv, '--restaurar' in sys.argv
    s, vivo = call('GET', '/workflows/' + WID); assert s == 200, (s, vivo)
    repo = json.load(io.open(ARCHIVO, encoding='utf-8'))
    dif, conex = iguales(vivo, repo)
    if dif or not conex:
        sys.exit('Lo que corre NO es lo versionado (nodos distintos: %s; conexiones iguales: %s). Traelo primero al archivo.' % (dif, conex))
    nuevo = (quitar if restaurar else poner)(forma(vivo))
    print('nodos: %d -> %d' % (len(vivo['nodes']), len(nuevo['nodes'])), '| le_contesto [si] ->', [x['node'] for x in nuevo['connections']['le_contesto']['main'][0]],
          '| ia_salon_encendida ->', [[x['node'] for x in o] for o in nuevo['connections'].get('ia_salon_encendida', {}).get('main', [])])
    if seco: sys.exit(0)
    os.makedirs(os.path.join(RAIZ, 'para-subir'), exist_ok=True)
    resp = os.path.join(RAIZ, 'para-subir', 'respaldo_salones_principal_%s.json' % datetime.datetime.now().strftime('%Y-%m-%dT%H-%M-%S'))
    io.open(resp, 'w', encoding='utf-8').write(json.dumps(forma(vivo), ensure_ascii=False, indent=1)); print('respaldo', resp)
    activo = vivo.get('active')
    if activo: call('POST', f'/workflows/{WID}/deactivate')       # guardar un flujo activo deja su webhook sin registrar
    s, r = call('PUT', f'/workflows/{WID}', nuevo)
    if s != 200 and 'settings' in str(r):                          # la API publica rechaza claves de settings que la interfaz si guarda
        nuevo['settings'] = {k: v for k, v in nuevo['settings'].items() if k in ('executionOrder', 'timezone', 'errorWorkflow', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'saveManualExecutions', 'saveExecutionProgress', 'executionTimeout', 'callerPolicy')}
        s, r = call('PUT', f'/workflows/{WID}', nuevo)
    if s != 200:                                                   # no quedo guardado: se vuelve a encender lo que habia
        if activo: call('POST', f'/workflows/{WID}/activate')
        sys.exit('n8n no guardo el flujo (%s): %s' % (s, str(r)[:400]))
    if activo: print('encendido', call('POST', f'/workflows/{WID}/activate')[0])
    s, vivo2 = call('GET', '/workflows/' + WID)
    dif, conex = iguales(vivo2, nuevo)
    print('guardado', s, '| activo', vivo2.get('active'), '| nodos', len(vivo2['nodes']), '| distinto de lo enviado:', dif, '| conexiones iguales:', conex)
    io.open(ARCHIVO, 'w', encoding='utf-8', newline='\n').write(json.dumps(forma(vivo2), ensure_ascii=False, indent=1))
    print('actualizado', ARCHIVO)
