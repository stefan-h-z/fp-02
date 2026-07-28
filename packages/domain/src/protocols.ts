/**
 * Treatment and measurement protocols (SPEC §12.2).
 *
 * A protocol is its own object type because neither of the existing ones fits:
 * eye drops five times a day for five days would spawn twenty-five calendar
 * entries or twenty-five tasks and ruin both. It has a defined end and clears
 * itself away; a missed instance means something different from a task left
 * undone; and it needs acknowledgement visible to everyone at once, which is what
 * stops the second parent giving a second dose (FR-917, SC-007).
 *
 * Instances are *derived* from the definition rather than stored, so a protocol
 * costs a handful of fields instead of a table of rows — and correcting the
 * schedule corrects every future instance without a migration. Only what a human
 * did (acknowledged, skipped, measured) is stored, keyed by instance.
 */
import { derivedId } from "./ids.js";
import {
  EntityTypes,
  readNumber,
  readOptionalNumber,
  readOptionalString,
  readString,
  readStringList,
} from "./schema.js";
import type { FamilyState } from "./state.js";

export const HOUR_MS = 60 * 60 * 1000;

export type ProtocolKind = "acknowledgement" | "measurement";
export type InstanceState = "due" | "upcoming" | "acknowledged" | "skipped" | "missed";

/**
 * `times-per-day` spreads over waking hours; `every-n-hours` counts from the
 * *actual* last dose, which is the only correct reading of "every 8 hours"
 * (FR-922); `fixed-times` is for medication tied to a clock.
 */
export type FrequencyKind = "times-per-day" | "every-n-hours" | "fixed-times";

export interface ProtocolDefinition {
  readonly id: string;
  readonly personId: string;
  readonly label: string;
  readonly kind: ProtocolKind;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly frequencyKind: FrequencyKind;
  /** Doses per day, or the hour gap, depending on `frequencyKind`. */
  readonly frequencyValue: number;
  /** Minutes past midnight, for `fixed-times`. */
  readonly fixedTimes: readonly number[];
  /** May a reminder wake the house? Explicit per protocol (FR-921). */
  readonly wakeCapable: boolean;
  /** Night window in minutes past midnight, when not wake-capable. */
  readonly nightStartMinute: number;
  readonly nightEndMinute: number;
  /** Does a missed dose shift the series or leave it fixed (FR-920)? */
  readonly missedDoseRule: "shift" | "fixed";
  readonly instruction: string;
  readonly responsibleAdultIds: readonly string[];
}

export interface ProtocolInstance {
  readonly id: string;
  readonly protocolId: string;
  readonly personId: string;
  readonly label: string;
  readonly kind: ProtocolKind;
  readonly dueAt: number;
  readonly state: InstanceState;
  /** Who acknowledged and exactly when — not just whether (FR-917). */
  readonly acknowledgedBy: string | undefined;
  readonly acknowledgedAt: number | undefined;
  readonly measuredValue: number | undefined;
  readonly skipNote: string | undefined;
}

const DEFAULT_DAY_START_MINUTE = 8 * 60;
const DEFAULT_DAY_END_MINUTE = 21 * 60;
const MISSED_AFTER_MS = 4 * HOUR_MS;

export function readProtocol(state: FamilyState, protocolId: string): ProtocolDefinition | undefined {
  const entity = state.get(EntityTypes.protocol, protocolId);
  if (entity === undefined || entity.deleted) return undefined;

  return {
    id: entity.id,
    personId: readString(entity, "personId"),
    label: readString(entity, "label"),
    kind: readString(entity, "kind") === "measurement" ? "measurement" : "acknowledgement",
    startsAt: readNumber(entity, "startsAt"),
    endsAt: readNumber(entity, "endsAt"),
    frequencyKind: frequencyKindOf(readString(entity, "frequencyKind")),
    frequencyValue: readNumber(entity, "frequencyValue", 1),
    fixedTimes: readStringList(entity, "fixedTimes")
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value)),
    wakeCapable: readOptionalString(entity, "wakeCapable") === "true" || entity.fields["wakeCapable"] === true,
    nightStartMinute: readNumber(entity, "nightStartMinute", 22 * 60),
    nightEndMinute: readNumber(entity, "nightEndMinute", 6 * 60),
    missedDoseRule: readString(entity, "missedDoseRule") === "fixed" ? "fixed" : "shift",
    instruction: readString(entity, "instruction"),
    responsibleAdultIds: readStringList(entity, "responsibleAdultIds"),
  };
}

function frequencyKindOf(value: string): FrequencyKind {
  return value === "every-n-hours" || value === "fixed-times" ? value : "times-per-day";
}

/** Deterministic id, so two devices computing the same schedule agree. */
export function instanceId(protocolId: string, dueAt: number): string {
  return derivedId("protocolInstance", protocolId, String(dueAt));
}

/**
 * The schedule between two moments.
 *
 * For `every-n-hours` the chain hangs off actual acknowledgements: a dose given
 * an hour late moves the next one an hour later, because that is what the
 * prescription means (FR-922). Under the `fixed` rule the grid stays put instead.
 */
