# Plain-language copy: before and after

Style rules: `docs/project/COPY-GUIDE.md`. Trigger: Kyle said "Please remove jargon. This is too hard to understand."
Scope: all text produced on the main side (`app/src/main/services/**`), plus `PACKS` blurbs in `shared/contracts.ts`.

## Starter cards (summary and supports)

| # | Job | Before | After |
| --- | --- | --- | --- |
| 1 | Compare two spreadsheets, summary | Find what matches between two tables, such as a bank export and your ledger, and what does not. | See what matches and what does not between two lists, like your bank statement and your own records. |
| 1 | Compare two spreadsheets, supports | Two tables in CSV or Excel (.xlsx) form. Excel files are read from one sheet, as values only. NONON matches rows by reference, amount, date and wording, accounts for every row, and totals in exact cents. | Give it two spreadsheets (Excel or .csv). You get a new spreadsheet showing what matches, what is missing, and what is listed twice. NONON adds up the amounts itself, so the numbers are exact. |
| 2 | Meeting follow-up, summary | Turn meeting notes into action items, decisions and a reply draft you can edit. | Get a list of action items, decisions and open questions from your meeting notes, plus a reply you can edit. |
| 2 | Meeting follow-up, supports | Reads meeting notes from a .txt, .md, .docx or text-based .pdf file, or pasted text. Lists action items with who, what and when, decisions and open questions, each with the exact words and line it came from, and writes a reply draft. Saves an editable Word file and a plain text copy. | Give it your meeting notes as a .txt, .md, .docx or PDF file, or paste them in. You get action items (who, what and when), decisions and open questions, each with the words and line it came from. You also get a reply draft, saved as a Word file and a plain text copy. |
| 3 | Study packet, summary | Turn a reading into key ideas, practice questions with an answer key, and a short glossary. | Get key ideas, practice questions with an answer key, and a short list of key words from a reading. |
| 3 | Study packet, supports | Reads one or more .txt, .md, .docx or text-based .pdf files. Writes key ideas, practice questions, an answer key and a glossary, each with the exact words and line of your reading that back it up. Saves an editable Word file and a plain text copy. | Give it one or more .txt, .md, .docx or PDF files. You get key ideas, practice questions, an answer key and key words with their meanings. Each one shows the words and line from your reading that back it up. It is saved as a Word file and a plain text copy. |
| 4 | Lesson outline, summary | Plan a timed lesson from a reading or a topic, with your assumptions listed and easy to change. | Get a timed lesson plan from a reading or a topic, with your choices listed so you can change them. |
| 4 | Lesson outline, supports | Plans a lesson from a .txt, .md, .docx or text-based .pdf reading, or from a typed topic. Asks for the audience, length and objectives (with suggested answers) and lists them as assumptions. Writes a timed outline with activities, teacher notes, a check for understanding and source lines. Saves an editable Word file and a plain text copy. | Give it a .txt, .md, .docx or PDF reading, or just type a topic. NONON asks who the lesson is for, how long it is and what students should learn, and suggests answers. You get a timed plan with activities, teacher notes, a quick check for understanding and the source lines. It is saved as a Word file and a plain text copy. |
| 5 | Document draft, summary | Summarise a document, then draft a reply or a short report with the source lines shown. | Get a short summary of a document, plus a draft reply or report, with the lines each part came from. |
| 5 | Document draft, supports | Reads one .txt, .md, .docx or text-based .pdf file. Writes a summary and a draft reply, short report or summary, with the lines of the document each part rests on, and highlights anything you still need to fill in. Saves an editable Word file and a plain text copy. | Give it one .txt, .md, .docx or PDF file. You get a short summary of it, plus a draft reply, a short report or a longer summary. Each part shows the lines of the document it is based on, and anything you still need to fill in is highlighted. It is saved as a Word file and a plain text copy. |
| 6 | Tidy a folder, summary | Sort the files in your workspace folder into neat folders. You see every move before anything changes. | Get a plan to sort the loose files in your project's folder into neat folders. You see every move before anything changes. |
| 6 | Tidy a folder, supports | Looks at the files directly inside your workspace folder and in its Samples folder, and proposes an exact list of moves into Sorted/&lt;type&gt; (optionally by year), with tidier file names. Nothing moves until you approve, and you can undo after. | Point it at your project's folder. You get a list of exact moves into Sorted folders by file type (and by year if you choose), with tidier file names. Nothing moves until you say OK, and you can undo it afterwards. |
| 7 | Gmail brief, summary | Read your recent Gmail and list what needs your attention. | You get a list of your recent Gmail, with the emails that need you first. |
| 7 | Gmail brief, supports | Reads your Gmail inbox (read only) for the last 1 to 14 days, up to 50 emails. Writes a text and a Word brief with priorities, deadlines quoted word for word from the emails, links back to Gmail, and reply drafts as plain text. | Give it the number of days to look at, from 1 to 14. You get a text file and a Word document. They show what to do first, deadlines copied from the emails, links back to Gmail, and reply drafts. |
| 8 | Team draft, summary | A plan, a draft and a review, each by the AI you choose for that step, from one source. | Get a plan, a written draft and a review from one source file, with each step done by the AI you choose. |
| 8 | Team draft, supports | Reads a .md, .txt or .docx file, or pasted text, plus a short goal. Three steps run one after another: Design makes a plan, Implement writes the draft from that plan and the source, and Review checks the draft against both and points to the source lines. Each step runs on the AI chosen for it in the project settings; a step with no choice runs on this computer, so it works with no account and no internet. Saves an editable Word file and a text copy of the draft with the review notes, plus a text file with all three steps and who made each. | Give it a .md, .txt or .docx file (or pasted text) and a short goal. Three steps run in order: Plan, Write and Check. Each step uses the AI you picked for it in the project settings. If you pick none, it uses the AI on this computer, which needs no account and no internet. You get a Word file, a text copy and a file showing who did each step. |

