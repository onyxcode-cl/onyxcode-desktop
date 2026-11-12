# -*- coding: utf-8 -*-
"""Cálculo local, acotado y sin eval de fórmulas; cachés OOXML sin sustituir fórmulas.

openpyxl no calcula y XlsxWriter solo guarda resultados que el llamador le da.
Este motor usa el tokenizer de openpyxl y rechaza lo que no implementa: nunca usa
el caché anterior como entrada del cálculo ni ejecuta código de una fórmula.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal, ROUND_HALF_UP, localcontext
from io import BytesIO
import math
import operator
import os
import posixpath
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

from openpyxl.formula.tokenizer import Tokenizer, TokenizerError
from openpyxl.utils.cell import range_boundaries
from openpyxl.utils.datetime import to_excel

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '_shared'))
from output_file import write_output

NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
Q = '{%s}' % NS
ERRORS = {'#DIV/0!', '#REF!', '#NAME?', '#VALUE!', '#N/A', '#NUM!', '#NULL!'}


class Unsupported(ValueError):
    """Fórmula válida o extensión que este motor no sabe calcular."""


class FormulaError(ValueError):
    """Error del libro que Excel también mostraría."""


class Area:
    def __init__(self, values):
        self.values = values

    def flat(self):
        return [v for row in self.values for v in row]


def scalar(v):
    if isinstance(v, Area):
        if len(v.values) != 1 or len(v.values[0]) != 1:
            raise Unsupported('operación matricial no soportada')
        v = v.values[0][0]
    if isinstance(v, FormulaError):
        raise v
    return v


def number(v):
    v = scalar(v)
    if v is None:
        return 0
    if isinstance(v, bool):
        return int(v)
    try:
        return float(v) if isinstance(v, str) else v
    except ValueError:
        raise FormulaError('#VALUE!')


def truth(v):
    v = scalar(v)
    if isinstance(v, str):
        if v.upper() in ('TRUE', 'FALSE'):
            return v.upper() == 'TRUE'
        raise FormulaError('#VALUE!')
    return bool(v)


def equal(a, b):
    if isinstance(a, str) and isinstance(b, str):
        return a.casefold() == b.casefold()
    if isinstance(a, bool) != isinstance(b, bool):
        return False
    return a == b


def compare(a, b, op):
    a, b = scalar(a), scalar(b)
    if a is None:
        a = '' if isinstance(b, str) else 0
    if b is None:
        b = '' if isinstance(a, str) else 0
    if op in ('=', '<>'):
        return equal(a, b) == (op == '=')
    # Excel ordena números < texto < booleanos; texto sin distinguir mayúsculas.
    def key(v):
        return (2, v) if isinstance(v, bool) else ((1, v.casefold()) if isinstance(v, str) else (0, v))
    return {'<': operator.lt, '>': operator.gt, '<=': operator.le, '>=': operator.ge}[op](key(a), key(b))


class Parser:
    PRECEDENCE = {'=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1,
                  '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5}

    def __init__(self, formula):
        try:
            self.tokens = [t for t in Tokenizer(formula).items if t.type != 'WHITE-SPACE']
        except (TokenizerError, IndexError):
            raise FormulaError('#VALUE!')
        if len(self.tokens) > 2000:
            raise Unsupported('fórmula demasiado larga')
        self.i = 0

    def expression(self, minimum=0):
        if self.i >= len(self.tokens):
            raise FormulaError('#VALUE!')
        t = self.tokens[self.i]
        self.i += 1
        if t.type == 'OPERAND':
            left = ('value', t.subtype, t.value)
        elif t.type == 'OPERATOR-PREFIX':
            left = ('unary', t.value, self.expression(6))
        elif t.type == 'FUNC' and t.subtype == 'OPEN':
            args = []
            if self.i < len(self.tokens) and self.tokens[self.i].subtype != 'CLOSE':
                while True:
                    args.append(self.expression())
                    if self.i < len(self.tokens) and self.tokens[self.i].type == 'SEP' and self.tokens[self.i].subtype == 'ARG':
                        self.i += 1
                    else:
                        break
            self.close('FUNC')
            left = ('call', t.value[:-1].upper().removeprefix('_XLFN.'), args)
        elif t.type == 'PAREN' and t.subtype == 'OPEN':
            left = self.expression()
            self.close('PAREN')
        else:
            raise Unsupported('sintaxis no soportada: %s' % t.value)
        while self.i < len(self.tokens):
            t = self.tokens[self.i]
            if t.type == 'OPERATOR-POSTFIX' and t.value == '%':
                self.i += 1
                left = ('percent', left)
                continue
            p = self.PRECEDENCE.get(t.value, -1) if t.type == 'OPERATOR-INFIX' else -1
            if p < minimum:
                break
            self.i += 1
            left = ('binary', t.value, left, self.expression(p + 1))
        return left

    def close(self, kind):
        if self.i >= len(self.tokens) or self.tokens[self.i].type != kind or self.tokens[self.i].subtype != 'CLOSE':
            raise FormulaError('#VALUE!')
        self.i += 1

    def parse(self):
        node = self.expression()
        if self.i != len(self.tokens):
            raise Unsupported('sintaxis no soportada')
        return node


class Calculator:
    def __init__(self, wb):
        self.wb = wb
        self.sheets = {name.casefold(): name for name in wb.sheetnames}
        self.values = {}
        self.active = set()

    def cell(self, sheet, coord):
        sheet = self.sheets.get(sheet.casefold(), sheet)
        key = (sheet, coord)
        if key in self.active:
            raise FormulaError('referencia circular')
        if key in self.values:
            v = self.values[key]
            if isinstance(v, Exception):
                raise v
            return v
        if len(self.active) > 200:
            raise Unsupported('cadena de dependencias demasiado larga')
        if sheet not in self.wb.sheetnames:
            raise FormulaError('#REF!')
        c = self.wb[sheet][coord]
        v = c.value
        if c.data_type == 'e':
            raise FormulaError(str(v))
        if c.data_type == 'f':
            self.active.add(key)
            try:
                if not isinstance(v, str):
                    raise Unsupported('fórmula matricial no soportada')
                v = scalar(self.evaluate(Parser(v).parse(), sheet))
                if v is None:
                    v = 0  # una referencia vacía como resultado se muestra como cero
                if isinstance(v, float) and not math.isfinite(v):
                    raise FormulaError('#NUM!')
            except (Unsupported, FormulaError) as e:
                self.values[key] = e
                raise
            except (TypeError, ValueError, OverflowError, ZeroDivisionError, IndexError):
                self.values[key] = FormulaError('#VALUE!')
                raise self.values[key]
            finally:
                self.active.remove(key)
        elif isinstance(v, (dt.datetime, dt.date, dt.time, dt.timedelta)):
            v = to_excel(v, self.wb.epoch)
        self.values[key] = v
        return v

    def ref(self, ref, sheet):
        if '!' in ref:
            sheet, ref = ref.rsplit('!', 1)
            if sheet.startswith("'") and sheet.endswith("'"):
                sheet = sheet[1:-1].replace("''", "'")
        if not re.fullmatch(r'\$?[A-Za-z]{1,3}\$?[1-9]\d*(?::\$?[A-Za-z]{1,3}\$?[1-9]\d*)?', ref):
            raise Unsupported('referencia no soportada: %s' % ref)
        c1, r1, c2, r2 = range_boundaries(ref)
        if c1 > c2 or r1 > r2 or c2 > 16384 or r2 > 1048576:
            raise FormulaError('#REF!')
        if (c2-c1+1)*(r2-r1+1) > 200000:
            raise Unsupported('rango de más de 200000 celdas')
        from openpyxl.utils import get_column_letter
        def value(c, r):
            try:
                return self.cell(sheet, '%s%d' % (get_column_letter(c), r))
            except FormulaError as e:
                return e
        return Area([[value(c, r) for c in range(c1, c2+1)] for r in range(r1, r2+1)])

    def evaluate(self, node, sheet):
        kind = node[0]
        if kind == 'value':
            subtype, text = node[1:]
            if subtype == 'RANGE':
                return self.ref(text, sheet)
            if subtype == 'NUMBER':
                return float(text)
            if subtype == 'TEXT':
                return text[1:-1].replace('""', '"')
            if subtype == 'LOGICAL':
                return text.upper() == 'TRUE'
            if subtype == 'ERROR':
                raise FormulaError(text)
            raise Unsupported('operando no soportado')
        if kind == 'unary':
            v = number(self.evaluate(node[2], sheet))
            return -v if node[1] == '-' else v
        if kind == 'percent':
            return number(self.evaluate(node[1], sheet))/100
        if kind == 'binary':
            op = node[1]
            a, b = self.evaluate(node[2], sheet), self.evaluate(node[3], sheet)
            if op in ('=', '<>', '<', '>', '<=', '>='):
                return compare(a, b, op)
            if op == '&':
                def text(v):
                    v = scalar(v)
                    if v is None:
                        return ''
                    if isinstance(v, bool):
                        return str(v).upper()
                    return str(int(v)) if isinstance(v, float) and v.is_integer() else str(v)
                return text(a) + text(b)
            a, b = number(a), number(b)
            if op == '/' and b == 0:
                raise FormulaError('#DIV/0!')
            v = {'+': operator.add, '-': operator.sub, '*': operator.mul,
                 '/': operator.truediv, '^': operator.pow}[op](a, b)
            if isinstance(v, complex):
                raise FormulaError('#NUM!')
            return v
        fn, args = node[1:]
        if fn == 'IF' and len(args) in (2, 3):
            if truth(self.evaluate(args[0], sheet)):
                return self.evaluate(args[1], sheet)
            return self.evaluate(args[2], sheet) if len(args) == 3 else False
        if fn == 'IFERROR' and len(args) == 2:
            try:
                return self.evaluate(args[0], sheet)
            except FormulaError:
                return self.evaluate(args[1], sheet)
        supported = {'SUM', 'AVERAGE', 'MAX', 'MIN', 'COUNT', 'COUNTA', 'SUMIF', 'SUMIFS',
                     'COUNTIF', 'COUNTIFS', 'ROUND', 'ABS', 'AND', 'OR', 'NOT', 'INDEX', 'MATCH',
                     'VLOOKUP', 'DATE', 'TRUE', 'FALSE'}
        if fn not in supported:
            raise Unsupported('función %s no soportada por el cálculo local' % fn)
        vals = [self.evaluate(a, sheet) for a in args]
        if fn in ('SUM', 'AVERAGE', 'MAX', 'MIN', 'COUNT', 'COUNTA'):
            nums, allvals = [], []
            for v in vals:
                if isinstance(v, Area):
                    flat = v.flat()
                    if fn not in ('COUNT', 'COUNTA'):
                        for x in flat:
                            scalar(x)  # propagar errores en agregados, sin ignorarlos
                    nums.extend(x for x in flat if isinstance(x, (int, float)) and not isinstance(x, bool))
                    allvals.extend(flat)
                else:
                    allvals.append(v)
                    if v is not None:
                        try:
                            nums.append(number(v))
                        except FormulaError:
                            if fn != 'COUNT' and fn != 'COUNTA':
                                raise
            if fn == 'COUNT':
                return len(nums)
            if fn == 'COUNTA':
                return sum(v is not None for v in allvals)
            if fn == 'SUM':
                return sum(nums)
            if fn == 'AVERAGE':
                if not nums:
                    raise FormulaError('#DIV/0!')
                return sum(nums)/len(nums)
            return (max(nums) if fn == 'MAX' else min(nums)) if nums else 0
        if fn in ('SUMIF', 'SUMIFS', 'COUNTIF', 'COUNTIFS'):
            def area(v):
                if not isinstance(v, Area):
                    raise FormulaError('#VALUE!')
                return v
            if fn == 'SUMIF' and len(vals) in (2, 3):
                sums = area(vals[2] if len(vals) == 3 else vals[0])
                pairs = [(area(vals[0]), scalar(vals[1]))]
            elif fn == 'SUMIFS' and len(vals) >= 3 and len(vals) % 2 == 1:
                sums = area(vals[0])
                pairs = [(area(vals[i]), scalar(vals[i+1])) for i in range(1, len(vals), 2)]
            elif ((fn == 'COUNTIF' and len(vals) == 2) or (fn == 'COUNTIFS' and len(vals) >= 2 and len(vals) % 2 == 0)):
                sums = None
                pairs = [(area(vals[i]), scalar(vals[i+1])) for i in range(0, len(vals), 2)]
            else:
                raise FormulaError('#VALUE!')
            shape = lambda a: (len(a.values), len(a.values[0]))
            base = sums if sums is not None else pairs[0][0]
            if any(shape(a) != shape(base) for a, _ in pairs):
                raise Unsupported('rangos de distinto tamaño en %s; usa rangos iguales' % fn)
            flattened = [(a.flat(), criterion) for a, criterion in pairs]
            result = 0
            for i, v in enumerate(base.flat()):
                if all(criteria(a[i], criterion) for a, criterion in flattened):
                    if sums is None:
                        result += 1
                    else:
                        scalar(v)
                        if isinstance(v, (int, float)) and not isinstance(v, bool):
                            result += v
            return result
        if fn == 'ROUND' and len(vals) == 2:
            digits = int(number(vals[1]))
            if abs(digits) > 300:
                raise Unsupported('precisión ROUND fuera del límite local')
            with localcontext() as ctx:
                ctx.prec = 650
                return float(Decimal(str(number(vals[0]))).quantize(Decimal('1e%d' % -digits), rounding=ROUND_HALF_UP))
        if fn == 'ABS' and len(vals) == 1:
            return abs(number(vals[0]))
        if fn in ('AND', 'OR'):
            flat = []
            for v in vals:
                if isinstance(v, Area):
                    for x in v.flat():
                        scalar(x)
                        if isinstance(x, (int, float, bool)):
                            flat.append(x)
                else:
                    flat.append(v)
            if not flat:
                raise FormulaError('#VALUE!')
            bools = [truth(x) for x in flat]
            return (all if fn == 'AND' else any)(bools)
        if fn == 'NOT' and len(vals) == 1:
            return not truth(vals[0])
        if fn in ('TRUE', 'FALSE') and not vals:
            return fn == 'TRUE'
        if fn == 'INDEX' and len(vals) in (2, 3) and isinstance(vals[0], Area):
            r = int(number(vals[1]))
            c = int(number(vals[2])) if len(vals) == 3 else 1
            if len(vals) == 2 and len(vals[0].values) == 1:
                r, c = 1, r
            if r == 0 or c == 0:
                raise Unsupported('INDEX con fila o columna cero devuelve una matriz')
            if r < 1 or c < 1 or r > len(vals[0].values) or c > len(vals[0].values[0]):
                raise FormulaError('#REF!')
            return scalar(Area([[vals[0].values[r-1][c-1]]]))
        if fn == 'MATCH' and len(vals) in (2, 3):
            if len(vals) != 3 or number(vals[2]) != 0:
                raise Unsupported('MATCH solo admite coincidencia exacta (tercer argumento 0)')
            if not isinstance(vals[1], Area) or (len(vals[1].values) > 1 and len(vals[1].values[0]) > 1):
                raise FormulaError('#N/A')
            for i, v in enumerate(vals[1].flat(), 1):
                if lookup_equal(v, scalar(vals[0])):
                    return i
            raise FormulaError('#N/A')
        if fn == 'VLOOKUP' and len(vals) == 4 and isinstance(vals[1], Area):
            if truth(vals[3]):
                raise Unsupported('VLOOKUP solo admite coincidencia exacta (FALSE)')
            col = int(number(vals[2]))
            if col < 1 or col > len(vals[1].values[0]):
                raise FormulaError('#REF!')
            for row in vals[1].values:
                if lookup_equal(row[0], scalar(vals[0])):
                    return row[col-1]
            raise FormulaError('#N/A')
        if fn == 'DATE' and len(vals) == 3:
            y, m, d = [int(number(v)) for v in vals]
            if y < 0 or y >= 10000:
                raise FormulaError('#NUM!')
            if y < 1900:
                y += 1900
            y, m = y + (m-1)//12, (m-1) % 12 + 1
            # Excel incluye el día ficticio 29-02-1900 en su calendario de 1900.
            start = to_excel(dt.datetime(y, m, 1), self.wb.epoch)
            if self.wb.epoch.year == 1899 and (y, m) == (1900, 1):
                start = 1
            serial = start + d - 1
            if serial < 0 or serial >= to_excel(dt.datetime(9999, 12, 31), self.wb.epoch) + 1:
                raise FormulaError('#NUM!')
            return serial
        raise Unsupported('argumentos no soportados para %s' % fn)


def lookup_equal(value, wanted):
    value = scalar(value)
    if isinstance(wanted, str):
        # En búsquedas exactas «>5» es texto literal, no un criterio de SUMIF.
        return criteria(value, "=" + wanted)
    return equal(value, wanted)


def criteria(value, criterion):
    if isinstance(value, FormulaError):
        raise Unsupported("error en rango de criterios; comprueba la celda de entrada con error")
    if criterion is None:
        criterion = 0  # referencia a criterio vacía
    if not isinstance(criterion, str):
        return equal(0 if value is None else value, criterion)
    m = re.match(r'^(<=|>=|<>|=|<|>)(.*)$', criterion)
    op, wanted = m.groups() if m else ('=', criterion)
    try:
        n = float(wanted)
    except ValueError:
        n = None
    if n is not None:
        if value is None:
            value = 0
        if isinstance(value, str):
            try:
                value = float(value)
            except ValueError:
                return op == '<>'
        return compare(value, n, op)
    was_blank = value is None
    value = '' if was_blank else value
    if op in ('=', '<>'):
        pattern, i = '', 0
        while i < len(wanted):
            ch = wanted[i]
            if ch == '~' and i+1 < len(wanted):
                i += 1
                pattern += re.escape(wanted[i])
            else:
                pattern += '.*' if ch == '*' else ('.' if ch == '?' else re.escape(ch))
            i += 1
        matched = isinstance(value, str) and (not was_blank or wanted == '') and re.fullmatch(pattern, value, re.IGNORECASE) is not None
        return matched == (op == '=')
    return compare(value, wanted, op)


def calculate(wb):
    calc, values, unsupported = Calculator(wb), {}, []
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for c in row:
                if c.data_type != 'f':
                    continue
                try:
                    values[(ws.title, c.coordinate)] = calc.cell(ws.title, c.coordinate)
                except RecursionError:
                    unsupported.append({'hoja': ws.title, 'celda': c.coordinate, 'problema': 'fórmula demasiado compleja para el cálculo local'})
                except Unsupported as e:
                    unsupported.append({'hoja': ws.title, 'celda': c.coordinate, 'problema': str(e)})
                except FormulaError as e:
                    values[(ws.title, c.coordinate)] = str(e)
    return values, unsupported


def sheet_paths(z):
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    targets = {r.get('Id'): posixpath.normpath(posixpath.join('xl', r.get('Target'))).lstrip('/')
               if not r.get('Target').startswith('/') else r.get('Target').lstrip('/') for r in rels}
    root = ET.fromstring(z.read('xl/workbook.xml'))
    return {s.get('name'): targets[s.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')]
            for s in root.find(Q+'sheets')}


def read_cached_values(path):
    """Leer <v> directamente: no perder el serial 60 de 1900 ni precisión de fechas."""
    values = {}
    with zipfile.ZipFile(path) as z:
        for sheet, member in sheet_paths(z).items():
            root = ET.fromstring(z.read(member))
            for cell in root.iter(Q+'c'):
                if cell.find(Q+'f') is None:
                    continue
                v = cell.find(Q+'v')
                text = v.text if v is not None else None
                kind = cell.get('t', 'n')
                if kind == 'str' and v is not None:
                    value = text or ''
                elif text is None:
                    value = None
                elif kind == 'b':
                    value = text == '1'
                elif kind in ('e', 'd'):
                    value = text
                elif kind == 'n':
                    value = float(text)
                else:
                    # Tipos de caché que no escribe el motor: no dar por válido un índice.
                    value = None
                values[(sheet, cell.get('r'))] = value
    return values


def save_with_cache(wb, path):
    """Arma el ZIP completo con sus cachés en memoria y entrega una copia nueva.

    Nunca crea un temporal junto al destino ni necesita borrar o renombrar allí.
    Los temporales internos de openpyxl usan el directorio temporal del sistema.
    """
    values, unsupported = calculate(wb)
    from openpyxl.workbook.properties import CalcProperties
    wb.calculation = CalcProperties(calcMode='auto', fullCalcOnLoad=True)
    with BytesIO() as raw, BytesIO() as result:
        wb.save(raw)
        raw.seek(0)
        with zipfile.ZipFile(raw) as src, zipfile.ZipFile(result, 'w', zipfile.ZIP_DEFLATED) as dst:
            sheets = {p: s for s, p in sheet_paths(src).items()}
            for info in src.infolist():
                data = src.read(info.filename)
                if info.filename in sheets:
                    sheet = sheets[info.filename]
                    # Conservar namespaces y prefijos originales (drawing, extLst, etc.).
                    def patch(m):
                        cell = ET.fromstring(m.group(0))
                        if cell.find('f') is None:
                            return m.group(0)
                        key = (sheet, cell.get('r'))
                        for child in list(cell):
                            if child.tag in ('v', 'is'):
                                cell.remove(child)
                        cell.attrib.pop('t', None)
                        if key in values and values[key] != 'referencia circular':
                            value = values[key]
                            v = ET.SubElement(cell, 'v')
                            if isinstance(value, bool):
                                cell.set('t', 'b')
                                v.text = '1' if value else '0'
                            elif isinstance(value, str):
                                cell.set('t', 'e' if value in ERRORS else 'str')
                                v.text = value
                            else:
                                cell.set('t', 'n')
                                v.text = repr(value)
                        return ET.tostring(cell, encoding='unicode')
                    data = re.sub(r'<c\b[^>]*>.*?</c>', patch, data.decode('utf-8'), flags=re.S).encode('utf-8')
                dst.writestr(info, data)
        write_output(path, result.getvalue())
    return unsupported


def same_value(a, b, epoch):
    if isinstance(a, (dt.datetime, dt.date, dt.time, dt.timedelta)):
        a = to_excel(a, epoch)
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) == type(b) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(a, b, rel_tol=0, abs_tol=max(1e-10, 8*math.ulp(float(b))))
    # OOXML puede representar una cadena vacía como <v/>.
    return a == b or (a is None and b == '')


def total_range_issues(wb, tables=None):
    """Totales simples: contrastar con límites reales de datos, sin adivinar otros cálculos.

    Constructor: límites conocidos aunque no haya filtro. Verificador: filtro o
    encabezado de impresión + fila explícita Total (ambos sobreviven en OOXML).
    """
    tables = dict(tables or {})
    for ws in wb.worksheets:
        if ws.title in tables:
            continue
        if ws.auto_filter.ref:
            _, header, _, last = range_boundaries(ws.auto_filter.ref)
            tables[ws.title] = (header+1, last, last+1)
        elif ws.print_title_rows:
            match = re.fullmatch(r'\$?(\d+):\$?\1', ws.print_title_rows)
            if match:
                header = int(match[1])
                for row in ws.iter_rows(min_row=header+1):
                    if any(isinstance(c.value, str) and re.fullmatch(r'\s*(total|subtotal|total general)\s*:?\s*', c.value, re.I) for c in row):
                        tables[ws.title] = (header+1, row[0].row-1, row[0].row)
                        break
    issues = []
    for sheet, (first, last, total) in tables.items():
        if total is None:
            continue
        ws = wb[sheet]
        for row in ws.iter_rows(min_row=total, max_row=total):
            for c in row:
                if c.data_type != 'f' or not isinstance(c.value, str):
                    continue
                try:
                    node = Parser(c.value).parse()
                except (Unsupported, FormulaError):
                    continue
                if node[0] != 'call' or node[1] not in ('SUM', 'AVERAGE', 'COUNT', 'MIN', 'MAX') or len(node[2]) != 1:
                    continue
                arg = node[2][0]
                if arg[:2] != ('value', 'RANGE'):
                    continue
                ref, target = arg[2], sheet
                if '!' in ref:
                    target, ref = ref.rsplit('!', 1)
                    if target.startswith("'") and target.endswith("'"):
                        target = target[1:-1].replace("''", "'")
                target = next((name for name in tables if name.casefold() == target.casefold()), target)
                if target not in tables:
                    continue
                m = re.fullmatch(r'\$?([A-Z]+)\$?(\d+):\$?\1\$?(\d+)', ref, re.I)
                if not m:
                    continue
                begin, end, _ = tables[target]
                if (int(m[2]), int(m[3])) != (begin, end):
                    issues.append({'hoja': sheet, 'celda': c.coordinate,
                                   'problema': 'el rango %s no cubre las filas de datos %d:%d de %s; usa %s%d:%s%d o {col:%s:%s} en la especificación' %
                                   (ref, begin, end, target, m[1], begin, m[1], end, target, m[1])})
    return issues


def verify_cache(path, wb=None):
    from openpyxl import load_workbook
    own = wb is None
    wb = wb or load_workbook(path)
    cached = read_cached_values(path)
    try:
        values, unsupported = calculate(wb)
        errors, differences = [], []
        for (sheet, coord), value in values.items():
            entry = {'hoja': sheet, 'celda': coord, 'valor': value}
            if isinstance(value, str) and value in ERRORS:
                errors.append(dict(entry, problema='corrige la fórmula o sus datos de entrada (%s)' % value))
            elif value == 'referencia circular':
                errors.append(dict(entry, problema='elimina la referencia circular'))
            elif not same_value(cached.get((sheet, coord)), value, wb.epoch):
                differences.append(dict(entry, guardado=cached.get((sheet, coord)),
                                        problema='valor guardado distinto o ausente; vuelve a generar con build_xlsx.py o edit_xlsx.py (salida nueva)'))
        return {'values': values, 'unsupported': unsupported, 'errors': errors,
                'differences': differences, 'ranges': total_range_issues(wb)}
    finally:
        if own:
            wb.close()
