const crypto = require("crypto");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const hpp = require("hpp");
const mongoSanitize = require("express-mongo-sanitize");
const { rateLimit } = require("express-rate-limit");
const AppError = require("../utils/appError");

const origins = () =>
  (process.env.CLIENT_URL || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const corsOptions = () => ({
  origin(origin, callback) {
    const allowed = origins();
    if (!origin || allowed.includes(origin)) return callback(null, true);
    return callback(
      new AppError("Origin is not allowed by CORS", 403, "CORS_FORBIDDEN"),
    );
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Request-Id",
    "Idempotency-Key",
    "ngrok-skip-browser-warning",
  ],
  exposedHeaders: ["X-Request-Id"],
  maxAge: 86400,
});

const requestId = (req, res, next) => {
  const incoming = req.get("x-request-id");
  req.id =
    incoming && /^[a-zA-Z0-9_-]{8,128}$/.test(incoming)
      ? incoming
      : crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
};

const createRateLimiter = ({ max, message }) =>
  rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: (req) => req.method === "OPTIONS" || req.path === "/health",
    handler: (req, res) =>
      res.status(429).json({
        success: false,
        code: "RATE_LIMIT_EXCEEDED",
        message,
        requestId: req.id,
      }),
  });

const apiRateLimiter = createRateLimiter({
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
  message: "Too many requests; please try again later",
});

const authRateLimiter = createRateLimiter({
  max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  message: "Too many authentication attempts; please try again later",
});

const refreshRateLimiter = createRateLimiter({
  max: Number(process.env.REFRESH_RATE_LIMIT_MAX) || 300,
  message: "Too many session renewal requests; please try again shortly",
});

const carrierRateLimiter = createRateLimiter({
  max: Number(process.env.CARRIER_RATE_LIMIT_MAX) || 30,
  message: "Too many carrier requests; please try again later",
});

const applySecurityMiddleware = (app) => {
  app.disable("x-powered-by");
  app.use(requestId);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors(corsOptions()));
  app.use(compression());
  app.use(mongoSanitize({ replaceWith: "_" }));
  app.use(hpp());
  app.use(apiRateLimiter);
};

module.exports = {
  applySecurityMiddleware,
  authRateLimiter,
  refreshRateLimiter,
  carrierRateLimiter,
  requestId,
  corsOptions,
};
