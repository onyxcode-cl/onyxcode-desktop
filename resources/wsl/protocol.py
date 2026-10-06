"""Parte PURA del lanzador de Tareas en WSL (Lazunox, F8-B81): tramas, validación de la trama inicial y tablas.

Sin llamadas al sistema privilegiadas: se puede importar y probar en cualquier plataforma (`test_protocol.py`).
El formato de trama es el de `src/main/tasks/backends/bridge-protocol.ts` (vectores compartidos en vectors.json):

    [id:u32 BE][tipo:u8][len:u32 BE][datos...]      len <= MAX_FRAME_DATA

Todo lo que viene de Windows (la trama INIT) se trata como NO CONFIABLE: se valida con una lista cerrada y, ante
cualquier duda, se rechaza (ProtocolError). La clave real de un proveedor nunca debe llegar aquí (no hay forma de
pedirla) y el entorno solo admite prefijos conocidos.
"""
import json
import re
import struct

HEADER = struct.Struct(">IBI")
HEADER_SIZE = HEADER.size  # 9
MAX_FRAME_DATA = 1024 * 1024
MAX_STREAMS = 256
MAX_INIT_BYTES = 64 * 1024
INITIAL_WINDOW = 256 * 1024
PROTOCOL_VERSION = 1

INIT, OPEN, DATA, CLOSE, ERROR, WINDOW, PING, PONG, READY, EXIT = range(1, 11)
VALID_TYPES = frozenset(range(1, 11))

ERROR_CODES = {
    "frame_too_large": 1,
    "bad_type": 2,
    "bad_id": 3,
    "too_many_streams": 4,
    "bad_payload": 5,
    "stream_unknown": 6,
    "port_denied": 7,
    "window_exceeded": 8,
    "init_invalid": 9,
    "init_secret": 10,
    "closed": 11,
    "internal": 12,
}

WSL_USER = "lazunox"
WSL_UID = 1000
OPENCODE_BIN = "/opt/lazunox/bin/opencode"


class ProtocolError(Exception):
    def __init__(self, code, message=None):
        super().__init__(message or code)
        self.code = code


def id_owner(i):
    """0 control, impares los abre Windows ('host'), pares el agente ('agent')."""
    if i == 0:
        return "control"
    return "host" if i % 2 == 1 else "agent"


def encode_frame(i, t, data=b""):
    if not isinstance(i, int) or i < 0 or i > 0xFFFFFFFF:
        raise ProtocolError("bad_id")
    if t not in VALID_TYPES:
        raise ProtocolError("bad_type")
    if len(data) > MAX_FRAME_DATA:
        raise ProtocolError("frame_too_large")
    return HEADER.pack(i, t, len(data)) + bytes(data)


class FrameDecoder:
    """Decodificador incremental; tras un error queda envenenado (la sesión se corta)."""

    def __init__(self):
        self._buf = bytearray()
        self.failure = None

    def push(self, chunk):
        if self.failure:
            raise self.failure
        self._buf += chunk
        frames = []
        while len(self._buf) >= HEADER_SIZE:
            i, t, n = HEADER.unpack_from(self._buf, 0)
            if t not in VALID_TYPES:
                self._fail("bad_type")
            if n > MAX_FRAME_DATA:
                self._fail("frame_too_large")
            if len(self._buf) < HEADER_SIZE + n:
                break
            frames.append((i, t, bytes(self._buf[HEADER_SIZE : HEADER_SIZE + n])))
            del self._buf[: HEADER_SIZE + n]
        return frames

    def _fail(self, code):
        self.failure = ProtocolError(code)
        self._buf = bytearray()
        raise self.failure


def encode_port(p):
    if not isinstance(p, int) or p < 1 or p > 65535:
        raise ProtocolError("bad_payload", "puerto")
    return struct.pack(">H", p)


def decode_port(data):
    if len(data) != 2:
        raise ProtocolError("bad_payload", "OPEN")
    (p,) = struct.unpack(">H", data)
    if p < 1:
        raise ProtocolError("bad_payload", "puerto 0")
    return p


def encode_window(n):
    if not isinstance(n, int) or n < 0 or n > 0xFFFFFFFF:
        raise ProtocolError("bad_payload", "WINDOW")
    return struct.pack(">I", n)


def decode_window(data):
    if len(data) != 4:
        raise ProtocolError("bad_payload", "WINDOW")
    return struct.unpack(">I", data)[0]


def encode_error(code, message=""):
    return struct.pack(">H", ERROR_CODES[code]) + message.encode("utf-8")[:256]


def encode_exit(code):
    return struct.pack(">i", code)


# ───────────────────────── Landlock (tabla compartida con wsl-spec.ts) ─────────────────────────

LANDLOCK_RIGHTS = [
    "EXECUTE", "WRITE_FILE", "READ_FILE", "READ_DIR", "REMOVE_DIR", "REMOVE_FILE", "MAKE_CHAR",
    "MAKE_DIR", "MAKE_REG", "MAKE_SOCK", "MAKE_FIFO", "MAKE_BLOCK", "MAKE_SYM", "REFER",
]  # el índice es el bit (1 << i); TRUNCATE (ABI 3) NO se maneja, como en macOS
LANDLOCK_MIN_ABI = 2

