"""Regresiones de diseño y archivos Office reales, sin app, modelos ni render externo."""
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile
from xml.etree import ElementTree as ET

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.util import Inches, Pt

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from build_pptx import Builder, THEMES
from check_pptx import check


EXAMPLE = {"title": "Continuidad 2027", "footer": "Comité · ejemplo", "slides": [
    {"type": "cover", "title": "Plan de continuidad 2027", "subtitle": "Resumen para el comité"},
    {"type": "section", "title": "Cobertura y recursos", "eyebrow": "01", "subtitle": "Preparación para el próximo período"},
    {"type": "content", "title": "Objetivo", "text": "Mantener la atención durante una interrupción del suministro.\nCoordinar recursos, responsables y fechas de revisión."},
    {"type": "bullets", "title": "Prioridades", "bullets": ["Revisar la reserva de agua", "Actualizar el calendario de respuesta", "Confirmar los responsables"]},
    {"type": "two_col", "title": "Riesgo y respuesta", "left": {"heading": "Riesgo crítico", "bullets": ["Interrupción de suministro", "Demora en la reposición"]}, "right": {"heading": "Preparación", "bullets": ["Reserva para 72 horas", "Dos depósitos de agua"]}},
    {"type": "stat", "title": "Ejecución presupuestaria", "value": "35 %", "label": "del presupuesto aprobado", "text": "31.500.000 CLP ejecutados de 90.000.000 CLP"},
    {"type": "table", "title": "Calendario y responsables", "columns": ["Hito", "Fecha", "Responsable"], "rows": [["Aprobar los depósitos", "30 de noviembre", "Comité"], ["Simulacro de continuidad", "15 de diciembre", "Coordinación"]]},
    {"type": "chart", "title": "Presupuesto disponible", "categories": ["Ejecutado", "Saldo"], "series": [{"name": "Millones CLP", "values": [31.5, 58.5]}]},
    {"type": "closing", "title": "Próximos pasos", "subtitle": "Aprobar los recursos y confirmar el calendario"}
]}
for i, slide in enumerate(EXAMPLE['slides'], 1):
    slide['notes'] = 'Nota del orador %d: cifras de ejemplo, no datos reales.' % i


