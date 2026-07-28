/**
 * Capture and the inbox (SPEC §14).
 *
 * The inbox is the answer to a single design constraint: capturing must never
 * take longer than the note on the fridge (P-04), so nothing may ask a question
 * at the moment of capture. Whatever cannot be placed with confidence lands here
 * instead of being guessed or dropped (FR-1113, AI-05), and is swiped away in
 * seconds later (FR-1114) — with a visible counter so the pile cannot grow
 * quietly (FR-1115).
 *
 * Two things this file is deliberately *not*: it does not talk to an AI (that
 * runs server-side, AI-01 — extraction arrives here as plain fields), and it
 * never invents a target type. Everything ingested becomes an event, a task or a
 * deadline; external sources get no data type of their own (FR-801).
 */
import {
  EntityTypes,
  readNumber,
  readOptionalNumber,
  readOptionalString,
  readString,
  readStringList,
} from "./schema.js";
import type { FamilyState } from "./state.js";

export type CaptureSource = "voice" | "photo" | "mail" | "share" | "screenshot";
export type TriageState = "new" | "triaged" | "dismissed";

/** The only targets triage may produce — no data type of its own (FR-801). */
export type TriageTarget = "event" | "task" | "shoppingItem" | "document" | "collectionItem" | "protocol";

/** What the server-side extraction made of a capture (FR-1106). All optional:
 * a missing field is a fact about the input, not an error. */
export interface ExtractedFields {
  readonly title: string | undefined;
  readonly startsAt: number | undefined;
  readonly dueAt: number | undefined;
  /** A return-by date, which is what turns a parent letter into a task (FR-807). */
  readonly deadlineAt: number | undefined;
  readonly place: string | undefined;
  readonly personIds: readonly string[];
  readonly itemName: string | undefined;
}

export interface InboxItem {
  readonly id: string;
  readonly source: CaptureSource;
  readonly capturedAt: number;
  readonly capturedBy: string | undefined;
  /** Raw text: transcript, OCR, mail body or shared message. */
  readonly text: string;
  /** Sender of a forwarded mail (FR-1103) — the hook most rules key on. */
  readonly sender: string | undefined;
  readonly state: TriageState;
  readonly extracted: ExtractedFields;
  /** What the server-side extractor concluded, when it concluded anything. */
  readonly suggestedTarget: TriageTarget | undefined;
  readonly confidence: number;
}

export function readInboxItem(state: FamilyState, itemId: string): InboxItem | undefined {
  const entity = state.get(EntityTypes.inboxItem, itemId);
  if (entity === undefined || entity.deleted) return undefined;

  const recordedState = readString(entity, "state");

  return {
    id: entity.id,
    source: sourceOf(readString(entity, "source")),
    capturedAt: readNumber(entity, "capturedAt"),
    capturedBy: readOptionalString(entity, "capturedBy"),
    text: readString(entity, "text"),
    sender: readOptionalString(entity, "sender"),
    state: recordedState === "triaged" || recordedState === "dismissed" ? recordedState : "new",
    extracted: {
      title: readOptionalString(entity, "title"),
      startsAt: readOptionalNumber(entity, "startsAt"),
      dueAt: readOptionalNumber(entity, "dueAt"),
      deadlineAt: readOptionalNumber(entity, "deadlineAt"),
      place: readOptionalString(entity, "place"),
      personIds: readStringList(entity, "personIds"),
      itemName: readOptionalString(entity, "itemName"),
    },
    suggestedTarget: targetOf(readOptionalString(entity, "suggestedTarget")),
    confidence: readNumber(entity, "confidence"),
  };
}

function sourceOf(value: string): CaptureSource {
  return value === "photo" || value === "mail" || value === "share" || value === "screenshot" ? value : "voice";
}

function targetOf(value: string | undefined): TriageTarget | undefined {
  switch (value) {
    case "event":
    case "task":
    case "shoppingItem":
    case "document":
    case "collectionItem":
    case "protocol":
      return value;
    default:
      return undefined;
  }
}

/** Untriaged captures, oldest first — the order they are swiped through (FR-1114). */
export function openInboxItems(state: FamilyState): readonly InboxItem[] {
  return state
    .all(EntityTypes.inboxItem)
    .map((entity) => readInboxItem(state, entity.id))
    .filter((item): item is InboxItem => item !== undefined && item.state === "new")
    .sort((a, b) => a.capturedAt - b.capturedAt || (a.id < b.id ? -1 : 1));
}

/**
 * The visible counter (FR-1115).
 *
 * Dismissed items are excluded on purpose: a counter that also counts what the
 * family has already decided to ignore stops being a number anybody acts on.
 */
export function inboxCount(state: FamilyState): number {
  return openInboxItems(state).length;
}

