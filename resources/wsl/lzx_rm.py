#!/usr/bin/python3 -I
"""rm/rmdir/unlink de Tareas: main decide por ruta; todo rechazo vuelve al programa nativo.

No borra archivos por sí mismo. El billete solo autoriza una llamada viva y nunca sustituye
la autorización que hace main. Esta misma fuente se usa en macOS y dentro de WSL.
"""
import http.client
import json
import os
import sys
from urllib.parse import urlsplit

VERBS = ("rm", "rmdir", "unlink")
MAX_PATHS = 100
MAX_BODY = 128 * 1024
MAX_RESPONSE = 8 * 1024 * 1024


def parse_args(verb, args):
    """Índices de operandos y opciones conocidas. None conserva la semántica nativa completa."""
    if verb not in VERBS:
        return None
    options = {"recursive": False, "directory": verb == "rmdir", "force": False, "verbose": False}
    indices = []
    flags = True
    for i, arg in enumerate(args):
        if flags and arg == "--":
            flags = False
            continue
        if flags and arg.startswith("-"):
            if verb != "rm" or len(arg) < 2 or any(c not in "rRfdv" for c in arg[1:]):
                return None
            options["recursive"] |= any(c in arg for c in "rR")
            options["directory"] |= "d" in arg
            options["force"] |= "f" in arg
            options["verbose"] |= "v" in arg
        else:
            # No colapsar un padre de enlace, ni quitar la semántica de directorio de / o /.
            if not arg or arg.endswith("/") or arg.endswith("/.") or ".." in arg.split("/") or arg.startswith("//"):
                return None
            indices.append(i)
    if not indices or len(indices) > MAX_PATHS or (verb == "unlink" and len(indices) != 1):
        return None
    return indices, options


def native(verb, args):
    """Ruta fija: nunca volver a entrar en nuestro PATH, ni ejecutar un programa del proyecto."""
    candidates = ("/bin/" + verb, "/usr/bin/" + verb)
    for path in candidates:
        if os.path.isfile(path) and os.access(path, os.X_OK):
            os.execv(path, [verb] + args)
    raise FileNotFoundError("No se encuentra el programa nativo: " + verb)


def ask_main(url, ticket, payload):
    # Sin DNS, proxy, redirecciones ni credencial general del canal. Solo loopback explícito.
    parsed = urlsplit(url)
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or not parsed.port
            or parsed.username or parsed.password or parsed.query or parsed.fragment or not parsed.path):
        return None
    body = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    if len(body) > MAX_BODY or not ticket or len(ticket) > 512 or any(c in ticket for c in "\r\n"):
        return None
    conn = http.client.HTTPConnection("127.0.0.1", parsed.port, timeout=10)
    try:
        conn.request("POST", parsed.path, body=body, headers={
            "Authorization": "Bearer " + ticket, "Content-Type": "application/json"
        })
        reply = conn.getresponse()
        if reply.status != 200:
            return None
        data = reply.read(MAX_RESPONSE + 1)
        if len(data) > MAX_RESPONSE:
            return None
        result = json.loads(data)
        deleted = result.get("deleted") if isinstance(result, dict) else None
        if (not isinstance(deleted, list) or len(deleted) != len(payload["paths"])
                or any(type(v) is not bool for v in deleted)):
            return None
        removed = result.get("removed")
        if payload.get("options", {}).get("verbose") and not isinstance(removed, list):
            return None
        if removed is not None:
            if not isinstance(removed, list) or len(removed) > 20000:
                return None
            for item in removed:
                if (not isinstance(item, dict) or set(item) != {"path", "isDirectory"}
                        or not isinstance(item["path"], str) or type(item["isDirectory"]) is not bool):
                    return None
                path = item["path"]
                if (not os.path.isabs(path) or "\0" in path or path != os.path.abspath(path)
                        or not any(path == root or path.startswith(root + "/") for root in payload["paths"])):
                    return None
        return result
    finally:
        conn.close()


def main(argv=None, environ=None):
    argv = sys.argv if argv is None else argv
    env = os.environ if environ is None else environ
    verb = os.path.basename(argv[0])
    # El lanzador de macOS usa un shell diminuto para admitir un Python cuya ruta tenga espacios.
    # Solo es un prefijo interno al ejecutar la fuente; rm --lazunox-verb sigue siendo opción desconocida.
    if verb not in VERBS and len(argv) >= 3 and argv[1] == "--lazunox-verb" and argv[2] in VERBS:
        verb = argv[2]
        argv = [verb] + argv[3:]
    if verb not in VERBS:
        raise ValueError("El programa debe invocarse como rm, rmdir o unlink")
    args = argv[1:]
    parsed = parse_args(verb, args)
    ticket, url = env.get("LAZUNOX_RM_BILLETE", ""), env.get("LAZUNOX_RM_URL", "")
    if parsed is None or not ticket or not url:
        return native(verb, args)
    indices, options = parsed
    try:
        cwd = os.getcwd()
        paths = [os.path.abspath(args[i]) for i in indices]
        result = ask_main(url, ticket, {
            "action": "delete", "ticket": ticket, "cwd": cwd, "paths": paths, "options": options, "verb": verb
        })
    except (OSError, ValueError, http.client.HTTPException):
        result = None
    if result is None:
        return native(verb, args)
    deleted = result["deleted"]
    removed = {i for i, ok in zip(indices, deleted) if ok}
    if options["verbose"]:
        for item in result["removed"]:
            # Mantener el operando original (absoluto o relativo, con ./ si lo tenía), también
            # para sus descendientes; el servidor devuelve el orden real de unlink/rmdir.
            root_index = next(i for i, root in zip(indices, paths)
                              if item["path"] == root or item["path"].startswith(root + "/"))
            root = os.path.abspath(args[root_index])
            suffix = os.path.relpath(item["path"], root)
            name = args[root_index] if suffix == "." else args[root_index] + "/" + suffix
            if sys.platform == "darwin":
                print(name, flush=True)
            else:
                print(("removed directory " if item["isDirectory"] else "removed ") + repr(name), flush=True)
    if len(removed) == len(indices):
        return 0
    return native(verb, [arg for i, arg in enumerate(args) if i not in removed])


if __name__ == "__main__":
    sys.exit(main())
