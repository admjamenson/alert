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
globalThis.Buffer = BufferPolyfill;

const processPolyfill = require(P_MOD);
global.process = processPolyfill;
globalThis.process = processPolyfill;

if (typeof globalThis.TextEncoder !== 'function') {
  class BufferTextEncoder {
    encode(input: string = ''): Uint8Array {
      return Uint8Array.from(BufferPolyfill.from(String(input), 'utf8'));
    }
  }

  (globalThis as any).TextEncoder = BufferTextEncoder;
}

if (typeof globalThis.TextDecoder !== 'function') {
  class BufferTextDecoder {
    decode(
      input?: ArrayBuffer | ArrayBufferView | null,
      _options?: { stream?: boolean },
    ): string {
      if (input == null) {
        return '';
      }

      if (ArrayBuffer.isView(input)) {
        return BufferPolyfill.from(
          input.buffer,
          input.byteOffset,
          input.byteLength,
        ).toString('utf8');
      }

      return BufferPolyfill.from(input).toString('utf8');
    }
  }

  (globalThis as any).TextDecoder = BufferTextDecoder;
}

const hasWorkingDateTimeFormat = (): boolean => {
  try {
    return (
      typeof global.Intl.DateTimeFormat === 'function' &&
      typeof new global.Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
      }).format(new Date()) === 'string'
    );
  } catch {
    return false;
  }
};

// 4. Intl polyfills. Hermes generally provides these; load FormatJS only when
// the runtime is missing support so startup does not pay this cost on every boot.
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
if (typeof global.Intl.PluralRules !== 'function') {
  require('@formatjs/intl-pluralrules/polyfill.js');
  require('@formatjs/intl-pluralrules/locale-data/en.js');
  require('@formatjs/intl-pluralrules/locale-data/pt.js');
}
if (!hasWorkingDateTimeFormat()) {
  require('@formatjs/intl-datetimeformat/polyfill.js');
  require('@formatjs/intl-datetimeformat/locale-data/en.js');
  require('@formatjs/intl-datetimeformat/locale-data/pt.js');
  require('@formatjs/intl-datetimeformat/add-golden-tz.js');
}

// Environment config
if (global.process) {
  global.process.env.NODE_ENV = __DEV__ ? 'development' : 'production';
}

export {};
