# TrueLead Functional MVP

TrueLead es una plataforma separada para agencias que mide leads reales de WhatsApp, administra clientes/proyectos y envía conversiones confirmadas a Meta Conversions API.

## Qué incluye esta versión

- Website público con estética TrueLead.
- Registro/login.
- Dashboard funcional para agencias.
- Panel de administrador para validar cuentas y pagos manuales.
- Gestión de clientes.
- Gestión de proyectos/landings.
- Generación de `projectPublicId` para integrar landings.
- Endpoint público para crear preleads.
- Confirmación manual de leads por código.
- Webhook preparado para confirmar leads desde un conector de WhatsApp.
- Envío real a Meta Conversions API si configurás Pixel ID + CAPI token.
- Base de datos JSON persistente para MVP.
- `render.yaml` preparado para desplegar en Render con persistent disk.

## Usuarios de prueba

En el primer inicio se crea automáticamente un administrador:

```txt
Email: admin@truelead.local
Contraseña: TrueLeadAdmin123!
```

En producción cambiá esto en Render con:

```env
ADMIN_EMAIL=tu-email
ADMIN_PASSWORD=una-clave-segura
JWT_SECRET=un-secreto-largo
```

## Ejecutar local

```bash
npm install
cp .env.example .env
npm start
```

Abrí:

```txt
http://localhost:3000
```

## Flujo de uso

1. Entrá como admin.
2. Validá o creá cuentas de agencia.
3. Desde una cuenta agencia, creá un cliente.
4. Creá un proyecto con:
   - dominio,
   - WhatsApp destino,
   - Pixel ID,
   - Meta CAPI token.
5. Copiá el `projectPublicId`.
6. Usá el SDK de tracking en una landing externa.
7. Cuando llega un WhatsApp con código `TL-XXXXX`, confirmalo manualmente o vía webhook.
8. TrueLead intenta enviar el evento `Lead` a Meta.

## SDK para landings

Agregá este script a la landing del cliente:

```html
<script
  src="https://TU_BACKEND_RENDER.onrender.com/sdk/truelead.js"
  data-project="PROJECT_PUBLIC_ID"
  data-api="https://TU_BACKEND_RENDER.onrender.com">
</script>
```

Y al botón de WhatsApp agregale:

```html
<a href="#" data-truelead-whatsapp>Enviar WhatsApp</a>
```

El SDK pedirá un código al backend, armará el mensaje y abrirá WhatsApp.

## Webhook futuro para WhatsApp

Cuando tengamos el conector real de WhatsApp por QR o Cloud API, debe llamar:

```http
POST /api/webhooks/whatsapp/message
x-truelead-secret: WHATSAPP_WEBHOOK_SECRET
Content-Type: application/json

{
  "from": "5491100000000",
  "text": "Hola, mi código es: TL-4F9K2"
}
```

## Nota importante sobre WhatsApp QR

Esta versión deja preparada la app y el flujo completo, pero la conexión real por QR todavía queda como módulo siguiente. El panel incluye estado/QR demo y el webhook ya está listo para que conectemos Baileys o WhatsApp Cloud API después.

## Despliegue en Render

El repo incluye `render.yaml`.

Variables mínimas en Render:

```env
NODE_ENV=production
DATA_FILE=/var/data/truelead-db.json
APP_URL=https://truelead.com.ar
CORS_ORIGIN=https://truelead.com.ar,https://www.truelead.com.ar
ADMIN_EMAIL=tu-email
ADMIN_PASSWORD=tu-password
JWT_SECRET=generar_un_secreto
WHATSAPP_WEBHOOK_SECRET=generar_otro_secreto
```



## Cambios de esta versión

### Separación de paneles

- `login.html`: acceso cliente/agencia.
- `register.html`: registro público de agencias/clientes TrueLead.
- `app.html`: panel de cliente/agencia para clientes, proyectos, WhatsApp, leads, Meta CAPI y Mi Plan.
- `admin-login.html`: acceso exclusivo al backoffice interno.
- `admin.html`: backoffice TrueLead para validar cuentas, pagos, planes y vencimientos.

### Pricing ARS/USD

La landing consulta:

```txt
GET /api/public/pricing
```

Si detecta Argentina, muestra precios en ARS. Si no, muestra USD.

El valor de conversión se configura desde Render con:

