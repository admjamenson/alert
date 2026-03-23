const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createFirebaseState,
  resolveFirebaseServiceAccount,
} = require('./firebaseAdmin');

const createLogger = () => {
  const entries = [];
  return {
    entries,
    warn(message) {
      entries.push({ level: 'warn', message });
    },
    error(message) {
      entries.push({ level: 'error', message });
    },
    log(message) {
      entries.push({ level: 'log', message });
    },
  };
};

const createFs = existingFiles => ({
  existsSync(filePath) {
    return Object.prototype.hasOwnProperty.call(existingFiles, filePath);
  },
  readFileSync(filePath) {
    return existingFiles[filePath];
  },
});

test('resolveFirebaseServiceAccount returns null when env and local fallback are absent', () => {
  const resolved = resolveFirebaseServiceAccount({
    env: {},
    fsImpl: createFs({}),
    localFallbackPath: 'C:\\missing\\firebase-admin.json',
  });

  assert.deepEqual(resolved, {
    serviceAccount: null,
    source: 'missing',
    path: null,
  });
});

test('resolveFirebaseServiceAccount accepts FIREBASE_SERVICE_ACCOUNT as raw JSON string', () => {
  const serviceAccount = {
    project_id: 'alert-test',
    client_email: 'alerts@example.test',
  };

  const resolved = resolveFirebaseServiceAccount({
    env: {
      FIREBASE_SERVICE_ACCOUNT: JSON.stringify(serviceAccount),
    },
    fsImpl: createFs({}),
    localFallbackPath: 'C:\\missing\\firebase-admin.json',
  });

  assert.deepEqual(resolved, {
    serviceAccount,
    source: 'env_json',
    path: null,
  });
});

test('resolveFirebaseServiceAccount accepts FIREBASE_SERVICE_ACCOUNT as local file path', () => {
  const envPath = 'C:\\local\\service-account.json';
  const serviceAccount = {
    project_id: 'alert-test',
    client_email: 'alerts@example.test',
  };

  const resolved = resolveFirebaseServiceAccount({
    env: {
      FIREBASE_SERVICE_ACCOUNT: envPath,
    },
    fsImpl: createFs({
      [envPath]: JSON.stringify(serviceAccount),
    }),
    localFallbackPath: 'C:\\missing\\firebase-admin.json',
  });

  assert.deepEqual(resolved, {
    serviceAccount,
    source: 'env_file',
    path: envPath,
  });
});

test('resolveFirebaseServiceAccount falls back to backend/firebase-admin.json locally', () => {
  const localPath = 'C:\\Alert\\backend\\firebase-admin.json';
  const serviceAccount = {
    project_id: 'alert-local',
    client_email: 'alerts-local@example.test',
  };

  const resolved = resolveFirebaseServiceAccount({
    env: {},
    fsImpl: createFs({
      [localPath]: JSON.stringify(serviceAccount),
    }),
    localFallbackPath: localPath,
  });

  assert.deepEqual(resolved, {
    serviceAccount,
    source: 'local_fallback_file',
    path: localPath,
  });
});

test('createFirebaseState returns degraded state when FIREBASE_SERVICE_ACCOUNT file path is missing', () => {
  const logger = createLogger();
  const state = createFirebaseState({
    env: {
      FIREBASE_SERVICE_ACCOUNT: 'C:\\missing\\service-account.json',
    },
    admin: {
      apps: [],
      credential: { cert: value => value },
      initializeApp() {
        throw new Error('should_not_initialize');
      },
      firestore() {
        throw new Error('should_not_create_firestore');
      },
    },
    fsImpl: createFs({}),
    localFallbackPath: 'C:\\missing\\firebase-admin.json',
    logger,
  });

  assert.deepEqual(state, {
    available: false,
    reason: 'firebase_service_account_path_not_found',
    db: null,
  });
  assert.equal(logger.entries[0].level, 'warn');
  assert.match(logger.entries[0].message, /file path/);
});