LANDLOCK_ACCESS = {
    "rx": ["EXECUTE", "READ_FILE", "READ_DIR"],
    "ro": ["READ_FILE", "READ_DIR"],
    "dev": ["READ_FILE", "READ_DIR", "WRITE_FILE"],
    "rw-nodelete": ["READ_FILE", "READ_DIR", "WRITE_FILE", "MAKE_REG", "MAKE_DIR"],
    "rw-delete": ["READ_FILE", "READ_DIR", "WRITE_FILE", "MAKE_REG", "MAKE_DIR", "REMOVE_FILE", "REMOVE_DIR", "REFER"],
    "private": list(LANDLOCK_RIGHTS),
}

SYSTEM_RULES = [
    ("/usr", "rx"), ("/lib", "rx"), ("/lib64", "rx"), ("/bin", "rx"), ("/sbin", "rx"),
    ("/etc", "ro"), ("/opt/lazunox", "rx"), ("/proc", "ro"), ("/dev", "dev"),
]


def rights_mask(access):
    mask = 0
    for r in LANDLOCK_ACCESS[access]:
        mask |= 1 << LANDLOCK_RIGHTS.index(r)
    return mask


def handled_mask():
    return (1 << len(LANDLOCK_RIGHTS)) - 1


# ───────────────────────── Montajes ─────────────────────────


def drvfs_options(mode):
    """Opciones de `mount -t drvfs`: SIEMPRE noexec,nosuid,nodev (cierra la ejecución directa de .exe)."""
    if mode not in ("rw", "ro"):
        raise ProtocolError("init_invalid", "modo de montaje")
    return "noexec,nosuid,nodev,%suid=%d,gid=%d" % ("ro," if mode == "ro" else "", WSL_UID, WSL_UID)


_RESERVED = re.compile(r"^(?:con|prn|aux|nul|conin\$|conout\$|clock\$|com[0-9]|lpt[0-9])$", re.I)


def _segment_ok(seg):
    if seg in ("", ".", ".."):
        return False
    if len(seg) > 255 or any(ord(c) < 32 or ord(c) == 127 for c in seg):
        return False
    if any(c in seg for c in ':<>"|?*\\'):
        return False
    if seg.endswith(".") or seg.endswith(" "):
        return False
    if _RESERVED.match(seg.split(".")[0].rstrip(" ")):
        return False
    if re.search(r"~[0-9]", seg):
        return False
    return True


def valid_mount_linux(path):
    """`/win/<letra>` o `/win/<letra>/seg/...` con segmentos válidos de Windows."""
    if not isinstance(path, str) or len(path) > 4096:
        return False
    m = re.match(r"^/win/([a-z])((?:/[^/]+)*)$", path)
    if not m:
        return False
    return all(_segment_ok(s) for s in m.group(2).split("/")[1:])


def win_matches_linux(win, linux):
    """`C:\\a\\b` debe corresponder EXACTAMENTE (sin distinguir mayúsculas) con `/win/c/a/b`."""
    if not isinstance(win, str) or not re.match(r"^[A-Za-z]:\\", win):
        return False
    segs = [s for s in win[3:].split("\\") if s != ""]
    expected = "/".join(["/win", win[0].lower()] + segs)
    return expected.lower() == linux.lower()


# ───────────────────────── Validación de la trama INIT ─────────────────────────

_KEY = re.compile(r"^[0-9a-f]{16}$")
_ENV_KEY = re.compile(
    r"^(?:OPENCODE_[A-Z0-9_]+|LAZUNOX_[A-Z0-9_]+|(?:HTTPS?|ALL|NO)_PROXY|(?:https?|all|no)_proxy|LANG|LC_ALL|TZ)$"
)
_PLACEHOLDER = re.compile(r"^sandboxed-placeholder-[0-9a-f]{16}$")
MAX_ENV_TOTAL = 32 * 1024


def _inside(path, base):
    return path == base or path.startswith(base.rstrip("/") + "/")


def _port(p):
    return isinstance(p, int) and not isinstance(p, bool) and 1 <= p <= 65535


