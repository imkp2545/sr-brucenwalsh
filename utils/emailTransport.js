const nodemailer = require('nodemailer');
const net = require('net');

const DEFAULT_HOST = 'smtp.gmail.com';
const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 20_000;

let cachedTransport;
let cachedConfigKey;

const readSmtpConfig = (overrides = {}) => {
  const host = overrides.host || process.env.SMTP_HOST || DEFAULT_HOST;
  const rawPort = overrides.port ?? process.env.SMTP_PORT ?? '465';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be a valid TCP port');
  }

  const rawSecure = overrides.secure ?? process.env.SMTP_SECURE;
  if (rawSecure !== undefined && rawSecure !== '') {
    const normalizedSecure = String(rawSecure).trim().toLowerCase();
    if (!['true', 'false'].includes(normalizedSecure)) {
      throw new Error('SMTP_SECURE must be either true or false');
    }
  }
  const secure = rawSecure === undefined || rawSecure === ''
    ? port === 465
    : String(rawSecure).trim().toLowerCase() === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const missing = ['SMTP_USER', 'SMTP_PASSWORD'].filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing SMTP configuration: ${missing.join(', ')}`);

  return { host, port, secure, user, pass };
};

const getEmailTransport = (overrides = {}) => {
  const config = readSmtpConfig(overrides);
  // Include every transport setting in the cache key. If runtime configuration
  // changes, close the old socket pool/transport and create one with new values.
  const configKey = JSON.stringify(config);
  if (cachedTransport && cachedConfigKey === configKey) return cachedTransport;
  if (cachedTransport) cachedTransport.close();

  cachedTransport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    // Bound startup and delivery hangs: 10s for TCP/TLS greeting and 20s for
    // an established connection to finish SMTP commands or a message upload.
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
  cachedConfigKey = configKey;
  return cachedTransport;
};

const safeErrorDetails = (error) => {
  const config = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD };
  let message = typeof error?.message === 'string' ? error.message : 'Unknown SMTP error';
  for (const secret of [config.pass, config.user]) {
    if (secret) message = message.split(secret).join('[redacted]');
  }
  return {
    code: typeof error?.code === 'string' ? error.code : undefined,
    command: typeof error?.command === 'string' ? error.command : undefined,
    responseCode: Number.isInteger(error?.responseCode) ? error.responseCode : undefined,
    syscall: typeof error?.syscall === 'string' ? error.syscall : undefined,
    message,
  };
};

const logSmtpError = (context, error) => {
  const details = safeErrorDetails(error);
  console.error(`[SMTP] ${context}`, JSON.stringify(details));
};

const probeTcp = (host, port, label) => new Promise((resolve) => {
  const socket = net.connect({ host, port });
  let finished = false;
  const finish = (result) => {
    if (finished) return;
    finished = true;
    socket.destroy();
    resolve(result);
  };
  socket.setTimeout(CONNECTION_TIMEOUT_MS);
  socket.once('connect', () => {
    console.info(`[SMTP] TCP connection successful (${label})`);
    finish(true);
  });
  socket.once('timeout', () => {
    console.error(`[SMTP] TCP connection failed (${label})`);
    logSmtpError(`${label} TCP probe`, Object.assign(new Error('TCP connection timed out'), {
      code: 'ETIMEDOUT', syscall: 'connect',
    }));
    finish(false);
  });
  socket.once('error', (error) => {
    console.error(`[SMTP] TCP connection failed (${label})`);
    logSmtpError(`${label} TCP probe`, error);
    finish(false);
  });
});

const verifyEmailTransport = async () => {
  const config = readSmtpConfig();
  const verify = async (label, overrides) => {
    console.info(`[SMTP] Testing Gmail SMTP connection (${label})...`);
    const endpoint = readSmtpConfig(overrides);
    if (!(await probeTcp(endpoint.host, endpoint.port, label))) return false;
    try {
      const transport = getEmailTransport(overrides);
      await transport.verify();
      console.info(`[SMTP] Gmail SMTP connection successful (${label})`);
      return true;
    } catch (error) {
      console.error(`[SMTP] Gmail SMTP connection failed (${label})`);
      const stage = error?.command === 'AUTH' || error?.code === 'EAUTH'
        ? 'SMTP authentication'
        : 'TLS or SMTP greeting/verification';
      console.error(`[SMTP] Failure stage: ${stage} (${label})`);
      logSmtpError(`${label} verification error`, error);
      return false;
    }
  };

  const primaryOk = await verify(`${config.host}:${config.port}`, config);
  // A deterministic second probe distinguishes a port-specific block from a
  // Gmail credential problem when the requested primary port is 465.
  if (!primaryOk && config.host === DEFAULT_HOST && config.port === 465) {
    await verify(`${DEFAULT_HOST}:587 diagnostic`, {
      host: DEFAULT_HOST,
      port: 587,
      secure: false,
    });
    // Restore the configured transport as the cached transport after diagnostics.
    getEmailTransport(config);
  }
  return primaryOk;
};

const getFromAddress = () => {
  const name = process.env.SMTP_FROM_NAME || 'Bruce & Walsh Luxury';
  const email = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
  return `"${name.replace(/[\r\n"]+/g, '')}" <${email}>`;
};

module.exports = { getEmailTransport, getFromAddress, logSmtpError, verifyEmailTransport };
