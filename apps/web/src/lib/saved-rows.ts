import { stateName } from "./data";
import type { SavedCard } from "./saved";

/** A saved card as the saved-cards screen lists it: its link, its electorate and its values. */
export type SavedRow = { url: string; electorate: string; state: string; date: string };

const dateFmt = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * The saved cards, as the saved page lists them. The iOS app is handed the same rows, so the state's
 * name and the date read as the page writes them.
 */
export function savedRows(items: readonly SavedCard[]): SavedRow[] {
  return items.map((card) => ({
    url: card.url,
    electorate: card.electorate,
    state: stateName(card.state),
    date: dateFmt.format(new Date(card.savedAt)),
  }));
}
