// Must precede schema construction; see ./zod-runtime.ts.
import "./zod-runtime.js";
import { z } from "zod";

/**
 * The registry of elections the dataset covers. Each election is a fully self-contained
 * {@link Dataset} (its own questions, party positions and ballots), built into `data/dist/<id>/`
 * and listed in `data/dist/elections.json`. The app reads this registry to drive the election
 * toggle; the pipeline reads it to know which elections to migrate and build.
 *
 * `id` doubles as the on-disk directory name, the URL / share-link token and the localStorage
 * namespace, so it must be a short, stable, URL-safe slug.
 */
export const electionMetaSchema = z
  .object({
    /** Stable slug — directory name, share-link token, store key. */
    id: z.string().regex(/^[a-z0-9-]+$/, "election id must be a url-safe slug"),
    year: z.number().int(),
    /** Full display label, e.g. "2025 Federal Election". */
    label: z.string().min(1),
    /** Compact label for the toggle, e.g. "2025". */
    shortLabel: z.string().min(1),
    /**
     * Polling day (ISO date). Optional: an `upcoming` election that has not been announced has no
     * polling day yet (see `provisionalStage`). A refinement below requires it whenever a `timetable`
     * is present, so every scheduled election still carries one.
     */
    date: z.string().date().optional(),
    /** The most recent election — the app's default selection. Exactly one election is current. */
    current: z.boolean(),
    /**
     * The lifecycle of a placeholder UPCOMING election that targets a parliament period but has no AEC
     * timetable yet, so its stage cannot be derived from milestones. Set ONLY when `timetable` is
     * absent; a scheduled election derives its lifecycle from the timetable instead. Walks:
     *  - `pending`     — questions still in flight (may be re-curated); no candidates; party-alignment
     *                    comparison only.
     *  - `provisional` — questions locked; candidates not yet officially drawn (any shown render in a
     *                    neutral randomised order — see `ballotStatus`).
     *  - `drawn`       — everything locked; official ballot order. At this point the election is being
     *                    called and gains a real `timetable`, graduating to a normal election.
     * It is also the research collection cohort for the placeholder (see functions/api/research.ts),
     * so a pending wave is never mixed with a provisional one (a locked-questions series break).
     */
    provisionalStage: z.enum(["pending", "provisional", "drawn"]).optional(),
    /**
     * The official AEC electoral timetable for this election — the SINGLE, authoritative source for
     * every date/time on which the product's lifecycle and the research collection context turn
     * No timing is derived from magic-number day offsets: the phase
     * boundaries are exactly the AEC milestones below. Each set is transcribed from the AEC timetable
     * page in `source` and should be updated only against that page.
     *
     * All instants use the AEC's reference time zone (Canberra, UTC+10) and take the LATEST national
     * time, so a boundary is only crossed once it has been reached everywhere in Australia. The
     * declaration / polls-close / return-of-writs milestones fall in autumn (outside daylight saving),
     * so +10:00 is exact for them. The issue-of-writ day (the writ-window start) can fall during
     * daylight saving — it is modelled at the +10:00 start-of-day as a deliberately coarse,
     * day-granular boundary, so the ≤1h DST offset there is immaterial:
     *  - `declarationOfNominations` is when nominations AND the ballot draw are declared (ballot order
     *    becomes final) — the point the plan builder may open. Modelled at noon AEST.
     *  - `pollsCloseAt` is when the LAST polls close nationally — 6 pm AWST, expressed in Canberra
     *    time as 8 pm AEST (UTC+8 + 2h). After it, polls have closed everywhere: a contribution is
     *    post-election.
     *  - `returnOfWrits` is the last day for return of the writs (end of day AEST); after it the
     *    election is historical.
     */
    timetable: z
      .object({
        issueOfWrit: z.string().date(),
        closeOfRolls: z.string().date(),
        closeOfNominations: z.string().date(),
        /** Declaration of nominations = ballot order final. Noon AEST (Canberra). */
        declarationOfNominations: z.string().datetime({ offset: true }),
        /** Last polls close nationally: 6 pm AWST = 8 pm AEST (Canberra) on polling day. */
        pollsCloseAt: z.string().datetime({ offset: true }),
        /** Last day for return of the writs (end of day AEST, Canberra). */
        returnOfWrits: z.string().datetime({ offset: true }),
        /** The AEC timetable page these dates are transcribed from (authoritative). */
        source: z.string().url(),
      })
      .strict()
      .optional(),
    /** Data vintage surfaced on the card: latest division the positions are compiled from. */
    dataVersion: z.string().date(),
  })
  .strict()
  .superRefine((m, ctx) => {
    // A scheduled election (one with an AEC timetable) must carry its polling day; only an
    // unannounced placeholder may omit it.
    if (m.timetable && m.date === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["date"],
        message: "date (polling day) is required when a timetable is present",
      });
    }
    // provisionalStage models the lifecycle of a placeholder that has no timetable; a real election's
    // lifecycle comes from the timetable, so the two must not both be set.
    if (m.timetable && m.provisionalStage !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provisionalStage"],
        message: "provisionalStage must not be set when a timetable is present",
      });
    }
  });