export function planInstances(
  protocol: ProtocolDefinition,
  state: FamilyState,
  window: { readonly from: number; readonly to: number },
): readonly ProtocolInstance[] {
  const from = Math.max(protocol.startsAt, window.from);
  const to = Math.min(protocol.endsAt, window.to);
  if (to < from) return [];

  const dueTimes =
    protocol.frequencyKind === "every-n-hours"
      ? everyNHours(protocol, state, from, to)
      : dailySlots(protocol, from, to);

  return dueTimes
    .filter((dueAt) => protocol.wakeCapable || !isNightTime(protocol, dueAt))
    .map((dueAt) => readInstance(protocol, state, dueAt, window.to));
}

/**
 * Reminders repeat until acknowledged or deliberately skipped (FR-918), and go
 * to every responsible adult rather than one designated person (FR-916).
 */
export function pendingReminders(
  instances: readonly ProtocolInstance[],
  now: number,
): readonly ProtocolInstance[] {
  return instances.filter((instance) => instance.state === "due" && instance.dueAt <= now);
}

export function readInstance(
  protocol: ProtocolDefinition,
  state: FamilyState,
  dueAt: number,
  now: number,
): ProtocolInstance {
  const id = instanceId(protocol.id, dueAt);
  const stored = state.get(EntityTypes.protocolInstance, id);
  const recordedState = readString(stored, "state");

  const acknowledgedAt = readOptionalNumber(stored, "acknowledgedAt");
  const state_: InstanceState =
    recordedState === "acknowledged"
      ? "acknowledged"
      : recordedState === "skipped"
        ? "skipped"
        : dueAt > now
          ? "upcoming"
          : now - dueAt > MISSED_AFTER_MS
            ? "missed"
            : "due";

  return {
    id,
    protocolId: protocol.id,
    personId: protocol.personId,
    label: protocol.label,
    kind: protocol.kind,
    dueAt,
    state: state_,
    acknowledgedBy: readOptionalString(stored, "acknowledgedBy"),
    acknowledgedAt,
    measuredValue: readOptionalNumber(stored, "measuredValue"),
    skipNote: readOptionalString(stored, "skipNote"),
  };
}

function dailySlots(protocol: ProtocolDefinition, from: number, to: number): readonly number[] {
  const minutes =
    protocol.frequencyKind === "fixed-times"
      ? [...protocol.fixedTimes].sort((a, b) => a - b)
      : spreadOverDay(protocol.frequencyValue);

  const out: number[] = [];
  for (let day = startOfDay(from); day <= to; day += 24 * 60 * 60 * 1000) {
    for (const minute of minutes) {
      const dueAt = day + minute * 60 * 1000;
      if (dueAt >= from && dueAt <= to) out.push(dueAt);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Doses land inside waking hours, evenly spaced — not every three hours around
 * the clock, which is what a naive division would produce. */
function spreadOverDay(perDay: number): readonly number[] {
  const count = Math.max(1, Math.round(perDay));
  if (count === 1) return [DEFAULT_DAY_START_MINUTE];

  const span = DEFAULT_DAY_END_MINUTE - DEFAULT_DAY_START_MINUTE;
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(DEFAULT_DAY_START_MINUTE + i * step));
}

function everyNHours(
  protocol: ProtocolDefinition,
  state: FamilyState,
  from: number,
  to: number,
): readonly number[] {
  const gap = Math.max(1, protocol.frequencyValue) * HOUR_MS;
  const out: number[] = [];
  let dueAt = protocol.startsAt;

  while (dueAt <= to && out.length < 500) {
    if (dueAt >= from) out.push(dueAt);

    const stored = state.get(EntityTypes.protocolInstance, instanceId(protocol.id, dueAt));
    const acknowledgedAt = readOptionalNumber(stored, "acknowledgedAt");

    dueAt =
      protocol.missedDoseRule === "shift" && acknowledgedAt !== undefined
        ? acknowledgedAt + gap
        : dueAt + gap;
  }
  return out;
}

function isNightTime(protocol: ProtocolDefinition, at: number): boolean {
  const minute = minutesIntoDay(at);
  const { nightStartMinute: start, nightEndMinute: end } = protocol;
  return start <= end ? minute >= start && minute < end : minute >= start || minute < end;
}

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function minutesIntoDay(at: number): number {
  const date = new Date(at);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

/**
 * A finished protocol disappears by itself — no cleanup task for a family that
 * has just got through an illness (FR-924). The record stays readable.
 */
export function isProtocolActive(protocol: ProtocolDefinition, now: number): boolean {
  return now >= protocol.startsAt && now <= protocol.endsAt;
}

export interface ProtocolSummary {
  readonly protocolId: string;
  readonly label: string;
  readonly personId: string;
  readonly total: number;
  readonly acknowledged: number;
  readonly skipped: number;
  readonly missed: number;
  /** Measurements over time, for the curve handed to the doctor (FR-924). */
  readonly measurements: readonly { readonly at: number; readonly value: number }[];
}

export function summarizeProtocol(
  protocol: ProtocolDefinition,
  state: FamilyState,
  now: number,
): ProtocolSummary {
  const instances = planInstances(protocol, state, { from: protocol.startsAt, to: Math.min(protocol.endsAt, now) });

  return {
    protocolId: protocol.id,
    label: protocol.label,
    personId: protocol.personId,
    total: instances.length,
    acknowledged: instances.filter((i) => i.state === "acknowledged").length,
    skipped: instances.filter((i) => i.state === "skipped").length,
    missed: instances.filter((i) => i.state === "missed").length,
    measurements: instances
      .filter((i) => i.measuredValue !== undefined)
      .map((i) => ({ at: i.acknowledgedAt ?? i.dueAt, value: i.measuredValue! })),
  };
}
