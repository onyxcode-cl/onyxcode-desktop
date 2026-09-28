/*
 * lapis-disclaim — lanza un programa SIN heredar la "responsabilidad" TCC de Lapis.
 *
 * Uso: lapis-disclaim <programa> [args...]
 *
 * macOS atribuye los permisos de privacidad (Accesibilidad, Grabación de pantalla, Automatización…)
 * al "proceso responsable" de una cadena de procesos: por defecto, la app que la inició. Así, todo
 * hijo de Lapis.app (opencode serve → bash → screencapture) usaría los permisos concedidos a Lapis.
 *
 * Este lanzador reemplaza su propia imagen por la del programa (`POSIX_SPAWN_SETEXEC`: mismo PID,
 * mismos descriptores y grupo de procesos, así que el padre lo gestiona igual que si lo hubiera
 * lanzado directamente) marcando el atributo privado "disclaim" de libquarantine/libsystem
 * (`responsibility_spawnattrs_setdisclaim`, resuelto con dlsym). Con él, el nuevo proceso pasa a ser
 * responsable de sí mismo: no hereda ningún permiso TCC, y lo que pida lo pedirá a nombre propio.
 *
 * Si el símbolo no existe (otra versión de macOS), falla cerrado por defecto: sale con código 126 y
 * un mensaje; LAPIS_DISCLAIM_OPTIONAL=1 permite continuar sin disclaim (solo depuración).
 *
 * Implementación propia de Lapis (C estándar + API de spawn de POSIX).
 */
#include <dlfcn.h>
#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

extern char **environ;

typedef int (*setdisclaim_fn)(posix_spawnattr_t *attr, int disclaim);

int main(int argc, char *argv[]) {
  if (argc < 2) {
    fprintf(stderr, "uso: %s <programa> [args...]\n", argv[0]);
    return 64;
  }
  if (argc == 2 && strcmp(argv[1], "--check") == 0) {
    /* Diagnóstico: ¿está disponible la API? */
    void *sym = dlsym(RTLD_DEFAULT, "responsibility_spawnattrs_setdisclaim");
    printf("{\"disclaim\":%s}\n", sym ? "true" : "false");
    return sym ? 0 : 1;
  }

  posix_spawnattr_t attr;
  int rc = posix_spawnattr_init(&attr);
  if (rc != 0) {
    fprintf(stderr, "lapis-disclaim: posix_spawnattr_init: %s\n", strerror(rc));
    return 126;
  }

  setdisclaim_fn setdisclaim = (setdisclaim_fn)dlsym(RTLD_DEFAULT, "responsibility_spawnattrs_setdisclaim");
  if (setdisclaim) {
    rc = setdisclaim(&attr, 1);
    if (rc != 0) {
      fprintf(stderr, "lapis-disclaim: setdisclaim: %s\n", strerror(rc));
      setdisclaim = NULL;
    }
  }
  if (!setdisclaim) {
    const char *optional = getenv("LAPIS_DISCLAIM_OPTIONAL");
    if (!optional || strcmp(optional, "1") != 0) {
      fprintf(stderr, "lapis-disclaim: API de disclaim no disponible; no se lanza %s\n", argv[1]);
      return 126;
    }
    fprintf(stderr, "lapis-disclaim: aviso: sin disclaim (LAPIS_DISCLAIM_OPTIONAL=1)\n");
  }

  /* Reemplazar este proceso (mismo PID) y restablecer señales/máscara a los valores por defecto. */
  sigset_t none, all;
  sigemptyset(&none);
  sigfillset(&all);
  posix_spawnattr_setsigmask(&attr, &none);
  posix_spawnattr_setsigdefault(&attr, &all);
  short flags = POSIX_SPAWN_SETEXEC | POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_SETSIGDEF;
  rc = posix_spawnattr_setflags(&attr, flags);
  if (rc != 0) {
    fprintf(stderr, "lapis-disclaim: setflags: %s\n", strerror(rc));
    return 126;
  }

  pid_t pid = 0;
  /* Con SETEXEC, si tiene éxito no vuelve. Ruta absoluta o búsqueda en PATH. */
  rc = strchr(argv[1], '/') ? posix_spawn(&pid, argv[1], NULL, &attr, &argv[1], environ)
                            : posix_spawnp(&pid, argv[1], NULL, &attr, &argv[1], environ);
  fprintf(stderr, "lapis-disclaim: no se pudo ejecutar %s: %s\n", argv[1], strerror(rc));
  posix_spawnattr_destroy(&attr);
  return rc == ENOENT ? 127 : 126;
}
