/**
 * Seed content and templates (SPEC FR-126, FR-315, FR-316, FR-317, FR-324, FR-717).
 *
 * FR-126 forbids the empty state: a family that has just answered "who is in the
 * family" must find a product with something in it. Everything that fills that
 * first screen lives here, and it lives here **as data** — flat arrays of plain
 * objects with no behaviour — so that adding an entry is a content change, not a
 * code change, and so the whole catalogue can be read in one sitting by a person
 * deciding whether it is honest.
 *
 * **On size.** Every entry below is one somebody genuinely has to do: bins,
 * laundry, the school run, the passport that expires. There is no invented
 * long tail. A prefilled catalogue of ninety plausible-sounding chores is worse
 * than an empty app, because it buries the six things this family actually cares
 * about and makes deletion the first thing they have to learn (P-07). A handful
 * per category, chosen because it is universal, is the whole design.
 *
 * **On language.** Source strings are English (Constitution §VII) and every entry
 * carries a stable `key`. The keys are the contract: `@fam/i18n` translates them
 * (`template.<kind>.<key>`), so the strings here are a readable default and a
 * fallback, never the thing a German family is shown. No German belongs in this
 * file.
 *
 * **On instantiation.** `instantiateTemplate` returns operation *payloads* —
 * field bags, exactly as the reducer stores them. It does not build operations
 * and it does not touch state: ids, HLC stamps, actor attribution and the family
 * id all belong to the command layer, and a template that minted its own ids
 * could not be applied twice on two devices without colliding.
 */
import { derivedId } from "./ids.js";
import type { Value } from "./ops.js";
import { DAY_MS } from "./rhythm.js";
import { EntityTypes, canonicalItemKey } from "./schema.js";
import { UNGROUPED } from "./shopping.js";
import type { TaskKind, TaskRecurrence } from "./tasks.js";

/* ------------------------------------------------------------------------- */
/* Product groups (FR-126, FR-704)                                            */
/* ------------------------------------------------------------------------- */

export interface ProductGroupSeed {
  readonly key: string;
  readonly label: string;
}

/**
 * The aisles of an ordinary supermarket, plus the two non-food domains FR-724
 * names. There is nothing to instantiate: a product group is a *string attribute*
 * on a catalog item (`shopping.ts`), not an entity, so this list is a vocabulary
 * the app offers — a family that shops somewhere with different aisles simply
 * types their own and the grouping follows.
 */
export const STANDARD_PRODUCT_GROUPS: readonly ProductGroupSeed[] = [
  { key: "produce", label: "Fruit and vegetables" },
  { key: "bakery", label: "Bread and bakery" },
  { key: "dairy", label: "Dairy and eggs" },
  { key: "meat-fish", label: "Meat and fish" },
  { key: "dry-goods", label: "Dry goods and tins" },
  { key: "frozen", label: "Frozen" },
  { key: "drinks", label: "Drinks" },
  { key: "household", label: "Household and cleaning" },
  { key: "drugstore", label: "Drugstore and toiletries" },
  { key: UNGROUPED, label: "Other" },
];

/* ------------------------------------------------------------------------- */
/* The task library / mental-load deck (FR-316)                               */
/* ------------------------------------------------------------------------- */

export interface TaskLibraryTemplate {
  readonly kind: "task-library";
  readonly key: string;
  readonly title: string;
  readonly category: string;
  readonly taskKind: TaskKind;
  readonly recurrence: TaskRecurrence;
  /** A rough figure the family corrects; wrong-but-visible beats absent (P-08). */
  readonly effortMinutes: number;
  /** FR-402: the invisible half — remembering that it is due at all. */
  readonly includesNoticing: boolean;
  readonly includesPlanning: boolean;
}

/**
 * The recurring responsibilities almost every household with children has.
 *
 * FR-316 makes the task library and the mental-load deck the same content, so
 * these instantiate as **responsibility cards**, not tasks: a card carries the
 * noticing and the planning (FR-402) and can spawn the executable task, while a
 * task can never spawn the head-work back. The entries that are pure head-work —
 * remembering birthdays, watching whether the shoes still fit — are the reason
 * the deck exists at all, and are marked as such rather than dropped for being
 * hard to tick off.
 */
