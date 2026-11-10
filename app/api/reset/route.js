import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

// Clears the app's local state (fresh AI analyses + submission records) so the demo starts
// over from the committed seed analyses. PayPal's sandbox disputes are NOT changed:
// a submitted dispute stays submitted; use scripts/reseed.js for fresh disputes.
const dirs = ["analyses", "submissions"].map((d) => path.join(process.cwd(), "data", d));

export async function POST() {
  let removed = 0;
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      fs.unlinkSync(path.join(dir, f));
      removed++;
    }
  }
  return Response.json({ removed });
}
