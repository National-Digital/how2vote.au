import { browser } from "$app/environment";
import { ELECTION_IDS } from "@how2vote/data-schema";
import type { Answer, AnswerPoints } from "@how2vote/engine";
import { removeFromNative } from "./native-storage";

const KEY_PREFIX = "how2vote:quiz:v2:"; // v2: namespaced per election id
const key = (electionId: string): string => KEY_PREFIX + electionId;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // resume offered for 30 days

type StoredAnswer = { points: AnswerPoints; important: boolean };
type Persisted = {
  state: string | null;
  electorate: string | null;
  answers: Record<number, StoredAnswer>;
  cursor: number;
  questionIds: number[];
  updatedAt: number;
};

/**
 * Client-only quiz state (ballot selection, per-question answers, cursor), persisted to
 * localStorage after every change so closing the tab or losing signal never loses work
 * (WCAG 3.3.7 Redundant Entry). This is the single source of truth for the in-progress quiz;
 * a shared card, by contrast, is reconstructed from its URL fragment, not from here.
 *
 * Progress is kept separately per election: each election asks different questions, so switching
 * election swaps to that election's own saved answers rather than mixing them. The active fields
 * below always reflect {@link loadedId}; the root layout calls {@link useElection} whenever the
 * selected election changes.
 */
class Quiz {
  state = $state<string | null>(null);
  electorate = $state<string | null>(null);
  answers = $state<Record<number, StoredAnswer>>({});
  cursor = $state(0);
  hydrated = $state(false);

  /**
   * Canonical question ids, in scoring order. Sourced from the dataset — but the dataset loads
   * lazily (see $lib/data), so the ids are kept here (and persisted) rather than imported. Data
   * pages call {@link syncQuestions} once loaded; persistence means the home page can still show
   * the resume progress ("question 12 of 50") without pulling the dataset into its bundle.
   */
  questionIds = $state<number[]>([]);

  /** The election id the active fields currently belong to (null until first sync). */
  private loadedId: string | null = null;

  /** Number of questions with a recorded decision (an explicit skip counts). */
  get recorded(): number {
    return Object.keys(this.answers).length;
  }

  get total(): number {
    return this.questionIds.length;
  }

  get complete(): boolean {
    return this.recorded === this.total;
  }

  get hasBallot(): boolean {
    return this.state !== null && this.electorate !== null;
  }

  answerFor(id: number): StoredAnswer | undefined {
    return this.answers[id];
  }

  setBallot(state: string, electorate: string): void {
    this.state = state;
    this.electorate = electorate;
    this.persist();
  }

  /**
   * Records an answer for a question id (points 0 = skip). Importance is set separately on the
   * review screen via {@link toggleImportant}, so a fresh or re-answered question always starts
   * unstarred.
   */
  record(id: number, points: AnswerPoints, important = false): void {
    // Importance only exists on the extremes; enforce it here as a backstop to the UI.
    const imp = important && (points === 1 || points === 5);
    this.answers = { ...this.answers, [id]: { points, important: imp } };
    this.persist();
  }

  /**
   * Toggles the ×10 "extremely important" star on an already-answered question (review screen).
   * A no-op unless the recorded answer is an extreme (strongly agree/disagree), matching the
   * scoring model where importance only weights the two ends of the scale.
   */
  toggleImportant(id: number): void {
    const a = this.answers[id];
    if (a === undefined || (a.points !== 1 && a.points !== 5)) return;
    this.answers = { ...this.answers, [id]: { ...a, important: !a.important } };
    this.persist();
  }

  setCursor(index: number): void {
    this.cursor = Math.max(0, Math.min(index, this.total - 1));
    this.persist();
  }

  /**
   * Records the canonical question ids once the dataset has loaded. Idempotent, and persisted so a
   * returning visitor keeps an accurate quiz length before the dataset chunk is fetched again.
   */
  syncQuestions(ids: number[]): void {
    if (
      ids.length === this.questionIds.length &&
      ids.every((id, i) => id === this.questionIds[i])
    ) {
      return;
    }
    this.questionIds = ids;
    this.persist();
  }

  /** The full answer set in question order, unanswered questions defaulting to a skip. */
  toAnswers(): Answer[] {
    return this.questionIds.map((id) => {
      const a = this.answers[id];
      return { id, points: a?.points ?? 0, important: a?.important ?? false };
    });
  }