export const TASK_LIBRARY: readonly TaskLibraryTemplate[] = [
  {
    kind: "task-library",
    key: "weekday-dinner",
    title: "Cook the evening meal",
    category: "food",
    taskKind: "everyday",
    recurrence: { mode: "schedule", every: 1, unit: "day" },
    effortMinutes: 40,
    includesNoticing: false,
    includesPlanning: true,
  },
  {
    kind: "task-library",
    key: "grocery-shop",
    title: "Do the food shop",
    category: "food",
    taskKind: "everyday",
    recurrence: { mode: "schedule", every: 1, unit: "week" },
    effortMinutes: 75,
    includesNoticing: true,
    includesPlanning: true,
  },
  {
    kind: "task-library",
    key: "laundry",
    title: "Wash, dry and put away the laundry",
    category: "household",
    taskKind: "everyday",
    recurrence: { mode: "interval", every: 3, unit: "day" },
    effortMinutes: 45,
    includesNoticing: true,
    includesPlanning: false,
  },
  {
    kind: "task-library",
    key: "kitchen-evening",
    title: "Clear the kitchen after dinner",
    category: "household",
    taskKind: "everyday",
    recurrence: { mode: "schedule", every: 1, unit: "day" },
    effortMinutes: 20,
    includesNoticing: false,
    includesPlanning: false,
  },
  {
    kind: "task-library",
    key: "bins",
    title: "Put the bins out",
    category: "household",
    taskKind: "everyday",
    recurrence: { mode: "schedule", every: 1, unit: "week" },
    effortMinutes: 10,
    includesNoticing: true,
    includesPlanning: false,
  },
  {
    kind: "task-library",
    key: "bathroom",
    title: "Clean the bathroom",
    category: "household",
    taskKind: "everyday",
    recurrence: { mode: "interval", every: 1, unit: "week" },
    effortMinutes: 30,
    includesNoticing: true,
    includesPlanning: false,
  },
  {
    kind: "task-library",
    key: "floors",
    title: "Vacuum and mop the floors",
    category: "household",
    taskKind: "everyday",
    recurrence: { mode: "interval", every: 1, unit: "week" },
    effortMinutes: 45,
    includesNoticing: true,
    includesPlanning: false,
  },
  {
    kind: "task-library",
    key: "school-messages",
    title: "Read and answer messages from school and daycare",
    category: "school",
    taskKind: "everyday",
    recurrence: { mode: "schedule", every: 1, unit: "day" },
    effortMinutes: 10,
    includesNoticing: true,
    includesPlanning: true,
  },
  {
    kind: "task-library",
    key: "medical-appointments",
    title: "Keep track of check-ups and book appointments",
    category: "health",
    taskKind: "everyday",
    recurrence: { mode: "schedule", every: 1, unit: "month" },
    effortMinutes: 20,
    includesNoticing: true,
    includesPlanning: true,
  },
  {
    kind: "task-library",
    key: "birthdays-and-gifts",
    title: "Remember birthdays and organise presents",
    category: "social",
    taskKind: "everyday",
    recurrence: { mode: "schedule", every: 1, unit: "month" },
    effortMinutes: 30,
    includesNoticing: true,
    includesPlanning: true,
  },
  {
    kind: "task-library",
    key: "clothes-and-shoes",
    title: "Check that clothes and shoes still fit",
    category: "care",
    taskKind: "everyday",
    recurrence: { mode: "schedule", every: 3, unit: "month" },
    effortMinutes: 60,
    includesNoticing: true,
    includesPlanning: true,
  },
  {
    kind: "task-library",
    key: "bills",
    title: "Pay the bills and check the account",
    category: "admin",
    taskKind: "everyday",
    recurrence: { mode: "schedule", every: 1, unit: "month" },
    effortMinutes: 30,
    includesNoticing: true,
    includesPlanning: false,
  },
  {
    kind: "task-library",
    key: "vehicle-service",
    title: "Book the car service and inspection",
    category: "maintenance",
    taskKind: "project",
    // FR-320: the yearly jobs are exactly the ones a family forgets, and the
    // reminder logic that gives them weeks of lead time needs the recurrence to
    // say "year" rather than "every 365 days".
    recurrence: { mode: "schedule", every: 1, unit: "year" },
    effortMinutes: 120,
    includesNoticing: true,
    includesPlanning: true,
  },
];

