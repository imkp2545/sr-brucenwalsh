if (false) {
const mongoose = require('mongoose');
const { env } = require('./env');

mongoose.set('strictQuery', true);

const connectDatabase = () => mongoose.connect(env.mongoUri, {
  dbName: env.mongoDbName,
  autoIndex: env.nodeEnv !== 'production',
  maxPoolSize: 20,
  minPoolSize: env.nodeEnv === 'production' ? 2 : 0,
  serverSelectionTimeoutMS: 10000,
});

module.exports = { connectDatabase };
}

module.exports = require('./dbConfig');
