import { openDB } from './storage';
import { generationHeaders, RESET_GENERATION } from './reset-generation';
const initialized = new Set<string>();
const initializing = new Map<string, Promise<void>>();
/** A signed-in workspace stays unavailable until owner-scoped cleanup is verified. */
export function initializeCloudWorkspace(owner: string): Promise<void> {
  if (owner === 'guest') return openDB().then(() => undefined);
  if (initialized.has(owner)) return Promise.resolve();
  const pending = initializing.get(owner);
  if (pending) return pending;
  const operation = (async () => {
    const database = await openDB();
    const complete = await new Promise<boolean>((resolve, reject) => {
      const request = database
        .transaction('reset')
        .objectStore('reset')
        .get(`cloud:${owner}`);
      request.onsuccess = () => resolve(request.result === RESET_GENERATION);
      request.onerror = () => reject(request.error);
    });
    if (complete) {
      initialized.add(owner);
      return;
    }
    for (let attempt = 0; attempt < 200; attempt++) {
      const response = await fetch('/api/workspace/reset', {
        method: 'POST',
        headers: generationHeaders,
        signal: AbortSignal.timeout(30000),
        cache: 'no-store',
      });
      const progress = (await response.json()) as {
        error?: string;
        generation?: string;
        complete?: boolean;
      };
      if (!response.ok)
        throw new Error(
          progress.error ||
            'Workspace reset could not finish. Reconnect and retry.',
        );
      if (progress.generation !== RESET_GENERATION)
        throw new Error('Invalid workspace reset response.');
      if (progress.complete) {
        await new Promise<void>((resolve, reject) => {
          const tx = database.transaction('reset', 'readwrite');
          tx.objectStore('reset').put(RESET_GENERATION, `cloud:${owner}`);
          tx.oncomplete = () => resolve();
          tx.onabort = tx.onerror = () => reject(tx.error);
        });
        initialized.add(owner);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Workspace cleanup is continuing. Retry to resume.');
  })().finally(() => initializing.delete(owner));
  initializing.set(owner, operation);
  return operation;
}
