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
