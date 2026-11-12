"""Constructor real del Chat: caché entregado, mutación del banco y edición soportada.

GRIDCRAFT_CLI debe apuntar a una copia temporal del programa; LAZUNOX_NODE o PATH
aporta Node. No se ejecuta ni se busca la instalación personal de Craft.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from openpyxl import load_workbook

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(SCRIPTS.parent.parent / '_shared'))
from formula_cache import read_cached_values
import render_grid

GRID = os.environ.get('GRIDCRAFT_CLI')
NODE = os.environ.get('LAZUNOX_NODE') or shutil.which('node')
READY = GRID and Path(GRID).is_file() and NODE and (SCRIPTS / 'build_chat_xlsx.cjs').is_file()


@unittest.skipUnless(READY, 'requiere GRIDCRAFT_CLI temporal, Node y build_chat_xlsx.cjs compilado')
class ChatCacheTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='xlsx-chat-cache-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.path = self.root / 'chat.xlsx'
        self.env = dict(os.environ, LAZUNOX_GRIDCRAFT=GRID, LAZUNOX_NODE=NODE,
                        LAZUNOX_BIN_DIR=str(self.root), HOME=str(self.root),
                        TMPDIR=str(self.root), TMP=str(self.root), TEMP=str(self.root),
                        PYTHONDONTWRITEBYTECODE='1')
        spec = {'sheets': [
            {'name': 'Sondeo', 'rows': [['Entrada', 'Resultado'],
                                      [7, {'formula': 'A2*6', 'value': -999}]]},
            {'name': 'Resumen', 'rows': [['Doble'],
                                       [{'formula': 'Sondeo!B2*2', 'value': -999}]]}]}
        self.spec = self.root / 'spec.json'
        self.spec.write_text(json.dumps(spec))
        self.cli('build_chat_xlsx.py', self.spec, self.path)

    def cli(self, name, *args, code=0):
        p = subprocess.run([sys.executable, str(SCRIPTS / name), *map(str, args)],
                           env=self.env, capture_output=True, text=True, timeout=150)
        self.assertEqual(p.returncode, code, p.stdout + p.stderr)
        return p

    def test_constructor_saves_calculated_values_and_verifier_uses_local(self):
        self.assertEqual(read_cached_values(self.path),
                         {('Sondeo', 'B2'): 42, ('Resumen', 'A2'): 84})
        before = self.path.read_bytes()
        checked = json.loads(self.cli('recalc_check.py', self.path, '--json').stdout)
        self.assertTrue(checked['ok'])
        self.assertEqual(checked['motor'], 'local')
        self.assertFalse(checked['diferencias'])
        self.assertEqual(self.path.read_bytes(), before)
        p = subprocess.run([sys.executable, str(SCRIPTS.parent.parent / '_shared/verificar_office.py'),
                            str(self.path)], env=self.env, capture_output=True, text=True, timeout=150)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn('RESULTADO: OK', p.stdout)

    def test_bench_mutation_erases_cache_and_verifier_correctly_rejects_it(self):
        before = self.path.read_bytes()
        mutated = self.root / 'mutated.xlsx'
        wb = load_workbook(self.path)
        wb['Sondeo']['A2'] = 9
        wb.save(mutated)
        wb.close()
        self.assertTrue(all(v is None for v in read_cached_values(mutated).values()))
        checked = json.loads(self.cli('recalc_check.py', mutated, '--json', code=1).stdout)
        self.assertFalse(checked['ok'])
        self.assertEqual(checked['motor'], 'local')
        self.assertEqual({(v['hoja'], v['celda']): v['valor'] for v in checked['valores']},
                         {('Sondeo', 'B2'): 54, ('Resumen', 'A2'): 108})
        self.assertEqual(len(checked['diferencias']), 2)
        digest = hashlib.sha256(mutated.read_bytes()).hexdigest()
        with patch.dict(os.environ, self.env, clear=True):
            grid = render_grid.recalc(str(mutated), [])
        self.assertIsNotNone(grid)
        self.assertEqual(grid['motor'], 'gridcraft')
        self.assertEqual({(v['hoja'], v['celda']): v['valor'] for v in grid['valores']},
                         {('Sondeo', 'B2'): 54, ('Resumen', 'A2'): 108})
        self.assertEqual(hashlib.sha256(mutated.read_bytes()).hexdigest(), digest)
        self.assertEqual(self.path.read_bytes(), before)

    def test_edit_skill_refreshes_chat_cache_using_shared_formula_calculator(self):
        before = self.path.read_bytes()
        edited = self.root / 'edited.xlsx'
        self.cli('edit_xlsx.py', self.path, '--ops-json',
                 json.dumps([{'op': 'set_cells', 'sheet': 'Sondeo', 'cells': {'A2': 9}}]), '-o', edited)
        self.assertEqual(read_cached_values(edited),
                         {('Sondeo', 'B2'): 54, ('Resumen', 'A2'): 108})
        checked = json.loads(self.cli('recalc_check.py', edited, '--json').stdout)
        self.assertTrue(checked['ok'])
        self.assertEqual(self.path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
