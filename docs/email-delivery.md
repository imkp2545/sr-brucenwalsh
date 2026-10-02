# Gmail SMTP email delivery

The backend sends OTP, admin, and invoice email through Nodemailer and Gmail
SMTP. Configure these variables on the backend service:

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-gmail-address@gmail.com
SMTP_PASSWORD=your-16-character-google-app-password
SMTP_FROM_NAME=Bruce & Walsh Luxury
SMTP_FROM_EMAIL=your-gmail-address@gmail.com
```

`SMTP_PASSWORD` must be a Google App Password for an account with 2-Step
Verification enabled. Store it only in Render's environment settings; never
commit it or add it to the mobile app.

On startup the API probes the configured TCP endpoint, then uses
`transporter.verify()` to check TLS, SMTP greeting, and authentication. If port
465 cannot be reached, it also checks port 587 (`secure=false`) as a diagnostic.
The second port check is diagnostic only; outbound application email continues
to use the configured endpoint. Logs identify TCP, TLS/SMTP verification, or
authentication failures without printing credentials, OTPs, or message bodies.

Render Free web services block outbound connections on SMTP ports 25, 465, and
587. Gmail SMTP therefore requires a Render paid web service. On a Free service,
the startup TCP probes will report a connectivity failure on both ports; Gmail
credentials cannot resolve that plan-level network block. See [Render's Free
instance limitations](https://render.com/docs/free).