def validate_init(raw):
    """Parsea y valida el JSON de INIT. Devuelve el dict o lanza ProtocolError('init_invalid'|'init_secret')."""
    if isinstance(raw, (bytes, bytearray)):
        if len(raw) > MAX_INIT_BYTES:
            raise ProtocolError("init_invalid", "INIT demasiado grande")
        try:
            raw = raw.decode("utf-8")
        except UnicodeDecodeError:
            raise ProtocolError("init_invalid", "no es UTF-8")
    try:
        init = json.loads(raw)
    except ValueError:
        raise ProtocolError("init_invalid", "no es JSON")
    bad = lambda why: ProtocolError("init_invalid", why)  # noqa: E731
    if not isinstance(init, dict):
        raise bad("no es un objeto")
    allowed_keys = {"v", "sandboxKey", "mounts", "relayPorts", "serverPort", "serveArgs", "cwd", "env", "landlock"}
    if set(init) != allowed_keys:
        raise bad("claves inesperadas")
    if init["v"] != PROTOCOL_VERSION:
        raise bad("versión")
    key = init["sandboxKey"]
    if not isinstance(key, str) or not _KEY.match(key):
        raise bad("sandboxKey")

    mounts = init["mounts"]
    if not isinstance(mounts, list) or not 1 <= len(mounts) <= 16:
        raise bad("mounts")
    seen = set()
    for m in mounts:
        if not isinstance(m, dict) or set(m) != {"win", "linux", "mode"}:
            raise bad("mount")
        if m["mode"] not in ("rw", "ro"):
            raise bad("mode")
        if not valid_mount_linux(m["linux"]) or not win_matches_linux(m["win"], m["linux"]):
            raise bad("ruta de montaje fuera de /win o incoherente")
        if m["linux"].lower() in seen:
            raise bad("montaje duplicado")
        seen.add(m["linux"].lower())
    if mounts[0]["mode"] != "rw":
        raise bad("la carpeta principal es rw")
    main = mounts[0]["linux"]
    if init["cwd"] != main:
        raise bad("cwd")

    ports = init["relayPorts"]
    if not isinstance(ports, list) or len(ports) > 64 or not all(_port(p) for p in ports) or len(set(ports)) != len(ports):
        raise bad("relayPorts")
    if not _port(init["serverPort"]):
        raise bad("serverPort")
    args = init["serveArgs"]
    if not isinstance(args, list) or not 1 <= len(args) <= 64 or args[0] != "serve":
        raise bad("serveArgs")
    if not all(isinstance(a, str) and "\x00" not in a and len(a) < 2048 for a in args):
        raise bad("serveArgs")

    env = init["env"]
    if not isinstance(env, dict):
        raise bad("env")
    total = 0
    for k, v in env.items():
        if not isinstance(v, str) or "\x00" in v or not _ENV_KEY.match(k):
            raise bad("variable de entorno no permitida: %r" % (k,))
        total += len(k) + len(v)
        if k == "OPENCODE_AUTH_CONTENT":
            _assert_placeholder_auth(v)
    if total > MAX_ENV_TOTAL:
        raise bad("env demasiado grande")

    ll = init["landlock"]
    if not isinstance(ll, dict) or set(ll) != {"minAbi", "rules"}:
        raise bad("landlock")
    if not isinstance(ll["minAbi"], int) or ll["minAbi"] < LANDLOCK_MIN_ABI:
        raise bad("minAbi")
    mount_modes = {m["linux"]: m["mode"] for m in mounts}
    sys_paths = {p for p, _ in SYSTEM_RULES}
    xdg, tmp = "/home/%s/xdg/%s" % (WSL_USER, key), "/tmp/lazunox-%s" % key
    rules = ll["rules"]
    if not isinstance(rules, list) or len(rules) > 128:
        raise bad("rules")
    for r in rules:
        if not isinstance(r, dict) or set(r) != {"path", "access"} or r["access"] not in LANDLOCK_ACCESS:
            raise bad("regla")
        p, a = r["path"], r["access"]
        if not isinstance(p, str) or not p.startswith("/") or "\x00" in p or ".." in p.split("/") or p != p.rstrip("/") and p != "/":
            raise bad("ruta de regla")
        if p in sys_paths:
            if (p, a) not in SYSTEM_RULES:
                raise bad("regla de sistema alterada")
        elif p in (xdg, tmp):
            if a != "private":
                raise bad("regla privada alterada")
        elif p in mount_modes:
            if mount_modes[p] == "ro" and a != "ro":
                raise bad("montaje ro con escritura")
            if mount_modes[p] == "rw" and a not in ("rw-nodelete", "rw-delete"):
                raise bad("montaje rw con acceso inválido")
            if a == "rw-delete" and p != main:
                raise bad("solo la carpeta principal puede borrar")
        elif _inside(p, main) and valid_mount_linux(p) and a == "rw-delete":
            pass  # scratch dentro de la principal
        else:
            raise bad("regla fuera de la política: %r" % (p,))
    paths = [r["path"] for r in rules]
    if len(set(paths)) != len(paths):
        raise bad("regla duplicada")
    for p, a in SYSTEM_RULES:
        if (p, a) not in [(r["path"], r["access"]) for r in rules]:
            raise bad("falta una regla de sistema")
    if (xdg, "private") not in [(r["path"], r["access"]) for r in rules]:
        raise bad("falta la regla privada")
    return init


def _assert_placeholder_auth(content):
    try:
        parsed = json.loads(content)
    except ValueError:
        raise ProtocolError("init_secret", "OPENCODE_AUTH_CONTENT no es JSON")
    if not isinstance(parsed, dict):
        raise ProtocolError("init_secret")
    for entry in parsed.values():
        if (
            not isinstance(entry, dict)
            or set(entry) != {"type", "key"}
            or entry["type"] != "api"
            or not isinstance(entry["key"], str)
            or not _PLACEHOLDER.match(entry["key"])
        ):
            raise ProtocolError("init_secret", "no es un centinela")
