"""Pruebas de `build_word_craft.py` (la ruta con WordCraft): no necesitan el programa instalado salvo la prueba real opcional.

Ejecutar:  $LAZUNOX_PYTHON tests/test_craft.py     (con WORDCRAFT_CLI=ruta se prueba también con el programa real)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = os.path.join(HERE, "..", "scripts")
sys.path.insert(0, SCRIPTS)
import build_word_craft as bw  # noqa: E402
import _docxlib as lib  # noqa: E402

SPEC = {
    "title": "Informe", "subtitle": "Sub", "author": "Ana", "date": "hoy", "header": "Cab", "footer": "Pie",
    "blocks": [
        {"type": "heading", "level": 1, "text": "Resumen"},
        {"type": "paragraph", "text": "Subió **12,5%** y *mucho*.", "align": "justify"},
        {"type": "bullets", "items": ["a", ["b1", "b2"], "c"]},
        {"type": "numbered", "items": ["uno", "dos"]},
        {"type": "numbered", "items": ["otra", "lista"]},
        {"type": "table", "columns": ["R", "V"], "rows": [["N", 1234567], ["Total", 2.5]], "total_row": True, "caption": "T1"},
        {"type": "page_break"},
    ],
}


class Craft(unittest.TestCase):
    def test_helpers_iguales_a_docxlib(self):
        for v, d in [(1234567, None), (1234567, 2), (1234.5, None), (0.1, None), (3.0, None), (True, None), (-5, None)]:
            self.assertEqual(bw.fmt_num(v, d), lib.fmt_num(v, d))
        for s in ["1.234", "$ 5", "12%", "hola", "", "(3)", "10 CLP"]:
            self.assertEqual(bw.looks_numeric(s), lib.looks_numeric(s))
        self.assertEqual(bw.fecha_es(), lib.fecha_es())

    def test_comandos_validos(self):
        cmds = bw.build_commands(SPEC, ".")
        for c in cmds:
            i, _, rest = c.partition("=")
            self.assertRegex(i, r"^[a-z]+\.[a-zA-Z0-9]+$")
            if rest:
                json.loads(rest)
        self.assertTrue(any(c.startswith("insert.table=") for c in cmds))
        self.assertEqual(sum(1 for c in cmds if c == "para.restartNumbering"), 1)  # solo el 2.º bloque numbered reinicia
        self.assertIn("insert.closeHeader", cmds)  # el cursor vuelve al cuerpo tras encabezado/pie

    def test_el_texto_es_dato(self):
        evil = 'x"}\n--cmd shape.delete'
        cmds = bw.build_commands({"blocks": [{"type": "paragraph", "text": evil}]}, ".")
        self.assertIn("text.insert=" + json.dumps({"text": evil}, ensure_ascii=False, separators=(",", ":")), cmds)

    def test_rechaza_contenido_invalido(self):
        casos = [None, {}, {"blocks": []}, {"blocks": [{"type": "otro"}]}, {"blocks": [{"type": "heading", "level": 7, "text": "x"}]},
                 {"blocks": [{"type": "table", "columns": ["a", "b"], "rows": [["1"]]}]},
                 {"blocks": [{"type": "paragraph", "text": "x" * 6000}]},
                 {"blocks": [{"type": "image", "path": "../../etc/passwd"}]},
                 {"blocks": [{"type": "image", "path": "no-existe.png"}]}]
        for c in casos:
            with self.assertRaises(bw.SpecError, msg=str(c)[:60]):
                bw.build_commands(c, tempfile.gettempdir())

    def test_imagen_solo_dentro_de_la_carpeta_del_json(self):
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "a.png"), "wb").write(b"x")
            ok = bw.build_commands({"blocks": [{"type": "image", "path": "a.png"}]}, d)
            self.assertTrue(any(c.startswith("insert.picture=") for c in ok))
            self.assertIn("caret.docEnd", ok)  # la imagen queda seleccionada; sin mover el cursor el texto siguiente la borra

    def test_sin_programa_sale_con_3(self):
        with tempfile.TemporaryDirectory() as d:
            j = os.path.join(d, "c.json")
            json.dump(SPEC, open(j, "w"))
            env = {"PATH": os.environ.get("PATH", ""), "LAZUNOX_BIN_DIR": os.path.join(d, "nada")}
            cp = subprocess.run([sys.executable, "-I", os.path.join(SCRIPTS, "build_word_craft.py"), j, os.path.join(d, "o.docx")],
                                capture_output=True, text=True, env=env)
            self.assertEqual(cp.returncode, 3, cp.stderr)

    @unittest.skipUnless(os.environ.get("WORDCRAFT_CLI"), "sin WORDCRAFT_CLI")
    def test_con_el_programa_real(self):
        with tempfile.TemporaryDirectory() as d:
            j = os.path.join(d, "c.json")
            json.dump(SPEC, open(j, "w"))
            env = {"PATH": os.environ.get("PATH", ""), "LAZUNOX_WORDCRAFT": os.environ["WORDCRAFT_CLI"]}
            out = os.path.join(d, "o.docx")
            cp = subprocess.run([sys.executable, "-I", os.path.join(SCRIPTS, "build_word_craft.py"), j, out], capture_output=True, text=True, env=env)
            self.assertEqual(cp.returncode, 0, cp.stderr)
            self.assertGreater(os.path.getsize(out), 3000)


class CraftWindowsFind(unittest.TestCase):
    """`find_wordcraft` en Windows (simulado): busca `wordcraft-cli.exe` con su marca de instalación."""

    def test_windows_encuentra_exe_con_marca(self):
        with tempfile.TemporaryDirectory() as d:
            carpeta = os.path.join(d, "craft-0.5.0", "word")
            os.makedirs(carpeta)
            exe = os.path.join(carpeta, "wordcraft-cli.exe")
            open(exe, "w").write("#!/bin/sh\n")
            os.chmod(exe, 0o755)
            open(os.path.join(d, "craft-0.5.0", "installed-wordcraft.json"), "w").write("{}")
            env = {"LAZUNOX_BIN_DIR": d}
            with mock.patch.object(sys, "platform", "win32"), mock.patch.dict(os.environ, env, clear=True):
                self.assertEqual(bw.find_wordcraft(), exe)
                os.remove(os.path.join(d, "craft-0.5.0", "installed-wordcraft.json"))
                self.assertEqual(bw.find_wordcraft(), "")

    def test_variable_del_motor_gana(self):
        with tempfile.TemporaryDirectory() as d:
            exe = os.path.join(d, "wordcraft-cli.exe")
            open(exe, "w").write("x")
            os.chmod(exe, 0o755)
            with mock.patch.object(sys, "platform", "win32"), mock.patch.dict(os.environ, {"LAZUNOX_WORDCRAFT": exe}, clear=True):
                self.assertEqual(bw.find_wordcraft(), exe)


if __name__ == "__main__":
    unittest.main()
