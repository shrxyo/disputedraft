// Fetches every sandbox dispute's full details and saves them to fixtures/disputes/.
// Usage:  node scripts/save-disputes.js

const fs = require("fs");
const path = require("path");
const { api } = require("./paypal");

async function main() {
  const list = await api("GET", "/v1/customer/disputes?page_size=50");
  if (!list.ok) {
    console.error(`List disputes failed (HTTP ${list.status}):`, list.body);
    process.exit(1);
  }

  const dir = path.join(__dirname, "..", "fixtures", "disputes");
  fs.mkdirSync(dir, { recursive: true });

  for (const item of list.body.items || []) {
    const detail = await api("GET", `/v1/customer/disputes/${item.dispute_id}`);
    if (!detail.ok) {
      console.error(`- ${item.dispute_id}: details failed (HTTP ${detail.status})`);
      continue;
    }
    const d = detail.body;
    fs.writeFileSync(path.join(dir, `${d.dispute_id}.json`), JSON.stringify(d, null, 2));

    const actions = (d.links || []).map((l) => l.rel).filter((r) => r !== "self");
    console.log(`- ${d.dispute_id} | ${d.reason} | stage ${d.dispute_life_cycle_stage} | ${d.status}`);
    console.log(`    seller response due: ${d.seller_response_due_date || "n/a"}`);
    console.log(`    transaction: ${d.disputed_transactions?.[0]?.seller_transaction_id || "n/a"}`);
    console.log(`    actions PayPal allows now: ${actions.join(", ") || "none"}`);
  }
  console.log(`\nSaved ${list.body.items?.length || 0} dispute(s) to fixtures/disputes/`);
}

main().catch((e) => {
  console.error("Unexpected error:", e.message);
  process.exit(1);
});