export interface TriageSuggestion {
  readonly target: TriageTarget;
  /** 0..1. Never rounded up to look decisive — fuzziness over false precision (P-08). */
  readonly confidence: number;
  /** Exactly what the one-swipe action would fill in (FR-1114). */
  readonly fields: Readonly<Record<string, string | number>>;
  /** Required fields the extraction could not supply — the one question triage may ask. */
  readonly missing: readonly string[];
  readonly certain: boolean;
  readonly reason: string;
}

/** Above this the swipe pre-commits; below it the target is offered, not assumed. */
export const TRIAGE_CERTAIN_AT = 0.6;

const REQUIRED_FIELDS: Readonly<Record<TriageTarget, readonly string[]>> = {
  event: ["title", "startsAt"],
  task: ["title"],
  shoppingItem: ["itemName"],
  document: ["title"],
  collectionItem: ["title"],
  protocol: ["title"],
};

/**
 * Marker words that place a capture without a date.
 *
 * German alongside English because the app ships in both from launch (§2.4) and
 * because this is *user* vocabulary, not source language — a family speaks into
 * the app in German and the parser has to hear it.
 */
const COLLECTION_MARKERS: readonly string[] = ["gift idea", "present for", "wish list", "wishlist", "idea for", "geschenkidee", "geschenk für", "wunschliste", "idee für"];
const PROTOCOL_MARKERS: readonly string[] = ["times a day", "twice a day", "eye drops", "antibiotic", "dose", "mal täglich", "tropfen", "antibiotikum", "medikament"];

/**
 * The most likely target for one swipe (FR-1114).
 *
 * Order is deliberate: an extracted date is the strongest evidence there is, so
 * it beats every keyword. When nothing decides, the fallback is a task with a
 * low confidence — "somebody has to look at this" is the one statement that is
 * always true of an inbox item, and marking it uncertain keeps the app from
 * pretending (P-08, AI-05).
 */
export function triageSuggestion(item: InboxItem): TriageSuggestion {
  const e = item.extracted;
  const title = e.title ?? firstLine(item.text);

  // The server-side extractor already decided; the client does not second-guess
  // it, it only reports how sure it was (AI-01, AI-04).
  if (item.suggestedTarget !== undefined) {
    return build(item.suggestedTarget, item.confidence, item, title, "Recognized during processing");
  }

  if (e.startsAt !== undefined) {
    return build("event", 0.9, item, title, "Contains a date and time");
  }
  if (e.deadlineAt !== undefined) {
    return build("task", 0.85, item, title, "Contains a return-by date");
  }
  if (e.dueAt !== undefined) {
    return build("task", 0.8, item, title, "Contains a due date");
  }
  if (e.itemName !== undefined) {
    return build("shoppingItem", 0.8, item, title, "Names a single item");
  }
  if (containsAny(item.text, PROTOCOL_MARKERS)) {
    return build("protocol", 0.6, item, title, "Sounds like a repeated treatment");
  }
  if (containsAny(item.text, COLLECTION_MARKERS)) {
    return build("collectionItem", 0.6, item, title, "Something to keep, not something to do");
  }
  if (item.source === "photo" || item.source === "screenshot") {
    return build("document", 0.5, item, title, "A scan without a recognizable date");
  }

  return build("task", 0.3, item, title, "Nothing recognized — somebody has to look at it");
}

function build(
  target: TriageTarget,
  confidence: number,
  item: InboxItem,
  title: string,
  reason: string,
): TriageSuggestion {
  const fields = fieldsFor(target, item, title);
  const missing = REQUIRED_FIELDS[target].filter((field) => fields[field] === undefined);
  const bounded = Math.max(0, Math.min(1, confidence));

  return {
    target,
    confidence: bounded,
    fields,
    missing,
    // A missing required field makes the suggestion offerable but not
    // pre-committable, however sure the extractor was.
    certain: bounded >= TRIAGE_CERTAIN_AT && missing.length === 0,
    reason,
  };
}

function fieldsFor(
  target: TriageTarget,
  item: InboxItem,
  title: string,
): Readonly<Record<string, string | number>> {
  const e = item.extracted;
  const fields: Record<string, string | number> = {};

  if (target === "shoppingItem") {
    if (e.itemName !== undefined) fields["itemName"] = e.itemName;
  } else if (title.length > 0) {
    fields["title"] = title;
  }

  if (target === "event") {
    if (e.startsAt !== undefined) fields["startsAt"] = e.startsAt;
    if (e.place !== undefined) fields["place"] = e.place;
  }
  if (target === "task") {
    // A return-by date is a due date once it is a task — a deadline is not a
    // separate object type (FR-801, FR-807).
    const due = e.deadlineAt ?? e.dueAt;
    if (due !== undefined) fields["dueAt"] = due;
    if (e.deadlineAt !== undefined) fields["isDeadline"] = 1;
  }
  const first = e.personIds[0];
  if (first !== undefined) fields["personId"] = first;
  fields["sourceInboxItemId"] = item.id;

  return fields;
}