class NativeDesign(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)

    def save(self, prs):
        data = io.BytesIO()
        prs.save(data)
        return data.getvalue()

    def assertClean(self, data):
        n, problems, warns = check(io.BytesIO(data))
        self.assertFalse(problems, '\n'.join(problems))
        return Presentation(io.BytesIO(data))

    def test_all_themes_native_layouts_notes_table_and_chart(self):
        for theme in THEMES:
            with self.subTest(theme=theme):
                prs = self.assertClean(self.save(Builder(EXAMPLE, str(self.base), theme).build()))
                self.assertEqual(len(prs.slides), 9)
                self.assertGreaterEqual(len({s.slide_layout.name for s in prs.slides}), 5)
                for spec, slide in zip(EXAMPLE['slides'], prs.slides):
                    self.assertEqual(slide.shapes.title.text, spec['title'])
                    self.assertEqual(slide.notes_slide.notes_text_frame.text, spec['notes'])
                    for ph in slide.placeholders:
                        self.assertTrue(ph.text.strip())
                self.assertGreater(len(prs.slides[3].placeholders), 1)
                self.assertEqual(len(prs.slides[4].placeholders), 3)
                table = next(s.table for s in prs.slides[6].shapes if s.has_table)
                self.assertEqual(table.cell(2, 0).text, 'Simulacro de continuidad')
                chart = next(s.chart for s in prs.slides[7].shapes if s.has_chart)
                self.assertEqual(list(chart.series[0].values), [31.5, 58.5])
                self.assertTrue(chart.part.chart_workbook.xlsx_part.blob.startswith(b'PK'))
                with zipfile.ZipFile(io.BytesIO(self.save(prs))) as z:
                    theme_xml = z.read('ppt/theme/theme1.xml').decode()
                    self.assertIn('Arial', theme_xml)
                    self.assertIn(THEMES[theme]['accent'], theme_xml)

    def test_layout_inference_uses_native_data(self):
        spec = json.loads(json.dumps(EXAMPLE))
        for slide in spec['slides']:
            slide.pop('type')
        prs = self.assertClean(self.save(Builder(spec, str(self.base), 'sobrio').build()))
        self.assertTrue(any(s.has_chart for s in prs.slides[7].shapes))
        self.assertTrue(any(s.has_table for s in prs.slides[6].shapes))

    def test_split_preserves_notes_on_every_page(self):
        slides = [{"type": "bullets", "title": "Lista", "bullets": ['Punto con suficiente texto para repartir la lista en varias láminas %d' % i for i in range(25)], "notes": "Conservar esta nota"},
                  {"type": "table", "title": "Registro", "columns": ["Nombre", "Valor"], "rows": [['Fila %d' % i, str(i)] for i in range(20)], "notes": "Conservar tabla"}]
        prs = self.assertClean(self.save(Builder({'slides': slides}, str(self.base), 'sobrio').build()))
        self.assertGreater(len(prs.slides), 4)
        for slide in prs.slides:
            self.assertIn(slide.notes_slide.notes_text_frame.text, ('Conservar esta nota', 'Conservar tabla'))

    def test_invalid_output_is_never_created_or_overwritten(self):
        spec = self.base / 'spec.json'
        out = self.base / 'nuevo.pptx'
        spec.write_text(json.dumps({'slides': [{'type': 'content', 'title': 'Demasiado', 'text': 'Una frase muy larga ' * 3000}]}))
        args = [sys.executable, str(SCRIPTS/'build_pptx.py'), str(spec), str(out)]
        r = subprocess.run(args, capture_output=True, text=True, timeout=20)
        self.assertEqual(r.returncode, 1, r.stdout+r.stderr)
        self.assertFalse(out.exists())
        out.write_bytes(b'original')
        r = subprocess.run(args, capture_output=True, text=True, timeout=20)
        self.assertEqual(r.returncode, 1)
        self.assertEqual(out.read_bytes(), b'original')

    def bad_slide(self, layout=5):
        prs = Presentation()
        slide = prs.slides.add_slide(prs.slide_layouts[layout])
        if slide.shapes.title is not None:
            slide.shapes.title.text = 'Revisión'
        return prs, slide

    def test_missing_title_is_error(self):
        prs, _ = self.bad_slide(6)
        self.assertTrue(any('sin título' in p for p in check(io.BytesIO(self.save(prs)))[1]))

    def test_empty_placeholder_is_error(self):
        prs, _ = self.bad_slide(1)
        self.assertTrue(any('marcador vacío' in p for p in check(io.BytesIO(self.save(prs)))[1]))

    def test_low_contrast_on_colored_shape_and_table(self):
        prs, slide = self.bad_slide()
        tb = slide.shapes.add_textbox(Inches(1), Inches(2), Inches(4), Inches(1))
        tb.text = 'Texto ilegible'
        tb.fill.solid()
        tb.fill.fore_color.rgb = RGBColor.from_string('222222')
        tb.text_frame.paragraphs[0].runs[0].font.color.rgb = RGBColor.from_string('333333')
        table = slide.shapes.add_table(1, 1, Inches(1), Inches(4), Inches(4), Inches(1)).table
        cell = table.cell(0, 0)
        cell.text = 'Gris claro'
        cell.fill.solid()
        cell.fill.fore_color.rgb = RGBColor.from_string('FFFFFF')
        cell.text_frame.paragraphs[0].runs[0].font.color.rgb = RGBColor.from_string('EEEEEE')
        issues = check(io.BytesIO(self.save(prs)))[1]
        self.assertEqual(len([p for p in issues if 'contraste insuficiente' in p]), 2, issues)

    def test_overflow_in_table_and_soft_breaks(self):
        prs, slide = self.bad_slide()
        cell = slide.shapes.add_table(1, 1, Inches(1), Inches(2), Inches(2), Inches(.4)).table.cell(0, 0)
        cell.text = 'Texto demasiado largo ' * 50
        cell.text_frame.paragraphs[0].runs[0].font.size = Pt(24)
        tb = slide.shapes.add_textbox(Inches(5), Inches(2), Inches(2), Inches(.4))
        tb.text_frame.paragraphs[0].text = 'uno\vdos\vtres\vcuatro'
        issues = check(io.BytesIO(self.save(prs)))[1]
        self.assertGreaterEqual(len([p for p in issues if 'desborda' in p]), 2, issues)

    def test_low_contrast_chart_labels(self):
        prs = Builder(EXAMPLE, str(self.base), 'sobrio').build()
        chart = next(sh.chart for sh in prs.slides[7].shapes if sh.has_chart)
        chart.plots[0].data_labels.font.color.rgb = RGBColor.from_string('EEEEEE')
        issues = check(io.BytesIO(self.save(prs)))[1]
        self.assertTrue(any('contraste insuficiente en el gráfico' in p for p in issues), issues)

    def test_duplicate_relationship_rejected_even_when_python_opens(self):
        prs, _ = self.bad_slide()
        data = self.save(prs)
        changed = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(changed, 'w') as target:
            for name in source.namelist():
                content = source.read(name)
                if name == 'ppt/_rels/presentation.xml.rels':
                    root = ET.fromstring(content)
                    root.append(ET.fromstring(ET.tostring(root[0])))
                    content = ET.tostring(root)
                target.writestr(name, content)
        self.assertTrue(any('Relaciones duplicadas' in p for p in check(io.BytesIO(changed.getvalue()))[1]))

    def test_duplicate_zip_part_and_missing_target_rejected(self):
        prs, _ = self.bad_slide()
        data = self.save(prs)
        changed = io.BytesIO()
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(changed, 'w') as target:
                for name in source.namelist():
                    if name != 'docProps/app.xml':
                        target.writestr(name, source.read(name))
                target.writestr('ppt/slides/slide1.xml', source.read('ppt/slides/slide1.xml'))
        issues = check(io.BytesIO(changed.getvalue()))[1]
        self.assertTrue(any('partes duplicadas' in p for p in issues), issues)
        self.assertTrue(any('Relación sin destino' in p for p in issues), issues)

    def test_malformed_file_cli_fails(self):
        path = self.base / 'roto.pptx'
        path.write_bytes(b'PK invalid')
        r = subprocess.run([sys.executable, str(SCRIPTS/'check_pptx.py'), str(path), '--no-render'], capture_output=True, text=True, timeout=20)
        self.assertEqual(r.returncode, 1)
        self.assertIn('no se pudo abrir', r.stdout)


if __name__ == '__main__':
    unittest.main()
