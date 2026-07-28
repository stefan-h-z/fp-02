/**
 * Paper output (SPEC FR-1118, FR-1208, FR-727).
 *
 * Everything here exists for the moment the product is unavailable: the phone is
 * flat, the babysitter has no account, the tablet in the kitchen has gone dark,
 * or somebody simply wants the week on the fridge. So these sheets are held to a
 * different standard than a screen — they have to survive being read by a person
 * who has never seen the app, hours after they were printed.
 *
 * Two rules follow from that and are enforced throughout this file:
 *
 *  - **No identifier ever reaches paper.** A row that says `p-4f2a` is worthless
 *    to the neighbour holding it, so every reference is resolved to a name here
 *    and an unresolvable one becomes an honest placeholder rather than its id.
 *  - **Nothing is derived twice.** The sheets read the same projections the
 *    screens do (`calendar.ts`, `protocols.ts`, `documents.ts`, `shopping.ts`);
 *    a printout that disagreed with the app would destroy trust in both.
 */
import { occurrencesInWindow, type Occurrence } from "./calendar.js";
import { buildEmergencyBinder, type ContactRecord } from "./documents.js";
import { planInstances, readInstance, readProtocol, type ProtocolInstance } from "./protocols.js";
import { DAY_MS } from "./rhythm.js";
import { EntityTypes, readOptionalString, readString } from "./schema.js";
import type { ShoppingListView } from "./shopping.js";
import type { FamilyState } from "./state.js";

/**
 * Lines, not a formatted block.
 *
 * The domain has no idea what it is printing onto: A4 through a home printer, a
 * share sheet into a chat (FR-727), a thermal receipt printer on a kitchen wall.
 * Wrapping, page breaks, column widths and the joining character are all
 * decisions of the surface that owns the paper, and baking one in here would make
 * exactly one of those cases work.
 */
export type Sheet = readonly string[];

export interface PaperOptions {
  /**
   * Minutes east of UTC to render clock times in.
   *
   * The only place in the domain that needs a wall clock. Everywhere else a
   * moment is an instant and the app decides how to show it — but a sheet of
   * paper is read in a room, and "14:00" printed for a family living at UTC+2 is
   * not a formatting detail, it is a wrong medication time. Defaults to UTC so a
   * caller that forgets is at least consistent with the rest of the domain.
   */
  readonly offsetMinutes?: number;
}

/**
 * The one-page emergency sheet (FR-1118).
 *
 * Deliberately three sections and nothing else: what happens today, what has to
 * be given or measured today, and who to ring. The fuller emergency binder
 * (FR-1009, `documents.ts`) carries papers and household knowledge as well; this
 * is the subset somebody can hold in one hand at the front door, so anything that
 * is merely useful was left out to keep what is critical unmissable.
 */
export function renderEmergencySheet(state: FamilyState, now: number, options: PaperOptions = {}): Sheet {
  const offset = options.offsetMinutes ?? 0;
  const from = startOfLocalDay(now, offset);
  const to = from + DAY_MS - 1;

  return [
    "EMERGENCY SHEET",
    formatDayHeading(from, offset),
    "",
    ...section("Today", todayLines(state, { from, to }, offset)),
    "",
    ...section("Medication and care", protocolLines(state, { from, to }, now, offset)),
    "",
    ...section("Emergency contacts", contactLines(buildEmergencyBinder(state, now).contacts)),
  ];
}

function todayLines(
  state: FamilyState,
  window: { readonly from: number; readonly to: number },
  offset: number,
): readonly string[] {
  const occurrences = occurrencesInWindow(state, window).filter((occurrence) => !occurrence.cancelled);
  if (occurrences.length === 0) return ["Nothing in the calendar today."];

  return occurrences.map(
    (occurrence) => timeRange(occurrence, offset) + "  " + occurrenceTitle(state, occurrence),
  );
}

/**
 * Protocols are printed grouped by protocol, with the instruction once and the
 * day's times under it.
 *
 * Repeating "one drop in the right eye" five times would push the next protocol
 * off the page, and the instruction is the part a stand-in has to get right
 * (FR-919). The window is the whole printed day rather than the moment of
 * printing: a course that starts at noon still belongs on the sheet somebody
 * prints at breakfast.
 */
