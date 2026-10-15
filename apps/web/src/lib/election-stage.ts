/**
 * Where an election stands, for what a page may say about it. Every surface that words an
 * election's stage — the landing, the card, the electorate list, /how-to-decide — reads it from
 * here, so no two of them can describe the same election differently.
 */
import {
  electionPhase,
  isElectionAnnounced,
  type ElectionMeta,
  type ElectionPhase,
} from "@how2vote/data-schema";

/**
 * What the election's dataset holds (scripts/ballot-states.mjs): no electorates, candidates in a
 * provisional neutral order before the AEC draw (ADR 0013 D2), or the drawn ballot.
 */
export type Ballot = "none" | "provisional" | "drawn";

/** A dataset's ballot; an omitted `ballotStatus` is `drawn`. */
export function ballotOf(ballots: { ballotStatus?: string; electorates: unknown[] }): Ballot {
  if (ballots.electorates.length === 0) return "none";
  return ballots.ballotStatus === "provisional" ? "provisional" : "drawn";
}

/**
 * - `unannounced` — no AEC timetable and no electorates: no candidates or ballot.
 * - `called`      — timetable recorded, nominations not declared, no electorates: no ballot yet.
 * - `listed`      — candidates are listed, but the ballot is not both declared and drawn: the
 *                   candidates and ballot order are not final (ADR 0013).
 * - `declared`    — the AEC has declared the candidates, but the dataset has no electorates yet.
 * - `ballot`      — the drawn ballot is loaded and nominations are declared; not yet held.
 * - `held`        — the election has been held.
 */
export type Stage = "unannounced" | "called" | "listed" | "declared" | "ballot" | "held";

export const STAGES: readonly Stage[] = [
  "unannounced",
  "called",
  "listed",
  "declared",
  "ballot",
  "held",
];

/**
 * @param phase - the election's lifecycle phase (`electionPhase`)
 * @param announced - an AEC timetable is recorded (`isElectionAnnounced`)
 * @param ballot - what the election's dataset holds
 */
export function stageAt(phase: ElectionPhase, announced: boolean, ballot: Ballot): Stage {
  if (phase === "archived") return "held";
  if (ballot !== "none") return phase === "live" && ballot === "drawn" ? "ballot" : "listed";
  if (phase === "live") return "declared";
  return announced ? "called" : "unannounced";
}

/**
 * Whether the plan builder may open: a declared, drawn ballot, or a held election's drawn ballot
 * as a historical demonstration. Never before the AEC declares the ballot order, never over a
 * provisional order, and never without electorates.
 */
export const plansOpen = (stage: Stage, ballot: Ballot): boolean =>
  stage === "ballot" || (stage === "held" && ballot === "drawn");

/** The stage of an election at a given phase, as the card and the iOS states pages read it. */
export function stageOfPhase(meta: ElectionMeta, phase: ElectionPhase, ballot: Ballot): Stage {
  return stageAt(phase, isElectionAnnounced(meta), ballot);
}

export function stageFor(meta: ElectionMeta, ballot: Ballot, now?: Date): Stage {
  return stageOfPhase(meta, electionPhase(meta, now), ballot);
}

type BuiltElection = { id: string; meta: ElectionMeta; ballot: Ballot };

/**
 * The stage the iOS app's `card-hint-parliament` section is worded for. The app draws that one
 * section for every election without electorates (`CardWording` keys it by `electorateLess` alone),
 * so the elections it covers must share a stage.
 */
export function parliamentHintStage(elections: BuiltElection[], now?: Date): Stage {
  const without = elections.filter((e) => e.ballot === "none");
  const stages = new Map(without.map((e) => [e.id, stageFor(e.meta, "none", now)]));
  const distinct = new Set(stages.values());
  if (distinct.size > 1) {
    const each = [...stages].map(([id, stage]) => `${id} is ${stage}`).join(", ");
    throw new Error(
      `card-hint-parliament cannot be worded for every election without electorates: ${each}. ` +
        "The iOS app draws that one section for all of them (CardWording keys the hint by " +
        "electorateLess alone), so it needs a section per stage before these can ship together.",
    );
  }
  return [...distinct][0] ?? "unannounced";
}

/**
 * Fails the build if an election with electorates is `listed`: the iOS app draws
 * `card-hint-ballot` for every election with electorates (`CardWording` keys the hint by
 * `electorateLess` alone), which offers a plan a listed election does not have.
 */
export function assertNoListedElection(elections: BuiltElection[], now?: Date): void {
  const listed = elections.filter(
    (e) => e.ballot !== "none" && stageFor(e.meta, e.ballot, now) === "listed",
  );
  if (listed.length > 0) {
    throw new Error(
      `${listed.map((e) => e.id).join(", ")} would be listed (candidates loaded before a declared, ` +
        "drawn ballot), but the iOS app would draw card-hint-ballot for it (CardWording keys the " +
        "hint by electorateLess alone). It needs a listed hint section before this can ship.",
    );
  }
}
