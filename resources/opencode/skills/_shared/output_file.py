"""Entrega bytes ya terminados sin temporales ni renombrados en el destino.

El aislamiento permite crear/escribir, pero puede negar borrar/mover/renombrar.
La serialización y validación deben terminar ANTES de llamar a esta función.
"""


def write_output(path, data, *, overwrite=False):
    """Una apertura y una escritura normal; por defecto nunca pisa un archivo.

    `overwrite` se reserva para --en-sitio de verificar_office, exclusivamente
    sobre un PowerPoint recién creado por el agente. No es un guardado atómico:
    un fallo del dispositivo durante write/close puede dejar la salida incompleta.
    No se intenta borrarla (ese permiso puede estar denegado).
    """
    opened = False
    try:
        with open(path, "wb" if overwrite else "xb") as target:
            opened = True
            if target.write(data) != len(data):
                raise OSError("escritura incompleta")
    except FileExistsError as e:
        raise FileExistsError("ya existe %s; elige un nombre nuevo (no se sobrescribe)" % path) from e
    except OSError as e:
        detail = ("La salida puede estar incompleta; no la entregues como válida."
                  if opened else "No se creó ningún archivo de salida.")
        raise OSError("No se pudo guardar %s: %s. %s" % (path, e, detail)) from e