function protocolLines(
  state: FamilyState,
  window: { readonly from: number; readonly to: number },
  now: number,
  offset: number,
): readonly string[] {
  const lines: string[] = [];

  for (const entity of state.all(EntityTypes.protocol)) {
    const protocol = readProtocol(state, entity.id);
    if (protocol === undefined) continue;
    if (protocol.endsAt < window.from || protocol.startsAt > window.to) continue;

    // `planInstances` stamps every instance against the end of the window it was
    // given, because that is the only moment it knows. For a whole printed day
    // that would mark the evening dose as missed on a sheet printed at
    // breakfast, so the states are recomputed against the moment of printing.
    const instances = planInstances(protocol, state, window).map((instance) =>
      readInstance(protocol, state, instance.dueAt, now),
    );
    if (instances.length === 0) continue;

    lines.push(protocol.label + " — " + personName(state, protocol.personId));
    if (protocol.instruction.length > 0) lines.push("  " + protocol.instruction);
    lines.push("  " + instances.map((instance) => instanceLabel(instance, now, offset)).join("   "));
  }

  return lines.length === 0 ? ["Nothing active today."] : lines;
}

/**
 * A measurement protocol has no "done" — it has a number, and the number is the
 * point of writing it down (FR-923).
 */
function instanceLabel(instance: ProtocolInstance, now: number, offset: number): string {
  const at = formatTime(instance.dueAt, offset);
  if (instance.measuredValue !== undefined) return at + " " + instance.measuredValue;

  switch (instance.state) {
    case "acknowledged":
      return at + " done";
    case "skipped":
      return at + " skipped";
    case "missed":
      return at + " MISSED";
    default:
      return instance.dueAt <= now ? at + " due" : at;
  }
}

function contactLines(contacts: readonly ContactRecord[]): readonly string[] {
  if (contacts.length === 0) return ["No emergency contacts recorded."];

  return contacts.map((contact) => {
    const reach = [contact.phone, contact.email].filter((value) => value !== undefined).join("  ");
    return contact.name + " (" + contact.role + ")" + (reach.length > 0 ? "  " + reach : "");
  });
}

export interface WeekSheetOptions extends PaperOptions {
  readonly from: number;
  readonly to: number;
  /** Narrows the meals to one plan; omitted, every planned meal in range shows. */
  readonly weekPlanId?: string;
}

/**
 * The printable week (FR-1208).
 *
 * One block per day, meals before appointments, because the question this sheet
 * gets stuck to the fridge to answer is "what are we eating and who is cooking"
 * (FR-609) — the calendar is the reason the answer is what it is.
 */
export function renderWeekSheet(state: FamilyState, options: WeekSheetOptions): Sheet {
  const offset = options.offsetMinutes ?? 0;
  const first = startOfLocalDay(options.from, offset);
  const last = startOfLocalDay(options.to, offset);

  const occurrences = occurrencesInWindow(state, { from: first, to: last + DAY_MS - 1 }).filter(
    // A cancelled appointment is not happening, and printing it as if it might
    // is how somebody ends up driving to a cancelled training session.
    (occurrence) => !occurrence.cancelled,
  );

  const lines: string[] = ["WEEK " + formatDate(first, offset) + " to " + formatDate(last, offset), ""];

  for (let day = first; day <= last; day += DAY_MS) {
    const dayEnd = day + DAY_MS - 1;
    lines.push(formatDayHeading(day, offset));

    const meals = mealLines(state, formatDate(day, offset), options.weekPlanId);
    for (const line of meals) lines.push("  " + line);

    const events = occurrences.filter(
      (occurrence) => occurrence.startsAt <= dayEnd && occurrence.endsAt >= day,
    );
    for (const occurrence of events) {
      lines.push("  " + timeRange(occurrence, offset) + "  " + occurrenceTitle(state, occurrence));
    }

    if (meals.length === 0 && events.length === 0) lines.push("  —");
    lines.push("");
  }

  return lines;
}

/** Meal order on paper is the order of the day, not the order the slots were
 * created in; anything unrecognised sorts after the three real meals. */
const MEAL_ORDER: readonly string[] = ["breakfast", "lunch", "dinner"];

function mealLines(state: FamilyState, dateKey: string, weekPlanId: string | undefined): readonly string[] {
  return state
    .all(EntityTypes.mealSlot)
    .filter((slot) => readString(slot, "date") === dateKey)
    .filter((slot) => weekPlanId === undefined || readOptionalString(slot, "weekPlanId") === weekPlanId)
    .map((slot) => {
      const mealType = readString(slot, "mealType", "meal");
      const recipeId = readOptionalString(slot, "recipeId");
      const title =
        recipeId === undefined
          ? undefined
          : readOptionalString(state.get(EntityTypes.recipe, recipeId), "title");
      const cookId = readOptionalString(slot, "cookOwnerId");

      return {
        rank: MEAL_ORDER.indexOf(mealType),
        mealType,
        // An empty slot is printed rather than hidden: the gap is the thing the
        // family is looking at when they decide what to cook (FR-604).
        text:
          capitalize(mealType) +
          ": " +
          (title ?? "not planned yet") +
          (cookId === undefined ? "" : " — cooked by " + personName(state, cookId)),
      };
    })
    .sort((a, b) => {
      const rankA = a.rank < 0 ? MEAL_ORDER.length : a.rank;
      const rankB = b.rank < 0 ? MEAL_ORDER.length : b.rank;
      return rankA - rankB || (a.mealType < b.mealType ? -1 : a.mealType > b.mealType ? 1 : 0);
    })
    .map((entry) => entry.text);
}

