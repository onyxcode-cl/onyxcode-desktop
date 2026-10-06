# Publicar una versión de Lazunox (guion y checklist)

Complementa `docs/DISTRIBUCION.md` (cómo se firma y notariza) y `docs/SEGURIDAD.md` §3 quinquies y septies (cómo se verifica una actualización).
Aquí está el **orden** de una publicación, quién hace cada paso y qué hacer si algo sale mal.

## 0. Resumen

| Quién | Paso |
|---|---|
| Tú | Subes la versión y las notas, corres `npm run verify` en tu Mac, creas y empujas el tag `vX.Y.Z`. |
| GitHub Actions (`release.yml`) | Espera tu **aprobación manual** (entorno `release`), firma, notariza, verifica y crea un **BORRADOR** de release con `.dmg`, `.zip` y `update.json` **sin firmar**. Nunca publica. |
| Tú, en tu Mac | Descargas `update.json` y el `.zip`, los firmas con la clave Ed25519 (`sign-update.mjs`) y subes `update.json.sig` al borrador. |
| Tú | Revisas el borrador y pulsas **Publish release** (sin marcar «pre-release», salvo una beta). |
| Tú | Compruebas en un Mac limpio (sección 6). |

La clave privada Ed25519 **nunca** va a GitHub: por eso la firma del manifiesto se hace en dos pasos. Los secretos de Apple sí viven en GitHub (solo en el
entorno protegido `release`), con la mitigación de la sección 9.

## 1. Una sola vez (lo hace el dueño; no lo automatiza ningún agente)

- [ ] Repositorio público de releases, entorno `release` con **Required reviewers** = tú, tags `v*` protegidos, verificación en dos pasos en la cuenta.
- [ ] `RELEASES_REPO`, `AUTHOR_ALIAS` y `UPDATE_PUBLIC_KEY` definidos en `src/shared/brand.ts` (`npm run verify:release` los exige).
- [ ] Par de claves Ed25519 (`docs/DISTRIBUCION.md` §10.1) con copia de la privada en el gestor de contraseñas.
- [ ] Alta en Apple Developer Program, certificado **Developer ID Application** exportado como `.p12`, clave API de App Store Connect (`docs/DISTRIBUCION.md` §1 y §2.1).
- [ ] Secretos en **Settings › Environments › release** (no a nivel de repositorio): `MAC_CERT_P12_BASE64` (`base64 -i certificado.p12 | pbcopy`), `MAC_CERT_PASSWORD`,
  `APPLE_API_KEY_P8` (contenido completo del `.p8`), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`. **La clave Ed25519 no va aquí.** Borra después el `.p12` y el `.p8` del Escritorio.
- [ ] Con el Team ID: rellena `UPDATE_TEAM_ID` (sección 8) y comprueba una release de prueba en un repositorio privado.

## 2. Antes de etiquetar

- [ ] `package.json` › `version` = la nueva (`X.Y.Z`; beta: `X.Y.Z-beta.N`). El tag **debe** ser `v` + esa versión (el workflow y el manifiesto lo exigen).
- [ ] `CHANGELOG.md`: mueve lo de «Sin publicar» a una sección `## [X.Y.Z] - AAAA-MM-DD` con lenguaje llano (es el cuerpo de la release: `node scripts/release-notes.mjs X.Y.Z` debe imprimirlo).
- [ ] Si cambia la identidad de firma respecto a la versión anterior (p. ej. de autofirmado a Developer ID), dilo en las notas (riesgo R2 del plan): macOS preguntará **una vez** por la clave del Llavero «Lazunox Safe Storage» y volverá a pedir Accesibilidad, Grabación de pantalla y Micrófono. «Elige **Permitir siempre**; **nunca** “Restaurar configuración”» (crearía un llavero vacío y perderías la sesión y los datos cifrados).
- [ ] En tu Mac: `npm run verify` completo (incluye el E2E con Electron, que el CI **no** corre) y `npm run verify:release`.
- [ ] Prueba del actualizador de punta a punta si tocaste `src/main/update`, `swap.sh` o la firma (`docs/DISTRIBUCION.md` §11).

