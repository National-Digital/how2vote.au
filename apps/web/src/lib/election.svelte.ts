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

  /** Switches election. No-op for an unknown id or the current one. */
  set(id: string): void {
    if (id === this.id || !electionById(id)) return;
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
  }
}

export const election = new ActiveElection();
