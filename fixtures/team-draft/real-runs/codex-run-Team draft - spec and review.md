# Team draft: plan, draft and review

Source: product-brief.md
Goal: A one page summary of what the bakery needs, for a web builder who will quote the job.

## Where each step came from

| Step | Done by | Version | Made at | Based on (input fingerprint) | This run |
| --- | --- | --- | --- | --- | --- |
| Design | This computer | 1 | 2026-10-09T09:19:58.922Z | 9c789e29075662d5 | made now |
| Implement | Codex (cloud) | 1 | 2026-10-09T09:20:11.469Z | 229586d972ecda08 | made now |
| Review | This computer | 1 | 2026-10-09T09:20:13.181Z | bedf7282cdfdc38a | made now |

Each step only saw what it needed: the Design step saw the source and your goal; the Implement step saw the plan and the source; the Review step saw the plan, the draft and the source. No other files, email or chat were shared.

## 1. Design: the plan (This computer)

**Audience:** web builder

**Purpose:** provide a one page summary of what the bakery needs

**Structure**

- Current Operations: sales volume, missed calls, customer location, hours (source lines 3, 7, 8, 9, 10)
- Requirements: product listing, pickup time selection, payment method, email confirmation (source lines 12, 14, 15, 16)
- Constraints: budget, deadline, no accounts/loyalty, ease of use for staff (source lines 18, 20, 21, 22, 23)
- Open Questions: who updates the list, cut-off time decision (source lines 25, 27, 28)

**Key points**

- The shop sells about 120 loaves and 60 pastries on a normal weekday. (source lines 7)
- Phone orders are missed on busy mornings; Maria estimates 8 to 10 calls a week go unanswered. (source lines 8)
- Most regular customers live within 2 km of the shop and pick up their order. (source lines 9)
- The shop opens at 6:30 am and closes at 3:00 pm, Tuesday to Sunday. (source lines 10)
- Budget for the first version is 1,500 USD in total. (source lines 20)
- The site must go live before the Saturday market on 14 November. (source lines 21)
- Maria does not want customer accounts or a loyalty scheme in the first version. (source lines 22)
- Everything must be easy for staff who are not technical to update. (source lines 23)

**Constraints**

- Budget for the first version is 1,500 USD in total.
- The site must go live before the Saturday market on 14 November.
- Maria does not want customer accounts or a loyalty scheme in the first version.
- Everything must be easy for staff who are not technical to update: prices and the daily list change often.
- Delivery is not wanted for now.
- Customers choose a pickup time and pay in the shop, not online.

## 2. Implement: the draft (Codex (cloud))

# Harbor Lane Bakery: Online Ordering Brief

## Current Operations

Harbor Lane Bakery is a neighbourhood bakery with one shop and four staff. All orders are currently taken by phone or at the counter. Owner Maria Santos wants customers to order ahead on a simple website.

The shop sells about 120 loaves and 60 pastries on a normal weekday. Phone orders are missed on busy mornings; Maria estimates that 8 to 10 calls a week go unanswered.

Most regular customers live within 2 km of the shop and pick up their orders. The shop opens at 6:30 am and closes at 3:00 pm, Tuesday to Sunday.

## Requirements

- Provide a page listing the daily bread and pastries with prices.
- Let customers choose a pickup time and pay in the shop, not online.
- Send an email to the shop for each order so nothing is missed.

## Constraints

- The total budget for the first version is 1,500 USD.
- The site must go live before the Saturday market on 14 November.
- Customer accounts and a loyalty scheme are excluded from the first version.
- Prices and the daily list change often, so everything must be easy for staff who are not technical to update.
- Delivery is not wanted for now.

## Open Questions

- Who will update the daily list each morning? Maria thinks it could be the opening baker.
- Whether to offer a cut-off time for same-day orders has not been decided.

## 3. Review: findings (This computer)

**Verdict:** Needs changes

The draft includes a constraint about delivery not being wanted, but this point was not explicitly listed in the 'Constraints' section of the specification design step, although it is mentioned in the source document under 'What we know'.

1. Left out. The draft includes 'Delivery is not wanted for now' in the Constraints section, but this point was not explicitly listed in the specification's Constraints section (which only covered budget, deadline, no accounts/loyalty, and ease of use).
   - Draft says: "- Delivery is not wanted for now."
   - Source line 9: "- Most regular customers live within 2 km of the shop and pick up their order. Delivery is not wanted for now."
   - The reviewer's quote was found in the source at line 9.