## 3. Crear el borrador (CI)

```bash
git tag vX.Y.Z && git push origin vX.Y.Z      # lo haces tú; protegido en el repositorio
```

1. El workflow **Release (borrador)** queda a la espera: abre la ejecución en la pestaña Actions y pulsa **Review deployments › release › Approve**.
2. Hace: `npm ci` → comprueba tag = versión → `verify:release` → typecheck, lint, formato, pruebas → importa el `.p12` en un llavero temporal → escribe el `.p8` en `$RUNNER_TEMP` → `npm run package` (firma, vuelve a firmar helpers con su identificador, notariza `.app` y `.dmg`) → `verify:bundled` y `verify:signed --expect devid` → `publish-update.mjs --manifest-only` → **borrador** con `.dmg`, `.zip` y `update.json` → borra llavero y `.p8`.
3. Si falla, no hay borrador. Lee el log; los fallos de notarización dicen qué variable falta (`APPLE_API_KEY_ID`…).

## 4. Firmar el manifiesto (en tu Mac)

```bash
mkdir -p ~/Descargas/lazunox-X.Y.Z && cd ~/Descargas/lazunox-X.Y.Z
gh release download vX.Y.Z --repo <owner>/<repo> --pattern 'update.json' --pattern '*.zip'
cd <ruta al repositorio de Lazunox>
LAZUNOX_UPDATE_KEY_FILE=~/.lazunox-keys/update.pem node scripts/sign-update.mjs --dir ~/Descargas/lazunox-X.Y.Z
node scripts/verify-update.mjs --dir ~/Descargas/lazunox-X.Y.Z
gh release upload vX.Y.Z ~/Descargas/lazunox-X.Y.Z/update.json.sig --repo <owner>/<repo>
```

`sign-update.mjs` se niega a firmar si el ZIP no coincide en tamaño y SHA-256 con el manifiesto, si el appId o el keyId no son los de `brand.ts`, si la clave no corresponde a `UPDATE_PUBLIC_KEY`, o si la clave está dentro del repositorio o con permisos más abiertos que `0600`. **Eso no sustituye a revisar el borrador:** firmar es declarar que ese ZIP es legítimo.

## 5. Publicar

- [ ] El borrador tiene **cuatro** archivos: `.dmg`, `Lazunox-X.Y.Z-arm64.zip`, `update.json`, `update.json.sig`, y las notas correctas.
- [ ] **Publish release**, sin «pre-release» (con una prerelease, `/releases/latest` no la devuelve y nadie del canal estable recibe el aviso). Una beta (`-beta.N`) sí se marca como pre-release: el workflow ya lo hace.

## 6. Comprobación posterior en un Mac limpio

- [ ] Un Mac (o usuario) que **nunca** tuvo Lazunox: descarga el `.dmg` de la release → abre **sin avisos** de Gatekeeper.
- [ ] `npm run verify:signed -- --expect devid --team <TEAM> --app <ruta al .app instalado> --dmg <ruta al .dmg descargado>`.
- [ ] Con la versión anterior instalada: Ajustes › aviso de versión nueva → **Actualizar** → descarga, verifica, reinicia → la versión nueva arranca y los permisos se conservan.
- [ ] Si no aparece el aviso: ¿la release está como prerelease o borrador? ¿`update.json.sig` subido? (R8 del plan).

## 7. Canal beta (apagado por defecto)

`src/main/update/channel.ts` implementa la selección (`GET /releases?per_page=10`, semver mayor incluidas las prereleases, `0.4.0-beta.1 < 0.4.0`) y `UpdateChecker` acepta `channel: () => 'stable' | 'beta'`, pero **nada en Ajustes lo activa todavía** y el instalador (`validateManifest` en `src/shared/update-install.ts`) sigue rechazando versiones con prerelease cuando la instalada es estable. Pendiente para activarlo: opción «Recibir versiones beta» en Ajustes › Acerca de, cablear el canal en `src/main/ipc/update.ts` y admitir prereleases en `validateManifest`. Hasta entonces una beta solo sirve para repartir el `.dmg` a mano.

