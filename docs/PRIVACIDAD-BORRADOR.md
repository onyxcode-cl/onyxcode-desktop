# Política de privacidad — BORRADOR

> **BORRADOR. NO ES TEXTO LEGAL DEFINITIVO.** Lo escribió el equipo técnico para describir lo que hace el cliente. **El
> titular de la app debe revisarlo, completarlo y, idealmente, pasarlo por un abogado antes de publicarlo.** Nada de lo de
> abajo afirma que se cumpla ninguna ley. Los puntos entre corchetes `[por definir]` son decisiones pendientes. La app ya
> no muestra ningún texto de privacidad propio (no hay pantalla de acceso ni «Ajustes › Cuenta»).

**Titular / responsable:** [por definir: nombre, correo de contacto, país]

## 1. Qué datos guardamos

Lazunox **no tiene cuentas ni inicio de sesión** y **no guarda tus datos personales en ningún servidor propio**: no
recogemos tu correo ni ningún identificador tuyo, y no hay un servidor de cuentas. Tus **conversaciones, archivos,
proyectos y claves de IA** se quedan en tu equipo (las claves, en el almacén propio del motor OpenCode). La única excepción es lo que ve el servicio de conexión del
celular si decides activarlo (§3).

## 2. Con quién se conecta la app

Lazunox se conecta solo a:

1. **Tu proveedor de IA** (el que elijas), directamente desde tu equipo y con tus propias claves. Lo que envías a ese
   proveedor se rige por su política, no por esta.
2. **GitHub**, para el aviso de versión nueva: como mucho una consulta al día a su API pública, sin datos tuyos (GitHub
   puede ver, como cualquier sitio web, la dirección IP desde la que consultas). No descarga ni instala nada y se puede
   desactivar en Ajustes → Acerca de.
3. **El servicio de conexión del celular**, solo si activas «También fuera de casa» (ver §3). Es opcional y está apagado
   por defecto.

Eso es todo: no hay telemetría, ni analítica, ni publicidad.

## 3. Control remoto fuera de casa (opcional; apagado por defecto)

Si activas «También fuera de casa» en Ajustes › Celular, tu Mac y tu celular se encuentran a través de un **servicio de conexión** alojado en Cloudflare (Cloudflare, Inc.; [por definir: encargado del tratamiento, país y garantías de la transferencia
internacional, y enlace a su política]). Ese servicio **ve** las direcciones IP de tu Mac y de tu celular, cuándo y cuánto tiempo te conectas, un identificador seudónimo estable de tu Mac y del celular, y los datos técnicos de la conexión (candidatos de red,
que incluyen direcciones IP privadas y públicas, y huellas públicas de cifrado). **No ve** el contenido de tus conversaciones, tu PIN, tus claves ni el código de vinculación: eso viaja cifrado y directo entre tu celular y tu Mac. Cloudflare conserva sus propios
registros operativos según su política; Lazunox no guarda registros ni crea cuentas para esto. El servidor de STUN de Cloudflare ve la IP pública de cada lado; si algún día se activa el relé (TURN), vería también cuántos bytes y cuándo pasan, siempre cifrados.
La página del celular se descarga del mismo proveedor (verá la IP y el navegador del celular al cargarla). Con «Solo esta red» nada de esto ocurre. [por definir: revisión legal antes de publicar.]

## 4. Seguridad

Los datos que la app guarda en tu equipo (por ejemplo, los vínculos de los celulares) se cifran con el Llavero del sistema.
Ninguna medida es infalible. [por definir: contacto para avisar de incidentes.]

## 5. Menores

[por definir: edad mínima de uso.]

## 6. Cambios

Si cambiamos esta política lo indicaremos en la app o en el registro de cambios.

## 7. Marco legal — PENDIENTE DE REVISIÓN POR UN ABOGADO

Este documento debe contrastarse, como mínimo, con:

- **Ley N.º 19.628** sobre protección de la vida privada (Chile) y sus modificaciones;
- **Ley N.º 21.719** (Chile), que crea un nuevo régimen de protección de datos personales y una agencia de protección de datos, con su calendario de entrada en vigencia;
- el **Reglamento (UE) 2016/679 (RGPD)**, si habrá usuarios en la Unión Europea o el Espacio Económico Europeo;
- cualquier otra norma aplicable según dónde vivan los usuarios.

**Este borrador no afirma cumplimiento de ninguna de esas normas.** Falta determinar, entre otras cosas, la base de
licitud de cada tratamiento, si hay obligación de registrar o designar un delegado, el contenido exacto del aviso de
privacidad, el tratamiento de transferencias internacionales y el procedimiento para ejercer derechos.