## Computer setup messages

| Case | Before | After |
| --- | --- | --- |
| No graphics card | More careful with long documents, but without a graphics card it writes slowly on this computer. | More careful with long documents, but this computer has no graphics card, so it would be slow. |
| Not enough disk space | There is not enough room on this drive. The built-in AI needs about X GB and Y GB is free. Free some space, or choose another drive for it. | There is not enough room on this drive. The AI on this computer needs about X GB, and only Y GB is free. Free up some space, then press install again. Nothing was installed. |
| AI not installed | The built-in AI is not installed yet. | The AI on this computer is not installed yet. |
| Download check failed | The download did not match its published checksum, so it was thrown away. Press install to try again. | The file did not download correctly, so NONON deleted it. Press install to try again. |

(There is no separate low-memory message on the main side; under 6 GB the app simply recommends nothing. Wording for that case lives in the renderer.)

## Common errors

| Case | Before | After |
| --- | --- | --- |
| File changed before the change was made | This file changed since the proposal was made | This file changed after NONON prepared the change. Nothing was changed. Ask for the change again to use the latest file. |
| The AI stopped | The built-in AI stopped (code 1): (log line) | The AI on this computer stopped working. Try again. If it keeps stopping, close other apps or restart your computer. (The code goes to the log only.) |
| Change blocked by a failed check | NONON will not apply this change: (label). | NONON did not make this change. Nothing was changed. Problem: (label). |
| Wrong kind of file for Compare | "x.xls" is a .xls file. NONON compares .csv and .xlsx files only. | "x.xls" is a .xls file. NONON can compare Excel (.xlsx) and .csv spreadsheets only. (Next step: open it in Excel, choose Save As, and save a copy as .xlsx or .csv.) |
| Claude not signed in | Claude Code is installed but not signed in. Sign in with Claude's own page. The check did not use your plan. | Claude Code is installed, but you are not signed in. Choose Sign in to use Claude's own sign-in page. This check did not use your plan. |

## Other rewrites worth noting
- Compare "green ticks": "51 rows in, 51 placed: 19 matched pairs (x2), ..." is now "All 51 rows are accounted for: 19 matched pairs, 9 only in one file, 1 listed twice, 3 not sure which row matches."
- Compare sign question: "One file shows spending as plus numbers and the other as minus numbers. Should NONON treat them as the same thing?" with options "Yes, flip file B ...", "Ignore plus and minus", "No, compare as written".
- Workbook sheets renamed "Duplicates" to "Listed twice" and "Ambiguous" to "Not sure". Cell status "duplicate" in the optional file-A columns is now "listed twice". Tests updated.
- Cloud providers are described as "online AI like Claude"; disclosures still say exactly what is sent where. Nothing says Gmail or online AI works offline.
- Prompts that make the AI write prose now ask for short sentences, everyday words and no jargon (`PLAIN_WRITING` in `doc-common/llm.ts`; Compare, Gmail, chat and routing prompts). Output shapes (zod/JSON schemas) are unchanged. Team-draft `PROMPT_REVISION` bumped to `team-draft-2` so older saved results re-run.

## Verification
- `npx vitest run` from `app/`: 36 files passed, 10 skipped; 658 tests passed, 33 skipped (baseline before this work: 650 passed, 33 skipped; the 8 extra tests were added while other agents worked; no test was removed or skipped by this work).
- `npx tsc -p tsconfig.node.json --noEmit`: no errors.
- Real-model tests (spreadsheet-compare, gmail, team-draft real tests) SKIPPED: no dev model server is running. The prompt changes are therefore verified against fake clients only; they have not been re-run against the real model.
- Not verified: copy read aloud by a real beginner; the renderer wording (another workstream).