## 8. Fijar el equipo de Apple en el actualizador (`UPDATE_TEAM_ID`)

Pon el Team ID (10 caracteres) en `UPDATE_TEAM_ID` de `src/main/update/config.ts` **en la primera versión que se firme con Developer ID**. Con valor, la app instalada exige que la actualización descargada esté firmada por ese equipo (`codesign --verify -R='anchor apple generic and certificate leaf[subject.OU] = "<TEAM>"'`), como defensa adicional a la firma Ed25519; un valor mal formado falla cerrado. Vacío = solo se comprueba el identificador (comportamiento actual). Las copias anteriores (autofirmadas, con el valor vacío) siguen aceptando esa primera actualización sin comprobar equipo; las que ya lo llevan exigirán el mismo equipo en las siguientes. Si algún día cambia el Team ID (sección 12), la versión que lo cambie debe publicarse todavía firmada por el equipo antiguo.

## 9. Riesgos del CI y mitigaciones

- Quien robe tu cuenta de GitHub podría firmar y notarizar malware con tu nombre. Mitigación: entorno con aprobación obligatoria, tags protegidos, verificación en dos pasos, acciones fijadas por SHA de commit, y que el borrador **no** se publica sin tu firma Ed25519 (la clave solo está en tu Mac). Alternativa más segura: empaquetar y firmar todo en local y no guardar secretos de Apple en GitHub.
- Permisos del workflow: solo lectura salvo `contents: write` en el job que crea el borrador. `ci.yml` no usa secretos.
- Para actualizar una acción: `gh api repos/<acción>/git/ref/tags/<etiqueta>` y cambia el SHA (y el comentario con la versión).

## 10. Política de rollback

Principio: **siempre hacia delante**. Una versión mala no se «retira» de los Mac que ya la instalaron; se publica otra mejor.

1. **Automático en el cliente.** `swap.sh` vuelve a la versión anterior si la nueva no confirma el arranque en 90 s (probado en `swap.integration.test.ts`). Es la red de seguridad para una versión que no arranca.
2. **Release mala que nadie ha instalado aún** (la acabas de publicar): vuelve a poner la release como **borrador** (Edit › Set as draft). `/releases/latest` vuelve a la anterior y el aviso desaparece para quien no la había recibido.
3. **Usuarios que ya actualizaron:** publica `X.Y.Z+1` con el código bueno (revierte el cambio con `git revert`, sube la versión, repite desde la sección 2). El **anti-downgrade** impide bajar de versión y es intencional: protege contra que alguien reinyecte una versión vieja y vulnerable. No existe «bajar a la anterior» desde la app.
4. **Clave Ed25519 filtrada o perdida:** ver sección 11.
5. **Certificado de Apple comprometido:** sección 12.

## 11. Claves: rotación y lista de pasos

El cliente verifica el manifiesto con una **lista** de claves (`verifyWithKeys`; `resolveInstallConfig` admite `updateKeys` extra; probado en `manifest-two-step.test.ts`). Falta que `src/shared/brand.ts` exponga esa lista (hoy `UPDATE_PUBLIC_KEY` + `UPDATE_KEY_ID`) y cablearla en `src/main/ipc/update.ts`: hazlo **antes de la primera release**, porque una app ya publicada solo conoce las claves con las que salió.

