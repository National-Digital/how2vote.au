import type { Answer, AnswerPoints } from "./answers.js";

/**
 * Self-contained share links. The full answer set lives in the URL **fragment**,
 * which browsers never send to a server, so a shared card recomputes deterministically on any
 * device, offline, with no lookup and no stored state:
 *
 *   /card#v1.<election-id>.<electorate-slug>.<payload>
 *
 * Each answer packs into 4 bits (3 bits of points 0–5, 1 important flag). Fifty answers → 25 bytes
 * → ~34 base64url characters. The codec is dataset-aware only through the ordered question-id list
 * the caller supplies for the named election: answers are packed in that order and reconstructed
 * against it, so the link carries no question text and stays stable as long as the ordering is.
 */
export const SHARE_VERSION = "v1" as const;

/**
 * The version-PINNED share format, used for a provisional (upcoming-election) quiz whose questions may
 * still change:
 *
 *   /card#v2.<election-id>.<data-version>.<electorate-slug>.<payload>
 *
 * Two things differ from v1. (1) The payload names each answer by its **They Vote For You policy id**
 * (the question `id`) rather than encoding it positionally, so the binding of an answer to a
 * proposition never depends on the question ordering. (2) The link carries the dataset's `dataVersion`
 * and {@link decodeShare} refuses to decode unless it byte-matches the election's CURRENT dataVersion —
 * so any change to a provisional quiz (which bumps dataVersion) makes an old link fail closed to
 * "start again" instead of silently rebinding answers to a proposition that has since changed. A
 * `data-version` is an ISO date (hyphens, no dots), so it never collides with the `.` field delimiter.
 */
export const SHARE_VERSION_PINNED = "v2" as const;

/**
 * Upper bound on a fragment we will even attempt to decode. A genuine link is well under 100 chars
 * (a 50-answer payload is ~34 base64url chars plus the version/election/slug tokens); anything vastly
 * larger is malformed or hostile, so we reject it up front rather than allocate against it. Generous
 * enough to never reject a real link, small enough that a pathological fragment can't force a large
 * allocation in the decoder (fail-closed).
 */
const MAX_FRAGMENT_LENGTH = 4096;

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function bytesToBase64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64URL[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64URL[b2 & 0x3f];
  }
  return out;
}

function base64urlToBytes(str: string): Uint8Array {
  const lookup = new Map<string, number>([...B64URL].map((c, i) => [c, i]));
  const out: number[] = [];
  for (let i = 0; i < str.length; i += 4) {
    const c0 = lookup.get(str[i]!);
    const c1 = lookup.get(str[i + 1]!);
    if (c0 === undefined || c1 === undefined) throw new Error("invalid base64url payload");
    out.push((c0 << 2) | (c1 >> 4));
    // Distinguish "no more input" (a legitimate short final quad) from "a character is present but
    // invalid" (a corrupt payload). The latter must THROW, not silently drop the byte — a truncated
    // decode would otherwise be indistinguishable from a valid shorter card.
    if (i + 2 < str.length) {
      const c2 = lookup.get(str[i + 2]!);
      if (c2 === undefined) throw new Error("invalid base64url payload");
      out.push(((c1 & 0x0f) << 4) | (c2 >> 2));
      if (i + 3 < str.length) {
        const c3 = lookup.get(str[i + 3]!);
        if (c3 === undefined) throw new Error("invalid base64url payload");
        out.push(((c2 & 0x03) << 6) | c3);
      }
    }
  }
  return Uint8Array.from(out);
}

const isPoints = (n: number): n is AnswerPoints => n >= 0 && n <= 5;

/** Packs answers into a byte array, one nibble per question in `orderedIds` order. */
export function packAnswers(answers: readonly Answer[], orderedIds: readonly number[]): Uint8Array {
  const byId = new Map(answers.map((a) => [a.id, a]));
  const nibbles: number[] = orderedIds.map((id) => {
    const a = byId.get(id);
    if (a === undefined) return 0; // unanswered → skip
    return (a.points & 0b0111) | (a.important ? 0b1000 : 0);
  });
  const bytes = new Uint8Array(Math.ceil(nibbles.length / 2));
  for (let i = 0; i < nibbles.length; i++) {
    const byteIndex = i >> 1;
    bytes[byteIndex] = i % 2 === 0 ? nibbles[i]! << 4 : bytes[byteIndex]! | nibbles[i]!;
  }
  return bytes;
}

