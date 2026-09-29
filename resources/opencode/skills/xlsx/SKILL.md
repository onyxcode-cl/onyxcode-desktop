---
name: xlsx
description: Crea o lee hojas de cálculo de Excel (.xlsx) en el Mac, con encabezados, anchos de columna, números y fórmulas. Úsala cuando el usuario pida una planilla, tabla de datos o consolidado en Excel.
---
# Skill: hojas de cálculo Excel (.xlsx)

Dos rutas; elige según lo que exista en este Mac (no lo supongas, compruébalo):

`python3 -c "import openpyxl; print(openpyxl.__version__)"`

- Si imprime una versión: **ruta A** con `openpyxl`.
- Si falla (`ModuleNotFoundError`): **ruta B**, sin dependencias (solo biblioteca estándar de Python).

Trabaja en `./.cowork/`. **Usa un nombre de archivo NUEVO** (`ventas-v2.xlsx`): en el sandbox, `mv`
(renombrar/mover) falla con "Operation not permitted" y las herramientas que reemplazan el archivo de
forma atómica fallan con "no tienes permiso". Nunca sobrescribas un original del usuario.

## Ruta A: openpyxl (plantilla `make_xlsx.py`)
1. Copia la plantilla desde el «Base directory for this skill» que te da la herramienta `skill`:
   `cp "<directorio base>/make_xlsx.py" .cowork/make_xlsx.py`
2. Edita `HOJAS` (nombre de hoja → filas; una fórmula es un texto que empieza por `=`) y ejecuta
   `python3 .cowork/make_xlsx.py ventas.xlsx`. Da encabezado en negrita sobre fondo oscuro, fila
   fija, anchos según el contenido y formato de miles en números y fórmulas.
3. Si `openpyxl` no está en el Mac pero el usuario activó PyPI (interruptor de red de las tareas):
   `python3 -m pip install --target ./.cowork/pylib openpyxl` (sin `--user`: `~/Library/Python` no es
   escribible en el sandbox). La plantilla ya busca en `.cowork/pylib`. *(La descarga no se pudo
   comprobar en esta verificación: sin PyPI activado no hay red en el sandbox.)* Sin PyPI, usa la ruta B.

## Ruta B: sin dependencias (plantilla `make_xlsx_basico.py`)
1. `cp "<directorio base>/make_xlsx_basico.py" .cowork/make_xlsx_basico.py`
2. Edita `HOJAS` y ejecuta `python3 .cowork/make_xlsx_basico.py ventas.xlsx`.
   Números como números, texto como texto, encabezado en negrita sobre fondo oscuro, primera fila fija,
   anchos de columna. Escribe el `.xlsx` a mano (XML mínimo dentro de un zip) sin librerías.
3. Fórmulas: `'=C2*D2'` la calcula Excel al abrir, pero una vista previa la mostrará **vacía**; si el
   valor debe verse en la vista previa de Entregables, pasa `('=C2*D2', 15000)` (fórmula y valor ya
   calculado).

## Verificar (obligatorio)
- Con openpyxl: `python3 -c "import openpyxl; ws=openpyxl.load_workbook('ventas.xlsx').active; print([[c.value for c in r] for r in ws.iter_rows()])"`
- Sin openpyxl: `python3 .cowork/read_xlsx_basico.py ventas.xlsx` (copia antes esa herramienta desde la
  carpeta base de la skill con `cp`), que imprime cada fila con tabuladores; y `zip -T ventas.xlsx`
  debe decir `OK`.
- Comprueba que las cifras coinciden con los datos de origen y que no hay celdas vacías inesperadas.

## Leer un Excel existente
Con `openpyxl`: `load_workbook('archivo.xlsx', data_only=True)` (valores calculados; `data_only=False`
para ver las fórmulas). Sin `openpyxl`: `python3 .cowork/read_xlsx_basico.py archivo.xlsx`. Un `.xls`
antiguo o un `.csv` con separador `;` requiere convertir/leer aparte: si no puedes, dilo.

## Formato es-CL
Guarda **números reales**, no textos como `"1.234,5"`; el formato con punto de miles y coma decimal lo
aplica Excel según la región del usuario. Fechas como fechas o como texto ISO (`2026-09-27`).

## Lo que NO se puede hacer aquí
- Gráficos, tablas dinámicas, formato condicional avanzado, macros y validación de datos.
- Editar un libro existente conservando su formato: crea una copia nueva con `openpyxl`
  (`load_workbook` + `save` con otro nombre) y avisa de que puede perder gráficos u objetos.
- Previsualizar con `qlmanage`/`open`: en el sandbox están bloqueados.
- Si ni `openpyxl` ni la ruta B sirven (p. ej. no hay `python3`), entrega un `.csv` UTF-8 con
  separador `,` y dilo en **Para revisar**.
