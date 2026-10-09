# NONON copy guide (plain language)

Every sentence a beginner reads must make sense to a shopkeeper, a student or a school teacher on first read.

## Rules
- Reading level: grade 6 to 8. Short sentences, about 18 words or fewer. Everyday words.
- Say what it does for the person, not how it works inside. Warm, direct, no hype. No em dashes.
- Say what happened, whether anything was changed, and what to do next. No codes, no stack traces.
- Do not claim more than the product does. Never say Gmail or online AI "works offline".

## Words
| Do not say | Say |
| --- | --- |
| model, LLM, inference, token, context window | the AI on this computer / AI (never explain internals) |
| local AI | the AI on this computer |
| cloud AI | online AI like Claude |
| runtime, adapter, endpoint, API, latency, throughput | (leave out) or "the AI helper" |
| procedure | job or task |
| pack | kind of work (or just its name) |
| workspace | project (the NONON thing); folder (the folder on disk) |
| fingerprint, hash, sha, checksum | "checked that it downloaded correctly" / "same file as before" |
| proposal, staged | change waiting for your OK |
| apply | make the change |
| revert, recover, restore | undo |
| schema, JSON | (leave out) |
| CSV / XLSX in headings | spreadsheet; name the file type once as "Excel or .csv spreadsheets" |
| cents | exact amount |
| reconcile | compare |
| discrepancy | difference / does not match |
| ambiguous | could be either / not sure which |
| duplicate | listed twice |
| OAuth | sign in with Google |
| quantized, GPU, VRAM | (leave out) / graphics card |
| deterministic, heuristic | (leave out) |

## Starter cards
- `title`: a verb phrase ("Compare two spreadsheets").
- `summary`: one sentence that starts with what the person gets.
- `supports`: one or two short sentences: what to give it, what you get back.
- `limits`: short sentences that also say what to do instead.

## Questions
Ask in plain words and explain the suggested answer. Keep option labels short.

## Checks (green ticks)
Plain statements of what was verified, with the real numbers.
Example: "All 51 rows are accounted for: 19 matched pairs, 9 only in one file, 1 listed twice, 3 not sure."

## AI-written parts
Prompts must ask the AI to write for a non-expert, in short sentences, without jargon. Output shapes
(schemas) are unchanged.
