# Busqueda de catalogo

- Sin distinguir mayusculas ni acentos (`cafe` encuentra `Café`).
- Coincide por subcadena en el nombre o en cualquiera de las etiquetas (`tags`).
- Orden: primero los que coinciden por nombre, despues los que solo coinciden por etiqueta; dentro de cada grupo se conserva el orden original.
- Una consulta vacia (o solo espacios) devuelve `[]`.
