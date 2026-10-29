#!/usr/bin/env python3
"""Presentación con el MISMO motor y vocabulario de diseño que el Chat: `python3 build_chat_deck.py spec.json salida.pptx`.

`spec.json` es el JSON del bloque ```pptx del Chat (theme/style/palette/fonts/background, layouts incluido `free`, stat, steps, cards,
chart, kpis…; guía en SKILL.md). Este script solo ubica Node y DeckCraft y lanza `build_chat_deck.cjs` (generado por `npm run build:chat-deck`
desde `src/main/office/craft/chat-deck-cli.ts`: valida el JSON con el mismo `isPptxSpec` y arma el archivo con el mismo `chatDeckCommands` +
`runCraft` que usa el Chat; no hay diseño duplicado aquí). El JSON es DATO: nunca va a una ruta ni a un comando, y la salida nunca
sobrescribe un archivo existente.

Códigos de salida: 0 ok · 1 error de contenido o de DeckCraft (el mensaje dice qué corregir) · 2 uso · 3 falta DeckCraft, Node o el
motor empaquetado (no insistas: sigue con `build_pptx.py`).
"""
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_shared"))
import render  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))
MOTOR = os.path.join(AQUI, "build_chat_deck.cjs")


def buscar_node():
    """Node de la app (`$LAZUNOX_NODE`, el que descarga la app) o el `node` del PATH. `None` si no hay ninguno."""
    ruta = os.environ.get("LAZUNOX_NODE")
    if ruta and os.path.isfile(ruta) and os.access(ruta, os.X_OK):
        return ruta
    return shutil.which("node")


def main(argv):
    if len(argv) != 3 or not argv[2].lower().endswith(".pptx"):
        print("Uso: build_chat_deck.py spec.json salida.pptx", file=sys.stderr)
        return 2
    deckcraft = render.buscar_deckcraft()
    if not deckcraft:
        print("Aviso: DeckCraft no está instalado; usa build_pptx.py (diseño estándar).", file=sys.stderr)
        return 3
    node = buscar_node()
    if not node or not os.path.isfile(MOTOR):
        print("Aviso: el motor de presentaciones del Chat no está disponible en este equipo (falta Node o build_chat_deck.cjs); "
              "usa build_pptx.py (diseño estándar).", file=sys.stderr)
        return 3
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE")}
    env["LAZUNOX_DECKCRAFT"] = deckcraft
    try:
        r = subprocess.run([node, MOTOR, argv[1], argv[2]], capture_output=True, text=True, timeout=90, env=env)
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f"ERROR: no se pudo ejecutar el motor de presentaciones: {e}", file=sys.stderr)
        return 1
    if r.stdout:
        print(r.stdout.rstrip())
    if r.stderr:
        print(r.stderr.rstrip(), file=sys.stderr)
    return r.returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv))
