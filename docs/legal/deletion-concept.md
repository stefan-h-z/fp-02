# Deletion concept

**Status:** draft, derived from the implemented system · **not legal advice.**

Art. 5(1)(e) requires that data is kept no longer than necessary. This document
states how long each kind is kept, why, and what actually deletes it — the code
that does so is named, because a retention policy nothing implements is a
statement of intent rather than a control.

## Retention periods

| Data | Period | Why |
|---|---|---|
| Voice recordings | **Deleted at transcription** — never stored | The text is what the feature needs; the audio is a transport (SPEC OBL-07) |
| Object histories (who changed what, when) | 5 years, rolling | Long-interval tasks (vehicle inspection, tire changes) and seasonality only become visible across years (SPEC decision 25) |
| Purchase timestamps feeding the staples engine | 5 years, rolling | Same reason: a yearly rhythm cannot be learned from a shorter window |
| Derived intervals and confidences | Until the family switches learning off, then immediately | They are the learned model; switching learning off must forget it (SPEC AI-06) |
| Completed shopping-list items | 12 months in the history view | Long enough to answer "what did we buy last time", short enough not to accumulate |
| Finished treatment protocols | Until deleted by the family | They are medical documentation the family may need for a later appointment; automatic deletion of a medication record would be the wrong default (SPEC FR-924) |
| Documents | Until deleted; expiry reminders do not delete | A passport's expiry is a reminder, not a licence to destroy the scan |
| Devices | Until revoked | |
| Invitations and recovery codes | Until redeemed or expired | Invitations expire; a recovery code is replaced on use |
| Guest links | Until expiry (default 7 days, maximum 90) or revocation | SPEC FR-108 |
| Consent records | Kept after revocation | The record of what was agreed and when is the accountability evidence (Art. 7(1)); deleting it would destroy the proof |

## What implements this

- `retentionCutoff(now)` in `packages/domain/src/compliance.ts` computes the
  five-year boundary.
- `pruneOpsBefore(wallMs)` on the `StateStore` removes the operations behind it,
  locally and in the backend's `family_ops`.
- Switching learning off is a command that both flips the family flag and clears
  the learned state (`setLearningEnabled` in `apps/app/src/commands.ts`).
- Deleting the health module offers deletion of everything it holds; without
  activation, no such data exists at all.

Backups follow the same clock: a restored backup carries its own retention
stamps, so restoring an old backup cannot silently reintroduce data that was
due to be pruned.

## Erasure on request (Art. 17)

Family data has several data subjects, so erasure cannot simply delete rows.
`planErasure` produces, and the app shows before anything happens:

1. **Deleted outright** — entities that are only about this person: their
   profile, membership, devices, consents, and any health data naming them.
2. **Cleared in place** — fields on shared objects that named them (who fetches,
   who cooks, who owns a task).
3. **Removed from lists** — participant and eater sets.
4. **Anonymized** — authorship on operations. The family's history stays
   intact and legible; it simply no longer says who wrote each line.

The shared appointment, the recipe, the shopping list survive. Only when the
**last adult** leaves is the family deleted in full — otherwise one person's
departure would destroy everyone else's record (SPEC FR-1417a).

A child's data is individually removable without touching anything else, which
is the case guardians ask about most.

## Account deletion in the app

Both stores require it and it is implemented as a first-class control, not a
support request (SPEC FR-1415). Google additionally requires a route from
outside the app; that route is a published web form on the support domain, and
it is an ops task, not a code one.

## What is deliberately never deleted automatically

- **Consent records**, as above.
- **The operation log's structure.** Pruning removes old operations; it never
  removes the entities they built, because the current state is what the family
  uses. History gets shorter, the app does not lose the shopping list.
- **A finished protocol**, unless the family asks.
