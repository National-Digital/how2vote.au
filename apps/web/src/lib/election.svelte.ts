import { browser } from "$app/environment";
import { CURRENT_ELECTION_ID, electionById, type ElectionMeta } from "@how2vote/data-schema";
import { manifestFor, type Manifest } from "./manifest";

const KEY = "how2vote:election:v1";

/**
 * The election the app is currently showing. Selecting an election changes the questions the quiz
 * asks, the ballot the card is built for, and the vintage the footer reports. The dataset itself is
 * loaded lazily per election (see $lib/data), so this store holds only the id and the tiny,
 * statically-available metadata/manifest — screens read the id and call `loadData(id)` when they
 * need the dataset. Defaults to the current election; the choice is persisted so a returning
 * visitor stays where they were, and opening a shared card sets it to that card's election.
 *
 * The root layout drives this from the URL (a `/2019` landing selects 2019; `/` is current) and
 * re-syncs the quiz to the matching election's saved progress on every change.
 */
class ActiveElection {
  id = $state<string>(CURRENT_ELECTION_ID);

  get meta(): ElectionMeta {
    return electionById(this.id) ?? electionById(CURRENT_ELECTION_ID)!;
  }
  get manifest(): Manifest {
    return manifestFor(this.id);
  }

  /**
   * True once the store holds the visitor's choice — restored from storage, or set by the route —
   * from which point it, not the stored value, is the choice.
   */
  settled = false;

  /** Switches election. No-op for an unknown id or the current one. */
  set(id: string): void {
    if (!electionById(id)) return;
    this.settled = true;
    if (id === this.id) return;
    this.id = id;
    this.save();
  }

  private save(): void {
    if (!browser) return;
    try {
      localStorage.setItem(KEY, this.id);
    } catch {
      // storage disabled — selection still holds for this session
    }
  }

  /** Restores the persisted selection (used on a direct load of a flow route). */
  hydrate(): void {
    if (!browser) return;
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && electionById(saved)) this.id = saved;
    } catch {
      // ignore corrupt/blocked storage
    }
    this.settled = true;
  }
}

export const election = new ActiveElection();

/**
 * The election the visitor last chose, as stored — readable before the store has restored it, as it
 * has not on a direct load when the native router first asks. Null when none is stored.
 */
export function savedElectionId(): string | null {
  if (!browser) return null;
  try {
    const saved = localStorage.getItem(KEY);
    return saved && electionById(saved) ? saved : null;
  } catch {
    return null;
  }
}
