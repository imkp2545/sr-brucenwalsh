require('dotenv').config();
const { connectDatabase, disconnectDatabase } = require('../config/dbConfig');
const CustomerAuthOtp = require('../models/customerAuthOtpModel');
const User = require('../models/userModel');

const migrateCustomerAuth = async () => {
  await connectDatabase();

  await CustomerAuthOtp.createIndexes();
  await User.collection.createIndex(
    { profileCompleted: 1 },
    { name: 'profileCompleted_1', background: true },
  );
  const completedProfiles = await User.updateMany(
    {
      profileCompleted: { $ne: true },
      firstName: { $type: 'string', $ne: '' },
      lastName: { $type: 'string', $ne: '' },
    },
    { $set: { profileCompleted: true } },
  );

  console.info(
    `Customer authentication indexes are ready; ${completedProfiles.modifiedCount} existing profiles were marked complete`,
  );
};

migrateCustomerAuth()
  .catch((error) => {
    console.error(`Customer authentication migration failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
