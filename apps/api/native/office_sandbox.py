"""Exec the server-selected native binary with inherited, fail-closed network denial.

Linux only. libseccomp is a small distro runtime dependency. AF_UNIX is needed for
LibreOffice's private instance pipe; INET, INET6, packet and other sockets are
denied, including in descendants. No helper shell, inherited network fd, or fallback.
"""
import ctypes
import errno
import os
import socket
import sys


class Comparison(ctypes.Structure):
    _fields_ = [('arg', ctypes.c_uint), ('op', ctypes.c_uint),
                ('a', ctypes.c_uint64), ('b', ctypes.c_uint64)]


def deny_network():
    if sys.platform != 'linux':
        raise RuntimeError('network isolation requires Linux')
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong,
                           ctypes.c_ulong, ctypes.c_ulong]
    libc.prctl.restype = ctypes.c_int
    if libc.prctl(38, 1, 0, 0, 0) != 0:  # PR_SET_NO_NEW_PRIVS
        raise RuntimeError('no_new_privs')
    lib = ctypes.CDLL('libseccomp.so.2', use_errno=True)
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
    lib.seccomp_rule_add_array.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int,
                                         ctypes.c_uint, ctypes.POINTER(Comparison)]
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    context = lib.seccomp_init(0x7fff0000)  # SCMP_ACT_ALLOW
    if not context:
        raise RuntimeError('seccomp init')
    try:
        action = 0x00050000 | errno.EPERM
        for name in (b'socket', b'socketpair', b'socketcall', b'io_uring_setup'):
            syscall = lib.seccomp_syscall_resolve_name(name)
            if syscall < 0:
                continue  # socketcall is absent on x86_64
            comparisons = (Comparison * 1)(Comparison(0, 1, socket.AF_UNIX, 0)) if name in (b'socket', b'socketpair') else None
            if lib.seccomp_rule_add_array(context, action, syscall, 1 if comparisons is not None else 0, comparisons) != 0:
                raise RuntimeError('seccomp rule')
        if lib.seccomp_load(context) != 0:
            raise RuntimeError('seccomp load')
    finally:
        lib.seccomp_release(context)


if __name__ == '__main__':
    try:
        deny_network()
        os.execv(sys.argv[1], sys.argv[1:])
    except Exception:
        sys.exit(1)
