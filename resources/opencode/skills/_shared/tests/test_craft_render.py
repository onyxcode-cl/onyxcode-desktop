"""`render.py` con ArtCraft (DeckCraft/WordCraft) falsos: sin LibreOffice, con prioridad, con fallos y sin los programas.

Ejecutar:  $LAZUNOX_PYTHON tests/test_craft_render.py
"""
from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
RENDER = os.path.join(HERE, "..", "render.py")
PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc000000301010018dd8db00000000049454e44ae426082")

DECK = """#!/bin/sh
# DeckCraft falso: render FILE --all OUTDIR  -> OUTDIR/slide-01..03.png
[ "$1" = render ] || exit 2
mkdir -p "$4"; for n in 01 02 03; do printf '%s' PNGDATA > "$4/slide-$n.png"; done
"""
WORD = """#!/bin/sh
# WordCraft falso: info FILE | render FILE OUT --page N
if [ "$1" = info ]; then echo '{"pages": 2}'; exit 0; fi
[ "$1" = render ] && [ "$4" = --page ] || exit 2
printf '%s' PNGDATA > "$3"
"""


def fake(path, body):
    with open(path, "w") as f:
        f.write(body)
    os.chmod(path, os.stat(path).st_mode | stat.S_IEXEC)


def run(archivo, outdir, env_extra):
    env = {"PATH": "/usr/bin:/bin"}
    env.update(env_extra)
    cp = subprocess.run([sys.executable, "-I", RENDER, archivo, "--outdir", outdir], capture_output=True, text=True, env=env)
    return cp.returncode, json.loads(cp.stdout)


class CraftRender(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.bin = os.path.join(self.d, "bin")
        os.makedirs(os.path.join(self.bin, "craft-0.5.0", "deck"))
        os.makedirs(os.path.join(self.bin, "craft-0.5.0", "word"))
        fake(os.path.join(self.bin, "craft-0.5.0", "deck", "deckcraft-cli"), DECK)
        fake(os.path.join(self.bin, "craft-0.5.0", "word", "wordcraft-cli"), WORD)
        for t in ("deckcraft", "wordcraft"):
            open(os.path.join(self.bin, "craft-0.5.0", f"installed-{t}.json"), "w").write("{}")
        self.pptx = os.path.join(self.d, "a.pptx")
        self.docx = os.path.join(self.d, "b.docx")
        for f in (self.pptx, self.docx):
            open(f, "w").write("x")

    def test_pptx_con_deckcraft_sin_libreoffice(self):
        code, res = run(self.pptx, os.path.join(self.d, "o1"), {"LAZUNOX_BIN_DIR": self.bin})
        self.assertEqual(code, 0, res)
        self.assertEqual((res["ok"], res["paginas"], res["motor"]), (True, 3, "artcraft"))
        self.assertEqual([os.path.basename(p) for p in res["pngs"]], ["a-p01.png", "a-p02.png", "a-p03.png"])
        self.assertTrue(all(os.path.isfile(p) for p in res["pngs"]))

    def test_docx_con_wordcraft_pagina_a_pagina(self):
        code, res = run(self.docx, os.path.join(self.d, "o2"), {"LAZUNOX_BIN_DIR": self.bin})
        self.assertEqual(code, 0, res)
        self.assertEqual((res["paginas"], len(res["pngs"])), (2, 2))

    def test_variable_del_motor_tiene_prioridad(self):
        otro = os.path.join(self.d, "otro-wordcraft")
        fake(otro, WORD.replace('"pages": 2', '"pages": 1'))
        code, res = run(self.docx, os.path.join(self.d, "o3"), {"LAZUNOX_BIN_DIR": self.bin, "LAZUNOX_WORDCRAFT": otro})
        self.assertEqual(res["paginas"], 1)

    def test_sin_marca_de_instalacion_completa_no_se_usa(self):
        os.remove(os.path.join(self.bin, "craft-0.5.0", "installed-wordcraft.json"))
        code, res = run(self.docx, os.path.join(self.d, "o4"), {"LAZUNOX_BIN_DIR": self.bin})
        self.assertEqual(code, 1)  # sin ArtCraft ni LibreOffice: no hay render
        self.assertFalse(res["ok"])

    def test_si_el_programa_falla_se_avisa_y_se_cae_a_libreoffice(self):
        fake(os.path.join(self.bin, "craft-0.5.0", "deck", "deckcraft-cli"), "#!/bin/sh\nexit 1\n")
        code, res = run(self.pptx, os.path.join(self.d, "o5"), {"LAZUNOX_BIN_DIR": self.bin})
        self.assertFalse(res["ok"])
        self.assertTrue(any("DeckCraft no pudo" in a for a in res["avisos"]), res["avisos"])


if __name__ == "__main__":
    unittest.main()
