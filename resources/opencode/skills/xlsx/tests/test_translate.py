"""Pruebas de translate_xlsx.py y de comparar_estructura.py sobre Excel. Ejecutar: python -m unittest tests/test_translate.py
Crean un libro mínimo a mano (cadenas compartidas, texto con formato mixto, comentario, gráfico, fórmulas, estilos, combinaciones, anchos)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile

AQUI = os.path.dirname(os.path.abspath(__file__))
SC = os.path.join(AQUI, "..", "scripts")
SH = os.path.join(AQUI, "..", "..", "_shared")
sys.path.insert(0, SH)
import comparar_estructura  # noqa: E402

NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
PARTES = {
    "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    "xl/workbook.xml": '<?xml version="1.0"?><workbook %s xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Ventas" sheetId="1" r:id="rId1"/></sheets></workbook>' % NS,
    "xl/_rels/workbook.xml.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/styles.xml": '<?xml version="1.0"?><styleSheet %s><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="4"/></cellXfs></styleSheet>' % NS,
    "xl/sharedStrings.xml": '<?xml version="1.0"?><sst %s count="6" uniqueCount="6">'
    '<si><t>Producto</t></si><si><t>Notas &amp; &lt;dudas&gt;</t></si><si><t xml:space="preserve">Total general</t></si>'
    '<si><r><t xml:space="preserve">Nota: </t></r><r><rPr><b/></rPr><t>revisar</t></r></si><si><t>2026</t></si><si><t>Una frase bastante larga para la columna</t></si></sst>' % NS,
    "xl/worksheets/sheet1.xml": '<?xml version="1.0"?><worksheet %s><cols><col min="1" max="1" width="12" customWidth="1"/></cols><sheetData>'
    '<row r="1"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>4</v></c></row>'
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>10.5</v></c><c r="C2"><f>B2*2</f><v>21</v></c></row>'
    '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3" t="str"><f>"ok"&amp;"!"</f><v>ok!</v></c></row>'
    '<row r="4"><c r="A4" t="s"><v>5</v></c></row>'
    '</sheetData><mergeCells count="1"><mergeCell ref="D1:E1"/></mergeCells></worksheet>' % NS,
    "xl/comments1.xml": '<?xml version="1.0"?><comments %s><commentList><comment ref="B2"><text><t>Confirmar cantidad</t></text></comment></commentList></comments>' % NS,
    "xl/charts/chart1.xml": '<?xml version="1.0"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    '<c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Ventas por producto</a:t></a:r></a:p></c:rich></c:tx></c:title></c:chart></c:chartSpace>',
    "xl/media/logo.png": "PNG-FALSO",
}


def crear(ruta, partes=None):
    with zipfile.ZipFile(ruta, "w", zipfile.ZIP_DEFLATED) as z:
        for n, c in (partes or PARTES).items():
            z.writestr(n, c)


def leer(ruta, n):
    with zipfile.ZipFile(ruta) as z:
        return z.read(n).decode("utf-8")


def run(*args, ok=(0,)):
    p = subprocess.run([sys.executable, os.path.join(SC, "translate_xlsx.py")] + list(args), capture_output=True, text=True)
    assert p.returncode in ok, "%s -> %d\n%s\n%s" % (args, p.returncode, p.stdout, p.stderr)
    return p


class TestTraducirExcel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = tempfile.mkdtemp(prefix="trxlsx-")
        cls.src = os.path.join(cls.d, "src.xlsx")
        crear(cls.src)
        cls.seg = os.path.join(cls.d, "seg.json")
        run("extraer", cls.src, "-o", cls.seg)
        with open(cls.seg, encoding="utf-8") as f:
            cls.datos = json.load(f)
        cls.por_id = {s["id"]: s for s in cls.datos["segmentos"]}

    def test_extraer_lista_textos_con_contexto_y_omite_cifras(self):
        ids = set(self.por_id)
        self.assertEqual(ids, {"s0", "s1", "s2", "s3", "s5", "c1-0", "g1-0"})  # s4 = «2026» no es texto; sin hojas/otros
        self.assertEqual(self.por_id["s0"]["celdas"], ["Ventas!A1"])
        self.assertEqual(self.por_id["s1"]["texto"], "Notas & <dudas>")
        self.assertEqual(self.por_id["s3"]["texto"], "<r1>Nota: </r1><r2>revisar</r2>")
        self.assertEqual(self.por_id["g1-0"]["texto"], "Ventas por producto")
        self.assertEqual(self.datos["nombres_de_hoja_no_traducidos"], ["Ventas"])

    def traducir(self, sufijo, cambios, **kw):
        tr = {"s0": "Product", "s1": "Notes & <doubts>", "s2": " Grand total", "s3": "<r1>Note: </r1><r2>review</r2>", "s5": "A fairly long sentence for the column",
              "c1-0": "Confirm quantity", "g1-0": "Sales by product"}
        tr.update(cambios)
        t = os.path.join(self.d, "tr-%s.json" % sufijo)
        with open(t, "w", encoding="utf-8") as f:
            json.dump(tr, f)
        out = os.path.join(self.d, "out-%s.xlsx" % sufijo)
        p = run("aplicar", self.src, "-t", t, "-o", out, "--informe", os.path.join(self.d, "inf-%s.json" % sufijo), **kw)
        return out, p

    def test_aplicar_cambia_solo_el_texto_y_deja_todo_lo_demas_igual(self):
        out, p = self.traducir("a", {})
        self.assertIn("ESTRUCTURA: idéntica al original", p.stdout)
        with zipfile.ZipFile(self.src) as a, zipfile.ZipFile(out) as b:
            self.assertEqual(a.namelist(), b.namelist())
            for n in a.namelist():
                if n not in ("xl/sharedStrings.xml", "xl/comments1.xml", "xl/charts/chart1.xml"):
                    self.assertEqual(a.read(n), b.read(n), "la parte %s debía quedar idéntica byte a byte" % n)
        sst = leer(out, "xl/sharedStrings.xml")
        self.assertIn("<t>Product</t>", sst)
        self.assertIn("Notes &amp; &lt;doubts&gt;", sst)
        self.assertIn('<t xml:space="preserve"> Grand total</t>', sst)
        self.assertIn("<b/></rPr><t>review</t>", sst)  # el tramo en negrita sigue con su formato
        self.assertIn("<t>Confirm quantity</t>", leer(out, "xl/comments1.xml"))
        self.assertIn("<a:t>Sales by product</a:t>", leer(out, "xl/charts/chart1.xml"))
        hoja = leer(out, "xl/worksheets/sheet1.xml")
        self.assertIn("<f>B2*2</f>", hoja)
        self.assertIn('<mergeCell ref="D1:E1"/>', hoja)
        # el original nunca se toca
        self.assertIn("<t>Producto</t>", leer(self.src, "xl/sharedStrings.xml"))

    def test_nunca_sobrescribe_ni_la_salida_ni_el_original(self):
        out, _ = self.traducir("b", {})
        t = os.path.join(self.d, "tr-b.json")
        p = run("aplicar", self.src, "-t", t, "-o", out, ok=(1,))
        self.assertIn("no se sobrescribe", p.stderr)
        p = run("aplicar", self.src, "-t", t, "-o", self.src, ok=(1,))
        self.assertIn("no se sobrescribe", p.stderr)
        self.assertIn("<t>Producto</t>", leer(self.src, "xl/sharedStrings.xml"))

    def test_sin_traduccion_formato_perdido_y_recorte_se_informan(self):
        out, p = self.traducir("c", {"s0": "y" * 30, "s2": "", "s3": "Note: review", "s5": "x" * 60})
        with open(os.path.join(self.d, "inf-c.json"), encoding="utf-8") as f:
            inf = json.load(f)
        self.assertEqual(inf["sin_traduccion"], ["s2"])
        self.assertEqual(inf["formato_simplificado"], ["s3"])
        # la columna A mide 12: «Producto» cabía y ahora no; la frase de A4 ya no cabía antes, así que no se avisa de ella
        self.assertEqual(inf["posible_recorte"], ["Ventas!A1"])
        self.assertIn("<t xml:space=\"preserve\">Total general</t>", leer(out, "xl/sharedStrings.xml"))  # sin traducción: queda el original
        self.assertIn("Note: review", leer(out, "xl/sharedStrings.xml"))

    def test_comparar_detecta_cambios_de_estructura(self):
        out, _ = self.traducir("d", {})
        self.assertEqual(comparar_estructura.comparar(self.src, out)[0], [])
        # mutación: cambiar una fórmula, un estilo o quitar una celda
        for nombre, f in (("formula", lambda h: h.replace("<f>B2*2</f>", "<f>B2*3</f>")), ("estilo", lambda h: h.replace('r="B2" s="1"', 'r="B2" s="0"')),
                          ("celda", lambda h: h.replace('<c r="A4" t="s"><v>5</v></c>', "")), ("combinada", lambda h: h.replace("D1:E1", "D1:F1"))):
            malo = os.path.join(self.d, "malo-%s.xlsx" % nombre)
            partes = dict(PARTES)
            partes["xl/worksheets/sheet1.xml"] = f(PARTES["xl/worksheets/sheet1.xml"])
            crear(malo, partes)
            dif = comparar_estructura.comparar(self.src, malo)[0]
            self.assertTrue(dif, "debía detectar el cambio de %s" % nombre)
        # una parte que no es de texto (la imagen) cambiada
        malo = os.path.join(self.d, "malo-img.xlsx")
        partes = dict(PARTES)
        partes["xl/media/logo.png"] = "OTRA"
        crear(malo, partes)
        self.assertTrue(comparar_estructura.comparar(self.src, malo)[0])
        # el CLI también: código 1
        p = subprocess.run([sys.executable, os.path.join(SH, "comparar_estructura.py"), self.src, malo], capture_output=True, text=True)
        self.assertEqual(p.returncode, 1)
        self.assertIn("CAMBIÓ", p.stdout)

    def test_no_es_un_xlsx_o_esta_cifrado(self):
        malo = os.path.join(self.d, "no.xlsx")
        with open(malo, "w") as f:
            f.write("no soy un zip")
        p = run("extraer", malo, "-o", os.path.join(self.d, "x.json"), ok=(1,))
        self.assertIn("no es un .xlsx válido", p.stderr)

    def test_libro_sin_texto(self):
        sin = os.path.join(self.d, "sin.xlsx")
        partes = dict(PARTES)
        partes["xl/sharedStrings.xml"] = '<?xml version="1.0"?><sst %s><si><t>123</t></si></sst>' % NS
        for k in ("xl/comments1.xml", "xl/charts/chart1.xml"):
            partes.pop(k)
        crear(sin, partes)
        run("extraer", sin, "-o", os.path.join(self.d, "y.json"), ok=(2,))


if __name__ == "__main__":
    unittest.main()
