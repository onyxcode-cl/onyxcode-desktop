#!/usr/bin/env python3
"""Excel con el MISMO motor y vocabulario de diseño que el Chat: `python3 build_chat_xlsx.py spec.json salida.xlsx`.

`spec.json` es el JSON del bloque ```xlsx del Chat (esquema y guía de diseño en SKILL.md). Valida con el mismo validador del Chat y arma el archivo
con GridCraft, igual que el Chat (ver `_shared/chat_engine.py`). Códigos: 0 ok · 1 error de contenido o del programa (el mensaje dice qué corregir) ·
2 uso · 3 falta GridCraft, Node o el motor empaquetado (no insistas: sigue con `build_xlsx.py`). Nunca sobrescribe un archivo existente.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_shared"))
import chat_engine  # noqa: E402

if __name__ == "__main__":
    sys.exit(chat_engine.lanzar("xlsx", os.path.join(os.path.dirname(os.path.abspath(__file__)), "build_chat_xlsx.cjs"), sys.argv))
