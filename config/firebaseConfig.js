const admin = require('firebase-admin');

const normalizePrivateKey = (value = '') => value.replace(/\\n/g, '\n');

const getServiceAccount = () => {
  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    };
  }

  return null;
};

const initializeFirebase = () => {
  if (admin.apps.length) return admin.app();

  const serviceAccount = getServiceAccount();
  if (!serviceAccount) {
    console.warn('Firebase is not configured; push notifications will be unavailable');
    return null;
  }

  return admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
};

const getMessaging = () => {
  const app = initializeFirebase();
  if (!app) throw new Error('Firebase is not configured');
  return admin.messaging(app);
};

module.exports = { admin, initializeFirebase, getMessaging };
