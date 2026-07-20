import { browser } from "$app/environment";
import { MAX_SAVED, parseSaved, removeByUrl, upsert, type SavedCard } from "./saved";

const KEY = "how2vote:saved:v1";

/**
 * The visitor's on-device library of saved how2vote cards.
 *
 * Privacy by construction: this lives only in this browser's localStorage. Nothing is ever sent to
 * a server, there is no account, and each card is just its shareable link (answers travel in the
 * URL fragment, not in a separate store). The visitor saves explicitly — nothing is written unless
 * they choose to — and can delete any card, or clear the lot, at any time. Clearing the site's
 * browser data also removes it. Mirrors the persistence pattern of the quiz store.
 */
class Saved {
  items = $state<SavedCard[]>([]);
  hydrated = $state(false);

  get count(): number {
    return this.items.length;
  }

  /** True once the list is full — surfaced so the UI can explain why the oldest card dropped off. */
  get atCapacity(): boolean {
    return this.items.length >= MAX_SAVED;
  }

  has(url: string): boolean {
    return this.items.some((c) => c.url === url);
  }

  /** Save (or refresh) a card. Idempotent per url; moves an existing card to the front. */
  save(card: Omit<SavedCard, "savedAt">): void {
    this.items = upsert(this.items, card, Date.now());
    this.persist();
  }

  remove(url: string): void {
    this.items = removeByUrl(this.items, url);
    this.persist();
  }

  clear(): void {
    this.items = [];
    if (browser) localStorage.removeItem(KEY);
  }

  hydrate(): void {
    this.hydrated = true;
    if (!browser) return;
    this.items = parseSaved(localStorage.getItem(KEY));
  }

  private persist(): void {
    if (!browser) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.items));
    } catch {
      // Storage full / disabled — the list still works for this session.
    }
  }
}

export const saved = new Saved();