test('createFirebaseState returns degraded state when FIREBASE_SERVICE_ACCOUNT JSON is invalid', () => {
  const logger = createLogger();
  const state = createFirebaseState({
    env: {
      FIREBASE_SERVICE_ACCOUNT: '{bad-json',
    },
    admin: {
      apps: [],
      credential: { cert: value => value },
      initializeApp() {
        throw new Error('should_not_initialize');
      },
      firestore() {
        throw new Error('should_not_create_firestore');
      },
    },
    fsImpl: createFs({}),
    localFallbackPath: 'C:\\missing\\firebase-admin.json',
    logger,
  });

  assert.deepEqual(state, {
    available: false,
    reason: 'invalid_firebase_service_account_json',
    db: null,
  });
  assert.equal(logger.entries[0].level, 'error');
  assert.match(logger.entries[0].message, /invalid JSON/);
});

test('createFirebaseState initializes Firebase Admin when FIREBASE_SERVICE_ACCOUNT is valid JSON', () => {
  const logger = createLogger();
  const firestore = { collection: () => ({}) };
  let certInput = null;
  let initializeCalled = false;

  const serviceAccount = {
    project_id: 'alert-test',
    client_email: 'alerts@example.test',
    private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
  };

  const state = createFirebaseState({
    env: {
      FIREBASE_SERVICE_ACCOUNT: JSON.stringify(serviceAccount),
    },
    admin: {
      apps: [],
      credential: {
        cert(value) {
          certInput = value;
          return { mockCredential: true, value };
        },
      },
      initializeApp(config) {
        initializeCalled = true;
        assert.equal(config.credential.mockCredential, true);
      },
      firestore() {
        return firestore;
      },
    },
    fsImpl: createFs({}),
    localFallbackPath: 'C:\\missing\\firebase-admin.json',
    logger,
  });

  assert.equal(initializeCalled, true);
  assert.deepEqual(certInput, serviceAccount);
  assert.equal(state.available, true);
  assert.equal(state.reason, null);
  assert.equal(state.db, firestore);
  assert.equal(logger.entries.at(-1).level, 'log');
  assert.match(logger.entries.at(-1).message, /Firebase Admin initialized/);
});

test('createFirebaseState reuses existing Firebase app without reinitializing', () => {
  const logger = createLogger();
  let initializeCalled = false;
  const firestore = { collection: () => ({}) };

  const state = createFirebaseState({
    env: {
      FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
        project_id: 'alert-test',
      }),
    },
    admin: {
      apps: [{}],
      credential: {
        cert() {
          throw new Error('should_not_build_new_credential');
        },
      },
      initializeApp() {
        initializeCalled = true;
      },
      firestore() {
        return firestore;
      },
    },
    fsImpl: createFs({}),
    localFallbackPath: 'C:\\missing\\firebase-admin.json',
    logger,
  });

  assert.equal(initializeCalled, false);
  assert.equal(state.available, true);
  assert.equal(state.db, firestore);
});

test('createFirebaseState returns degraded state when Firebase Admin initialization throws', () => {
  const logger = createLogger();
  const state = createFirebaseState({
    env: {
      FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
        project_id: 'alert-test',
      }),
    },
    admin: {
      apps: [],
      credential: {
        cert(value) {
          return value;
        },
      },
      initializeApp() {
        throw new Error('bad_credential');
      },
      firestore() {
        throw new Error('should_not_create_firestore');
      },
    },
    fsImpl: createFs({}),
    localFallbackPath: 'C:\\missing\\firebase-admin.json',
    logger,
  });

  assert.deepEqual(state, {
    available: false,
    reason: 'firebase_admin_initialization_failed',
    db: null,
  });
  assert.equal(logger.entries.at(-1).level, 'error');
  assert.match(logger.entries.at(-1).message, /bad_credential/);
});
