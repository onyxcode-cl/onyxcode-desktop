# Probar los conectores locales con una cuenta real (sin darle secretos a nadie)

Lo hace Ben en su propio Mac y en su propio navegador. Nadie (ni un agente) necesita contraseñas, tokens ni el archivo del cliente de Google. Las dos fichas dicen «Aún sin probar con una cuenta real» hasta que esto salga bien; entonces se quita `accountTested` de la ficha y se anota la fecha en `verification` (`docs/CATALOGO.md`).

## Requisitos

- Mac. Ya no hace falta instalar uv ni Node.js a mano (F8-B195): la app descarga los suyos (`userData/runtimes`, fijados en `resources/runtimes/pin.json`) con «Instalar lo necesario»; uno del sistema solo se usa de respaldo.
- Una cuenta de prueba (mejor que la principal). Microsoft: cuenta PERSONAL (Outlook.com, Hotmail, Live), no de trabajo.

## Google (Gmail, Calendar, Drive)

1. Personalización › Conectores › «Gmail, Google Calendar y Google Drive» › Conectar. Lee la ficha, marca las dos casillas, Seguir.
2. Una sola vez, en la consola de Google Cloud (el asistente trae el enlace y los pasos): proyecto, activar Gmail API, Google Calendar API y Google Drive API, pantalla de consentimiento «Externo» con tu cuenta en «Usuarios de prueba», y un ID de cliente de OAuth de tipo **Aplicación de escritorio**. Descarga el JSON.
3. «Elegir el archivo…» y escoge ese JSON. «Instalar» (baja unos 230 MB; unos minutos).
4. En el chat: «Conecta mi cuenta de Google». Se abre el navegador; entra y comprueba que Google pide SOLO permisos de lectura (ver correo, calendario y Drive). Si pide enviar, modificar o borrar, **para y avísanos**.
5. Prueba: «¿Qué tengo en la agenda esta semana?», «Busca el último correo de …». Debe preguntar antes de cada uso.
6. Prueba que no escribe: «Envía un correo a mí mismo», «Crea un evento mañana a las 10», «Borra este correo». Debe decir que no tiene esa herramienta. Si lo hace, **no dar por bueno el conector**.
7. Revisa en https://myaccount.google.com/permissions que la aplicación tiene solo lectura.
8. Quita el conector (Tuyos › Quitar) y comprueba que la carpeta `~/Library/Application Support/Lazunox/conectores-locales/google` ya no existe, y revoca la app en esa misma página de Google.

## Microsoft (Outlook, Calendario, OneDrive)

1. Igual con «Outlook, Calendario y OneDrive» (baja unos 95 MB).
2. En el chat: «Inicia sesión en Microsoft». La IA da una dirección y un código: ábrela, escribe el código y entra con tu cuenta personal. Microsoft debe listar solo permisos de lectura. Luego dile «ya entré».
3. Pruebas: «¿Qué reuniones tengo mañana?», «Busca el último correo de …», «Busca en mi OneDrive …»; y de escritura («Responde este correo», «Borra este archivo»): deben negarse.
4. Quita el conector y revoca la aplicación en https://account.live.com/consent/Manage.

## Si algo falla

Anota el mensaje exacto del asistente (no incluye secretos) y quita el conector: se borra todo.
