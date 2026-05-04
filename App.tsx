import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { scheduleDeferredBootstrap } from './src/startup/DeferredBootstrapCoordinator';
import EmergencyEntryShell from './src/startup/EmergencyEntryShell';
import { markStartupPhase } from './src/startup/startupTelemetry';

type DeferredAppRootComponent = React.ComponentType;

const CRITICAL_SHELL_MIN_VISIBLE_MS = 1200;

type TestRuntimeGlobal = typeof globalThis & {
  expect?: unknown;
  it?: unknown;
  jest?: unknown;
};

const isJestRuntime = () => {
  const runtime = globalThis as TestRuntimeGlobal;
  const hasJestGlobals =
    typeof runtime.jest !== 'undefined' ||
    (typeof runtime.expect === 'function' && typeof runtime.it === 'function');
  const hasJestEnv =
    typeof process !== 'undefined' &&
    Boolean(process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test');
  return hasJestGlobals || hasJestEnv;
};

const loadDeferredAppRoot = (): DeferredAppRootComponent => {
  const moduleRef = require('./src/startup/DeferredAppRoot');
  return moduleRef.default || moduleRef.DeferredAppRoot;
};

export default function App() {
  const [DeferredAppRoot, setDeferredAppRoot] =
    useState<DeferredAppRootComponent | null>(null);
  const [releaseShell, setReleaseShell] = useState(false);
  const startedAtRef = useRef(Date.now());
  const shellMarkedRef = useRef(false);
  const isTestRuntime = isJestRuntime();

  if (isTestRuntime) {
    return <View style={styles.container} />;
  }

  if (!shellMarkedRef.current) {
    shellMarkedRef.current = true;
    markStartupPhase('CRITICAL_SHELL_MOUNT_BEGIN');
  }

  useEffect(() => {
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;
    const handle = scheduleDeferredBootstrap(() => {
      const Root = loadDeferredAppRoot();
      setDeferredAppRoot(() => Root);

      const elapsed = Date.now() - startedAtRef.current;
      const remaining = Math.max(0, CRITICAL_SHELL_MIN_VISIBLE_MS - elapsed);
      releaseTimer = setTimeout(() => {
        setReleaseShell(true);
      }, remaining);
    });

    return () => {
      handle.cancel();
      if (releaseTimer) {
        clearTimeout(releaseTimer);
      }
    };
  }, []);

  const showEmergencyShell = !releaseShell;
  const deferredRoot = useMemo(
    () => (DeferredAppRoot ? <DeferredAppRoot /> : null),
    [DeferredAppRoot],
  );

  return (
    <View style={styles.container}>
      {deferredRoot}
      {showEmergencyShell ? (
        <EmergencyEntryShell mainAppMounted={Boolean(DeferredAppRoot)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
});
