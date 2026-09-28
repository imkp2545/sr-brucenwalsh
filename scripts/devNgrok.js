const path = require("path");
const { spawn } = require("child_process");
const ngrok = require("@ngrok/ngrok");
const dotenv = require("dotenv");

const backendDirectory = path.resolve(__dirname, "..");
const workspaceDirectory = path.resolve(backendDirectory, "..");
const mobileDirectory = path.join(workspaceDirectory, "mobile");

dotenv.config({ path: path.join(backendDirectory, ".env") });

const portFromEnvironment = (name, fallback) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return value;
};

const appendOrigin = (currentValue, origin) =>
  [
    ...new Set(
      [...(currentValue || "").split(","), origin]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].join(",");

const listenerOptions = (port, domain) => ({
  addr: `localhost:${port}`,
  authtoken_from_env: true,
  ...(domain ? { domain } : {}),
});

const children = new Set();
const listeners = new Set();
let shuttingDown = false;

const startProcess = (label, workingDirectory, args, environment) => {
  const child = spawn(process.execPath, args, {
    cwd: workingDirectory,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
  });
  children.add(child);
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (!shuttingDown && (code !== 0 || signal)) {
      console.error(
        `${label} stopped unexpectedly (${signal || `exit ${code}`})`,
      );
      shutdown(1);
    }
  });
  return child;
};

const shutdown = async (exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  await Promise.allSettled([...listeners].map((listener) => listener.close()));
  process.exit(exitCode);
};

const main = async () => {
  if (!process.env.NGROK_AUTHTOKEN) {
    throw new Error(
      "NGROK_AUTHTOKEN is required in backend/.env or the current shell",
    );
  }

  const backendPort = portFromEnvironment("PORT", 5000);
  const mobilePort = portFromEnvironment("NGROK_MOBILE_PORT", 5173);

  console.info("Creating ngrok HTTPS endpoints...");
  const backendListener = await ngrok.forward(
    listenerOptions(backendPort, process.env.NGROK_BACKEND_DOMAIN),
  );
  listeners.add(backendListener);

  const mobileListener = await ngrok.forward(
    listenerOptions(mobilePort, process.env.NGROK_MOBILE_DOMAIN),
  );
  listeners.add(mobileListener);

  const backendUrl = backendListener.url();
  const mobileUrl = mobileListener.url();
  const sharedEnvironment = { ...process.env, NODE_ENV: "development" };

  console.info(`Backend: ${backendUrl}`);
  console.info(`Mobile:  ${mobileUrl}`);
  console.info("Press Ctrl+C to stop both apps and both tunnels.");

  startProcess(
    "Backend",
    backendDirectory,
    [
      path.join(
        backendDirectory,
        "node_modules",
        "nodemon",
        "bin",
        "nodemon.js",
      ),
      "server.js",
    ],
    {
      ...sharedEnvironment,
      PORT: String(backendPort),
      TRUST_PROXY: process.env.TRUST_PROXY || "1",
      CLIENT_URL: appendOrigin(process.env.CLIENT_URL, mobileUrl),
    },
  );

  startProcess(
    "Mobile frontend",
    mobileDirectory,
    [
      path.join(mobileDirectory, "node_modules", "vite", "bin", "vite.js"),
      "--host",
      "0.0.0.0",
      "--port",
      String(mobilePort),
      "--strictPort",
    ],
    {
      ...sharedEnvironment,
      __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: new URL(mobileUrl).hostname,
      VITE_API_BASE_URL: `${backendUrl}/api/v1`,
      VITE_SOCKET_URL: backendUrl,
      VITE_NGROK_DEV: "true",
    },
  );
};

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

main().catch(async (error) => {
  console.error(`Unable to start ngrok development: ${error.message}`);
  await shutdown(1);
});
