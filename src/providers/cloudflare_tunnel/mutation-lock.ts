const mutationTails = new Map<string, Promise<void>>();

/**
 * Serializes mutations sharing a key inside this Node.js process.
 * This does not coordinate with other runtimes or Cloudflare Dashboard writes.
 */
export async function withProcessLocalMutationLock<T>(key: string, mutate: () => Promise<T>): Promise<T> {
  const previous = mutationTails.get(key) ?? Promise.resolve();
  let release = (): void => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  mutationTails.set(key, current);

  await previous;
  try {
    return await mutate();
  } finally {
    release();
    if (mutationTails.get(key) === current) {
      mutationTails.delete(key);
    }
  }
}