/**
 * The shopping list as text (FR-727, FR-1208).
 *
 * Takes the view rather than the state so that what is printed is exactly what
 * was on the screen — the same grouping, the same "I am at Aldi" filter, the same
 * ticks (FR-704, FR-705). Re-deriving it here would let the paper and the phone
 * drift apart while the family is standing in the shop.
 *
 * Suggestions (reported empty, probably due) are left out on purpose: they are an
 * invitation to add something to the list, and a sheet of paper cannot accept
 * one. Printing them would put items in front of somebody in the shop that
 * nobody ever decided to buy (FR-739, FR-741).
 */
export function renderShoppingSheet(view: ShoppingListView): Sheet {
  const lines: string[] = ["SHOPPING LIST", ""];

  if (view.groups.length === 0) {
    lines.push("Nothing on the list.");
    return lines;
  }

  for (const group of view.groups) {
    lines.push(group.label);
    for (const line of group.lines) {
      const parts = [line.name];
      if (line.quantityLabel.length > 0) parts.push(line.quantityLabel);
      if (line.note.length > 0) parts.push("(" + line.note + ")");
      if (line.awaitingApproval) parts.push("- waiting for a parent");
      if (line.openQuestion !== undefined) parts.push("- question: " + line.openQuestion);
      lines.push("  " + (line.checked ? "[x] " : "[ ] ") + parts.join(" "));
    }
    lines.push("");
  }

  lines.push(view.openCount + " open, " + view.checkedCount + " already ticked");
  return lines;
}

function section(heading: string, body: readonly string[]): readonly string[] {
  return [heading, ...body.map((line) => "  " + line)];
}

/**
 * A private appointment keeps its time and loses its title (FR-203). The person
 * carrying the sheet still needs to know the slot is taken; they do not need to
 * know what it is — and a private entry names nobody either.
 *
 * Who brings and who fetches is printed with the appointment because that is the
 * half of an entry a stand-in cannot reconstruct (FR-209): the time is on the
 * poster at the swimming pool, the arrangement is not.
 */
function occurrenceTitle(state: FamilyState, occurrence: Occurrence): string {
  if (occurrence.private) return "Private";

  const title = occurrence.title.length > 0 ? occurrence.title : "Untitled";
  const roles: string[] = [];
  if (occurrence.bringOwnerId !== undefined) roles.push("brings: " + personName(state, occurrence.bringOwnerId));
  if (occurrence.fetchOwnerId !== undefined) roles.push("fetches: " + personName(state, occurrence.fetchOwnerId));

  return roles.length === 0 ? title : title + " (" + roles.join(", ") + ")";
}

function timeRange(occurrence: Occurrence, offset: number): string {
  if (occurrence.allDay) return "all day".padEnd(11);
  const start = formatTime(occurrence.startsAt, offset);
  const end = formatTime(occurrence.endsAt, offset);
  return (start === end ? start : start + "-" + end).padEnd(11);
}

/**
 * Names, never ids (see the module note). A person who is not in the family any
 * more still has appointments in the past, and printing their raw id would be
 * both unreadable and a small privacy leak.
 */
function personName(state: FamilyState, personId: string): string {
  return readOptionalString(state.get(EntityTypes.person, personId), "name") ?? "someone";
}

const WEEKDAYS: readonly string[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatDayHeading(at: number, offset: number): string {
  const shifted = new Date(at + offset * 60_000);
  return (WEEKDAYS[shifted.getUTCDay()] ?? "") + " " + formatDate(at, offset);
}

function formatDate(at: number, offset: number): string {
  const shifted = new Date(at + offset * 60_000);
  return (
    String(shifted.getUTCFullYear()) +
    "-" +
    pad(shifted.getUTCMonth() + 1) +
    "-" +
    pad(shifted.getUTCDate())
  );
}

function formatTime(at: number, offset: number): string {
  const shifted = new Date(at + offset * 60_000);
  return pad(shifted.getUTCHours()) + ":" + pad(shifted.getUTCMinutes());
}

function startOfLocalDay(at: number, offset: number): number {
  const shift = offset * 60_000;
  return Math.floor((at + shift) / DAY_MS) * DAY_MS - shift;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
