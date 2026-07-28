/**
 * Commands: everything the app can do to the family's data.
 *
 * Screens call these and nothing else. Each one turns an intent ("this is
 * empty", "we'll cook that on Tuesday") into operations, which is where the
 * product's rules live — most importantly the ones about *not* asking: adding an
 * item never demands a quantity, reporting something empty never demands a
 * category, and a spoken sentence never demands a correction (SPEC P-04, FR-735).
 */
import { EntityTypes, SetFields, canonicalItemKey, plannedNeedKey, type Value } from "@fam/domain";
import type { MutationBuilder } from "@fam/sync";

export type Mutate = (describe: (builder: MutationBuilder) => void) => Promise<unknown>;

export interface AddItemInput {
  readonly listId: string;
  readonly name: string;
  readonly amount?: number;
  readonly unit?: string;
  readonly note?: string;
  /** A child's entry needs a parent's nod before it counts (FR-725). */
  readonly asWish?: boolean;
}

/**
 * Adding is one gesture. The catalog entry is created alongside, because the
 * rhythm engine learns from every item that was ever on a list — there is no
 * candidate list to curate (FR-741).
 */
export async function addItem(mutate: Mutate, input: AddItemInput): Promise<string> {
  const itemKey = canonicalItemKey(input.name);
  let id = "";

  await mutate((builder) => {
    ensureCatalogItem(builder, itemKey, input.name);
    id = builder.createNew(EntityTypes.shoppingItem, {
      listId: input.listId,
      name: input.name.trim(),
      itemKey,
      checked: false,
      wish: input.asWish === true,
      approved: input.asWish !== true,
      ...(input.amount === undefined ? {} : { amount: input.amount }),
      ...(input.unit === undefined ? {} : { unit: input.unit }),
      ...(input.note === undefined ? {} : { note: input.note }),
    });
  });

  return id;
}

/**
 * Ticking an item off is the single most frequent action in the product, and the
 * one most likely to happen twice at once in a shop. It is a Tier-1 write, so two
 * people doing it simultaneously converges silently (FR-1219) — and it is what
 * teaches the rhythm engine (FR-731).
 */
export async function checkOff(
  mutate: Mutate,
  input: { readonly itemId: string; readonly itemKey: string; readonly at: number },
): Promise<void> {
  await mutate((builder) => {
    builder.set(EntityTypes.shoppingItem, input.itemId, { checked: true, checkedAt: input.at });
    builder.setAdd(EntityTypes.catalogItem, input.itemKey, SetFields.purchases, String(input.at));
  });
}

/** The tick on a derived planned need, which is stored separately from the
 * need itself so a changed quantity cannot lose it (see `plan.ts`). */
export async function checkOffPlanned(
  mutate: Mutate,
  input: { readonly weekPlanId: string; readonly itemKey: string; readonly listId: string; readonly at: number },
): Promise<void> {
  const key = plannedNeedKey(input.weekPlanId, input.itemKey);
  await mutate((builder) => {
    builder.create(EntityTypes.plannedTick, key, { listId: input.listId, checked: true, checkedAt: input.at });
    builder.setAdd(EntityTypes.catalogItem, input.itemKey, SetFields.purchases, String(input.at));
  });
}

export async function uncheck(mutate: Mutate, itemId: string): Promise<void> {
  await mutate((builder) => builder.set(EntityTypes.shoppingItem, itemId, { checked: false }));
}

/**
 * The empty report: exactly one piece of information, captured in the moment,
 * with no quantity and no category (FR-734). It beats any prediction.
 */
export async function reportEmpty(
  mutate: Mutate,
  input: { readonly name: string; readonly at: number; readonly kind?: "empty" | "low" | "use-up" },
): Promise<void> {
  const itemKey = canonicalItemKey(input.name);
  await mutate((builder) => {
    ensureCatalogItem(builder, itemKey, input.name);
    builder.setAdd(
      EntityTypes.catalogItem,
      itemKey,
      input.kind === "use-up" ? "useUpReports" : SetFields.emptyReports,
      String(input.at),
    );
  });
}