/* ------------------------------------------------------------------------- */
/* Child task suggestions by age (FR-317)                                     */
/* ------------------------------------------------------------------------- */

export interface ChildTaskTemplate {
  readonly kind: "child-task";
  readonly key: string;
  readonly title: string;
  readonly minAge: number;
  /** Open-ended for the oldest band — a teenager keeps doing the younger jobs. */
  readonly maxAge: number | undefined;
  /** FR-323: symbolic stars, no redemption logic, never on an adult's task. */
  readonly rewardStars: number;
}

/**
 * What a child of a given age can realistically own.
 *
 * Bands rather than exact ages, because the app has no business being precise
 * about a six-year-old. `requiresApproval` is deliberately not set on these:
 * `readTask` derives it from the owner's role (FR-312), so a template that also
 * wrote the flag would be a second source of truth that could disagree.
 *
 * Stars stop at twelve: FR-323 puts them on children's tasks, and a fourteen-year
 * -old collecting stars for doing their own laundry is the kind of infantilising
 * the SPEC's non-goals rule out.
 */
export const CHILD_TASK_SUGGESTIONS: readonly ChildTaskTemplate[] = [
  { kind: "child-task", key: "tidy-toys", title: "Put the toys away", minAge: 3, maxAge: 5, rewardStars: 1 },
  { kind: "child-task", key: "clothes-basket", title: "Put dirty clothes in the basket", minAge: 3, maxAge: 5, rewardStars: 1 },
  { kind: "child-task", key: "lay-table", title: "Lay the table", minAge: 3, maxAge: 8, rewardStars: 1 },
  { kind: "child-task", key: "water-plants", title: "Water the plants", minAge: 4, maxAge: 8, rewardStars: 1 },
  { kind: "child-task", key: "pack-school-bag", title: "Pack the school bag for tomorrow", minAge: 6, maxAge: 12, rewardStars: 1 },
  { kind: "child-task", key: "empty-dishwasher", title: "Empty the dishwasher", minAge: 6, maxAge: 12, rewardStars: 1 },
  { kind: "child-task", key: "feed-pet", title: "Feed the pet", minAge: 6, maxAge: undefined, rewardStars: 1 },
  { kind: "child-task", key: "make-bed", title: "Make your own bed", minAge: 6, maxAge: 12, rewardStars: 1 },
  { kind: "child-task", key: "take-bins-out", title: "Take the bins out", minAge: 9, maxAge: undefined, rewardStars: 1 },
  { kind: "child-task", key: "hang-up-washing", title: "Hang up the washing", minAge: 9, maxAge: undefined, rewardStars: 1 },
  { kind: "child-task", key: "own-breakfast", title: "Make your own breakfast", minAge: 9, maxAge: 12, rewardStars: 1 },
  { kind: "child-task", key: "cook-one-meal", title: "Cook one meal a week", minAge: 13, maxAge: undefined, rewardStars: 0 },
  { kind: "child-task", key: "own-laundry", title: "Do your own laundry", minAge: 13, maxAge: undefined, rewardStars: 0 },
  { kind: "child-task", key: "shop-from-list", title: "Do a small shop from the list", minAge: 13, maxAge: undefined, rewardStars: 0 },
];

/** FR-317. An age outside every band returns nothing rather than the nearest
 * guess: suggesting chores to a one-year-old would be a bug with a straight face. */
export function childTasksForAge(ageYears: number): readonly ChildTaskTemplate[] {
  return CHILD_TASK_SUGGESTIONS.filter(
    (template) => ageYears >= template.minAge && (template.maxAge === undefined || ageYears <= template.maxAge),
  );
}

/* ------------------------------------------------------------------------- */
/* Task packs (FR-315)                                                        */
/* ------------------------------------------------------------------------- */

