const fs = require('fs');
const path = require('path');

const DEFAULT_LOCAL_SERVICE_ACCOUNT_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  'firebase-admin.json',
);

const buildUnavailableState = reason => ({
  available: false,
  reason,
  db: null,
});

const readJsonFile = (fsImpl, filePath) => {
  const raw = fsImpl.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

const resolveFirebaseServiceAccount = ({
  env = process.env,
  fsImpl = fs,
  localFallbackPath = DEFAULT_LOCAL_SERVICE_ACCOUNT_PATH,
} = {}) => {
  const rawEnvValue = String(env.FIREBASE_SERVICE_ACCOUNT || '').trim();

  if (rawEnvValue) {
    if (rawEnvValue.startsWith('{')) {
      return {
        serviceAccount: JSON.parse(rawEnvValue),
        source: 'env_json',
        path: null,
      };
    }

    if (fsImpl.existsSync(rawEnvValue)) {
      return {
        serviceAccount: readJsonFile(fsImpl, rawEnvValue),
        source: 'env_file',
        path: rawEnvValue,
      };
    }

    throw new Error('firebase_service_account_path_not_found');
  }

  if (fsImpl.existsSync(localFallbackPath)) {
    return {
      serviceAccount: readJsonFile(fsImpl, localFallbackPath),
      source: 'local_fallback_file',
      path: localFallbackPath,
    };
  }

  return {
    serviceAccount: null,
    source: 'missing',
    path: null,
  };
};

const createFirebaseState = ({
  env = process.env,
  admin,
  logger = console,
  fsImpl = fs,
  localFallbackPath = DEFAULT_LOCAL_SERVICE_ACCOUNT_PATH,
} = {}) => {
  if (!admin) {
    throw new Error('firebase_admin_dependency_required');
  }

  let resolvedCredential;
  try {
    resolvedCredential = resolveFirebaseServiceAccount({
      env,
      fsImpl,
      localFallbackPath,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      logger.error(
        `[bootstrap/firebase] Firebase initialization failed: invalid JSON in service account source. ${error.message}`,
      );
      return buildUnavailableState('invalid_firebase_service_account_json');
    }

    if (error.message === 'firebase_service_account_path_not_found') {
      logger.warn(
        '[bootstrap/firebase] FIREBASE_SERVICE_ACCOUNT was provided as a file path, but no readable file was found. Backend will start in degraded mode.',
      );
      return buildUnavailableState('firebase_service_account_path_not_found');
    }

    logger.error(
      `[bootstrap/firebase] Firebase credential resolution failed. ${error.message}`,
    );
    return buildUnavailableState('firebase_service_account_resolution_failed');
  }

  if (!resolvedCredential.serviceAccount) {
    logger.warn(
      '[bootstrap/firebase] Firebase disabled: no service account configured. Set FIREBASE_SERVICE_ACCOUNT or provide backend/firebase-admin.json for local development.',
    );
    return buildUnavailableState('missing_firebase_service_account');
  }

  try {
    if (!Array.isArray(admin.apps) || admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(resolvedCredential.serviceAccount),
      });
    }

    logger.log(
      `[bootstrap/firebase] Firebase Admin initialized (${resolvedCredential.source}).`,
    );

    return {
      available: true,
      reason: null,
      db: admin.firestore(),
    };
  } catch (error) {
    logger.error(
      `[bootstrap/firebase] Firebase initialization failed: ${error.message}`,
    );
    return buildUnavailableState('firebase_admin_initialization_failed');
  }
};

module.exports = {
  DEFAULT_LOCAL_SERVICE_ACCOUNT_PATH,
  createFirebaseState,
  resolveFirebaseServiceAccount,
};
