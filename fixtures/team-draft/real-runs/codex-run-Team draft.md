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

## Review notes

> **Note:** The reviewer asks for changes before this is used. The draft includes a constraint about delivery not being wanted, but this point was not explicitly listed in the 'Constraints' section of the specification design step, although it is mentioned in the source document under 'What we know'.

1. **Left out.** The draft includes 'Delivery is not wanted for now' in the Constraints section, but this point was not explicitly listed in the specification's Constraints section (which only covered budget, deadline, no accounts/loyalty, and ease of use). *Draft says:* "- Delivery is not wanted for now." *Source line 9:* "- Most regular customers live within 2 km of the shop and pick up their order. Delivery is not wanted for now." The reviewer's quote was found in the source at line 9.

**Who did what:** Design: This computer. Implement: Codex (cloud). Review: This computer.

Highlighted sentences are the ones to check against your source before you use this.