  reset(): void {
    this.state = null;
    this.electorate = null;
    this.answers = {};
    this.cursor = 0;
    // questionIds are build constants, not user work — keep them in memory so the home page's total
    // stays correct after a reset; the next persist (a fresh ballot) writes them back to storage.
    if (browser && this.loadedId) {
      localStorage.removeItem(key(this.loadedId));
      // Write through to the shells' durable copy, or the next launch restores what was just reset.
      void removeFromNative([key(this.loadedId)]);
    }
  }

  /**
   * Wipes saved quiz progress for EVERY election, not just the active one. Used when an under-18
   * declares eligibility (see $lib/age.svelte): they must never inherit answers or a plan left on the
   * device by a prior adult session, for ANY election. {@link reset} clears only the active election
   * (the right scope for "start again"); this clears the lot, fail-closed.
   */
  clearAllElections(): void {
    this.reset(); // in-memory fields + the active election's stored key
    if (!browser) return;
    // Remove each registered election's progress key by its resolvable "how2vote:" name (via key()),
    // so the clear-all namespace guard (scripts/check-clear-all.mjs) can prove every key is swept —
    // an opaque localStorage.key(i) sweep cannot be statically verified.
    for (const id of ELECTION_IDS) {
      try {
        localStorage.removeItem(key(id));
      } catch {
        // Storage disabled — nothing persisted to clear.
      }
    }
    // Write through to the shells' durable copy. Without this an under-18's declaration wipes the
    // prior adult session's answers from localStorage only, and the next launch heals them back.
    void removeFromNative(ELECTION_IDS.map(key));
  }

  /**
   * Points the active fields at `electionId`'s saved progress: persists whatever election was
   * loaded, then loads the target (or resets to defaults if none/expired). Idempotent — a repeat
   * call for the already-loaded election just marks the store hydrated.
   */
  useElection(electionId: string): void {
    if (electionId === this.loadedId) {
      this.hydrated = true;
      return;
    }
    if (this.loadedId) this.persist(); // save the outgoing election before switching
    this.loadedId = electionId;
    this.load(electionId);
    this.hydrated = true;
  }

  /** Loads persisted state for an election if present and fresh; otherwise resets to defaults. */
  private load(electionId: string): void {
    this.state = null;
    this.electorate = null;
    this.answers = {};
    this.cursor = 0;
    this.questionIds = [];
    if (!browser) return;
    try {
      const raw = localStorage.getItem(key(electionId));
      if (!raw) return;
      const p = JSON.parse(raw) as Persisted;
      if (typeof p.updatedAt !== "number" || Date.now() - p.updatedAt > MAX_AGE_MS) {
        localStorage.removeItem(key(electionId));
        return;
      }
      this.state = p.state ?? null;
      this.electorate = p.electorate ?? null;
      this.answers = p.answers ?? {};
      this.cursor = p.cursor ?? 0;
      this.questionIds = p.questionIds ?? [];
    } catch {
      // Corrupt state degrades to a fresh start rather than a crash.
      localStorage.removeItem(key(electionId));
    }
  }

  private persist(): void {
    if (!browser || !this.loadedId) return;
    // Age-first gate (see docs/adr/0011): no quiz state may be written before the 18+
    // eligibility declaration. This is defence-in-depth behind the layout route guard — it stops an
    // async page mount (a data load resolving into syncQuestions) from persisting quiz state during
    // the redirect to /start. The key is the one-bit acknowledgement written by the age-gate store
    // (see $lib/age.svelte, STORAGE_KEY "how2vote:age-ok:v1"). Spelled out as a LITERAL, not the
    // imported AGE_ELIGIBILITY_KEY: check-clear-all.mjs proves every key here is swept by resolving
    // it statically, and an imported const is unresolvable to it. Duplication the guard requires.
    try {
      if (localStorage.getItem("how2vote:age-ok:v1") !== "1") return;
    } catch {
      return;
    }
    const data: Persisted = {
      state: this.state,
      electorate: this.electorate,
      answers: this.answers,
      cursor: this.cursor,
      questionIds: this.questionIds,
      updatedAt: Date.now(),
    };
    try {
      localStorage.setItem(key(this.loadedId), JSON.stringify(data));
    } catch {
      // Storage full / disabled — the quiz still works for this session.
    }
  }
}

export const quiz = new Quiz();