/** Dismissing trains the model rather than just hiding the row (FR-739). */
export async function dismissSuggestion(
  mutate: Mutate,
  input: { readonly itemKey: string; readonly at: number },
): Promise<void> {
  await mutate((builder) =>
    builder.setAdd(EntityTypes.catalogItem, input.itemKey, SetFields.dismissals, String(input.at)),
  );
}

/** Accepting a suggestion is just adding it — the same one gesture as always. */
export async function acceptSuggestion(
  mutate: Mutate,
  input: { readonly itemKey: string; readonly name: string; readonly listId: string },
): Promise<string> {
  return addItem(mutate, { listId: input.listId, name: input.name });
}

/** A question from the shop lands on the item, never in a chat (FR-721, SPEC §1.3). */
export async function askAboutItem(
  mutate: Mutate,
  input: { readonly itemId: string; readonly question: string },
): Promise<void> {
  await mutate((builder) => builder.set(EntityTypes.shoppingItem, input.itemId, { question: input.question }));
}

export async function answerAboutItem(
  mutate: Mutate,
  input: { readonly itemId: string; readonly answer: string },
): Promise<void> {
  await mutate((builder) =>
    builder.set(EntityTypes.shoppingItem, input.itemId, { question: "", answer: input.answer }),
  );
}

/** A parent releasing a child's wish onto the list (FR-725). */
export async function approveWish(mutate: Mutate, itemId: string): Promise<void> {
  await mutate((builder) => builder.set(EntityTypes.shoppingItem, itemId, { approved: true }));
}

export interface PlanMealInput {
  readonly weekPlanId: string;
  readonly date: string;
  readonly mealType: string;
  readonly recipeId?: string;
  /** Daycare lunch, canteen, eating out — a plan entry without a recipe (FR-604). */
  readonly label?: string;
  readonly cookOwnerId?: string;
  readonly eaterIds: readonly string[];
}

export async function planMeal(mutate: Mutate, input: PlanMealInput): Promise<string> {
  let id = "";
  await mutate((builder) => {
    id = builder.createNew(EntityTypes.mealSlot, {
      weekPlanId: input.weekPlanId,
      date: input.date,
      mealType: input.mealType,
      state: "planned",
      ...(input.recipeId === undefined ? {} : { recipeId: input.recipeId }),
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.cookOwnerId === undefined ? {} : { cookOwnerId: input.cookOwnerId }),
    });
    for (const eaterId of input.eaterIds) {
      builder.setAdd(EntityTypes.mealSlot, id, SetFields.eaters, eaterId);
    }
  });
  return id;
}

export async function unplanMeal(mutate: Mutate, mealSlotId: string): Promise<void> {
  await mutate((builder) => builder.delete(EntityTypes.mealSlot, mealSlotId));
}

/** Marking a meal cooked is what teaches the suggester what actually happens
 * versus what was planned (FR-620, FR-621). */
export async function markCooked(
  mutate: Mutate,
  input: { readonly mealSlotId: string; readonly recipeId?: string; readonly at: number },
): Promise<void> {
  await mutate((builder) => {
    builder.set(EntityTypes.mealSlot, input.mealSlotId, { state: "cooked" });
    if (input.recipeId !== undefined) {
      builder.set(EntityTypes.recipe, input.recipeId, { lastCookedAt: input.at });
    }
  });
}

/**
 * Acknowledging a dose. The actor is required, because "who gave it" is the
 * whole point of the feature — this is one of the few places a shared device
 * must ask who is standing there (FR-116, FR-917).
 */
export async function acknowledgeDose(
  mutate: Mutate,
  input: {
    readonly instanceId: string;
    readonly personId: string;
    readonly at: number;
    readonly measuredValue?: number;
  },
): Promise<void> {
  await mutate((builder) =>
    builder.create(EntityTypes.protocolInstance, input.instanceId, {
      state: "acknowledged",
      acknowledgedBy: input.personId,
      acknowledgedAt: input.at,
      ...(input.measuredValue === undefined ? {} : { measuredValue: input.measuredValue }),
    }),
  );
}

