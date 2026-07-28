/**
 * The operation model — the unit of change in the whole product.
 *
 * Nothing mutates state except by appending an operation, which is what makes
 * offline-first (SPEC FR-1214) and per-object history (FR-1218) fall out of the
 * architecture instead of being bolted on.
 *
 * The op set is deliberately tiny and generic; domain meaning lives in commands
 * (which produce ops) and projections (which read them). A small op set is what
 * lets the convergence property tests actually cover the space.
 */
import { z } from "zod";
import type { HlcStamp } from "./hlc.js";

export const OP_KINDS = [
  "entity.create",
  "entity.setFields",
  "entity.delete",
  "set.add",
  "set.remove",
] as const;

export type OpKind = (typeof OP_KINDS)[number];

/** JSON-serializable field value. */
export type Value = string | number | boolean | null | readonly Value[] | { readonly [k: string]: Value };

export const hlcSchema = z.object({
  wall: z.number().int().nonnegative(),
  counter: z.number().int().nonnegative(),
  deviceId: z.string().min(1),
});

const valueSchema: z.ZodType<Value> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(valueSchema), z.record(valueSchema)]),
);

export const operationSchema = z.object({
  opId: z.string().min(1),
  familyId: z.string().min(1),
  deviceId: z.string().min(1),
  /** Person acting, when it is semantically required (SPEC FR-116 kiosk rules). */
  actorId: z.string().min(1).nullable(),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  kind: z.enum(OP_KINDS),
  payload: z.record(valueSchema),
  hlc: hlcSchema,
  /**
   * Field versions the author had seen, for Tier-2 (critical) fields only.
   * Absent for Tier-1 operations, which cannot conflict by construction.
   */
  base: z.record(z.number().int().nonnegative()).optional(),
  schemaVersion: z.number().int().positive(),
});

export type Operation = z.infer<typeof operationSchema>;

/** An operation after the server gave it its place in the family's total order. */
export interface SequencedOperation extends Operation {
  readonly seq: number;
}

export const SCHEMA_VERSION = 1;

export interface NewOperationInput {
  readonly familyId: string;
  readonly deviceId: string;
  readonly actorId: string | null;
  readonly entityType: string;
  readonly entityId: string;
  readonly kind: OpKind;
  readonly payload: Record<string, Value>;
  readonly hlc: HlcStamp;
  readonly opId: string;
  readonly base?: Record<string, number>;
}

export function makeOperation(input: NewOperationInput): Operation {
  const op: Operation = {
    opId: input.opId,
    familyId: input.familyId,
    deviceId: input.deviceId,
    actorId: input.actorId,
    entityType: input.entityType,
    entityId: input.entityId,
    kind: input.kind,
    payload: input.payload,
    hlc: input.hlc,
    schemaVersion: SCHEMA_VERSION,
    ...(input.base === undefined ? {} : { base: input.base }),
  };
  return operationSchema.parse(op);
}
