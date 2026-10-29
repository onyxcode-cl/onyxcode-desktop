#!/usr/bin/env python3
"""Word con el MISMO motor y vocabulario de diseño que el Chat: `python3 build_chat_docx.py spec.json salida.docx`.

`spec.json` es el JSON del bloque ```docx del Chat (esquema y guía de diseño en SKILL.md). Valida con el mismo validador del Chat y arma el archivo
con WordCraft, igual que el Chat (ver `_shared/chat_engine.py`). Códigos: 0 ok · 1 error de contenido o del programa (el mensaje dice qué corregir) ·
2 uso · 3 falta WordCraft, Node o el motor empaquetado (no insistas: sigue con `build_docx.py`). Nunca sobrescribe un archivo existente.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_shared"))
import chat_engine  # noqa: E402

if __name__ == "__main__":
    sys.exit(chat_engine.lanzar("docx", os.path.join(os.path.dirname(os.path.abspath(__file__)), "build_chat_docx.cjs"), sys.argv))