export interface TaskPackItem {
  readonly key: string;
  readonly title: string;
  /**
   * Days relative to the anchor date — negative is before it. A move is not a
   * date, it is a run-up, and a pack that dumped fifteen tasks on the same day
   * would tell a family nothing they did not already know.
   */
  readonly offsetDays: number;
  /** FR-321: the opportunity is gone if this one slips. */
  readonly deadline?: boolean;
  /** FR-303, only where "done" is genuinely ambiguous. */
  readonly definitionOfDone?: string;
}

export interface TaskPackTemplate {
  readonly kind: "task-pack";
  readonly key: string;
  readonly title: string;
  readonly taskKind: TaskKind;
  readonly category: string;
  readonly items: readonly TaskPackItem[];
}

/**
 * The four situations FR-315 names, and no others.
 *
 * There are no dependencies between the items even though FR-308 supports them:
 * a family knows the order of its own move, and a pack that arrived pre-wired
 * with blockers would spend its first hour being unpicked. The lead times are the
 * only ordering claim made here, and they are the one a person cannot easily
 * reconstruct under pressure.
 */
export const TASK_PACKS: readonly TaskPackTemplate[] = [
  {
    kind: "task-pack",
    key: "moving",
    title: "Moving house",
    taskKind: "project",
    category: "moving",
    items: [
      {
        key: "give-notice",
        title: "Give notice on the current home",
        offsetDays: -90,
        deadline: true,
        definitionOfDone: "Notice sent in writing and receipt confirmed",
      },
      { key: "tell-school", title: "Tell school and daycare about the move", offsetDays: -60 },
      { key: "book-removal", title: "Book the removal van or the helpers", offsetDays: -45 },
      { key: "transfer-contracts", title: "Transfer electricity, gas and internet", offsetDays: -30 },
      { key: "redirect-post", title: "Set up mail forwarding", offsetDays: -14 },
      {
        key: "meter-readings",
        title: "Read and photograph all the meters",
        offsetDays: 0,
        definitionOfDone: "Photo of every meter, with the date, saved to the documents",
      },
      { key: "register-address", title: "Register the new address with the authorities", offsetDays: 7, deadline: true },
    ],
  },
  {
    kind: "task-pack",
    key: "school-enrollment",
    title: "Starting school",
    taskKind: "project",
    category: "school",
    items: [
      { key: "registration-appointment", title: "Book the registration appointment", offsetDays: -180 },
      { key: "school-medical", title: "Go to the school medical check", offsetDays: -150 },
      { key: "hand-in-forms", title: "Hand in the registration forms", offsetDays: -120, deadline: true },
      { key: "after-school-care", title: "Apply for after-school care", offsetDays: -120, deadline: true },
      { key: "buy-supplies", title: "Buy the school supplies from the list", offsetDays: -14 },
    ],
  },
  {
    kind: "task-pack",
    key: "trip-preparation",
    title: "Getting ready for a trip",
    taskKind: "project",
    category: "travel",
    items: [
      {
        key: "check-documents",
        title: "Check that passports and ID cards are still valid",
        offsetDays: -90,
        definitionOfDone: "Every traveller's document is valid past the return date",
      },
      { key: "book-travel", title: "Book the travel and the accommodation", offsetDays: -60 },
      { key: "arrange-care", title: "Arrange care for the pets and the plants", offsetDays: -21 },
      { key: "travel-medicine", title: "Put the travel medicine bag together", offsetDays: -7 },
      { key: "pause-deliveries", title: "Pause deliveries and sort out the bins", offsetDays: -3 },
      { key: "pack", title: "Pack the bags", offsetDays: -1 },
    ],
  },
  {
    kind: "task-pack",
    key: "sick-week",
    title: "A child is ill",
    taskKind: "everyday",
    category: "health",
    items: [
      { key: "report-absence", title: "Report the absence to school or daycare", offsetDays: 0, deadline: true },
      { key: "tell-work", title: "Tell work that someone is staying at home", offsetDays: 0 },
      { key: "cancel-week", title: "Cancel this week's appointments and lifts", offsetDays: 0 },
      { key: "restock", title: "Restock drinks, tissues and easy food", offsetDays: 0 },
      { key: "rebook", title: "Rebook what was cancelled", offsetDays: 7 },
    ],
  },
];

