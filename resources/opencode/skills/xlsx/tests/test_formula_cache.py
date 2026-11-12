"""Regresiones de valores OOXML y verificación sin componentes opcionales."""
import copy
import json
import os
import datetime as dt
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch

from openpyxl import Workbook, load_workbook
from openpyxl.utils.datetime import to_excel, CALENDAR_MAC_1904

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import build_xlsx
import recalc_check
from formula_cache import calculate, save_with_cache, verify_cache

SPEC = {
    'sheets': [{'name': "Datos d'hoy", 'title': 'Ventas', 'subtitle': '2026',
                'columns': [{'header': 'Zona'}, {'header': 'Estado'},
                            {'header': 'Monto', 'total': 'sum'},
                            {'header': 'Doble', 'formula': '=C{r}*2', 'total': '=SUM({col:Datos d\'hoy:D})'}],
                'rows': [['Sur', 'OK', 10], ['Norte', 'OK', 20], ['Sur', 'NO', 30]]}],
    'summary': {'name': 'Resumen', 'kpis': [
        {'label': 'Sur OK', 'formula': '=SUMIFS({col:Datos d\'hoy:C},{col:Datos d\'hoy:A},"Sur",{col:Datos d\'hoy:B},"OK")'},
        {'label': 'Total', 'formula': '={total:Datos d\'hoy:C}'}]}}


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'book.xlsx'

    def cli(self, script, *args):
        env = dict(os.environ, LAZUNOX_GRIDCRAFT='/no/gridcraft', LAZUNOX_BIN_DIR=self.tmp.name)
        return subprocess.run([sys.executable, str(script), *map(str, args)], env=env,
                              capture_output=True, text=True, timeout=30)

    def build(self):
        spec = Path(self.tmp.name) / 'spec.json'
        spec.write_text(json.dumps(SPEC))
        p = self.cli(SCRIPTS / 'build_xlsx.py', spec, '-o', self.path)
        self.assertEqual(p.returncode, 0, p.stdout+p.stderr)

    def test_build_cross_sheet_sumifs_and_both_checkers(self):
        self.build()
        with zipfile.ZipFile(self.path) as z:
            xml = z.read('xl/worksheets/sheet1.xml')
            self.assertIn(b'<f>', xml)
            self.assertIn(b'<v>10</v>', xml)
        wb = load_workbook(self.path, data_only=True)
        self.assertEqual(wb['Resumen']['B4'].value, 10)
        self.assertEqual(wb['Resumen']['B5'].value, 60)
        self.assertEqual(wb["Datos d'hoy"]['D8'].value, 120)
        wb.close()
        p = self.cli(SCRIPTS / 'recalc_check.py', self.path, '--json')
        self.assertEqual(p.returncode, 0, p.stdout+p.stderr)
        self.assertEqual(json.loads(p.stdout)['motor'], 'local')
        p = self.cli(SCRIPTS.parent.parent / '_shared/verificar_office.py', self.path)
        self.assertEqual(p.returncode, 0, p.stdout+p.stderr)
        self.assertIn('RESULTADO: OK', p.stdout)

    def test_tampered_saved_value_reports_cell_both_checkers(self):
        self.build()
        tampered = self.path.with_name('tampered.xlsx')
        with zipfile.ZipFile(self.path) as src, zipfile.ZipFile(tampered, 'w') as dst:
            for name in src.namelist():
                data = src.read(name)
                if name == 'xl/worksheets/sheet1.xml':
                    data = data.replace(b'<v>10</v>', b'<v>999</v>')
                dst.writestr(name, data)
        for script in (SCRIPTS / 'recalc_check.py', SCRIPTS.parent.parent / '_shared/verificar_office.py'):
            p = self.cli(script, tampered)
            self.assertEqual(p.returncode, 1, p.stdout+p.stderr)
            self.assertIn('Resumen!B4', p.stdout)
            self.assertIn('vuelve a generar', p.stdout)

    def test_edit_refreshes_all_dependent_caches_and_preserves_original(self):
        self.build()
        original = self.path.read_bytes()
        target = self.path.with_name('edited.xlsx')
        p = self.cli(SCRIPTS / 'edit_xlsx.py', self.path, '--ops-json',
                     json.dumps([{'op': 'set_cells', 'sheet': "Datos d'hoy", 'cells': {'C5': 100}}]), '-o', target)
        self.assertEqual(p.returncode, 0, p.stdout+p.stderr)
        wb = load_workbook(target, data_only=True)
        self.assertEqual(wb['Resumen']['B4'].value, 100)
        self.assertEqual(wb['Resumen']['B5'].value, 150)
        self.assertEqual(wb["Datos d'hoy"]['D8'].value, 300)
        wb.close()
        self.assertEqual(self.path.read_bytes(), original)
        self.assertFalse(verify_cache(target)['differences'])

    def test_unsupported_formula_and_dependency_never_get_fake_values(self):
        wb = Workbook()
        ws = wb.active
        ws['A1'] = '=TEXTJOIN(",",TRUE,"A","B")'
        ws['B1'] = '=A1&"C"'
        ws['C1'] = '=SUMSQ(1,2)'  # función Excel válida fuera de la lista antigua
        warns = save_with_cache(wb, self.path)
        self.assertEqual({w['celda'] for w in warns}, {'A1', 'B1', 'C1'})
        cached = load_workbook(self.path, data_only=True)
        self.assertIsNone(cached.active['A1'].value)
        self.assertIsNone(cached.active['B1'].value)
        cached.close()
        for script in (SCRIPTS / 'recalc_check.py', SCRIPTS.parent.parent / '_shared/verificar_office.py'):
            p = self.cli(script, self.path)
            self.assertEqual(p.returncode, 0, p.stdout+p.stderr)
            self.assertIn('Sheet!A1', p.stdout)
            self.assertIn('NO verificado', p.stdout)
            self.assertNotIn('✘', p.stdout)

    def test_title_offset_detected_and_tokens_independent_of_autofilter(self):
        spec = copy.deepcopy(SPEC)
        spec['sheets'][0]['columns'][2]['total'] = '=SUM(C2:C4)'
        with self.assertRaisesRegex(build_xlsx.SpecError, "C8.*filas de datos 5:7"):
            build_xlsx.build(spec)
        wb = build_xlsx.build(SPEC)
        ws = wb["Datos d'hoy"]
        ws['C8'] = '=SUM(C2:C4)'
        save_with_cache(wb, self.path)
        p = self.cli(SCRIPTS / 'recalc_check.py', self.path)
        self.assertEqual(p.returncode, 1, p.stdout)
        self.assertIn("Datos d'hoy!C8", p.stdout)
        self.assertIn('C5:C7', p.stdout)
        spec = copy.deepcopy(SPEC)
        spec['sheets'][0]['autofilter'] = False
        wb = build_xlsx.build(spec)
        self.assertEqual(wb["Datos d'hoy"]['D8'].value, "=SUM('Datos d''hoy'!D5:D7)")
        spec['sheets'][0]['columns'][2]['total'] = '=SUM(C2:C4)'
        with self.assertRaisesRegex(build_xlsx.SpecError, 'C8.*filas de datos 5:7'):
            build_xlsx.build(spec)
        wb["Datos d'hoy"]['C8'] = '=SUM(C2:C4)'
        self.path = self.path.with_name('without-filter.xlsx')
        save_with_cache(wb, self.path)
        self.assertEqual(verify_cache(self.path)['ranges'][0]['celda'], 'C8')

    def test_function_results_types_dates_rounding_and_lazy_if(self):
        wb = Workbook()
        ws = wb.active
        ws.append(['grupo', 'valor'])
        ws.append(['A', 10])
        ws.append(['B', 20])
        ws.append(['A', 30])
        formulas = [
            ('=SUM(B2:B4)+2*3^2', 78), ('=SUMIF(A2:A4,"A",B2:B4)', 40),
            ('=COUNT(B2:B4)', 3), ('=COUNTIF(A2:A4,"A")', 2),
            ('=COUNTIFS(A2:A4,"A",B2:B4,">10")', 1),
            ('=AVERAGE(B2:B4)', 20), ('=MAX(B2:B4)-MIN(B2:B4)', 20),
            ('=ROUND(-1.005,2)', -1.01), ('=ROUND(125,-1)', 130),
            ('=IF(B2=10,"Sí","No")', 'Sí'), ('=IF(TRUE,42,1/0)', 42),
            ('=INDEX(B2:B4,MATCH("B",A2:A4,0))', 20),
            ('=VLOOKUP("A",A2:B4,2,FALSE)', 10),
            ('=DATE(2026,13,0)', to_excel(__import__('datetime').datetime(2026,12,31))),
            ('=B2>5', True), ('=""', ''), ('=IFERROR(1/0,0)', 0),
            ('=-2^2', 4), ('=2^3^2', 64), ('=50%*B2', 5)]
        for i, (formula, _) in enumerate(formulas, 1):
            ws.cell(i, 4, formula)
        self.assertFalse(save_with_cache(wb, self.path))
        cached = load_workbook(self.path, data_only=True)
        for i, (formula, expected) in enumerate(formulas, 1):
            actual = cached.active.cell(i, 4).value
            if expected == '' and actual is None:
                continue
            self.assertEqual(actual, expected, formula)
        cached.close()
        check = verify_cache(self.path)
        self.assertFalse(check['errors'], check)
        self.assertFalse(check['differences'], check)
        wb.epoch = CALENDAR_MAC_1904
        ws['F1'] = '=DATE(2026,1,1)'
        ws['F1'].number_format = 'yyyy-mm-dd'
        self.path = self.path.with_name('epoch-1904.xlsx')
        save_with_cache(wb, self.path)
        self.assertFalse(verify_cache(self.path)['differences'])

    def test_criteria_blanks_wildcards_and_lookup_literal(self):
        wb = Workbook()
        ws = wb.active
        for row in [['A', 10], ['a', 20], ['B', 30], ['*', 40], ['>5', 50], [None, None]]:
            ws.append(row)
        formulas = [
            ('=COUNTIF(A1:A6,"A")', 2), ('=COUNTIF(A1:A6,"~*")', 1),
            ('=COUNTIF(A1:A6,"*")', 5), ('=COUNTIF(A1:A6,"")', 1),
            ('=SUMIF(B1:B6,">=20")', 140),
            ('=INDEX(B1:B6,MATCH(">5",A1:A6,0))', 50),
            ('=VLOOKUP(">5",A1:B6,2,FALSE)', 50),
            ('=IF(ISBLANK(A1),1,2)', None)]
        for i, (formula, _) in enumerate(formulas, 1):
            ws.cell(i, 4, formula)
        values, unsupported = calculate(wb)
        for i, (formula, expected) in enumerate(formulas[:-1], 1):
            self.assertEqual(values[('Sheet', 'D%d' % i)], expected, formula)
        self.assertEqual(unsupported[0]['celda'], 'D8')

    def test_cache_dates_error_dependencies_and_empty_strings(self):
        wb = Workbook()
        ws = wb.active
        ws['A1'] = '=DATE(1900,2,29)'
        ws['A1'].number_format = 'yyyy-mm-dd'
        ws['A2'] = dt.datetime(2026,1,1)
        ws['B2'] = '=A2+1'
        ws['B2'].number_format = 'yyyy-mm-dd'
        ws['C1'] = '=1/0'
        ws['C2'] = '=C1+1'
        ws['D1'] = '=SUMIF(A2:A3,"<0",C1:C2)'
        ws['E1'] = '=COUNT(C1:C2)'
        ws['E2'] = '=COUNTA(C1:C2)'
        ws['F1'] = '=IF(TRUE,"",0)'
        ws['F2'] = '=F1'
        save_with_cache(wb, self.path)
        checked = verify_cache(self.path)
        self.assertFalse(checked['differences'], checked)
        self.assertEqual(checked['values'][('Sheet','A1')], 60)
        self.assertEqual(checked['values'][('Sheet','B2')], to_excel(dt.datetime(2026,1,2)))
        self.assertEqual({e['celda'] for e in checked['errors']}, {'C1', 'C2'})
        self.assertEqual(checked['values'][('Sheet','D1')], 0)
        self.assertEqual(checked['values'][('Sheet','E1')], 0)
        self.assertEqual(checked['values'][('Sheet','E2')], 2)
        self.assertEqual(checked['values'][('Sheet','F2')], '')

    def test_optional_grid_extends_verification_without_environment_failure(self):
        wb = Workbook()
        wb.active['A1'] = '=_xlfn.TEXTJOIN(",",TRUE,"A","B")'
        save_with_cache(wb, self.path)
        fake = {'valores': [{'hoja': 'Sheet', 'celda': 'A1', 'valor': 'A,B'}]}
        with patch.object(recalc_check.render_grid, 'find_gridcraft', return_value='/fake/gridcraft'), \
             patch.object(recalc_check.render_grid, 'recalc', return_value=fake):
            checked = recalc_check.analyse(self.path, 10)
        self.assertEqual(checked['motor'], 'local + gridcraft')
        self.assertEqual(checked['diferencias'][0]['celda'], 'A1')
        self.assertFalse(checked['no_soportadas'])
        with patch.object(recalc_check.render_grid, 'find_gridcraft', return_value='/fake/gridcraft'), \
             patch.object(recalc_check.render_grid, 'recalc', return_value=None):
            checked = recalc_check.analyse(self.path, 10)
        self.assertFalse(checked['errores'] or checked['diferencias'] or checked['sintaxis'])
        self.assertEqual(checked['no_soportadas'][0]['celda'], 'A1')

    def test_errors_cycles_and_unsupported_lookup_modes(self):
        wb = Workbook()
        ws = wb.active
        ws['A1'] = '=1/0'
        ws['A2'] = '=A2+1'
        ws['A3'] = '=MATCH(2,B1:B3,1)'
        ws['A4'] = '=VLOOKUP(2,B1:C3,2,TRUE)'
        ws['A5'] = '=IF(FALSE,UNSUPPORTED(),3)'
        save_with_cache(wb, self.path)
        r = verify_cache(self.path)
        self.assertEqual({e['celda'] for e in r['errors']}, {'A1', 'A2'})
        self.assertEqual({e['celda'] for e in r['unsupported']}, {'A3', 'A4'})
        self.assertEqual(r['values'][('Sheet','A5')], 3)


if __name__ == '__main__':
    unittest.main()
