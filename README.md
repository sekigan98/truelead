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