Rotación (sospecha de filtración o renovación periódica):
1. [ ] Genera la clave nueva (`docs/DISTRIBUCION.md` §10.1) con otro `keyId` (`lazunox-2`). Guárdala en el gestor de contraseñas.
2. [ ] Versión **N**: lleva `[lazunox-2 (nueva), lazunox-1 (vieja)]` y se **firma con la vieja**, para que la acepten las copias anteriores (que solo conocen la vieja).
3. [ ] Versión **N+1**: se firma con la **nueva**. El manifiesto lleva `keyId: lazunox-2`; `brand.ts` pone `UPDATE_KEY_ID = 'lazunox-2'`.
4. [ ] Cuando casi nadie use versiones anteriores a N, retira la vieja de la lista en N+2.
5. [ ] Si la vieja se filtró: asume que quien la tenga puede firmar «actualizaciones» que las copias antiguas aceptarán hasta que actualicen a N. Publica N cuanto antes, avisa a los usuarios (web y notas de la release) y recomienda descargar el `.dmg` de N a mano.
6. [ ] Si **perdiste** la privada y no se filtró: no hay actualización automática posible desde las copias antiguas; publica un `.dmg` nuevo con la clave nueva y que cada usuario lo instale a mano.

## 12. Certificado de Apple comprometido o revocado

1. [ ] Revócalo en developer.apple.com › Certificates (pide a Apple la revocación si hay sospecha de uso indebido). Las apps ya notarizadas siguen abriendo si la revocación lleva fecha; las firmadas después con ese certificado no.
2. [ ] Crea otro Developer ID Application, actualiza `MAC_CERT_P12_BASE64` y `MAC_CERT_PASSWORD` en el entorno `release`, y la clave API si también se expuso (revócala en App Store Connect).
3. [ ] Si el Team ID cambia (cuenta nueva), actualiza `UPDATE_TEAM_ID` **en una versión firmada todavía por el equipo antiguo** (sección 8); si no, las copias instaladas rechazarán la actualización.
4. [ ] Publica una versión nueva firmada con el certificado nuevo (flujo normal).

## 13. Si decides otro nombre (simulación)

**Renombre total aplicado (0.5.0, Lazunox).** La identidad es única (`DISPLAY_NAME` === `INTERNAL_NAME`) y la 0.5.0 es una instalación nueva. Invariantes que NO se tocan sin un plan de migración
(los vigila `src/test/identity-freeze.test.ts`): `package.json` `name`/`productName`, `appId` `cl.bentec.lazunox`, `app.setName(INTERNAL_NAME)` (clave del
Llavero) y ningún `setPath('userData')`, `APP_SLUG`, `UPDATE_KEY_ID`, `SITE_KEY_ID`, `Lazunox.app`, nombre del DMG/ZIP, protocolo `lazunox://`, dominio y
certificado. Ni `CFBundleName` ni `CFBundleExecutable` se sobrescriben (Electron localiza sus helpers con ellos). Los celulares vinculados antes de la 0.5.0 deben vincularse de nuevo (cambian las etiquetas criptográficas) y los iconos de la PWA ya instalados
conservan la etiqueta antigua hasta reinstalarlos. La marca no está verificada: no publicar antes de ese paso.

El nombre y el identificador (`appId`) están en cada copia instalada: si cambian **después** de publicar, las copias existentes no pueden actualizarse solas a la nueva. Decídelo **antes** de la primera versión pública. Para ver todo lo que cambiaría, sin tocar nada:

```bash
node scripts/rename-app.mjs --dry-run --name NuevoNombre --alias nuevoalias
node scripts/rename-app.mjs --dry-run --json > cambios.json     # lista completa, legible por máquina
```

El script **no aplica nada**: lista productName, appId, identificadores de helpers, rutas de datos, textos, i18n y docs afectados.

## 14. Licencia

`LICENSE` es MIT («Copyright (c) 2026 onyxcode-cl»; TODO D10: el titular sigue pendiente de decisión del dueño y no se ha tocado) y `THIRD_PARTY_NOTICES.md` lo refleja. Falta tu confirmación (titular, MIT u otra, y que tu empleador no reclame el proyecto): si cambias algo, edita ambos ficheros a la vez. `npm run verify:release` falla si se contradicen.