```env
TRUELEAD_USD_ARS_RATE=1200
```

Para modificar los precios en pesos:
1. Ir al servicio en Render.
2. Environment.
3. Cambiar `TRUELEAD_USD_ARS_RATE`.
4. Redeploy.

### Backoffice de planes

El admin puede:
- ver precios calculados por plan,
- activar/suspender agencias,
- cargar pagos manuales,
- aprobar o rechazar pagos,
- cambiar el plan y vencimiento de una agencia.



## Versión con WhatsApp/Baileys + comprobantes

Esta versión agrega un conector real preparado con Baileys.

### Qué hace

- Genera QR real desde el panel de agencia.
- Guarda sesión en disco persistente.
- Escucha mensajes entrantes de WhatsApp.
- Detecta códigos `TL-XXXXX`.
- Confirma leads automáticamente cuando entra un mensaje con código.
- Envía `Lead` a Meta CAPI si el proyecto tiene Pixel ID y CAPI token.
- Detecta imágenes, documentos, videos, audios o stickers como posible comprobante.
- Registra esos comprobantes en la sección **Comprobantes** del panel.
- Permite validar manualmente la compra desde TrueLead.
- No guarda conversaciones completas.
- No descarga archivos multimedia en esta versión; solo registra el evento para evitar inflar la base.

### Variables nuevas

```env
WHATSAPP_SESSION_DIR=/var/data/whatsapp-sessions
WHATSAPP_AUTO_RESTORE=false
WHATSAPP_DISABLE_RECONNECT=false
WHATSAPP_QR_WAIT_MS=25000
WHATSAPP_LOG_LEVEL=silent
WHATSAPP_ALLOW_DEMO_CONNECT=true
```

### Flujo de tracking

```txt
Landing crea prelead TL-XXXXX
Usuario manda WhatsApp con ese código
Baileys detecta el mensaje
TrueLead marca Lead real
TrueLead intenta mandar Lead a Meta CAPI

Si después el usuario envía imagen/PDF/documento:
TrueLead registra Comprobante recibido
La agencia valida manualmente la compra desde el panel
TrueLead muestra Purchase/compra confirmada dentro del sistema
```

### Importante

La compra confirmada queda registrada en TrueLead. En esta versión no se manda automáticamente `Purchase` a Meta, porque conviene validar el comprobante antes.


## Notas de esta actualización

- `login.html` ya no muestra el acceso al backoffice administrador.
- Un usuario administrador puede ingresar desde `login.html` y entrar al panel cliente/agencia (`app.html`).
- `admin-login.html` queda como acceso interno separado para administradores.
- La cuenta base de TrueLead queda preparada como `trueleadsite@gmail.com`.
- Se agregó servicio de emails para avisos de registro pendiente, activación/suspensión de cuenta, pagos aprobados/rechazados y cambios de plan.
- Si no configurás `SMTP_PASS`, el sistema no rompe: registra los emails como `skipped_missing_smtp` y los deja logueados.

### Email en Render

