/**
 * A one-slot handoff for prefilling the chat composer from another view.
 *
 * The chat stays mounted while the operator is elsewhere, so Library can drop
 * an expert's `@Name ` straight into the composer without a provider: a module
 * level listener set is enough.
 */

type Seed = { text: string; nonce: number };

const listeners = new Set<(seed: Seed) => void>();

/** Hand a prompt to the chat composer. A fresh `nonce` marks it as new. */
export function seedComposer(text: string): void {
  const seed: Seed = { text, nonce: Date.now() };
  listeners.forEach((listener) => listener(seed));
}

/** Subscribe to composer seeds. Returns an unsubscribe function. */
export function onComposerSeed(listener: (seed: Seed) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
