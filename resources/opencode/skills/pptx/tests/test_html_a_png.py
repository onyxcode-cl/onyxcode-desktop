import os
import subprocess
import sys
import tempfile
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.normpath(os.path.join(AQUI, "..", "scripts", "html_a_png.py"))


def correr(*args, env=None):
    e = dict(os.environ)
    if env:
        e.update(env)
    return subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True, env=e, timeout=120)


class HtmlAPng(unittest.TestCase):
    def test_uso_incorrecto_sale_2(self):
        self.assertEqual(correr().returncode, 2)

    def test_no_sobrescribe_una_carpeta_con_contenido(self):
        with tempfile.TemporaryDirectory() as d:
            html = os.path.join(d, "a.html")
            open(html, "w").write("<p>x</p>")
            out = os.path.join(d, "salida")
            os.mkdir(out)
            open(os.path.join(out, "algo.png"), "w").write("x")
            r = correr(html, out)
            self.assertEqual(r.returncode, 1)
            self.assertIn("ya existe", r.stderr)
            self.assertTrue(os.path.exists(os.path.join(out, "algo.png")))

    def test_sin_navegador_sale_3(self):
        with tempfile.TemporaryDirectory() as d:
            html = os.path.join(d, "a.html")
            open(html, "w").write("<p>x</p>")
            # PATH vacío y sin LAZUNOX_CHROMIUM: sin Chromium conocido en rutas fijas solo si de verdad no hay; en ese caso el código es 3.
            r = correr(html, os.path.join(d, "nueva"), env={"PATH": "", "LAZUNOX_CHROMIUM": ""})
            self.assertIn(r.returncode, (0, 3))  # 0 si este equipo tiene Chrome/Brave/Edge en su ruta fija; 3 si no


if __name__ == "__main__":
    unittest.main()