/* ------------------------------------------------------------------------- */
/* Packing lists (FR-324)                                                     */
/* ------------------------------------------------------------------------- */

export interface PackingListTemplate {
  readonly kind: "packing-list";
  readonly key: string;
  readonly title: string;
  readonly items: readonly { readonly key: string; readonly title: string }[];
}

/**
 * Packing lists instantiate as **one task with subtasks** (FR-307), not as a pack
 * of tasks: packing is a single job somebody does in one go, and fifteen separate
 * tasks called "swimsuit" would drown every other list in the app.
 */
export const PACKING_LISTS: readonly PackingListTemplate[] = [
  {
    kind: "packing-list",
    key: "swimming-bag",
    title: "Swimming bag",
    items: [
      { key: "swimsuit", title: "Swimsuit" },
      { key: "towel", title: "Towel" },
      { key: "goggles", title: "Goggles" },
      { key: "shower-things", title: "Shower gel and hairbrush" },
      { key: "snack", title: "Snack and drink" },
    ],
  },
  {
    kind: "packing-list",
    key: "overnight-stay",
    title: "Overnight stay",
    items: [
      { key: "pyjamas", title: "Pyjamas" },
      { key: "toothbrush", title: "Toothbrush" },
      { key: "change-of-clothes", title: "Change of clothes" },
      { key: "cuddly-toy", title: "Cuddly toy" },
      { key: "bedtime-book", title: "Bedtime book" },
    ],
  },
  {
    kind: "packing-list",
    key: "beach-holiday",
    title: "Beach holiday",
    items: [
      { key: "travel-documents", title: "Travel documents and ID" },
      { key: "swimwear", title: "Swimwear" },
      { key: "sun-protection", title: "Sun cream and hats" },
      { key: "beach-towels", title: "Beach towels" },
      { key: "first-aid", title: "First-aid kit" },
      { key: "chargers", title: "Chargers and adapters" },
    ],
  },
  {
    kind: "packing-list",
    key: "winter-holiday",
    title: "Winter holiday",
    items: [
      { key: "travel-documents", title: "Travel documents and ID" },
      { key: "warm-layers", title: "Warm layers" },
      { key: "gloves-and-hats", title: "Gloves and hats" },
      { key: "waterproofs", title: "Waterproof trousers and jackets" },
      { key: "snow-boots", title: "Snow boots" },
      { key: "sun-protection", title: "Sun cream and lip balm" },
    ],
  },
];

/* ------------------------------------------------------------------------- */
/* Shopping templates (FR-717)                                                */
/* ------------------------------------------------------------------------- */

export interface ShoppingTemplateItem {
  readonly key: string;
  readonly name: string;
  /** A key from `STANDARD_PRODUCT_GROUPS`, so a seeded list groups by aisle at once. */
  readonly productGroup: string;
}

export interface ShoppingTemplate {
  readonly kind: "shopping-template";
  readonly key: string;
  readonly title: string;
  readonly items: readonly ShoppingTemplateItem[];
}

/**
 * The four lists FR-717 names.
 *
 * The sickness stock carries no medicines by name. The SPEC's non-goals are
 * explicit that this is not a medical device — no dose calculation, no
 * diagnostics, no therapy — and a prefilled list that says which painkiller to
 * buy for a child would be exactly that, dressed up as convenience. What is here
 * is what a household runs out of while somebody is ill.
 */
