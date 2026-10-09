// Windows only. llama-server needs three Microsoft Visual C++ runtime DLLs. They are not stored in this repository:
// before packaging they are copied from the build computer's System32 into resources/vcruntime, which the installer ships
// next to the app (Microsoft allows app-local redistribution of these files, see its Visual C++ redistributable terms).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") process.exit(0);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "resources", "vcruntime");
const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
mkdirSync(out, { recursive: true });
for (const dll of ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"]) {
  const from = join(system32, dll);
  if (!existsSync(from)) {
    console.error(`Missing ${from}. Install the Microsoft Visual C++ Redistributable (x64) on the build computer, then try again.`);
    process.exit(1);
  }
  copyFileSync(from, join(out, dll));
}
console.log("Visual C++ runtime copied to resources/vcruntime");
