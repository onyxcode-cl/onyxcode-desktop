"""Lanzador común de los motores del Chat empaquetados (`build_chat_docx.cjs`, `build_chat_xlsx.cjs`) para las skills docx y xlsx.

Cada skill tiene un `build_chat_*.py` de 10 líneas que llama a `lanzar()`: ubica el programa de ArtCraft (WordCraft/GridCraft, el mismo que usa
el Chat) y Node, y ejecuta el `.cjs` (generado por `npm run build:chat-office` desde `src/main/office/craft/chat-*-cli.ts`, que valida el JSON
con los mismos `isDocxSpec`/`isXlsxSpec` y arma el archivo con el mismo `renderChatDocx`/`renderChatGrid` del Chat). Aquí no hay lógica de diseño.
El JSON es DATO: nunca va a una ruta ni a un comando; la salida nunca sobrescribe un archivo existente (lo exige el `.cjs`).
Códigos: 0 ok · 1 error de contenido o del programa · 2 uso · 3 falta el programa, Node o el `.cjs` (la skill sigue con su camino en Python).
"""
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render  # noqa: E402

VARIABLES = {"docx": "LAZUNOX_WORDCRAFT", "xlsx": "LAZUNOX_GRIDCRAFT"}
PROGRAMAS = {"docx": ("WordCraft", render.buscar_wordcraft), "xlsx": ("GridCraft", render.buscar_gridcraft)}
RESPALDO = {"docx": "build_docx.py", "xlsx": "build_xlsx.py"}


def buscar_node():
    """Node de la app (`$LAZUNOX_NODE`, el que descarga la app) o el `node` del PATH. `None` si no hay ninguno."""
    ruta = os.environ.get("LAZUNOX_NODE")
    if ruta and os.path.isfile(ruta) and os.access(ruta, os.X_OK):
        return ruta
    return shutil.which("node")


def lanzar(tipo, motor, argv):
    """`tipo` = 'docx' | 'xlsx'; `motor` = ruta del `.cjs`; `argv` = sys.argv del script (spec.json y salida)."""
    nombre_script = os.path.basename(argv[0])
    if len(argv) != 3 or not argv[2].lower().endswith("." + tipo):
        print("Uso: %s spec.json salida.%s" % (nombre_script, tipo), file=sys.stderr)
        return 2
    programa, buscar = PROGRAMAS[tipo]
    ruta = buscar()
    if not ruta:
        print("Aviso: %s no está instalado; usa %s (diseño estándar)." % (programa, RESPALDO[tipo]), file=sys.stderr)
        return 3
    node = buscar_node()
    if not node or not os.path.isfile(motor):
        print("Aviso: el motor del Chat no está disponible en este equipo (falta Node o %s); usa %s (diseño estándar)."
              % (os.path.basename(motor), RESPALDO[tipo]), file=sys.stderr)
        return 3
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE")}
    env[VARIABLES[tipo]] = ruta
    try:
        r = subprocess.run([node, motor, argv[1], argv[2]], capture_output=True, text=True, timeout=120, env=env)
    except (OSError, subprocess.TimeoutExpired) as e:
        print("ERROR: no se pudo ejecutar el motor del Chat: %s" % e, file=sys.stderr)
        return 1
    if r.stdout:
        print(r.stdout.rstrip())
    if r.stderr:
        print(r.stderr.rstrip(), file=sys.stderr)
    return r.returncode