/** An explicit skip with a reason, never a silent disappearance (FR-919). */
export async function skipDose(
  mutate: Mutate,
  input: { readonly instanceId: string; readonly personId: string; readonly note: string; readonly at: number },
): Promise<void> {
  await mutate((builder) =>
    builder.create(EntityTypes.protocolInstance, input.instanceId, {
      state: "skipped",
      skipNote: input.note,
      acknowledgedBy: input.personId,
      acknowledgedAt: input.at,
    }),
  );
}

/** Anything captured but not yet understood goes here rather than interrupting
 * the person who said it (FR-1113, AI-05). */
export async function captureToInbox(
  mutate: Mutate,
  input: { readonly source: string; readonly text: string; readonly at: number },
): Promise<string> {
  let id = "";
  await mutate((builder) => {
    id = builder.createNew(EntityTypes.inboxItem, {
      source: input.source,
      text: input.text,
      capturedAt: input.at,
      state: "pending",
    });
  });
  return id;
}

/** Absence pauses this person's rotations and the family's staple clocks
 * (FR-110, FR-733). */
export async function setAbsence(
  mutate: Mutate,
  input: {
    readonly membershipId: string;
    readonly from: number | null;
    readonly until: number | null;
  },
): Promise<void> {
  await mutate((builder) =>
    builder.set(EntityTypes.membership, input.membershipId, {
      absentFrom: input.from,
      absentUntil: input.until,
    }),
  );
}

/**
 * What the family learned about a dish after cooking it (FR-536).
 *
 * Written on the recipe rather than on the meal slot, because the point of the
 * note is the *next* time — a slot is gone by then.
 */
export async function noteAfterCooking(
  mutate: Mutate,
  input: { readonly recipeId: string; readonly note: string; readonly at: number },
): Promise<void> {
  await mutate((builder) =>
    builder.set(EntityTypes.recipe, input.recipeId, {
      nextTimeNote: input.note.trim(),
      nextTimeNoteAt: input.at,
    }),
  );
}

/** One step of a routine, in the shape the task entity stores it. */
export interface RoutineStepState {
  readonly id: string;
  readonly title: string;
  readonly icon: string;
  readonly done: boolean;
}

/**
 * A child ticking off part of their routine (FR-1207).
 *
 * Subtasks live as one array field, so the whole sequence is rewritten. That is
 * a last-writer-wins field, which is the right trade here: two people ticking the
 * same child's routine at the same second is not a case worth a merge, and the
 * child in front of the kitchen tablet must see their tick immediately.
 *
 * Completing the last step does not complete the task: a child's task carries an
 * approval gate (FR-312), and silently closing it would take that away.
 */
export async function setRoutineStepDone(
  mutate: Mutate,
  input: {
    readonly taskId: string;
    readonly steps: readonly RoutineStepState[];
    readonly stepId: string;
    readonly done: boolean;
  },
): Promise<void> {
  const next = input.steps.map((step) => ({
    id: step.id,
    title: step.title,
    icon: step.icon,
    done: step.id === input.stepId ? input.done : step.done,
  }));

  await mutate((builder) => builder.set(EntityTypes.task, input.taskId, { subtasks: next }));
}

/**
 * The first question of onboarding, answered (FR-124).
 *
 * A person and their membership are created together: the person is the identity
 * and the membership is what makes them part of *this* family (FR-105).
 */
export async function addFamilyMember(
  mutate: Mutate,
  input: {
    readonly familyId: string;
    readonly name: string;
    readonly role: "adult" | "teen" | "child";
  },
): Promise<string> {
  let personId = "";

  await mutate((builder) => {
    personId = builder.createNew(EntityTypes.person, { name: input.name.trim() });
    builder.createNew(EntityTypes.membership, {
      familyId: input.familyId,
      personId,
      role: input.role,
    });
  });

  return personId;
}

/**
 * The second question, answered: only that area is switched on (FR-125). The
 * others appear when the family needs them, which is why this stores one area
 * rather than a set of feature flags.
 */
