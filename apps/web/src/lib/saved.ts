/**
 * Pure data logic for the on-device "saved cards" list — kept separate from the Svelte-runes store
 * (saved.svelte.ts) so it can be unit-tested without a component runtime.
 *
 * A saved card is nothing more than its shareable link plus a little display metadata: the answers
 * live entirely in the URL fragment (see the card page's encodeShare), so the same link both
 * identifies the card and reconstructs it — no answer data is duplicated into storage. Because it's
 * only a link + electorate name + timestamp, a saved card reveals no more than a shared link would,
 * and it never leaves the device (see saved.svelte.ts).
 */

export type SavedCard = {
  /** The shareable path, including the `#`-fragment, e.g. "/card#v1.…". Also the dedupe key. */
  url: string;
  /** Electorate/division name, for display. */
  electorate: string;
  /** State code (NSW, VIC, …), for display. */
  state: string;
  /** Epoch ms the card was saved (most recent save wins on a re-save). */
  savedAt: number;
};

/** Newest-first cap on stored cards, so the list can never grow without bound. */
export const MAX_SAVED = 50;

/** Narrow an unknown value to a well-formed SavedCard (defensive against corrupt/old storage). */
export function isSavedCard(value: unknown): value is SavedCard {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.url === "string" &&
    c.url.length > 0 &&
    typeof c.electorate === "string" &&
    typeof c.state === "string" &&
    typeof c.savedAt === "number" &&
    Number.isFinite(c.savedAt)
  );
}

/** Parse the persisted JSON into a clean, newest-first list; anything malformed is dropped. */
export function parseSaved(raw: string | null): SavedCard[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedCard).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/**
 * Insert or refresh a card. Saving a card that's already stored (same url) moves it to the front
 * and updates its timestamp rather than duplicating it. The list is capped at {@link MAX_SAVED}.
 */
export function upsert(
  items: SavedCard[],
  card: Omit<SavedCard, "savedAt">,
  now: number,
): SavedCard[] {
  const rest = items.filter((c) => c.url !== card.url);
  return [{ ...card, savedAt: now }, ...rest].slice(0, MAX_SAVED);
}

/** Remove a card by its url (the dedupe key). */
export function removeByUrl(items: SavedCard[], url: string): SavedCard[] {
  return items.filter((c) => c.url !== url);
}
