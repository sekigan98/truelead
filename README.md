<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="Vinculación de WhatsApp en TrueLead." />
  <title>TrueLead — Vincular WhatsApp</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/styles.css" />
</head>
<body data-page="connect">
  <div class="site-shell simple-page">
    <header class="topbar container compact">
      <a class="brand" href="index.html">
        <img src="assets/logo.png" alt="TrueLead" />
        <span>TRUELEAD</span>
      </a>
      <div class="nav-actions">
        <a class="link-btn" href="dashboard.html">Volver al panel</a>
      </div>
    </header>

    <main class="container connect-page">
      <section class="connect-grid">
        <article class="connect-card panel-glow fade-in-up">
          <span class="section-kicker">Vinculación segura</span>
          <h1>Conectá tu WhatsApp en menos de 1 minuto</h1>
          <p>
            Escaneá este código QR desde tu teléfono para vincular tu cuenta.
            Una vez conectado, TrueLead empezará a detectar leads reales y a medir
            conversiones confirmadas.
          </p>

          <div class="qr-panel standalone">
            <div class="qr-placeholder giant" aria-hidden="true">
              <div class="qr-square"></div>
              <div class="qr-center">WA</div>
            </div>
            <div class="status-pill">Estado actual: esperando vinculación</div>
          </div>
        </article>

        <aside class="connect-card side-info panel-glow fade-in-up delay-1">
          <h2>Cómo vincular tu WhatsApp</h2>
          <ol>
            <li>Abrí WhatsApp en tu teléfono.</li>
            <li>Entrá en <strong>Dispositivos vinculados</strong>.</li>
            <li>Tocá <strong>Vincular un dispositivo</strong>.</li>
            <li>Escaneá el código QR de esta pantalla.</li>
          </ol>

          <div class="panel-soft mini-session">
            <strong>¿Qué pasa después?</strong>
            <p>Tu agencia podrá ver leads reales, tasa de confirmación, campañas y los envíos a Meta desde el panel.</p>
          </div>

          <div class="panel-soft mini-session">
            <strong>Privacidad</strong>
            <p>TrueLead no necesita guardar conversaciones completas para medir conversiones. Solo procesa los eventos necesarios.</p>
          </div>
        </aside>
      </section>
    </main>
  </div>

  <script src="js/app.js"></script>
</body>
</html>