function firstLine(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

/* ------------------------------------------------------------------ *
 * Voice capture (FR-735, SPEC §10.2)
 * ------------------------------------------------------------------ */

export type CapturedItemKind = "empty" | "low" | "use-up";

export interface CapturedItem {
  readonly itemName: string;
  readonly kind: CapturedItemKind;
  /** The fragment it came from, so triage can show what was heard (AI-04). */
  readonly phrase: string;
}

export interface CaptureParse {
  readonly items: readonly CapturedItem[];
  /** Fragments with no recognizable marker. These become inbox items — never a
   * guess, never a question at capture time (FR-735, FR-1113, AI-05). */
  readonly unclear: readonly string[];
}

/**
 * The marker vocabulary.
 *
 * Deliberately bilingual: the surrounding code is English (Constitution §VII),
 * but these are the words a family actually says into the phone, and the app
 * ships in German and English from launch (§2.4). They are data, not code
 * language.
 *
 * The three kinds map onto the only structured input the staples engine takes
 * (FR-734) plus the "needs using up" report, which is a meal-plan signal rather
 * than a stock one (FR-736). No quantities, no categories — one gesture, one
 * fact.
 *
 * Order within a kind does not matter (the longest match wins), but the order of
 * the kinds themselves does: "almost gone" must read as *low*, not as *empty*.
 */
export const CAPTURE_MARKERS: Readonly<Record<CapturedItemKind, readonly string[]>> = {
  "use-up": [
    "needs using",
    "need using",
    "needs using up",
    "need to be used",
    "needs to be used",
    "use up",
    "using up",
    "should be eaten",
    "going off",
    "muss weg",
    "müssen weg",
    "muss aufgebraucht werden",
    "aufbrauchen",
    "wird schlecht",
    "werden schlecht",
    "muss gegessen werden",
  ],
  low: [
    "almost gone",
    "almost out",
    "almost empty",
    "almost",
    "nearly gone",
    "nearly out",
    "running low",
    "getting low",
    "low on",
    "fast alle",
    "fast leer",
    "fast aus",
    "wird knapp",
    "geht zur neige",
    "neigt sich dem ende",
    "knapp",
  ],
  empty: [
    "'s gone",
    "is gone",
    "are gone",
    "all gone",
    "is out",
    "we are out of",
    "we're out of",
    "out of",
    "ran out of",
    "ran out",
    "is empty",
    "needs buying",
    "need to buy",
    "ist alle",
    "sind alle",
    "ist leer",
    "ist aus",
    "aufgebraucht",
    "haben wir nicht mehr",
    "ist nicht mehr da",
    "fehlt",
  ],
};

/** Checked in this order, so a "low" phrase is never swallowed by "empty". */
const MARKER_ORDER: readonly CapturedItemKind[] = ["use-up", "low", "empty"];

/**
 * Words that carry no item. Stripped from both ends of what remains after the
 * marker is removed, which is enough to turn "we're out of the milk" into "milk"
 * without any grammar.
 */
const FILLER_TOKENS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "of", "is", "are", "we", "i", "our", "my", "some", "also", "still",
  "we're", "it", "it's", "its", "they", "them", "this", "that", "there", "please", "oh", "yeah",
  "der", "die", "das", "den", "dem", "ein", "eine", "einen", "und", "ist", "sind", "wir", "ich",
  "es", "sie", "dies", "da", "hier", "unser", "unsere", "unseren", "noch", "mal", "auch",
  "bitte", "schon", "so", "halt",
]);

const FRAGMENT_SEPARATORS = /[,;.!?\n]+|\bund\b|\band\b|\bsowie\b/giu;

/**
 * Split one spoken sentence into structured reports (FR-735).
 *
 * "milk's gone, pasta almost, the peppers need using" is three facts, and the
 * point of the feature is that the person says it once, in passing, and is asked
 * nothing. So the parser is deliberately shallow: it recognizes markers it knows
 * and hands everything else to the inbox rather than inventing an item name.
 */
export function parseCapturedItems(text: string): CaptureParse {
  const items: CapturedItem[] = [];
  const unclear: string[] = [];

  for (const fragment of splitFragments(text)) {
    const match = findMarker(fragment);
    if (match === undefined) {
      unclear.push(fragment);
      continue;
    }

    const name = cleanName(fragment.slice(0, match.index) + " " + fragment.slice(match.index + match.length));
    if (name.length === 0) {
      // A marker with nothing attached ("it's all gone") names no item — that is
      // exactly the uncertainty the inbox exists for.
      unclear.push(fragment);
      continue;
    }

    items.push({ itemName: name, kind: match.kind, phrase: fragment });
  }

  return { items, unclear };
}