export async function chooseStartArea(
  mutate: Mutate,
  input: { readonly familyId: string; readonly area: string },
): Promise<void> {
  await mutate((builder) => {
    builder.set(EntityTypes.family, input.familyId, { activeArea: input.area });
    builder.setAdd(EntityTypes.family, input.familyId, "enabledAreas", input.area);
  });
}

/**
 * Consent for the health module (FR-1407).
 *
 * Every grant is its own record, never an edit of an earlier one, because what
 * was agreed, when, and in which policy version is the accountability evidence
 * (FR-1410) — and evidence you overwrite is not evidence.
 */
export async function grantConsent(
  mutate: Mutate,
  input: {
    readonly personId: string;
    readonly subject: string;
    readonly policyVersion: string;
    readonly at: string;
  },
): Promise<string> {
  let id = "";
  await mutate((builder) => {
    id = builder.createNew(EntityTypes.consent, {
      personId: input.personId,
      subject: input.subject,
      policyVersion: input.policyVersion,
      grantedAt: input.at,
    });
  });
  return id;
}

/**
 * Withdrawing consent (FR-1408): one tap, the same as granting. The record is
 * stamped rather than deleted, for the same reason as above.
 */
export async function revokeConsent(
  mutate: Mutate,
  input: { readonly consentIds: readonly string[]; readonly at: string },
): Promise<void> {
  await mutate((builder) => {
    for (const id of input.consentIds) {
      builder.set(EntityTypes.consent, id, { revokedAt: input.at });
    }
  });
}

/**
 * Carry out an erasure that was already shown to the person (FR-1414).
 *
 * The plan comes from `planErasure` and is applied verbatim, so what was on
 * screen is what happens. Shared entries are kept and only the fields naming the
 * person are cleared — a family calendar does not disappear because one member
 * left (FR-1417a).
 *
 * TODO(WP-0.8): `plan.anonymizeAuthorship` cannot be honoured from a client —
 * the actor on already-shipped operations lives in the server's log. The
 * backend's erasure endpoint rewrites those to `ANONYMOUS_ACTOR`; this command
 * covers the entity data only.
 */
export async function erasePersonalData(
  mutate: Mutate,
  plan: {
    readonly deleteEntityRefs: readonly { readonly type: string; readonly id: string }[];
    readonly clearFields: readonly { readonly type: string; readonly id: string; readonly field: string }[];
    readonly removeSetMembers: readonly {
      readonly type: string;
      readonly id: string;
      readonly field: string;
      readonly member: string;
    }[];
  },
): Promise<void> {
  await mutate((builder) => {
    for (const ref of plan.deleteEntityRefs) builder.delete(ref.type, ref.id);
    for (const ref of plan.clearFields) builder.set(ref.type, ref.id, { [ref.field]: null });
    for (const ref of plan.removeSetMembers) builder.setRemove(ref.type, ref.id, ref.field, ref.member);
  });
}

/** Deleting the whole family, in the app, as the stores require (FR-1415). */
export async function eraseFamilyData(
  mutate: Mutate,
  refs: readonly { readonly type: string; readonly id: string }[],
): Promise<void> {
  await mutate((builder) => {
    for (const ref of refs) builder.delete(ref.type, ref.id);
  });
}

/** Switching learning off must also forget what was learned (AI-06). */
export async function setLearningEnabled(
  mutate: Mutate,
  input: { readonly familyId: string; readonly enabled: boolean; readonly catalogItemIds: readonly string[] },
): Promise<void> {
  await mutate((builder) => {
    builder.set(EntityTypes.family, input.familyId, { learningEnabled: input.enabled });
    if (input.enabled) return;
    for (const id of input.catalogItemIds) {
      builder.set(EntityTypes.catalogItem, id, { forgottenAt: Date.now() });
    }
  });
}

function ensureCatalogItem(builder: MutationBuilder, itemKey: string, name: string): void {
  // `entity.create` is idempotent, so this is safe to send every time and
  // removes the need for a read-before-write on the hot path.
  const fields: Record<string, Value> = { name: name.trim(), productGroup: "other" };
  builder.create(EntityTypes.catalogItem, itemKey, fields);
}
