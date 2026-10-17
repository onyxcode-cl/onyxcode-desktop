# Catálogo de Personalización

Lo que ofrece la pantalla **Personalización** (habilidades incluidas y conectores) vive en **un solo archivo** dentro de la app: `resources/catalogo/catalogo.json`, con su esquema en `resources/catalogo/catalogo.schema.json`. No hay servidor, cuentas ni descargas: lo que la persona ve es lo que viaja en el paquete. El código lo lee en `src/shared/catalogo.ts` (`validateCatalog`) y la prueba `src/test/catalogo.test.ts` falla si una ficha no cumple el esquema o promete algo sin verificar.

## Reglas

- **Solo se ofrece lo verificado de punta a punta.** Una ficha de conector exige `verifiedAt` (fecha) y `verification` (qué se comprobó: dirección contra la documentación oficial y respuesta real del servicio). Palabras como «próximamente», «pronto» o «beta» hacen fallar la prueba.
- **El sello «Revisado por Lazunox»** (`reviewed: true`) es solo de las fichas de este archivo. Lo que la persona instale por su cuenta desde una carpeta propia nunca lo lleva.
- **Conectores** (v1): solo remotos (una URL `https`); añadirlos no ejecuta ningún programa en el equipo. Quedan desactivados hasta que la persona los conecta y confirma la casilla «Entiendo». Los secretos (`inputs[].kind = "secret"`) se piden en un campo enmascarado, se guardan donde ya guarda Ajustes › Conectores y no se vuelven a mostrar. Sin OAuth propio de la app.
- **Habilidades incluidas**: el `id` debe ser una carpeta real de `resources/opencode/skills/` cuyo `SKILL.md` se llame igual.
- **Agrupación**: cada conector pertenece a un grupo por tarea de la vida real (`groups`: correo y calendario, archivos en la nube, hojas y datos, contabilidad, clientes y ventas, desarrollo…). Los grupos sin fichas no se muestran.
- **Textos**: el catálogo guarda ids; los textos visibles (título, descripción, permisos, ejemplos) viven en `src/shared/i18n/{es,en}/personalizacionCatalogo.ts` con la misma clave en los dos idiomas. Lenguaje llano, sin nombres de productos de terceros fuera de los títulos de las fichas.

## Cómo se propone una ficha (pull request)

1. Agrega la ficha a `resources/catalogo/catalogo.json` (copia una existente) y sube `catalogVersion` y `updatedAt`.
2. Agrega sus textos en `personalizacionCatalogo.ts` de `es` y `en`.
3. Verifica el servicio de verdad (dirección, autenticación, qué puede y qué no hacer) y escribe en `verification` cómo lo hiciste, con la fecha.
4. Corre `npx vitest run src/test/catalogo.test.ts src/test/plain-language.test.ts` y `npm run check:mcp-catalog` (con red).
5. Abre el pull request con la documentación oficial del servicio enlazada. El dueño revisa y decide si lleva el sello; una ficha sin revisión no entra al archivo empaquetado.

Para agregar un ícono nuevo hay que añadirlo a `CATALOG_ICONS` (`src/shared/catalogo.ts`) y al mapa de `src/renderer/src/features/personalizacion/icons.ts`.
