"""`render.py` con ArtCraft (DeckCraft/WordCraft/GridCraft) falsos: con prioridad, con fallos y sin los programas.

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
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
RENDER = os.path.join(HERE, "..", "render.py")
sys.path.insert(0, os.path.join(HERE, ".."))
import render as R  # noqa: E402
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

    def test_pptx_con_deckcraft(self):
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
        self.assertEqual(code, 1)  # sin ArtCraft: no hay render
        self.assertFalse(res["ok"])
        self.assertIsNone(res["motor"])
        self.assertIn(R.AVISO_SIN_ARTCRAFT, res["avisos"])

    def test_si_el_programa_falla_se_avisa_y_no_hay_render(self):
        fake(os.path.join(self.bin, "craft-0.5.0", "deck", "deckcraft-cli"), "#!/bin/sh\nexit 1\n")
        code, res = run(self.pptx, os.path.join(self.d, "o5"), {"LAZUNOX_BIN_DIR": self.bin})
        self.assertEqual(code, 1)
        self.assertFalse(res["ok"])
        self.assertTrue(any("DeckCraft no pudo" in a for a in res["avisos"]), res["avisos"])

    def test_sin_artcraft_aviso_accionable_para_cada_formato(self):
        vacio = os.path.join(self.d, "vacio")
        os.makedirs(vacio)
        xlsx = os.path.join(self.d, "c.xlsx")
        open(xlsx, "w").write("x")
        for archivo in (self.pptx, self.docx, xlsx):
            code, res = run(archivo, os.path.join(self.d, "sin-" + os.path.basename(archivo)), {"LAZUNOX_BIN_DIR": vacio})
            self.assertEqual(code, 1, archivo)
            self.assertEqual(res["avisos"], [R.AVISO_SIN_ARTCRAFT], archivo)
        self.assertIn("Componentes opcionales", R.AVISO_SIN_ARTCRAFT)

    def test_formato_sin_soporte(self):
        doc = os.path.join(self.d, "viejo.doc")
        open(doc, "w").write("x")
        code, res = run(doc, os.path.join(self.d, "o6"), {"LAZUNOX_BIN_DIR": self.bin})
        self.assertEqual(code, 1)
        self.assertTrue(any("formato no soportado" in a for a in res["avisos"]), res["avisos"])


class CraftWindows(unittest.TestCase):
    """Búsqueda y entorno como en Windows (se simula con sys.platform; los «.exe» son scripts de texto con permiso)."""

    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.bin = os.path.join(self.d, "bin")
        self.dir = os.path.join(self.bin, "craft-0.5.0")
        for carpeta, exe in (("deck", "deckcraft-cli.exe"), ("word", "wordcraft-cli.exe"), ("grid", "gridcraft-cli.exe")):
            os.makedirs(os.path.join(self.dir, carpeta))
            fake(os.path.join(self.dir, carpeta, exe), "#!/bin/sh\n")
        for marca in ("installed-deckcraft.json", "installed-wordcraft.json", "installed-gridcraft.json"):
            open(os.path.join(self.dir, marca), "w").write("{}")
        self.env = {"LAZUNOX_BIN_DIR": self.bin}

    def tearDown(self):
        import shutil
        shutil.rmtree(self.d, ignore_errors=True)

    def _win(self):
        return mock.patch.object(sys, "platform", "win32")

    def test_exe_name(self):
        with self._win():
            self.assertEqual(R.exe_name("deckcraft-cli"), "deckcraft-cli.exe")
        with mock.patch.object(sys, "platform", "darwin"):
            self.assertEqual(R.exe_name("deckcraft-cli"), "deckcraft-cli")
        with mock.patch.object(sys, "platform", "linux"):
            self.assertEqual(R.exe_name("wordcraft-cli"), "wordcraft-cli")

    def test_busca_los_tres_programas_en_windows(self):
        with self._win(), mock.patch.dict(os.environ, self.env, clear=True):
            self.assertEqual(R.buscar_deckcraft(), os.path.join(self.dir, "deck", "deckcraft-cli.exe"))
            self.assertEqual(R.buscar_wordcraft(), os.path.join(self.dir, "word", "wordcraft-cli.exe"))
            self.assertEqual(R.buscar_gridcraft(), os.path.join(self.dir, "grid", "gridcraft-cli.exe"))

    def test_en_windows_no_sirve_el_nombre_sin_exe(self):
        os.rename(os.path.join(self.dir, "deck", "deckcraft-cli.exe"), os.path.join(self.dir, "deck", "deckcraft-cli"))
        with self._win(), mock.patch.dict(os.environ, self.env, clear=True):
            self.assertIsNone(R.buscar_deckcraft())

    def test_sin_marca_de_instalacion_completa_no_se_usa(self):
        os.remove(os.path.join(self.dir, "installed-gridcraft.json"))
        with self._win(), mock.patch.dict(os.environ, self.env, clear=True):
            self.assertIsNone(R.buscar_gridcraft())
            self.assertIsNotNone(R.buscar_wordcraft())

    def test_deckcraft_acepta_la_marca_antigua_installed_json(self):
        os.remove(os.path.join(self.dir, "installed-deckcraft.json"))
        open(os.path.join(self.dir, "installed.json"), "w").write("{}")
        with self._win(), mock.patch.dict(os.environ, self.env, clear=True):
            self.assertIsNotNone(R.buscar_deckcraft())

    def test_variable_del_motor_tiene_prioridad_en_windows(self):
        otro = os.path.join(self.d, "otro", "gridcraft-cli.exe")
        os.makedirs(os.path.dirname(otro))
        fake(otro, "#!/bin/sh\n")
        env = dict(self.env, LAZUNOX_GRIDCRAFT=otro)
        with self._win(), mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(R.buscar_gridcraft(), otro)

    def test_variable_inexistente_cae_a_la_carpeta_de_la_app(self):
        env = dict(self.env, LAZUNOX_WORDCRAFT=os.path.join(self.d, "no-existe.exe"))
        with self._win(), mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(R.buscar_wordcraft(), os.path.join(self.dir, "word", "wordcraft-cli.exe"))

    def test_entorno_minimo_windows(self):
        home = os.path.join(self.d, "home")
        with self._win(), mock.patch.dict(os.environ, {"SystemRoot": "C:\\WINDOWS"}, clear=True):
            e = R.entorno_minimo(home)
        self.assertEqual(e["PATH"], "C:\\WINDOWS\\System32;C:\\WINDOWS")
        self.assertEqual(e["SystemRoot"], "C:\\WINDOWS")
        for clave in ("HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP"):
            self.assertEqual(e[clave], home, clave)
        self.assertNotIn("XDG_CONFIG_HOME", e)

    def test_entorno_minimo_windows_sin_systemroot_usa_el_valor_por_defecto(self):
        with self._win(), mock.patch.dict(os.environ, {}, clear=True):
            e = R.entorno_minimo(self.d)
        self.assertEqual(e["PATH"], "C:\\Windows\\System32;C:\\Windows")

    def test_entorno_minimo_macos_igual_que_antes(self):
        home = os.path.join(self.d, "home")
        with mock.patch.object(sys, "platform", "darwin"):
            e = R.entorno_minimo(home)
        self.assertEqual(e, {"PATH": "/usr/bin:/bin", "HOME": home, "XDG_CONFIG_HOME": home, "XDG_DATA_HOME": home,
                             "XDG_CACHE_HOME": home, "XDG_STATE_HOME": home})

    def test_macos_busca_sin_exe(self):
        with mock.patch.object(sys, "platform", "darwin"), mock.patch.dict(os.environ, self.env, clear=True):
            os.rename(os.path.join(self.dir, "deck", "deckcraft-cli.exe"), os.path.join(self.dir, "deck", "deckcraft-cli"))
            self.assertEqual(R.buscar_deckcraft(), os.path.join(self.dir, "deck", "deckcraft-cli"))
            self.assertIsNone(R.buscar_wordcraft())  # solo existe wordcraft-cli.exe: en macOS no se encuentra


if __name__ == "__main__":
    unittest.main()
