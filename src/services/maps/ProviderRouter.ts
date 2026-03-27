import { ProviderCandidate, ProviderRunResult } from './types';

type ProviderHealth = {
  failures: number;
  openUntil: number;
};

const healthMap = new Map<string, ProviderHealth>();

const getHealth = (providerId: string): ProviderHealth => {
  const current = healthMap.get(providerId);
  if (current) return current;
  const next: ProviderHealth = { failures: 0, openUntil: 0 };
  healthMap.set(providerId, next);
  return next;
};

const sleep = (ms: number) =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`timeout_${timeoutMs}`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

export class ProviderRouter {
  static async execute<TInput, TOutput>(
    candidates: Array<ProviderCandidate<TInput, TOutput>>,
    input: TInput,
    options?: { maxRetriesPerProvider?: number },
  ): Promise<ProviderRunResult<TOutput> | null> {
    const now = Date.now();
    const retries = Math.max(0, options?.maxRetriesPerProvider ?? 1);
    let attempts = 0;

    for (const candidate of candidates) {
      const health = getHealth(candidate.id);
      if (health.openUntil > now) {
        continue;
      }

      for (let retry = 0; retry <= retries; retry += 1) {
        attempts += 1;
        try {
          const result = await withTimeout(candidate.execute(input), candidate.timeoutMs);
          if (result === null || result === undefined) {
            throw new Error('empty_result');
          }

          health.failures = 0;
          health.openUntil = 0;

          return {
            data: result,
            providerId: candidate.id,
            connectionStatus: retry > 0 ? 'degraded' : 'online',
            attempts,
          };
        } catch {
          health.failures += 1;
          if (retry < retries) {
            const jitterMs = 60 + Math.round(Math.random() * 140);
            await sleep(jitterMs);
            continue;
          }

          if (health.failures >= 3) {
            const cooldown = candidate.cooldownMs ?? 30_000;
            health.openUntil = Date.now() + cooldown;
          }
        }
      }
    }

    return null;
  }
}

export default ProviderRouter;