function splitFragments(text: string): readonly string[] {
  return text
    .replace(/[‘’]/gu, "'")
    .split(FRAGMENT_SEPARATORS)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

interface MarkerMatch {
  readonly kind: CapturedItemKind;
  readonly index: number;
  readonly length: number;
}

function findMarker(fragment: string): MarkerMatch | undefined {
  const haystack = fragment.toLowerCase();

  for (const kind of MARKER_ORDER) {
    // Longest first, so "almost gone" wins over "almost" and the leftover name
    // does not keep half a marker.
    const markers = [...CAPTURE_MARKERS[kind]].sort((a, b) => b.length - a.length);
    for (const marker of markers) {
      const index = haystack.search(markerPattern(marker));
      if (index >= 0) return { kind, index, length: marker.length };
    }
  }
  return undefined;
}

const patternCache = new Map<string, RegExp>();

/** Word-bounded, so "knapp" does not fire inside another word — but tolerant of
 * markers that start with punctuation, such as "'s gone". */
function markerPattern(marker: string): RegExp {
  const cached = patternCache.get(marker);
  if (cached !== undefined) return cached;

  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const lead = /^\p{L}/u.test(marker) ? "(?<!\\p{L})" : "";
  const tail = /\p{L}$/u.test(marker) ? "(?!\\p{L})" : "";
  const pattern = new RegExp(lead + escaped + tail, "u");

  patternCache.set(marker, pattern);
  return pattern;
}

function cleanName(rest: string): string {
  const tokens = rest
    .replace(/[\s]+/gu, " ")
    .trim()
    .split(" ")
    .filter((token) => token.length > 0)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((token) => token.length > 0);

  let start = 0;
  let end = tokens.length;
  while (start < end && FILLER_TOKENS.has((tokens[start] ?? "").toLowerCase())) start += 1;
  while (end > start && FILLER_TOKENS.has((tokens[end - 1] ?? "").toLowerCase())) end -= 1;

  return tokens.slice(start, end).join(" ");
}

/* ------------------------------------------------------------------ *
 * Rule-based automation (FR-1107)
 * ------------------------------------------------------------------ */

export interface RuleCondition {
  readonly source?: CaptureSource;
  /** Substring of the mail sender, case-insensitive — "school.de". */
  readonly senderContains?: string;
  /** Any one of these in the text is enough. */
  readonly textContains?: readonly string[];
  readonly hasDeadline?: boolean;
}

export interface RuleOutcome {
  readonly target: TriageTarget;
  /** Fixed values the rule always sets, e.g. an owner or a category. */
  readonly fields?: Readonly<Record<string, string | number>>;
  /** "…always create a task **with a deadline**": if none was extracted, triage
   * asks for exactly that one field instead of dropping the requirement. */
  readonly requireDeadline?: boolean;
}

export interface CaptureRule {
  readonly id: string;
  readonly when: RuleCondition;
  readonly then: RuleOutcome;
}

export interface RuleMatch {
  readonly ruleId: string;
  readonly suggestion: TriageSuggestion;
}

/**
 * Apply the family's own rules (FR-1107).
 *
 * First match wins, so the list order is the family's priority order — an
 * explicit list beats a scoring scheme nobody can predict. A rule hit is
 * confidence 1.0: it is not a guess, it is a decision the family already made,
 * and the swipe may pre-commit on it.
 */
export function applyRules(item: InboxItem, rules: readonly CaptureRule[]): RuleMatch | undefined {
  for (const rule of rules) {
    if (!matches(item, rule.when)) continue;

    const base = triageSuggestion({ ...item, suggestedTarget: rule.then.target, confidence: 1 });
    const fields = { ...base.fields, ...(rule.then.fields ?? {}) };
    const missing = [...base.missing.filter((field) => fields[field] === undefined)];
    if (rule.then.requireDeadline === true && fields["dueAt"] === undefined) missing.push("dueAt");

    return {
      ruleId: rule.id,
      suggestion: {
        target: rule.then.target,
        confidence: 1,
        fields,
        missing,
        certain: missing.length === 0,
        reason: `Rule ${rule.id}`,
      },
    };
  }
  return undefined;
}

function matches(item: InboxItem, when: RuleCondition): boolean {
  if (when.source !== undefined && when.source !== item.source) return false;
  if (
    when.senderContains !== undefined &&
    !(item.sender ?? "").toLowerCase().includes(when.senderContains.toLowerCase())
  ) {
    return false;
  }
  if (when.textContains !== undefined && !containsAny(item.text, when.textContains)) return false;
  if (when.hasDeadline !== undefined && when.hasDeadline !== (item.extracted.deadlineAt !== undefined)) return false;
  return true;
}

function containsAny(text: string, needles: readonly string[]): boolean {
  const haystack = text.toLowerCase();
  return needles.some((needle) => haystack.includes(needle.toLowerCase()));
}