export type ElectionMeta = z.infer<typeof electionMetaSchema>;

/**
 * The stage of an election on the AEC electoral timetable, from the perspective of a person acting
 * now. This is the SINGLE classifier both the product and the research pipeline use, so a screen and
 * a stored record can never disagree about where an election sits. Boundaries are the AEC milestones
 * (see `timetable`), never day-offset heuristics:
 *
 * - `pre-declaration` — before the declaration of nominations: candidates/ballot order are not final.
 * - `live`            — from declaration of nominations until the last polls close: the ballot is
 *                       final and a plan is for use at this election.
 * - `post-election`   — from poll close until the return of the writs: the election has been held.
 * - `historical`      — after the return of the writs: the election is formally concluded.
 * - `unknown`         — no timetable is recorded, so the stage cannot be determined authoritatively.
 *
 * `now` is injectable so the function is pure (prerender-safe and testable); it defaults to the wall
 * clock. Because the boundaries are fixed calendar instants, a past election's stage never changes.
 */
export type ElectionStage = "pre-declaration" | "live" | "post-election" | "historical" | "unknown";

export const electionStage = (meta: ElectionMeta, now: Date = new Date()): ElectionStage => {
  const t = meta.timetable;
  if (!t) return "unknown";
  const n = now.getTime();
  if (n < Date.parse(t.declarationOfNominations)) return "pre-declaration";
  if (n < Date.parse(t.pollsCloseAt)) return "live";
  if (n < Date.parse(t.returnOfWrits)) return "post-election";
  return "historical";
};

/**
 * The product lifecycle phase, derived from the timetable stage — never from the `current` toggle:
 *
 * - `upcoming`  — ballot not yet final (pre-declaration) or timetable unknown: comparison browsing
 *                 only; the plan builder stays closed.
 * - `live`      — the campaign window: the plan builder is open and its outputs are for use at this
 *                 election.
 * - `archived`  — the election has been held (post-election or historical): a HISTORICAL
 *                 DEMONSTRATION, clearly labelled retrospective and never presented as instructions
 *                 for a current vote.
 *
 * `unknown` is treated as `upcoming` so a missing timetable can never open a live plan by accident.
 */
export type ElectionPhase = "upcoming" | "live" | "archived";

export const electionPhase = (meta: ElectionMeta, now?: Date): ElectionPhase => {
  switch (electionStage(meta, now)) {
    case "live":
      return "live";
    case "post-election":
    case "historical":
      return "archived";
    default:
      return "upcoming";
  }
};

/** Whether an election is a historical demonstration (it has been held). */
export const isArchivedElection = (meta: ElectionMeta, now?: Date): boolean =>
  electionPhase(meta, now) === "archived";

/**
 * The writ window — the only period the TVFY snapshot may be (re)fetched from the live API
 * (ADR 0005): from the start of the day the writs are issued (AEC reference time, AEST) up to,
 * but not including, the declaration of nominations, at which point the snapshot locks. Null when
 * no timetable is recorded (the election must be added to {@link ELECTIONS} first).
 */
export const writWindow = (meta: ElectionMeta): { start: number; end: number } | null => {
  const t = meta.timetable;
  if (!t) return null;
  return {
    start: Date.parse(`${t.issueOfWrit}T00:00:00+10:00`),
    end: Date.parse(t.declarationOfNominations),
  };
};

/**
 * Whether `now` falls within the polling-day window during which live analysis is withheld: from
 * 00:00 at the start of polling day up to (but not including) `pollsCloseAt` — the last national
 * poll close, 8 pm AEST. Both boundaries are fixed instants in the AEC reference zone (+10:00,
 * AEST — federal polls fall outside daylight saving), so the visitor's local zone is irrelevant and
 * a past polling day never re-triggers. Pure and prerender-safe: `now` is injectable and defaults
 * to the wall clock. False when no timetable is recorded (the window cannot be determined).
 *
 * Used to close the survey Insights page on election day (see docs/adr/0014-election-day-notice.md):
 * `< pollsCloseAt` matches the `electionStage` "live" boundary exactly, so the window ends the
 * instant the election stops being `live`.
 */
