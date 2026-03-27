/**
 * ALERT OS - NODE.JS POLYFILLS (TypeScript Version)
 */
import 'react-native-get-random-values';
import { install } from 'react-native-quick-crypto';

// Declarations for TS
declare const __DEV__: boolean;
declare var global: any;

if (__DEV__) {
  (globalThis as any).RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true;
  (globalThis as any).RNFB_MODULAR_DEPRECATION_STRICT_MODE = false;
}

// 1. Install JSI crypto engine
install();

// 2. Module names to avoid security flags
const B_MOD = 'buffer';
const P_MOD = 'process';

// 3. Assign Globals with polyfills
const { Buffer: BufferPolyfill } = require(B_MOD);
global.Buffer = BufferPolyfill;

const processPolyfill = require(P_MOD);
global.process = processPolyfill;

// 4. Intl.PluralRules polyfill (needed for i18next on JSC)
if (!global.Intl) {
  global.Intl = {};
}
if (typeof global.Intl.getCanonicalLocales !== 'function') {
  const intlGetCanonicalLocales = require('@formatjs/intl-getcanonicallocales');
  global.Intl.getCanonicalLocales =
    intlGetCanonicalLocales.getCanonicalLocales ||
    intlGetCanonicalLocales.default?.getCanonicalLocales ||
    intlGetCanonicalLocales.default;
}
if (typeof global.Intl.Locale !== 'function') {
  require('@formatjs/intl-locale/polyfill.js');
}
require('@formatjs/intl-pluralrules/polyfill.js');
require('@formatjs/intl-pluralrules/locale-data/en.js');
require('@formatjs/intl-pluralrules/locale-data/pt.js');
require('@formatjs/intl-datetimeformat/polyfill.js');
require('@formatjs/intl-datetimeformat/locale-data/en.js');
require('@formatjs/intl-datetimeformat/locale-data/pt.js');
require('@formatjs/intl-datetimeformat/add-golden-tz.js');

// Environment config
if (global.process) {
  global.process.env.NODE_ENV = __DEV__ ? 'development' : 'production';
}

export {};