export const SHOPPING_TEMPLATES: readonly ShoppingTemplate[] = [
  {
    kind: "shopping-template",
    key: "weekly-shop",
    title: "Weekly shop",
    items: [
      { key: "milk", name: "Milk", productGroup: "dairy" },
      { key: "butter", name: "Butter", productGroup: "dairy" },
      { key: "eggs", name: "Eggs", productGroup: "dairy" },
      { key: "cheese", name: "Cheese", productGroup: "dairy" },
      { key: "bread", name: "Bread", productGroup: "bakery" },
      { key: "fruit", name: "Fruit", productGroup: "produce" },
      { key: "vegetables", name: "Vegetables", productGroup: "produce" },
      { key: "potatoes", name: "Potatoes", productGroup: "produce" },
      { key: "pasta", name: "Pasta", productGroup: "dry-goods" },
      { key: "coffee", name: "Coffee", productGroup: "drinks" },
      { key: "toilet-paper", name: "Toilet paper", productGroup: "household" },
      { key: "washing-up-liquid", name: "Washing-up liquid", productGroup: "household" },
    ],
  },
  {
    kind: "shopping-template",
    key: "barbecue",
    title: "Barbecue",
    items: [
      { key: "charcoal", name: "Charcoal", productGroup: "household" },
      { key: "firelighters", name: "Firelighters", productGroup: "household" },
      { key: "meat", name: "Meat and sausages", productGroup: "meat-fish" },
      { key: "rolls", name: "Bread rolls", productGroup: "bakery" },
      { key: "salad", name: "Salad", productGroup: "produce" },
      { key: "sauces", name: "Sauces and dips", productGroup: "dry-goods" },
      { key: "drinks", name: "Drinks", productGroup: "drinks" },
      { key: "napkins", name: "Napkins", productGroup: "household" },
    ],
  },
  {
    kind: "shopping-template",
    key: "holiday-shop",
    title: "Before the holiday",
    items: [
      { key: "sun-cream", name: "Sun cream", productGroup: "drugstore" },
      { key: "insect-repellent", name: "Insect repellent", productGroup: "drugstore" },
      { key: "plasters", name: "Plasters", productGroup: "drugstore" },
      { key: "wet-wipes", name: "Wet wipes", productGroup: "drugstore" },
      { key: "travel-toiletries", name: "Travel-size toiletries", productGroup: "drugstore" },
      { key: "travel-snacks", name: "Snacks for the journey", productGroup: "dry-goods" },
      { key: "water", name: "Bottled water", productGroup: "drinks" },
    ],
  },
  {
    kind: "shopping-template",
    key: "sickness-stock",
    title: "Sickness stock",
    items: [
      { key: "tissues", name: "Tissues", productGroup: "drugstore" },
      { key: "thermometer", name: "Thermometer", productGroup: "drugstore" },
      { key: "tea", name: "Tea", productGroup: "drinks" },
      { key: "still-water", name: "Still water", productGroup: "drinks" },
      { key: "broth", name: "Clear soup or broth", productGroup: "dry-goods" },
      { key: "rusks", name: "Rusks or plain crackers", productGroup: "dry-goods" },
      { key: "honey", name: "Honey", productGroup: "dry-goods" },
    ],
  },
];

/* ------------------------------------------------------------------------- */
/* Instantiation                                                              */
/* ------------------------------------------------------------------------- */

export type FamilyTemplate =
  | TaskLibraryTemplate
  | ChildTaskTemplate
  | TaskPackTemplate
  | PackingListTemplate
  | ShoppingTemplate;

export interface InstantiateOptions {
  readonly now: number;
  /**
   * Who carries what comes out of this.
   *
   * Required, because FR-301 allows exactly one owner and SC-011 treats an
   * ownerless responsibility as a finding to surface — instantiation must not
   * manufacture one. For a whole deck the two adults move the cards straight
   * afterwards; that negotiation is FR-128's job, not this function's, so
   * nothing here pretends to know the split.
   */
  readonly ownerId: string;
  /** The date a pack hangs off — moving day, the first day of school, departure.
   * Defaults to `now`, which is what the "somebody is ill today" pack wants. */
  readonly anchorAt?: number;
  /** The list a shopping template fills. */
  readonly listId?: string;
}

export interface TemplatePayload {
  readonly entityType: string;
  /**
   * Deterministic and template-derived, so two devices seeding the same family
   * offline produce the same rows instead of two copies of everything. The
   * command layer may mint a real id instead; this one is the identity the
   * template can promise.
   */
  readonly localId: string;
  readonly fields: Readonly<Record<string, Value>>;
}

