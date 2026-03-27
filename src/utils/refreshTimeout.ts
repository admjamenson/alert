type MutableRef<T> = {
  current: T;
};

type RefreshStatus = 'refreshing' | 'completed';

type RunRefreshWithTimeoutParams = {
  refreshFn: (requestToken: number) => Promise<void>;
  setRefreshing: (next: boolean) => void;
  requestTokenRef: MutableRef<number>;
  activeRunRef: MutableRef<number>;
  timeoutRef: MutableRef<ReturnType<typeof setTimeout> | null>;
  cancelPreviousRunRef?: MutableRef<(() => void) | null>;
  isMountedRef: MutableRef<boolean>;
  timeoutMs?: number;
  onStatusChange?: (status: RefreshStatus) => void;
};

export type RefreshTimeoutResult = {
  token: number;
  timedOut: boolean;
};

export const runRefreshWithTimeout = async ({
  refreshFn,
  setRefreshing,
  requestTokenRef,
  activeRunRef,
  timeoutRef,
  cancelPreviousRunRef,
  isMountedRef,
  timeoutMs = 5000,
  onStatusChange,
}: RunRefreshWithTimeoutParams): Promise<RefreshTimeoutResult> => {
  if (cancelPreviousRunRef?.current) {
    cancelPreviousRunRef.current();
    cancelPreviousRunRef.current = null;
  }

  const runId = activeRunRef.current + 1;
  activeRunRef.current = runId;

  const requestToken = requestTokenRef.current + 1;
  requestTokenRef.current = requestToken;

  if (isMountedRef.current) {
    setRefreshing(true);
    onStatusChange?.('refreshing');
  }

  let timedOut = false;
  let settled = false;
  let cancelled = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let cancelResolve: (() => void) | null = null;

  const cancelCurrentRun = () => {
    if (settled || cancelled) return;
    cancelled = true;
    settled = true;
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      if (timeoutRef.current === timeoutHandle) {
        timeoutRef.current = null;
      }
      timeoutHandle = null;
    }
    cancelResolve?.();
  };

  if (cancelPreviousRunRef) {
    cancelPreviousRunRef.current = cancelCurrentRun;
  }

  const settleUi = () => {
    if (settled || cancelled) return;
    settled = true;

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    if (timeoutRef.current) {
      timeoutRef.current = null;
    }

    if (!isMountedRef.current) return;
    if (activeRunRef.current !== runId) return;
    setRefreshing(false);
    onStatusChange?.('completed');
  };

  const timeoutPromise = new Promise<void>(resolve => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      settleUi();
      resolve();
    }, timeoutMs);
    timeoutRef.current = timeoutHandle;
  });

  const canceledPromise = new Promise<void>(resolve => {
    cancelResolve = resolve;
  });

  const refreshPromise = (async () => {
    try {
      await refreshFn(requestToken);
    } finally {
      settleUi();
    }
  })();

  await Promise.race([refreshPromise, timeoutPromise, canceledPromise]);
  if (cancelPreviousRunRef?.current === cancelCurrentRun) {
    cancelPreviousRunRef.current = null;
  }
  return { token: requestToken, timedOut };
};

export default runRefreshWithTimeout;
