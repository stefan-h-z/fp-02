# Data protection impact assessment (Art. 35 GDPR)

**Status:** draft, derived from the implemented system · **not legal advice**
**Must be reviewed by a data protection lawyer before publication.**

## Why one is required

Art. 35(3) and the German supervisory authorities' list both point the same way
here. Three factors coincide:

1. **Special categories** (Art. 9): health data — medication, administration
   times, measured values (SPEC §12).
2. **Vulnerable data subjects**: children, including pre-school children who
   cannot meaningfully consent themselves.
3. **Systematic evaluation of personal aspects**: the staples engine derives a
   household's purchasing rhythm from behaviour (SPEC §10.2).

Any two of these would make an assessment advisable; all three together make it
required. This document assesses the processing as built.

## Description of the processing

See [`records-of-processing.md`](records-of-processing.md) for the systematic
description. In summary: an offline-first app in which each family is an
isolated space; every change is an operation in that family's log; devices
authenticate with long-lived tokens and no password; and behavioural learning is
confined to purchase timestamps.

## Necessity and proportionality

| Purpose | Could it be achieved with less data? |
|---|---|
| Shared organization | No — the data *is* the family's organization |
| Anticipating needs | The design already answers this: it uses **only** the dates an item was ticked off. No quantities, no stock levels, no barcode scans, no best-before dates, no receipts (SPEC FR-743). This is the minimum from which the purpose is achievable at all |
| Health protocols | The app records what was prescribed and what was administered. It deliberately performs **no dose calculation and no diagnosis** (SPEC FR-915), so it holds no derived medical assessment |
| AI capture | Audio is transcribed and deleted; only the text the user intended to capture persists |

Data minimization is an architectural decision rather than a policy: what is not
stored need not be disclosed, exported, deleted or reported (SPEC ARC-07).

## Risks to data subjects, and what mitigates them

### R1 — A child's health data is exposed to someone who should not see it

*Likelihood:* low · *Severity:* high

Mitigations as built: the module does not exist until an adult activates it with
separate explicit consent; its administration is behind a second factor;
protocol data is separately deletable and separately exportable; delegation to a
babysitter or school is a **scoped, expiring link** carrying only the instances
being delegated, never access to the family (SPEC FR-923, FR-108: default seven
days, maximum ninety, no unlimited links).

*Residual risk:* a guest link forwarded by its holder. Accepted: the link is
narrow, expires, and is revocable, and the alternative (an account per
babysitter) would not be used.

### R2 — A child is profiled

*Likelihood:* very low · *Severity:* high

Mitigation: child profiles are excluded from every analysis unconditionally.
This is not a setting a parent can switch on — `learningAllowed` returns false
for any membership with the child role regardless of the family's own
preference, and it is covered by tests.

*Residual risk:* a child recorded as an adult by mistake. Mitigated only by the
role being visible and editable; noted rather than solved.

### R3 — The behavioural profile reveals more than intended

*Likelihood:* medium · *Severity:* low to medium

A purchase rhythm can imply things a household did not set out to disclose —
dietary patterns, medication, an absence. Mitigations: the data never leaves the
family's own space; there is no analytics pipeline and no third-party recipient;
the learning is switchable off per family and switching it off deletes what was
learned; raw timestamps are pruned after five years.

*Residual risk:* accepted, and the reason the switch and the plain-language
explanation exist (SPEC FR-1417).

### R4 — A device is lost while permanently signed in

*Likelihood:* medium · *Severity:* medium

The product deliberately keeps sessions alive indefinitely, because the
documented failure mode of family apps is the second adult being logged out and
never returning (SPEC §4.2). Mitigations: every device is listed and individually
revocable from any other device (FR-122); sensitive areas require a second
factor even on an unlocked device (FR-117); device tokens are stored hashed.

*Residual risk:* the window between loss and revocation. Accepted as the price
of the adoption property, and stated here rather than hidden.

### R5 — One family member's erasure damages the others

*Likelihood:* medium · *Severity:* medium

Family data has several data subjects at once. Mitigation: erasure anonymizes
authorship and clears the person from shared objects rather than deleting them;
only the departure of the **last adult** removes the family; a child's data is
individually removable without touching anything else (SPEC FR-1417a). The plan
is computed and shown before anything is deleted.

### R6 — AI processing sends family content to a third party

*Likelihood:* certain (by design) · *Severity:* medium

Mitigations: the provider is EU-hosted; processing is server-side so no client
holds provider credentials; the processor agreement must exclude training on
this data; AI-assisted processing is labelled in the interface so users know
which inputs travel (SPEC AI-01 to AI-04, FR-1405).

*Open:* the agreement has to be signed before launch (OBL-03).

### R7 — Data is lost rather than exposed

*Likelihood:* low · *Severity:* medium

An offline-first app that silently drops a device's work is a data protection
issue as much as a quality one — the family's record becomes wrong. Mitigations:
convergence is established by property tests over randomized multi-device
interleavings; unsent work survives restarts; rejections that could succeed
later never discard work; conflicts on critical fields are shown rather than
resolved silently.

## Consultation

Art. 35(9) asks for the views of data subjects where appropriate. The realistic
route here is the closed test group required before store release anyway
(SPEC STO-03): ask those families specifically about the health module, the
learning switch and the guest links, and record what they say.

## Conclusion (to be confirmed by review)

The residual risks after the mitigations above are, in the author's assessment,
not high within the meaning of Art. 36(1), so prior consultation with the
supervisory authority is probably not required. **This conclusion is the part
most in need of professional review**, because it is the one that decides
whether the app may launch without consulting the authority.

## Review schedule

Re-assess when any of these changes: a new category of data, a new processor, a
new automated inference, monetization, or a change to how children's data is
handled.
