const mongoose = require('mongoose');

const connectDatabase = async () => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error('MONGODB_URI is required');
  }

  mongoose.set('strictQuery', true);

  const connection = await mongoose.connect(mongoUri, {
    autoIndex: process.env.NODE_ENV !== 'production',
    maxPoolSize: 20,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });

  console.info(`MongoDB connected: ${connection.connection.host}`);
  return connection;
};

const disconnectDatabase = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};

module.exports = { connectDatabase, disconnectDatabase };
