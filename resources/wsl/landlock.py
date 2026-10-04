"""Landlock por `ctypes` (F8-B81). Falla CERRADO: sin Landlock con ABI >= LANDLOCK_MIN_ABI no se arranca el servidor.

Equivalente de Seatbelt `file-write-unlink`: sin REMOVE_FILE/REMOVE_DIR/REFER en la carpeta del usuario, borrar y
renombrar caen con EACCES a nivel del núcleo. NO se maneja TRUNCATE (igual que en macOS: queda documentado).
Importarlo no hace nada; solo `apply_policy()` toca el proceso (irreversible, hereda a los hijos).
No se ejecuta en el Mac: las pruebas de la parte pura están en test_protocol.py; esto se valida en el PC (T-W3).
"""
import ctypes
import ctypes.util
import os
import platform

import protocol as P

# Los números de llamada 444-446 son los mismos en x86_64 y aarch64 (tabla unificada).
_SYS = {"create_ruleset": 444, "add_rule": 445, "restrict_self": 446}
LANDLOCK_CREATE_RULESET_VERSION = 1 << 0
LANDLOCK_RULE_PATH_BENEATH = 1
PR_SET_NO_NEW_PRIVS = 38


class LandlockError(Exception):
    pass


class _RulesetAttr(ctypes.Structure):
    _fields_ = [("handled_access_fs", ctypes.c_uint64)]


class _PathBeneath(ctypes.Structure):
    _pack_ = 1
    _fields_ = [("allowed_access", ctypes.c_uint64), ("parent_fd", ctypes.c_int32)]


def _libc():
    lib = ctypes.CDLL(ctypes.util.find_library("c") or "libc.so.6", use_errno=True)
    lib.syscall.restype = ctypes.c_long
    return lib


def abi_version():
    """ABI de Landlock del núcleo (0 si no está disponible o no está activo)."""
    if platform.system() != "Linux":
        return 0
    lib = _libc()
    r = lib.syscall(_SYS["create_ruleset"], None, ctypes.c_size_t(0), ctypes.c_uint32(LANDLOCK_CREATE_RULESET_VERSION))
    return r if r > 0 else 0


def apply_policy(rules, min_abi=P.LANDLOCK_MIN_ABI, optional_system=("/lib64", "/sbin")):
    """Aplica `rules` [{path, access}] al proceso actual. Lanza LandlockError ante cualquier problema."""
    abi = abi_version()
    if abi < min_abi:
        raise LandlockError("Landlock ABI %d < %d: el núcleo de WSL no lo soporta" % (abi, min_abi))
    lib = _libc()
    attr = _RulesetAttr(P.handled_mask())
    fd = lib.syscall(_SYS["create_ruleset"], ctypes.byref(attr), ctypes.c_size_t(ctypes.sizeof(attr)), ctypes.c_uint32(0))
    if fd < 0:
        raise LandlockError("landlock_create_ruleset: errno %d" % ctypes.get_errno())
    try:
        for r in rules:
            path, access = r["path"], r["access"]
            try:
                pfd = os.open(path, os.O_PATH | os.O_CLOEXEC)
            except FileNotFoundError:
                if path in optional_system:
                    continue  # p. ej. /lib64 no existe en Alpine
                raise LandlockError("la ruta de la política no existe: %s" % path)
            try:
                is_dir = os.path.isdir(path)
                mask = P.rights_mask(access)
                if not is_dir:  # sobre un archivo solo valen los derechos de archivo
                    mask &= (1 << P.LANDLOCK_RIGHTS.index("EXECUTE")) | (1 << P.LANDLOCK_RIGHTS.index("WRITE_FILE")) | (
                        1 << P.LANDLOCK_RIGHTS.index("READ_FILE")
                    )
                pb = _PathBeneath(mask, pfd)
                if lib.syscall(_SYS["add_rule"], ctypes.c_int(fd), ctypes.c_int(LANDLOCK_RULE_PATH_BENEATH), ctypes.byref(pb), ctypes.c_uint32(0)) != 0:
                    raise LandlockError("landlock_add_rule(%s): errno %d" % (path, ctypes.get_errno()))
            finally:
                os.close(pfd)
        if lib.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
            raise LandlockError("prctl(NO_NEW_PRIVS): errno %d" % ctypes.get_errno())
        if lib.syscall(_SYS["restrict_self"], ctypes.c_int(fd), ctypes.c_uint32(0)) != 0:
            raise LandlockError("landlock_restrict_self: errno %d" % ctypes.get_errno())
    finally:
        os.close(fd)
