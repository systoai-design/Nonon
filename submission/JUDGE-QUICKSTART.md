# NONON judge quickstart

NONON does everyday file work with an AI that runs on your own computer. This page gets you from download to a finished, undone change.

## 1. Install (one time)

- Download from https://trynonon.xyz/download. Windows 10 or 11 (64-bit), or a Mac with Apple silicon (M1 or later; Intel Macs are not supported).
- Windows: the installer may show "Windows protected your PC" because it is not code-signed. Choose More info, then Run anyway. The page lists a SHA-256 checksum so you can check the file.
- Mac: open the .dmg, drag NONON to Applications. It is signed and notarized.
- Needs the internet once, for the AI download below. After that its core jobs work offline.

## 2. First run (about 1 to 10 minutes, mostly the download)

1. Meet Non: press Continue.
2. "What do you want help with?": choose **Bookkeeping**, press Continue.
3. "Get the built-in AI": NONON checks your computer and offers to download the AI (3 to 6 GB). Accept. Time depends on your connection (on the dev PC the 4B model plus engine took about a minute). When it says "The built-in AI is ready", press Continue.
4. "Pick a folder to work in": choose **Try sample files**, pick or create an empty folder, press **Start using NONON**. NONON puts practice files in a `Samples` folder inside it.

## 3. The 3-minute path

1. Click your project in the left list. In the box at the bottom type, then press Enter:
   `Compare expense-report-may-2026.csv with bank-export-may-2026.csv`
   Name the two files. A request without file names ("compare my expense report") makes Non ask you to add files first.
2. Non asks a few plain questions with a "Suggested" answer on each. Press **Continue**.
3. The answer opens in the app within a few seconds on a computer with a graphics card (about 3 seconds on the dev PC, longer on a slow CPU). Read the summary. Click the sheets: **Matched**, **Only in A**, **Only in B**, **Listed twice**, **Not sure**.
4. Press **Changes to check**. Nothing in your file has changed yet. It wants to add two columns, "NONON status" and "NONON note".
5. Press **Make the change**. Open the sample file if you want to look. Then press **Undo this change** and **Yes, undo it**. The file is back the way it was.

## 4. What to expect

For the sample files you should see: 51 rows, all accounted for, 19 matched pairs, 4 only in the expense report, 5 only in the bank export, 1 listed twice, 3 not sure. Totals PHP 70,852.30 and PHP 68,286.70, a difference of PHP 2,565.60. The header shows "AI: This computer". The AI's wording can differ run to run. The numbers come from code and should not.

To check offline use, disconnect from the network after the AI is downloaded and repeat step 3.

## 5. What is unverified

- Real 8 GB computers and Wi-Fi sharing between two separate computers were not tested.
- Gmail with a real Google account, the Claude sign-in, and the Codex and Antigravity sign-in buttons were not run for real.
- The tray icon and start at login were not seen. A .docx output was never opened in Word.
- The offline claim is backed by a no-outside-connections check while the AI generated on the dev PC (`docs/project/04-build-log/runtime-evidence.md`). The demo video was recorded with the internet on and does not prove it by itself.
- No beginner study was run.

Full list: `docs/project/DELIVERY-LEDGER.md`.