/** Reconstructs answers from packed bytes against the same ordered question-id list. */
export function unpackAnswers(bytes: Uint8Array, orderedIds: readonly number[]): Answer[] {
  const answers: Answer[] = [];
  for (let i = 0; i < orderedIds.length; i++) {
    const byte = bytes[i >> 1] ?? 0;
    const nibble = i % 2 === 0 ? byte >> 4 : byte & 0x0f;
    const rawPoints = nibble & 0b0111;
    const points: AnswerPoints = isPoints(rawPoints) ? rawPoints : 0;
    answers.push({ id: orderedIds[i]!, points, important: (nibble & 0b1000) !== 0 });
  }
  return answers;
}

/**
 * Packs answers as self-describing (id, nibble) records for the version-pinned v2 codec: 3 bytes of
 * big-endian question id (a They Vote For You policy id — comfortably inside 24 bits) plus 1 byte
 * carrying the same nibble v1 uses (3 bits points, 1 important flag). Only answered questions are
 * carried (a zero nibble is omitted and restored as "skip" on decode), so a partly-completed quiz
 * stays compact. Iterating `orderedIds` bounds the output to the CURRENT question set in a stable
 * order; an answer whose id is not a current question is dropped.
 */
export function packAnswersById(
  answers: readonly Answer[],
  orderedIds: readonly number[],
): Uint8Array {
  const byId = new Map(answers.map((a) => [a.id, a]));
  const out: number[] = [];
  for (const id of orderedIds) {
    const a = byId.get(id);
    if (a === undefined) continue;
    const nibble = (a.points & 0b0111) | (a.important ? 0b1000 : 0);
    if (nibble === 0) continue; // unanswered → omit; decode restores it as a skip
    out.push((id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff, nibble & 0x0f);
  }
  return Uint8Array.from(out);
}

/**
 * Reconstructs a FULL canonical answer set over `orderedIds` from v2 (id, nibble) records: every
 * current question gets an answer, defaulting to a skip when the payload did not carry it, and any
 * record whose id is not a current question is ignored. A trailing partial record (payload not a
 * multiple of 4 bytes) is ignored rather than throwing, so a corrupt-but-in-alphabet payload still
 * yields a safe, canonical answer set.
 */
export function unpackAnswersById(bytes: Uint8Array, orderedIds: readonly number[]): Answer[] {
  const present = new Set(orderedIds);
  const byId = new Map<number, { points: AnswerPoints; important: boolean }>();
  for (let i = 0; i + 4 <= bytes.length; i += 4) {
    const id = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    if (!present.has(id)) continue;
    const nibble = bytes[i + 3]! & 0x0f;
    const rawPoints = nibble & 0b0111;
    byId.set(id, {
      points: isPoints(rawPoints) ? rawPoints : 0,
      important: (nibble & 0b1000) !== 0,
    });
  }
  return orderedIds.map((id) => {
    const v = byId.get(id);
    return { id, points: v?.points ?? 0, important: v?.important ?? false };
  });
}

const slugify = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();

export type ShareCard = { electorate: string; answers: readonly Answer[] };

/**
 * Encodes a card into the fragment string (without the leading `#`):
 *
 *   v1.<election-id>.<electorate-slug>.<payload>
 *
 * The election id is carried explicitly because each election has a different question set and
 * ordering — the payload can only be unpacked against the right election's ordered ids, so the link
 * must name it. `orderedIds` must be that election's ordering.
 */
export function encodeShare(
  card: ShareCard,
  orderedIds: readonly number[],
  electionId: string,
): string {
  const payload = bytesToBase64url(packAnswers(card.answers, orderedIds));
  return `${SHARE_VERSION}.${electionId}.${slugify(card.electorate)}.${payload}`;
}

/**
 * Encodes a card into the version-PINNED v2 fragment (without the leading `#`):
 *
 *   v2.<election-id>.<data-version>.<electorate-slug>.<payload>
 *
 * Use this for a provisional quiz (an upcoming election, phase `upcoming`) whose questions can still
 * change: `dataVersion` is the current dataset's vintage, and {@link decodeShare}
 * will only decode the link while the election's dataVersion still matches. `orderedIds` is the
 * election's current ordered question-id list. See {@link SHARE_VERSION_PINNED}.
 */
export function encodeShareV2(
  card: ShareCard,
  orderedIds: readonly number[],
  electionId: string,
  dataVersion: string,
): string {
  const payload = bytesToBase64url(packAnswersById(card.answers, orderedIds));
  return `${SHARE_VERSION_PINNED}.${electionId}.${dataVersion}.${slugify(card.electorate)}.${payload}`;
}

export type DecodedShare = {
  version: string;
  electionId: string;
  electorateSlug: string;
  answers: Answer[];
};

/**
 * Decodes a fragment string back into an election id, electorate slug and answers. Because the
 * election is embedded in the link but the ordered id list needed to unpack the payload depends on
 * it, the caller supplies a resolver from election id → that election's ordered ids (returning
 * undefined for an unknown election). The caller then maps the slug to a real electorate against
 * that election's dataset. Returns `null` for anything unrecognised, so a malformed or stale link
 * degrades to "start again" rather than throwing.
 *
 * A version-PINNED `v2.<election-id>.<data-version>.<slug>.<payload>` link additionally carries the
 * dataset vintage it was produced against. It decodes ONLY when the caller supplies `dataVersionFor`
 * and the election's current dataVersion byte-matches the link's — otherwise it fails closed to null
 * ("start again"), so a provisional quiz that has changed can never silently rebind stale answers.
 */
export function decodeShare(
  fragment: string,
  orderedIdsFor: (electionId: string) => readonly number[] | undefined,
  dataVersionFor?: (electionId: string) => string | undefined,
): DecodedShare | null {
  if (typeof fragment !== "string" || fragment.length > MAX_FRAGMENT_LENGTH) return null;
  const clean = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const parts = clean.split(".");

  let version: string, electionId: string, electorateSlug: string, payload: string;
  let pinnedDataVersion: string | null = null;
  if (parts.length === 5 && parts[0] === SHARE_VERSION_PINNED) {
    [version, electionId, pinnedDataVersion, electorateSlug, payload] = parts as [
      string,
      string,
      string,
      string,
      string,
    ];
    if (pinnedDataVersion.length === 0) return null;
  } else if (parts.length === 4 && parts[0] === SHARE_VERSION) {
    [version, electionId, electorateSlug, payload] = parts as [string, string, string, string];
  } else {
    return null;
  }
  if (electionId.length === 0 || electorateSlug.length === 0 || payload.length === 0) return null;

  // Everything past here — including the caller-supplied resolvers — runs inside the guard, so a
  // malformed payload OR a resolver that throws degrades to "start again" (null), never a crash.
  try {
    const orderedIds = orderedIdsFor(electionId);
    if (!orderedIds) return null;
    if (pinnedDataVersion !== null) {
      // Version pin (v2): only decode while the provisional quiz is byte-identical to the one that
      // produced the link. A missing resolver or any mismatch fails closed.
      const current = dataVersionFor?.(electionId);
      if (current === undefined || current !== pinnedDataVersion) return null;
      return {
        version,
        electionId,
        electorateSlug,
        answers: unpackAnswersById(base64urlToBytes(payload), orderedIds),
      };
    }
    return {
      version,
      electionId,
      electorateSlug,
      answers: unpackAnswers(base64urlToBytes(payload), orderedIds),
    };
  } catch {
    return null;
  }
}

/**
 * Extracts just the election id a fragment names, without unpacking the payload. Lets a caller that
 * loads each election's dataset lazily discover which one to fetch before it can build the ordered
 * ids that {@link decodeShare} needs. Returns `null` for an unrecognised fragment.
 */
export function shareElectionId(fragment: string): string | null {
  if (typeof fragment !== "string" || fragment.length > MAX_FRAGMENT_LENGTH) return null;
  const clean = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  const parts = clean.split(".");
  if (parts.length === 5 && parts[0] === SHARE_VERSION_PINNED) return parts[1] || null;
  if (parts.length === 4 && parts[0] === SHARE_VERSION) return parts[1] || null;
  return null;
}

export { slugify };