/**
 * Turn a template into the payloads a command would write.
 *
 * Pure and stateless on purpose: no ids from the environment, no clock beyond
 * what was passed in, no reads of `FamilyState`. That is what lets the same call
 * be made on a phone in a tunnel and on the server, and lets a test assert the
 * entire result of "seed the moving pack" as one value.
 */
export function instantiateTemplate(
  template: FamilyTemplate,
  options: InstantiateOptions,
): readonly TemplatePayload[] {
  switch (template.kind) {
    case "task-library":
      return [
        {
          entityType: EntityTypes.responsibilityCard,
          localId: derivedId("template", template.kind, template.key),
          fields: {
            title: template.title,
            ownerId: options.ownerId,
            category: template.category,
            kind: template.taskKind,
            includesNoticing: template.includesNoticing,
            includesPlanning: template.includesPlanning,
            effortMinutes: template.effortMinutes,
            recurrenceMode: template.recurrence.mode,
            recurrenceEvery: template.recurrence.every,
            recurrenceUnit: template.recurrence.unit,
            createdAt: options.now,
          },
        },
      ];

    case "child-task":
      return [
        {
          entityType: EntityTypes.task,
          localId: derivedId("template", template.kind, template.key),
          fields: {
            title: template.title,
            ownerId: options.ownerId,
            state: "open",
            kind: "everyday",
            category: "child",
            rewardStars: template.rewardStars,
            createdAt: options.now,
          },
        },
      ];

    case "task-pack": {
      const anchor = options.anchorAt ?? options.now;
      return template.items.map((item) => ({
        entityType: EntityTypes.task,
        localId: derivedId("template", template.kind, template.key, item.key),
        fields: {
          title: item.title,
          ownerId: options.ownerId,
          state: "open",
          kind: template.taskKind,
          category: template.category,
          dueAt: anchor + item.offsetDays * DAY_MS,
          deadline: item.deadline === true,
          definitionOfDone: item.definitionOfDone ?? "",
          createdAt: options.now,
        },
      }));
    }

    case "packing-list":
      return [
        {
          entityType: EntityTypes.task,
          localId: derivedId("template", template.kind, template.key),
          fields: {
            title: template.title,
            ownerId: options.ownerId,
            state: "open",
            kind: "everyday",
            category: "packing",
            // A packing list with no date is not an oversight: FR-304 makes
            // "someday" a real state, and the swimming bag is packed when the
            // family knows it is swimming, not on a date a template invented.
            ...(options.anchorAt === undefined ? {} : { dueAt: options.anchorAt }),
            subtasks: template.items.map((item) => ({
              id: derivedId("template", template.kind, template.key, item.key),
              title: item.title,
              done: false,
            })),
            createdAt: options.now,
          },
        },
      ];

    case "shopping-template":
      return template.items.map((item) => ({
        entityType: EntityTypes.shoppingItem,
        localId: derivedId("template", template.kind, template.key, item.key),
        fields: {
          ...(options.listId === undefined ? {} : { listId: options.listId }),
          name: item.name,
          // The canonical key is what ties a seeded line to the catalog item that
          // learns its rhythm (`schema.ts`); without it the first real purchase
          // would start a second, parallel history of the same product.
          itemKey: canonicalItemKey(item.name),
          productGroup: item.productGroup,
          checked: false,
        },
      }));
  }
}

/** Everything FR-126 offers a brand-new family, in one place so onboarding does
 * not have to know the shape of the catalogue. */
export function allTemplates(): readonly FamilyTemplate[] {
  return [...TASK_LIBRARY, ...CHILD_TASK_SUGGESTIONS, ...TASK_PACKS, ...PACKING_LISTS, ...SHOPPING_TEMPLATES];
}

/** Templates are addressed by kind and key together — the keys are only unique
 * within a kind, and `moving` as a pack has nothing to do with `moving` anywhere
 * else. */
export function findTemplate(kind: FamilyTemplate["kind"], key: string): FamilyTemplate | undefined {
  return allTemplates().find((template) => template.kind === kind && template.key === key);
}
