"""Entregas en carpetas que permiten crear/escribir pero no borrar/renombrar."""
from contextlib import ExitStack, contextmanager, redirect_stderr, redirect_stdout
from io import StringIO
import builtins
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from openpyxl import load_workbook

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import build_xlsx
import edit_xlsx
import formula_cache
import translate_xlsx
import comparar_estructura

SPEC = {'sheets': [{'name': 'Datos', 'columns': [
    {'header': 'Entrada'}, {'header': 'Doble', 'formula': '=A{r}*2', 'total': 'sum'}],
    'rows': [[7], [3]]}]}


@contextmanager
def no_delete_or_rename(folder):
    """Solo deniega la carpeta de la persona; TMPDIR conserva sus permisos."""
    folder = os.path.abspath(folder)
    denied = []

    def guarded(name, real):
        def call(*args, **kwargs):
            for arg in args[:2] if name in ('rename', 'replace') else args[:1]:
                if isinstance(arg, (str, bytes, os.PathLike)):
                    path = os.path.abspath(os.fsdecode(arg))
                    try:
                        inside = os.path.commonpath([folder, path]) == folder
                    except ValueError:  # Windows: TMPDIR puede estar en otra unidad.
                        inside = False
                    if inside:
                        denied.append((name, path))
                        raise PermissionError('borrar/mover/renombrar denegado')
            return real(*args, **kwargs)
        return call

    with ExitStack() as stack:
        for name in ('rename', 'replace', 'unlink', 'remove'):
            stack.enter_context(patch.object(os, name, side_effect=guarded(name, getattr(os, name))))
        yield denied


class NoDestinationTempTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.spec = self.root / 'spec.json'
        self.spec.write_text(json.dumps(SPEC), encoding='utf-8')
        self.out = self.root / 'resultado.xlsx'

    def call(self, main, args):
        stdout, stderr = StringIO(), StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = main(list(map(str, args)))
        return code, stdout.getvalue() + stderr.getvalue()

    def check_book(self, path, first, total):
        with path.open('rb') as f:
            cached = load_workbook(f, data_only=True)
            self.assertEqual(cached['Datos']['B2'].value, first)
            self.assertEqual(cached['Datos']['B4'].value, total)
            cached.close()
        with path.open('rb') as f:
            formulas = load_workbook(f, data_only=False)
            self.assertEqual(formulas['Datos']['B2'].value, '=A2*2')
            self.assertEqual(formulas['Datos']['B4'].value, '=SUM(B2:B3)')
            formulas.close()
        self.assertFalse(formula_cache.verify_cache(path)['differences'])

    def test_build_and_edit_with_forbidden_destination_operations(self):
        edited = self.root / 'copia-v2.xlsx'
        writes = []
        real_open = builtins.open

        def track(file, mode='r', *args, **kwargs):
            if isinstance(file, (str, os.PathLike)) and Path(file) in (self.out, edited):
                if any(m in mode for m in 'wax+'):
                    writes.append((Path(file), mode))
            return real_open(file, mode, *args, **kwargs)

        with no_delete_or_rename(self.root) as denied, patch('builtins.open', side_effect=track):
            code, msg = self.call(build_xlsx.main, [self.spec, '-o', self.out])
            self.assertEqual(code, 0, msg)
            self.check_book(self.out, 14, 20)
            original = self.out.read_bytes()
            ops = json.dumps([{'op': 'set_cells', 'sheet': 'Datos', 'cells': {'A2': 9}}])
            code, msg = self.call(edit_xlsx.main, [self.out, '--ops-json', ops, '-o', edited])
            self.assertEqual(code, 0, msg)
            self.check_book(edited, 18, 24)
            self.assertEqual(self.out.read_bytes(), original)
            self.assertEqual(denied, [])
        self.assertEqual(writes, [(self.out, 'xb'), (edited, 'xb')])
        self.assertEqual(set(self.root.iterdir()), {self.spec, self.out, edited})

    def test_serialization_or_cache_failure_leaves_no_output(self):
        for target in ('openpyxl.workbook.workbook.Workbook.save', 'formula_cache.ET.tostring'):
            with self.subTest(target=target), no_delete_or_rename(self.root), \
                    patch(target, side_effect=ValueError('fallo al preparar el libro')):
                code, msg = self.call(build_xlsx.main, [self.spec, '-o', self.out])
                self.assertEqual(code, 1, msg)
                self.assertIn('fallo al preparar', msg)
                self.assertEqual(set(self.root.iterdir()), {self.spec})

    def test_permission_error_on_final_open_leaves_no_output(self):
        source = self.root / 'original.xlsx'
        self.assertEqual(self.call(build_xlsx.main, [self.spec, '-o', source])[0], 0)
        original = source.read_bytes()
        real_open = builtins.open

        def deny_output(file, mode='r', *args, **kwargs):
            if isinstance(file, (str, os.PathLike)) and Path(file) == self.out and mode == 'xb':
                raise PermissionError('escritura denegada')
            return real_open(file, mode, *args, **kwargs)

        ops = json.dumps([{'op': 'set_cells', 'sheet': 'Datos', 'cells': {'A2': 9}}])
        for main, args in ((build_xlsx.main, [self.spec, '-o', self.out]),
                           (edit_xlsx.main, [source, '--ops-json', ops, '-o', self.out])):
            with self.subTest(main=main.__module__), no_delete_or_rename(self.root), \
                    patch('builtins.open', side_effect=deny_output):
                code, msg = self.call(main, args)
            self.assertEqual(code, 1, msg)
            self.assertIn('No se pudo guardar', msg)
            self.assertIn('No se creó ningún archivo de salida', msg)
            self.assertEqual(set(self.root.iterdir()), {self.spec, source})
            self.assertEqual(source.read_bytes(), original)

    def test_existing_destination_is_preserved_even_with_force(self):
        self.out.write_bytes(b'original que no se debe tocar')
        before = self.out.read_bytes()
        with no_delete_or_rename(self.root):
            code, msg = self.call(build_xlsx.main, [self.spec, '-o', self.out, '--force'])
            self.assertEqual(code, 2, msg)
            self.assertIn('nombre nuevo', msg)
            with self.assertRaises(FileExistsError):
                formula_cache.save_with_cache(build_xlsx.build(SPEC), self.out)
        self.assertEqual(self.out.read_bytes(), before)
        self.assertEqual(set(self.root.iterdir()), {self.spec, self.out})

    def test_file_created_between_check_and_open_is_preserved(self):
        real_open = builtins.open

        def race(file, mode='r', *args, **kwargs):
            if isinstance(file, (str, os.PathLike)) and Path(file) == self.out and mode == 'xb':
                with real_open(file, 'wb') as other:
                    other.write(b'creado por otro proceso')
            return real_open(file, mode, *args, **kwargs)

        with no_delete_or_rename(self.root), patch('builtins.open', side_effect=race):
            code, msg = self.call(build_xlsx.main, [self.spec, '-o', self.out])
        self.assertEqual(code, 1, msg)
        self.assertIn('no se sobrescribe', msg)
        self.assertEqual(self.out.read_bytes(), b'creado por otro proceso')

    def test_translation_checks_structure_before_creating_output(self):
        source = self.root / 'fuente.xlsx'
        self.assertEqual(self.call(build_xlsx.main, [self.spec, '-o', source])[0], 0)
        original = source.read_bytes()
        translations = self.root / 'tr.json'
        translations.write_text(json.dumps({'i1-0': 'Input', 'i1-1': 'Double'}))
        from argparse import Namespace
        args = Namespace(xlsx=str(source), traduccion=str(translations), salida=str(self.out), informe=None)
        with no_delete_or_rename(self.root) as denied:
            with patch.object(comparar_estructura, 'comparar_xlsx', return_value=(['cambió una fórmula'], [], '')):
                with self.assertRaises(SystemExit) as err, redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                    translate_xlsx.cmd_aplicar(args)
                self.assertEqual(err.exception.code, 1)
            self.assertFalse(self.out.exists())
            with redirect_stdout(StringIO()):
                translate_xlsx.cmd_aplicar(args)
            self.assertEqual(denied, [])
        self.assertEqual(source.read_bytes(), original)
        self.check_book(self.out, 14, 20)
        translated = load_workbook(self.out)
        self.assertEqual(translated['Datos']['A1'].value, 'Input')
        translated.close()
        self.assertEqual(set(self.root.iterdir()), {self.spec, source, translations, self.out})


if __name__ == '__main__':
    unittest.main()
