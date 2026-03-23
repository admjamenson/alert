const fs = require('fs');
const path = require('path');
const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const { URL } = require('node:url');
const {
  CANONICAL_BILLING_ORIGIN,
  resolveBillingRuntimeConfig,
} = require('../src/billing/billingConfig');

const LEGACY_BILLING_HOST = 'api.alertpremium.com';
const DEFAULT_TIMEOUT_MS = 15_000;
const EXPECTED_ENV_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_PRICE_ID',
  'ALERT_BILLING_SESSION_SECRET',
  'STRIPE_WEBHOOK_SECRET',
  'APP_URL',
];

const parseArgs = argv =>
  argv.reduce((acc, current) => {
    if (current.startsWith('--env-file=')) {
      acc.envFile = current.slice('--env-file='.length);
      return acc;
    }
    if (current.startsWith('--host=')) {
      acc.host = current.slice('--host='.length);
      return acc;
    }
    return acc;
  }, {});

const loadEnvFile = envFilePath => {
  if (!envFilePath || !fs.existsSync(envFilePath)) {
    return {};
  }

  return fs
    .readFileSync(envFilePath, 'utf8')
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return acc;
      }
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) {
        return acc;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (!key) {
        return acc;
      }
      acc[key] = value;
      return acc;
    }, {});
};

const summarizeEnvShape = env => ({
  STRIPE_SECRET_KEY: {
    present: Boolean(String(env.STRIPE_SECRET_KEY || '').trim()),
    shapeOk: String(env.STRIPE_SECRET_KEY || '').trim().startsWith('sk_'),
  },
  STRIPE_PUBLISHABLE_KEY: {
    present: Boolean(String(env.STRIPE_PUBLISHABLE_KEY || '').trim()),
    shapeOk: String(env.STRIPE_PUBLISHABLE_KEY || '').trim().startsWith('pk_'),
  },
  STRIPE_PRICE_ID: {
    present: Boolean(String(env.STRIPE_PRICE_ID || '').trim()),
    shapeOk: String(env.STRIPE_PRICE_ID || '').trim().startsWith('price_'),
  },
  ALERT_BILLING_SESSION_SECRET: {
    present: Boolean(String(env.ALERT_BILLING_SESSION_SECRET || '').trim()),
    shapeOk: String(env.ALERT_BILLING_SESSION_SECRET || '').trim().length >= 24,
  },
  STRIPE_WEBHOOK_SECRET: {
    present: Boolean(String(env.STRIPE_WEBHOOK_SECRET || '').trim()),
    shapeOk: String(env.STRIPE_WEBHOOK_SECRET || '').trim().startsWith('whsec_'),
  },
  APP_URL: {
    present: Boolean(String(env.APP_URL || '').trim()),
    shapeOk: /^https?:\/\//i.test(String(env.APP_URL || '').trim()),
  },
});

const probeDns = async hostname => {
  try {
    const addresses = await dns.resolve4(hostname);
    return {
      hostname,
      ok: true,
      records: addresses,
    };
  } catch (error) {
    return {
      hostname,
      ok: false,
      error: error.code || error.message,
    };
  }
};

const probeTcp = (hostname, port) =>
  new Promise(resolve => {
    const socket = net.connect({ host: hostname, port });
    let settled = false;
    const finish = payload => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(payload);
    };

    socket.setTimeout(DEFAULT_TIMEOUT_MS);
    socket.once('connect', () =>
      finish({
        hostname,
        port,
        ok: true,
        remoteAddress: socket.remoteAddress || null,
      }),
    );
    socket.once('timeout', () =>
      finish({
        hostname,
        port,
        ok: false,
        error: 'timeout',
      }),
    );
    socket.once('error', error =>
      finish({
        hostname,
        port,
        ok: false,
        error: error.code || error.message,
      }),
    );
  });

const extractCertificate = certificate => {
  if (!certificate || !certificate.subject) {
    return null;
  }

  return {
    subject: certificate.subject,
    issuer: certificate.issuer,
    subjectaltname: certificate.subjectaltname || null,
    valid_from: certificate.valid_from || null,
    valid_to: certificate.valid_to || null,
    fingerprint256: certificate.fingerprint256 || null,
    serialNumber: certificate.serialNumber || null,
  };
};

const probeHttps = targetUrl =>
  new Promise(resolve => {
    const result = {
      url: targetUrl,
      ok: false,
      certificate: null,
      statusCode: null,
      statusMessage: null,
      error: null,
    };

    const request = https.request(
      targetUrl,
      {
        method: 'GET',
        timeout: DEFAULT_TIMEOUT_MS,
        rejectUnauthorized: true,
      },
      response => {
        result.ok = true;
        result.statusCode = response.statusCode || null;
        result.statusMessage = response.statusMessage || null;
        result.headers = {
          'content-type': response.headers['content-type'] || null,
          location: response.headers.location || null,
        };
        if (response.socket?.getPeerCertificate) {
          result.certificate = extractCertificate(response.socket.getPeerCertificate(true));
        }
        response.resume();
        response.on('end', () => resolve(result));
      },
    );

    request.on('socket', socket => {
      socket.on('secureConnect', () => {
        if (socket.getPeerCertificate) {
          result.certificate = extractCertificate(socket.getPeerCertificate(true));
        }
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });

    request.on('error', error => {
      result.error = error.code || error.message;
      resolve(result);
    });

    request.end();
  });

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const envFilePath = args.envFile
    ? path.resolve(process.cwd(), args.envFile)
    : path.resolve(__dirname, '..', '.env');
  const fileEnv = loadEnvFile(envFilePath);
  const mergedEnv = {
    ...process.env,
    ...fileEnv,
  };

  const officialOrigin = String(args.host || CANONICAL_BILLING_ORIGIN).trim();
  const officialUrl = new URL(officialOrigin);

  let runtimeConfig = null;
  let runtimeError = null;
  try {
    runtimeConfig = resolveBillingRuntimeConfig({}, mergedEnv);
  } catch (error) {
    runtimeError = error.message;
  }

  const [officialDns, legacyDns, tcp443, rootProbe, configProbe] = await Promise.all([
    probeDns(officialUrl.hostname),
    probeDns(LEGACY_BILLING_HOST),
    probeTcp(officialUrl.hostname, 443),
    probeHttps(`${officialOrigin.replace(/\/+$/g, '')}/`),
    probeHttps(`${officialOrigin.replace(/\/+$/g, '')}/billing/config`),
  ]);

  const summary = {
    checkedAt: new Date().toISOString(),
    officialOrigin,
    legacyHost: LEGACY_BILLING_HOST,
    officialWebhookUrl: `${officialOrigin.replace(/\/+$/g, '')}/webhooks/stripe`,
    envFileChecked: fs.existsSync(envFilePath) ? envFilePath : null,
    expectedEnvKeys: EXPECTED_ENV_KEYS,
    envShape: summarizeEnvShape(mergedEnv),
    runtimeConfig: runtimeConfig
      ? {
          appUrl: runtimeConfig.appUrl,
          priceSelection: runtimeConfig.priceSelection,
          market: runtimeConfig.market,
        }
      : null,
    runtimeError,
    dns: {
      official: officialDns,
      legacy: legacyDns,
    },
    tcp443,
    https: {
      root: rootProbe,
      billingConfig: configProbe,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.https.root.ok && summary.https.billingConfig.ok ? 0 : 1);
};

main().catch(error => {
  console.error(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        fatal: error.message,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
