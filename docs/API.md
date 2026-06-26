# TrueLead API

## Health

`GET /health`

## Auth

`POST /api/auth/register`

```json
{
  "agencyName": "Agencia Éxito",
  "name": "Tomi",
  "email": "hola@agencia.com",
  "password": "password123"
}
```

`POST /api/auth/login`

```json
{
  "email": "admin@truelead.local",
  "password": "TrueLeadAdmin123!"
}
```

## Agency

Requires `Authorization: Bearer TOKEN`.

- `GET /api/agency/dashboard`
- `GET /api/agency/clients`
- `POST /api/agency/clients`
- `GET /api/agency/projects`
- `POST /api/agency/projects`
- `GET /api/agency/preleads`

## Public preleads

`POST /api/preleads`

```json
{
  "projectPublicId": "tl_xxxxx",
  "landingUrl": "https://cliente.com/landing",
  "fbp": "...",
  "fbc": "...",
  "utm": {
    "utm_campaign": "junio"
  }
}
```

## Confirm lead

`POST /api/preleads/TL-XXXXX/confirm`

Requires auth.

```json
{
  "phone": "5491100000000",
  "sendToMeta": true,
  "source": "manual_panel"
}
```

## WhatsApp webhook future connector

`POST /api/webhooks/whatsapp/message`

Header:

`x-truelead-secret: WHATSAPP_WEBHOOK_SECRET`

```json
{
  "from": "5491100000000",
  "text": "Hola, mi código es TL-4F9K2"
}
```

## Admin

Requires admin token.

- `GET /api/admin/overview`
- `GET /api/admin/agencies`
- `PATCH /api/admin/agencies/:id/status`
- `POST /api/admin/agencies/:id/payments`
- `PATCH /api/admin/payments/:id/validate`


## WhatsApp/Baileys

Requires auth.

- `GET /api/whatsapp/status`
- `POST /api/whatsapp/request-qr`
- `POST /api/whatsapp/reconnect`
- `POST /api/whatsapp/disconnect`
- `POST /api/whatsapp/reset`

## Purchases / comprobantes

Requires agency auth.

`GET /api/agency/purchases`

`PATCH /api/agency/purchases/:id/status`

```json
{
  "status": "purchase_confirmed",
  "notes": "Comprobante validado manualmente."
}
```

Estados posibles:

- `proof_received`
- `purchase_confirmed`
- `rejected`
- `duplicate`
