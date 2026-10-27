# Ola 7, 7.2: Lazunox gasta menos tokens por paso

Rama del motor: `feat/ola7-tokens` en `~/Documents/lzx-wt/ola7-tokens` (9 commits sobre `feat/ola7-final` 87ff019; el último, 9940046). Binario nuevo (compilado en el VPS con la receta de siempre, carpeta ya borrada): `~/Documents/lzx-bench-bin/tokens/v2/opencode`, sha256 `16973e02a4ec6ad7158a55cd182d144668b8c3fca8d3f53a83e7e6dae62807e3`. El `v1` de esa carpeta es una versión intermedia sin ejecutar con modelo real.

## Qué se hizo (todo ENCENDIDO por defecto, por orden de Ben; apagar con `LAZUNOX_AHORRO_TOKENS=0`)

| Recorte | Qué | Commit |
|---|---|---|
| `busqueda` | Búsqueda diferida de herramientas MCP en `auto` si no hay variable explícita | 90a367c |
| `bash` | Descripción y parámetros del shell más cortos (reglas de git y seguridad intactas) | f217fe3 |
| `task`, `todo`, `herramientas` | Descripciones más cortas de task, todowrite, read, edit, write, glob, grep | e1baaa0 |
| `sistema` | Prompt por defecto de 8.258 a 3.878 caracteres | feb6757, ad340e8 |
| `herramientas` (más) | question, skill, webfetch, websearch, lsp | 6ce1357 |
| `cache` | Ruta temporal fuera de las herramientas; el subagente usa la clave de caché de su padre | 1bed36c |
| (aparte) | Tope de 15 min al `retry-after` (`LAZUNOX_RETRY_TOPE=0` lo apaga) | 1bed36c |
| encendido | Los recortes pasan a ON por defecto, pruebas ajustadas | d6e7361 |

## Resultado medido

Con servidor falso (sin gasto, ver `DIAGNOSTICO.md`): petición del primer paso de T01 34.063 B a 21.819 B (-36 %); T12 82.553 B a 24.331 B (-71 %).

Con modelo real (deepseek-v4.1-flash, vía proxy, **n=1 por tarea**, 104.280 tokens enviados en total de un tope de 400.000):

| Tarea | Éxito antes (n=3) | Éxito ahora (n=1) | Tokens/paso antes (mediana n=3) | Tokens/paso ahora | Tokens enviados antes | ahora |
|---|---|---|---:|---:|---:|---:|
| T01 | 3/3 | 1/1 | 9.043 | 6.436 | 44.704 | 31.013 |
| T12 | 3/3 | 1/1 | 22.794 | 8.088 | 68.921 | 38.815 |
| T13 | 3/3 | 1/1 | 9.820 | 6.715 | 47.864 | 32.681 |

OpenCode 2.2.0 en el comparativo: T01 5.473, T12 7.467, T13 5.888 por paso. Quedamos cerca; T12 casi igual.

## Lo que NO se midió (honesto)

- **No hay n>=5.** Cada tarea se corrió una sola vez con el binario nuevo (orden de Ben: «córtala de pruebas»). El «antes» sale del comparativo (n=3, mismo modelo, proxy). Sirve como humo («nada se rompió, bajan los tokens»), no como prueba estadística de que el éxito no baja en las otras 21 tareas.
- Solo se probó DeepSeek. Los prompts de Claude, GPT, Gemini y Codex **no** tienen versión compacta (no se hicieron); el recorte `sistema` solo afecta al prompt por defecto.
- No se midió T02, T21, T24 ni las tareas de ayudantes, donde `task` más corto y los avisos de ayudantes podrían cambiar el comportamiento.
- Compactación sobre el mismo prefijo (`compaction.ts` manda `tools:{}` y `system:[]`): no se hizo. Falta también el recorte de `cuaderno` y `shell_wait`, y un prompt base "mínimo con guía por herramienta presente" al estilo OpenCode.
- Lo de la caché de la primera petición está explicado por la ruta temporal pero no confirmado con el modelo real.
- Pruebas: `test/lazunox`, `test/session` y `test/tool` pasan (2.507 de 2.507 en la segunda corrida; una prueba de cancelar el shell falló una vez por carga y pasó al repetirla), y `typecheck` limpio. Pruebas nuevas: `test/lazunox/ahorro-tokens.test.ts`, y se ajustaron `tool-search`, `retry` y `llm`.

## Archivos

`DIAGNOSTICO.md` (tabla antes/después), `capturas/` (cuerpos de petición de final2, OpenCode 2.2.0 y v2; sin cabeceras ni claves), `humo/` (bench.json, log y `proxy.jsonl` del humo con modelo real), `herramientas/` (servidor de captura, lanzadores y analizador).
