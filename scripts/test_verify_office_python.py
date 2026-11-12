"""Verificación efectiva del entorno usado por oficina; ejecutar con el Python de la app."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'scripts/verify-office-python.py'
REQ = ROOT / 'resources/python-bin/requirements.txt'


class VerifyOfficePython(unittest.TestCase):
    def run_check(self, *args):
        return subprocess.run([sys.executable, '-I', str(SCRIPT), *map(str, args)],
                              capture_output=True, text=True, timeout=30)

    def test_entorno_real_importa_todo_y_coincide(self):
        result = self.run_check(REQ)
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = dict(line.split('==') for line in REQ.read_text().splitlines()
                        if line and not line.startswith('#'))
        self.assertEqual(json.loads(result.stdout)['packages'], expected)

    def test_version_distinta_falla(self):
        with tempfile.TemporaryDirectory() as tmp:
            req = Path(tmp) / 'requirements.txt'
            req.write_text('pymupdf==0.0.0\n')
            result = self.run_check(req)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('esperado 0.0.0', result.stderr)

    def test_no_acepta_modulos_de_otra_carpeta(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = self.run_check(REQ, '--site', tmp)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('origen fuera', result.stderr)


if __name__ == '__main__':
    unittest.main()
