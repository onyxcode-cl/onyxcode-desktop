# Política de privacidad — BORRADOR

> **BORRADOR. NO ES TEXTO LEGAL DEFINITIVO.** Lo escribió el equipo técnico para describir lo que hace el cliente y lo
> que el servidor de cuentas debería hacer. **El titular de la app debe revisarlo, completarlo y, idealmente, pasarlo
> por un abogado antes de publicarlo.** Nada de lo de abajo afirma que se cumpla ninguna ley. Los puntos entre
> corchetes `[por definir]` son decisiones pendientes. Se publicará en la URL de `PRIVACY_URL` (`src/shared/brand.ts`);
> mientras esté vacía, la app muestra una versión corta del borrador (`src/shared/account-legal.ts`; mantenerlas al día).

**Titular / responsable:** [por definir: nombre, correo de contacto, país]

## 1. Qué datos guardamos

Solo si creas una cuenta:

- Tu **correo electrónico**.
- Si entras con Google: el **identificador de esa cuenta de Google** (no su contraseña; no accedemos a tu Gmail ni a tus contactos).
- La **fecha de creación** de la cuenta y la de tu **último acceso**.
- Datos técnicos mínimos para operar y proteger el servicio (ver «Registros técnicos»).

**No** guardamos tus conversaciones, archivos, proyectos ni tus claves de IA: todo eso se queda en tu Mac. La
app habla con el proveedor de IA que elijas directamente desde tu equipo.

## 2. Para qué los usamos (finalidad)

1. **Gestionar tu cuenta** (entrar, cerrar sesión, recuperar el acceso, borrar la cuenta).
2. **Contar usuarios** (cuántas personas usan la app), de forma agregada.
3. **Avisos del servicio**: códigos de acceso y cambios importantes del servicio o de estas condiciones.

No usamos tus datos para publicidad. [por definir: confirmar si habrá otros usos; cualquier uso nuevo requiere actualizar este texto.]

## 3. Cuánto tiempo los conservamos

| Dato | Plazo |
|---|---|
| Cuenta (correo, proveedor, fechas) | Mientras exista la cuenta, hasta que la borres |
| Cuenta sin acceso | Se borra tras **24 meses sin acceso**, con aviso previo por correo [por definir: antelación, p. ej. 30 días] |
| Registros técnicos del servidor | **7 días**, sin correo, IP, token ni código |
| Copias de seguridad | Hasta **30 días** desde el borrado |
| Códigos de acceso por correo | Se guardan solo como huella, válidos 10 minutos |

## 4. Tus derechos

Puedes, desde **Ajustes › Cuenta**: **descargar tus datos** (archivo JSON con lo que guardamos) y **borrar tu cuenta**.
También puedes pedirnos por correo [contacto por definir] acceder a tus datos, corregirlos o suprimirlos, o
preguntarnos por su tratamiento. [por definir: plazo de respuesta, vía para reclamos, autoridad competente.]

## 5. Con quién los compartimos

No está previsto vender ni ceder tus datos. Para operar el servicio pueden intervenir **proveedores** [por definir:
alojamiento, envío de correo, etc.; indicar país y garantías si hay transferencia internacional]. Si entras con
Google, Google trata esa autenticación según su propia política.

## 6. Seguridad

La sesión en tu Mac se guarda cifrada con el Llavero de macOS; los códigos y sesiones se guardan en el servidor solo como
huellas; las conexiones usan HTTPS. Ninguna medida es infalible. [por definir: contacto para avisar de incidentes.]

## 7. Menores

[por definir: edad mínima de uso.]

## 8. Cambios

Si cambiamos esta política te avisaremos en la app o por correo.

## 9. Marco legal — PENDIENTE DE REVISIÓN POR UN ABOGADO

Este documento debe contrastarse, como mínimo, con:

- **Ley N.º 19.628** sobre protección de la vida privada (Chile) y sus modificaciones;
- **Ley N.º 21.719** (Chile), que crea un nuevo régimen de protección de datos personales y una agencia de protección de datos, con su calendario de entrada en vigencia;
- el **Reglamento (UE) 2016/679 (RGPD)**, si habrá usuarios en la Unión Europea o el Espacio Económico Europeo;
- cualquier otra norma aplicable según dónde vivan los usuarios.

**Este borrador no afirma cumplimiento de ninguna de esas normas.** Falta determinar, entre otras cosas, la base de
licitud de cada tratamiento, si hay obligación de registrar o designar un delegado, el contenido exacto del aviso de
privacidad, el tratamiento de transferencias internacionales y el procedimiento para ejercer derechos.
