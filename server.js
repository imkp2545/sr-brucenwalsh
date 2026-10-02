require('dotenv').config();

const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('./config/dbConfig');
const { initializeSocket } = require('./config/socketConfig');
const { configureCloudinary } = require('./config/cloudinaryConfig');
const { initializeFirebase } = require('./config/firebaseConfig');
const { startCampaignScheduler, stopCampaignScheduler } = require('./services/notificationCampaignService');
const { applySecurityMiddleware } = require('./middleware/securityMiddleware');
const notFoundMiddleware = require('./middleware/notFoundMiddleware');
const errorMiddleware = require('./middleware/errorMiddleware');
const ApiResponse = require('./utils/apiResponse');
const { verifyEmailTransport, logSmtpError } = require('./utils/emailTransport');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const collectionRoutes = require('./routes/collectionRoutes');
const productRoutes = require('./routes/productRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');
const wishlistRoutes = require('./routes/wishlistRoutes');
const cartRoutes = require('./routes/cartRoutes');
const appointmentRoutes = require('./routes/appointmentRoutes');
const couponRoutes = require('./routes/couponRoutes');
const cmsRoutes = require('./routes/cmsRoutes');
const bannerRoutes = require('./routes/bannerRoutes');
const checkoutRoutes = require('./routes/checkoutRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const orderRoutes = require('./routes/orderRoutes');
const shipmentRoutes = require('./routes/shipmentRoutes');
const returnRoutes = require('./routes/returnRoutes');
const refundRoutes = require('./routes/refundRoutes');
const buybackRoutes = require('./routes/buybackRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const settingRoutes = require('./routes/settingRoutes');
const supportEnquiryRoutes = require('./routes/supportEnquiryRoutes');
const customerAnalyticsRoutes = require('./routes/customerAnalyticsRoutes');
const voiceRoutes = require('./routes/voiceRoutes');

const app = express();
const httpServer = http.createServer(app);

const requiredEnvironmentVariables = ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

const validateEnvironment = () => {
  const missing = requiredEnvironmentVariables.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);

  for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (process.env[name].length < 32) throw new Error(`${name} must contain at least 32 characters`);
  }

  if (process.env.JWT_ACCESS_SECRET === process.env.JWT_REFRESH_SECRET) {
    throw new Error('JWT access and refresh secrets must be different');
  }
};

const trustProxy = Number(process.env.TRUST_PROXY || 0);
if (trustProxy > 0) app.set('trust proxy', trustProxy);

applySecurityMiddleware(app);
const preserveRawBody = (req, _res, buffer) => {
  if (buffer?.length) req.rawBody = Buffer.from(buffer);
};
app.use(express.json({ limit: '1mb', strict: true, verify: preserveRawBody }));
app.use(express.urlencoded({ extended: false, limit: '1mb', parameterLimit: 100, verify: preserveRawBody }));

app.get('/health', (_req, res) =>
  ApiResponse.success(res, {
    message: 'Bruce & Walsh Luxury API is healthy',
    data: {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    },
  }),
);

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/collections', collectionRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/inventory', inventoryRoutes);
app.use('/api/v1/wishlist', wishlistRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/appointments', appointmentRoutes);
app.use('/api/v1/coupons', couponRoutes);
app.use('/api/v1/cms', cmsRoutes);
app.use('/api/v1/banners', bannerRoutes);
app.use('/api/v1/checkout', checkoutRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/shipments', shipmentRoutes);
app.use('/api/v1/returns', returnRoutes);
app.use('/api/v1/refunds', refundRoutes);
app.use('/api/v1/buybacks', buybackRoutes);
app.use('/api/v1/reviews', reviewRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/settings', settingRoutes);
app.use('/api/v1/support-enquiries', supportEnquiryRoutes);
app.use('/api/v1/customer-analytics', customerAnalyticsRoutes);
app.use('/api/v1/voice', voiceRoutes);

app.use(notFoundMiddleware);
app.use(errorMiddleware);

let isShuttingDown = false;

const shutdown = async (signal, exitCode = 0) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.info(`${signal} received; shutting down gracefully`);

  const forceExitTimer = setTimeout(() => {
    console.error('Graceful shutdown timed out');
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  const finishShutdown = async (closeError) => {
  try {
    stopCampaignScheduler();
    await disconnectDatabase();
      if (closeError) throw closeError;
      process.exit(exitCode);
    } catch (error) {
      console.error('Shutdown failed', error);
      process.exit(1);
    }
  };

  if (httpServer.listening) httpServer.close(finishShutdown);
  else await finishShutdown();
};

const startServer = async () => {
  validateEnvironment();
  await connectDatabase();
  configureCloudinary();
  initializeFirebase();
  initializeSocket(httpServer);
  startCampaignScheduler();

  const port = Number(process.env.PORT) || 5000;
  await new Promise((resolve, reject) => {
    const handleError = (error) => {
      httpServer.off('listening', handleListening);
      reject(error);
    };
    const handleListening = () => {
      httpServer.off('error', handleError);
      resolve();
    };
    httpServer.once('error', handleError);
    httpServer.once('listening', handleListening);
    httpServer.listen(port);
  });
  console.info(`Bruce & Walsh Luxury API listening on port ${port} (${process.env.NODE_ENV || 'development'})`);
  // SMTP must not prevent HTTP startup. Verification runs in the background and
  // logs DNS/TCP versus TLS/SMTP/auth failures separately for Render diagnosis.
  verifyEmailTransport().catch((error) => logSmtpError('Startup verification could not run', error));
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection', error);
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception', error);
  shutdown('uncaughtException', 1);
});

startServer().catch(async (error) => {
  console.error('Server startup failed', error);
  try { await disconnectDatabase(); } catch (disconnectError) {
    console.error('Database disconnect after startup failure failed', disconnectError);
  }
  process.exit(1);
});

module.exports = { app, httpServer };
