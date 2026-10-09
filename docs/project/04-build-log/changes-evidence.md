# Changes workstream: evidence

Service: `app/src/main/services/changes.ts` (`createChangeService`), helpers in `app/src/main/services/changes/`.
Tests: `app/src/main/services/changes.test.ts`.

## Commands and results

```
cd app
npx vitest run src/main/services/changes      -> Test Files 1 passed (1), Tests 40 passed (40)
npx tsc -p tsconfig.node.json --noEmit        -> 0 errors in changes.ts, changes/*, changes.test.ts
```

Real temp files; real exceljs, papaparse and jszip; no filesystem mocks. Only stand-ins:
- the workspace service (`get`, `assertInside`, another workstream's module), using the shared `isInside` helper;
- one labelled fault-injection test for the Windows rename retry (the `Io.rename` seam throws EBUSY twice). A real file lock was not produced.

## What each requirement is proven by

| Requirement | Test (name fragment) |
| --- | --- |
| Original unchanged after stage and after reject (sha256 equal), csv and xlsx | "original is byte-identical after stage and after reject" |
| Paths outside the workspace throw; nothing is staged or emitted | "refuses paths outside the workspace" |
| Stale: file edited between stage and apply gives `stale`, error "This file changed since the proposal was made", nothing written, no recovery folder | "detects an edit made between stage and apply" |
| Stale for a create target that appeared | "is stale when a create target appears" |
| Partial failure reported exactly: step 1 applied, step 2 fails (a file appears where a folder is needed), step 3 not attempted; `editResults`, "Only 1 of 3 steps were applied... Not applied: steps 2, 3", recovery path in the message, recovery copy hash equals the original | "reports a partial application exactly" |
| Failure on the first step is `failed`, "Nothing was changed" | "a first-step failure is `failed`" |
| Recovery restores byte-identical content (sha256) | "applies, stores a verified recovery copy, and recovery is byte-identical" |
| Recovery refuses when the user edited after apply; status unchanged; exact message with the saved path; the user's file untouched | "recovery refuses when the user edited" |
| Second apply refused | same test (`rejects.toThrow(/already applied/)`) |
| Applies on one file are serialised (second proposal is `stale`, not interleaved) | "serialises applies on one file" |
| csv: BOM, CRLF, `;` delimiter, trailing newline kept; quotes, embedded quotes, delimiters and newlines in values written correctly; appended column | "preserves BOM, CRLF, delimiter..." and "keeps LF files LF..." |
| csv: out-of-range cell is a `fail` check; apply refuses; non-UTF-8 file refused rather than corrupted | "fails the stage check when a row or column is out of range", "refuses a file that is not UTF-8" |
| xlsx with a chart / macro (`.xlsm` and `vbaProject.bin`) / pivot / external link / slicer / image / drawing refused, with reason and "Save a copy as .csv or a values-only .xlsx, then try again."; apply writes nothing and makes no recovery copy | "refuses a workbook with a chart", `it.each` "refuses a workbook containing ...", "refuses a .xlsm" |
| Sheet protection, conditional formatting, data validation other than a list refused; a simple drop-down list is kept | "refuses sheet protection, conditional formatting...", "allows a simple drop-down list validation" |
| xlsx with merged cells, column widths, row height, freeze panes, a formula and a second sheet: edit applies and every one of those is preserved; `fullCalcOnLoad` written so formulas recalculate on open; recovery restores the old value | "edits values and keeps merged cells, column widths..." |
| Post-write verifier rejects a saved file that lost merged cells, changed another sheet's cell, did not save the new value, or changed a column width | "the post-write verifier catches..." |
| Missing sheet lists the real sheet names; bad address, duplicate address, address inside a merged block explained | "explains a missing sheet and bad addresses" |
| Formulas with no saved result produce a `warn` check | "warns when formulas have no saved result" |
| Formula cell written (`formula` field) | "writes a formula cell when asked" |
| Preview generated for csv and xlsx when the draft omits one (small before/after table, header row, edited rows, key column, `highlights`); an invalid supplied preview is replaced with a warn check; a valid one is kept | "builds a preview with highlights...", "builds an xlsx preview..." |
| autoApply: applies at stage when enabled and all checks pass; not when off, not when any check is `warn`, never for `rename-move` | "autoApply" group |
| create-file never overwrites; recovery deletes it only if unchanged since apply | "create-file refuses to overwrite..." |
| rename-move: destination must be free; recovery moves back only if the original path is still free and the moved file is unchanged | "rename-move applies, recovers by moving back..." |
| Atomic replace retries EBUSY/EPERM/EACCES with backoff, then reports "open in another program" and leaves the original and no temp file | "retries a rename that Windows refuses" (fault injected) |
| App died mid-apply: on startup the proposal becomes `failed` with an "not certain" message and the recovery path | "marks a change that was mid-apply..." |
| `change:updated` emitted on every status change | event order asserted in several tests (`staged, applying, applied, recovered`) |

## Real-world check beyond the unit tests

The xlsx writer was run (in memory, nothing on disk touched) against 60 `.xlsx` files already on this machine (built by openpyxl/exceljs-style tools for other projects). This found five real defects, all fixed and now covered by regression tests:

1. An empty `<workbookProtection/>` (openpyxl writes it on ordinary files) was flagged as protection. Now only an enabled lock or a password counts.
2. Verification compared style JSON with key order, so identical styles looked different after a round trip. Now key-order independent.
3. A merged-in cell reports its master's value, so editing the master looked like collateral damage. Merge slaves no longer carry a value in the snapshot.
4. exceljs silently drops a column width of exactly 9. The writer now nudges those to 9.00001 (invisible) and the verifier compares widths with a small tolerance. Without verification this would have been a silent change.
5. A number written into a date-formatted cell reads back as a Date; the verifier compares it as the spreadsheet serial number.

Result after the fixes: 57 of 60 files accept an edit of A2 and C3 plus an appended column and pass the post-write verification. The other 3 (`Book1.xlsx`, `timesheet sept.xlsx`) cannot be opened by exceljs ("Invalid row number in model"); stage reports them as a failed check ("could not be opened as a spreadsheet") and writes nothing.

## Conventions the procedures must follow (additions to the contract)

- `csv-set-cells`: `row` and `col` are 0-based indexes into the parsed grid; row 0 is the first line (usually the header). `appendColumns` values go to rows 1..n.
- `xlsx-set-cells`: `address` is A1 style (case-insensitive); the appended header goes in row 1 and values from row 2, after the sheet's last used column.
- `ChangePreview.highlights` index the preview tables (`before`/`after`), not the file.
- `ChangeProposal.appliedFingerprint` is the target's fingerprint after apply; for a `rename-move` target it is the moved file (its `path` is the new path).
- Statuses: `failed` = nothing was applied (or the state is uncertain, said in `error`); `partial` = some steps landed; `stale` = refused before writing; `staged` with `error` set = apply was refused because a check is `fail`.

## Not proven / limits (honest)

- Stale detection for formula caches is not done. Only missing cached results are detected (warn). A formula whose cached number is out of date cannot be told apart without a calculation engine; `fullCalcOnLoad` makes Excel recalculate on open.
- The post-write-verification failure path (restore the original, report `failed`) is exercised only through the verifier unit tests; the restore branch itself was not triggered end to end.
- csv unedited cells keep their values but may be re-quoted (a cell that was `"abc"` is written as `abc`). Values, delimiter, BOM, line endings and trailing newline are preserved; byte-identical output for untouched rows is not promised.
- Not tested on Excel-authored workbooks (none were available on this machine), only on workbooks written by other tools. Not tested on macOS.
- A real Windows file lock (Excel holding the file open) was not reproduced; the retry logic is tested with an injected fault.
- exceljs cannot open 3 of the 60 sample files; those are reported as unsupported.