export const isPollingDayNoticeWindow = (meta: ElectionMeta, now: Date = new Date()): boolean => {
  const t = meta.timetable;
  if (!t) return false;
  const start = Date.parse(`${meta.date}T00:00:00+10:00`);
  const end = Date.parse(t.pollsCloseAt);
  const n = now.getTime();
  return n >= start && n < end;
};

export const electionsIndexSchema = z.array(electionMetaSchema).min(1);
export type ElectionsIndex = z.infer<typeof electionsIndexSchema>;

/**
 * Single source of truth for which elections exist and how they present. Ordered newest-first,
 * which is the order the toggle renders. `dataVersion` is the last division date the positions were
 * compiled from (the historical sets were compiled by the original how2vote.com.au at the time).
 */
export const ELECTIONS: ElectionMeta[] = [
  {
    // The upcoming election for the current (48th) Parliament — a PROVISIONAL comparison shipped before
    // the election is announced. No AEC timetable/date/ballot yet: positions are compiled from the
    // current Parliament's voting record and the questions are still in flight (provisionalStage
    // "pending"). A non-year id so the year-keyed provenance gates treat it as the in-flight placeholder
    // it is; it graduates to a normal election (real timetable + ballot) once the election is called.
    id: "next",
    year: 2028,
    label: "Next Federal Election",
    shortLabel: "Next",
    // The default selection: post-2025-election, the forward-looking provisional comparison is the
    // primary experience (the landing at `/`). It carries no ballot yet (provisionalStage "pending").
    current: true,
    provisionalStage: "pending",
    dataVersion: "2026-06-23",
  },
  {
    id: "2025",
    year: 2025,
    label: "2025 Federal Election",
    shortLabel: "2025",
    date: "2025-05-03",
    current: false,
    // AEC timetable: https://www.aec.gov.au/elections/federal_elections/2025/timetable.htm
    timetable: {
      issueOfWrit: "2025-03-31",
      closeOfRolls: "2025-04-07",
      closeOfNominations: "2025-04-10",
      declarationOfNominations: "2025-04-11T12:00:00+10:00",
      pollsCloseAt: "2025-05-03T20:00:00+10:00",
      returnOfWrits: "2025-06-12T23:59:59+10:00",
      source: "https://www.aec.gov.au/elections/federal_elections/2025/timetable.htm",
    },
    dataVersion: "2025-03-28",
  },
  {
    id: "2022",
    year: 2022,
    label: "2022 Federal Election",
    shortLabel: "2022",
    date: "2022-05-21",
    current: false,
    // AEC timetable: https://www.aec.gov.au/elections/federal_elections/2022/timetable.htm
    timetable: {
      issueOfWrit: "2022-04-11",
      closeOfRolls: "2022-04-18",
      closeOfNominations: "2022-04-21",
      declarationOfNominations: "2022-04-22T12:00:00+10:00",
      pollsCloseAt: "2022-05-21T20:00:00+10:00",
      returnOfWrits: "2022-06-23T23:59:59+10:00",
      source: "https://www.aec.gov.au/elections/federal_elections/2022/timetable.htm",
    },
    dataVersion: "2022-05-04",
  },
  {
    id: "2019",
    year: 2019,
    label: "2019 Federal Election",
    shortLabel: "2019",
    date: "2019-05-18",
    current: false,
    // AEC timetable: https://www.aec.gov.au/elections/federal_elections/2019/timetable.htm
    timetable: {
      issueOfWrit: "2019-04-11",
      closeOfRolls: "2019-04-18",
      closeOfNominations: "2019-04-23",
      declarationOfNominations: "2019-04-24T12:00:00+10:00",
      pollsCloseAt: "2019-05-18T20:00:00+10:00",
      returnOfWrits: "2019-06-21T23:59:59+10:00",
      source: "https://www.aec.gov.au/elections/federal_elections/2019/timetable.htm",
    },
    dataVersion: "2019-05-09",
  },
];

/** The default election id (the current one). */
export const CURRENT_ELECTION_ID: string = ELECTIONS.find((e) => e.current)?.id ?? ELECTIONS[0]!.id;

export const electionById = (id: string): ElectionMeta | undefined =>
  ELECTIONS.find((e) => e.id === id);

/** All election ids, newest-first. */
export const ELECTION_IDS: string[] = ELECTIONS.map((e) => e.id);
