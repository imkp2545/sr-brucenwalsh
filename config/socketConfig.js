const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const Admin = require('../models/adminModel');

let io;

const allowedOrigins = () =>
  (process.env.CLIENT_URL || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const initializeSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins(),
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 20000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
  });

  io.use(async (socket, next) => {
    try {
      const authToken = socket.handshake.auth?.token;
      const headerToken = socket.handshake.headers.authorization?.startsWith('Bearer ')
        ? socket.handshake.headers.authorization.slice(7)
        : null;
      const token = authToken || headerToken;

      if (!token) {
        socket.user = null;
        socket.isGuest = true;
        return next();
      }

      const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
        algorithms: ['HS256'],
        issuer: process.env.JWT_ISSUER || 'bruce-walsh-luxury',
        audience: process.env.JWT_AUDIENCE || 'bruce-walsh-luxury-api',
      });

      if (payload.type !== 'access') return next(new Error('Invalid token type'));

      const isCustomer = payload.role === 'customer';
      const account = isCustomer
        ? await User.findOne({ _id: payload.sub, status: 'active', deletedAt: null })
        : await Admin.findOne({ _id: payload.sub, status: 'active', deletedAt: null });
      if (!account || (isCustomer && !account.isEmailVerified) || account.changedPasswordAfter(payload.iat)) {
        const error = new Error('Account is inactive or token is no longer valid');
        error.data = { code: 'SOCKET_AUTHENTICATION_FAILED' };
        return next(error);
      }

      socket.user = {
        id: String(account._id),
        sub: String(account._id),
        role: account.role,
        tokenId: payload.jti,
      };
      socket.isGuest = false;
      return next();
    } catch (_error) {
      const error = new Error('Invalid or expired authentication token');
      error.data = { code: 'SOCKET_AUTHENTICATION_FAILED' };
      return next(error);
    }
  });

  io.on('connection', (socket) => {
    socket.join('catalog:public');
    if (socket.user?.sub) socket.join(`user:${socket.user.sub}`);
    if (socket.user?.role) socket.join(`role:${socket.user.role}`);
  });

  return io;
};

const emitToUser = (userId, event, payload) => {
  if (!io) return false;
  io.to(`user:${userId}`).emit(event, payload);
  return true;
};

const emitToRoles = (roles, event, payload) => {
  if (!io) return false;
  [...new Set(roles)].forEach((role) => io.to(`role:${role}`).emit(event, payload));
  return true;
};

const emitToAll = (event, payload) => {
  if (!io) return false;
  io.emit(event, payload);
  return true;
};

const getSocket = () => {
  if (!io) throw new Error('Socket.IO has not been initialized');
  return io;
};

module.exports = { initializeSocket, getSocket, emitToUser, emitToRoles, emitToAll };