Para enviar emails reales desde `trueleadsite@gmail.com`, configurar en Render:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=trueleadsite@gmail.com
SMTP_PASS=contraseña_de_aplicación_de_gmail
MAIL_FROM=trueleadsite@gmail.com
TRUELEAD_CONTACT_EMAIL=trueleadsite@gmail.com
```

En Gmail no conviene usar la contraseña normal de la cuenta; usá contraseña de aplicación.


## Cambios versión 1.3.0

- Registro con activación por email mediante botón.
- La cuenta entra en trial automáticamente al verificar el email.
- Emails HTML con estética TrueLead.
- El login de cliente/agencia ya no depende de activación manual del admin.
- Los proyectos usan el WhatsApp vinculado por QR como destino real.
- El SDK genera un código único por intento/persona y guarda `visitorId`.
- Baileys registra mensajes entrantes mínimos para estadísticas sin guardar chats completos.
- Leads muestra celular parcial, mensajes entrantes, comprobantes, ventas y % de compra.
- Métricas por rango: hoy, 7 días, 30 días, todo o fecha personalizada.
- Dashboard calcula tasa de lead real y tasa de venta: compras validadas / leads reales.

### Variable importante nueva

Para que el botón de activación del email apunte al dominio correcto, configurar en Render:

```env
APP_URL=https://TU-SERVICIO.onrender.com
```

Cuando el dominio esté listo, reemplazar por:

```env
APP_URL=https://app.truelead.com.ar
```

## Public domain + app domain

If the public website is deployed on Netlify at `truelead.com.ar`, frontend requests now automatically use:

```txt
https://app.truelead.com.ar
```

This fixes registration/login from the public site. Make sure Render has:

```env
CORS_ORIGIN=https://app.truelead.com.ar,https://truelead.com.ar,https://www.truelead.com.ar
APP_URL=https://app.truelead.com.ar
```

Netlify also includes `frontend/_redirects` as an extra proxy fallback for `/api/*`.


## Versión 1.4.0 — WhatsApps por cliente y proyectos vinculados

Cambios principales:

- Un cliente puede tener uno o varios WhatsApps vinculados.
- Cada WhatsApp tiene cliente, nombre interno, estado, número detectado y QR propio.
- Al crear un proyecto se selecciona un WhatsApp vinculado; ya no se usa un número manual.
- El SDK soporta mensajes personalizados por botón con `data-truelead-message`.
- El SDK soporta `data-truelead-source` para medir qué botón generó el lead.
- El código `TL-XXXXXX` sigue siendo único por click/persona y lo genera TrueLead.
- Baileys asocia mensajes entrantes, leads y comprobantes al WhatsApp vinculado correspondiente.
- Se eliminaron textos viejos de “QR demo”.

Ejemplo de botón para landing:

```html
<a
  href="#"
  data-truelead-whatsapp
  data-truelead-source="hero"
  data-truelead-message="Hola, quiero recibir información. Mi código es: {{code}}">
  Enviar WhatsApp
</a>

<script
  src="https://app.truelead.com.ar/sdk/truelead.js"
  data-project="tl_TU_PROJECT_ID"
  data-api="https://app.truelead.com.ar">
</script>
```

El texto `{{code}}` se reemplaza automáticamente por el código real generado para esa persona.


## Fix SDK externo / landings

Esta versión permite que el SDK de TrueLead se cargue desde landings externas, por ejemplo:

```html
<script
  src="https://app.truelead.com.ar/sdk/truelead.js"
  data-project="tl_xxxxx"
  data-api="https://app.truelead.com.ar">
</script>
```

Cambios técnicos:
- `Cross-Origin-Resource-Policy` queda en `cross-origin`.
- `/sdk/*` responde con headers públicos.
- `/api/preleads` acepta CORS desde landings externas.
- El panel y endpoints privados siguen usando `CORS_ORIGIN`.

Para URLs públicas propias, mantener en Render:

```env
APP_URL=https://app.truelead.com.ar
CORS_ORIGIN=https://app.truelead.com.ar,https://truelead.com.ar,https://www.truelead.com.ar
```

No hace falta agregar cada landing a `CORS_ORIGIN` para crear preleads, porque `/api/preleads` es el endpoint público del SDK.

## Dominios autorizados por proyecto

El campo **Dominios autorizados de landing** del proyecto ahora funciona como whitelist real del SDK.
Podés cargar uno o varios dominios separados por salto de línea, coma, punto y coma o espacio, por ejemplo:

```txt
https://youwin-psi.vercel.app
https://cliente.com
https://www.cliente.com
*.cliente.com
```

Cuando una landing llama a `POST /api/preleads`, TrueLead verifica el `Origin`/`Referer` contra esos dominios.
Si el dominio no coincide, no crea el prelead ni genera código TL. Esto permite usar el SDK en landings externas sin editar `CORS_ORIGIN` en Render para cada cliente.

## Fix WhatsApp Baileys number suffix

- Se normaliza el JID propio de Baileys antes de guardarlo como número público.
- Corrige casos como `5491124649559:2@s.whatsapp.net`, que antes terminaban como `54911246495592`.
- En el arranque se reparan sesiones/proyectos ya guardados con ese formato incorrecto para que el SDK abra `wa.me` con el número real.


## Fix navbar sesión
- La home detecta sesión activa por localStorage/cookie y reemplaza Iniciar sesión/Crear cuenta por Ver panel/Cerrar sesión.
- Se agregó logout.html para limpiar sesión en app.truelead.com.ar y cookies compartidas del dominio.
- Login/Register redirigen al panel si ya hay sesión activa guardada.
