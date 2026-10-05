# Informe final: plan ND Tareas, Rutinas y primer uso

Rama nd/tareas. T1 a T6 hechas.

- Archivo sin commit: era la guardia T3 con literal vacío; se completó y se amplió (Home, compositor, avisos) con un estado de prueba para el store.
- Auditoría de T1/T2: faltaba un arreglo. La guardia desktop-scope fallaba en 3 archivos por `className="desk:size-4"` en iconos sueltos; ahora el botón padre lleva `desk:[&_svg]:size-4` y el span de Cambios `contents desk:hidden`. Clases base intactas, sin colores nuevos.
- T3 (conversación, compositor, Home, primer uso, avisos), T4 (Rutinas y editor, guardias primero), T5 (Wizard), T6 (escenarios, docs, CHANGELOG F8-B97, DESIGN.md).
- Verificación final: typecheck 0 errores; lint 0 errores (3 avisos previos); format:check limpio; vitest completo 3743 pasan, 1 falla (m001-tasks-rename, fixture ignorado por git, no tocado); build:pwa y size:pwa en verde (arranque 285,5 KB gz, budget.json intacto).
- Capturas (claro y oscuro, 1280x800): /private/tmp/claude-501/-Users-ben/0f2b5c02-144e-41f9-8c7c-156d39453861/scratchpad/shots-nd-tareas/ (tareas-*, rutinas*, onboarding*), 26 sin fallos.
- No hecho: shot-mobile/e2e/Electron completo (no pedidos). tareas-archivadas muestra la lista vacía.
