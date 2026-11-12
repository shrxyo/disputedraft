// Creates fresh sandbox disputes for the demo after earlier ones were used up by a submit.
// For each SKU: creates + captures a new order (you approve it as the buyer), tells you how to
// open the dispute as the buyer, waits until PayPal shows it, then saves it and points the
// store record at it.
//
// Usage:  node scripts/reseed.js FH-MUG-01 FH-POT-05

const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { api } = require("./paypal");
const { PRODUCTS, createOrder } = require("./create-order");

const root = path.join(__dirname, "..");

// What to pick in the buyer's "Report a problem" flow, per scenario (see CLAUDE.md seed table).
const SCENARIOS = {
  "FH-MUG-01": {
    reason: "I didn't receive my item",
    message: "I ordered the ceramic mug over a week ago and it still hasn't arrived. I'd like to know where it is and when it will get here.",
  },
  "FH-THROW-02": {
    reason: "Item is significantly different from the description",
    message: "The throw blanket I received is a different color than the photos and much thinner than I expected from the listing description.",
  },
  "FH-CANDLE-03": {
    reason: "I don't recognize this transaction / unauthorized transaction",
    message: "I don't recognize this purchase from Fernhill Goods. I did not place this order and did not authorize this charge on my account.",
  },
  "FH-NOTE-04": {
    reason: "I didn't receive my item",
    message: "The tracking says my notebook was delivered, but it was not at my door or with my neighbors. I never received the package at all.",
  },
  "FH-POT-05": {
    reason: "Item is significantly different from the description",
    message: "The planters are much smaller than they looked in the listing photos and are too small for my plants. This is not what I expected.",
  },
};

// A fresh prompt per question: createOrder() opens its own, and two at once garble input.
async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

const POLL_MS = 15_000;
const TIMEOUT_MS = 20 * 60_000;

async function findDisputeFor(captureId, knownIds) {
  const list = await api("GET", "/v1/customer/disputes?page_size=50");
  if (!list.ok) throw new Error(`List disputes failed (HTTP ${list.status})`);
  for (const item of list.body.items ?? []) {
    if (knownIds.has(item.dispute_id)) continue;
    const detail = await api("GET", `/v1/customer/disputes/${item.dispute_id}`);
    knownIds.add(item.dispute_id); // checked once is enough; it belongs to some other order otherwise
    const txn = detail.body.disputed_transactions?.[0];
    if (detail.ok && txn?.seller_transaction_id === captureId) return detail.body;
  }
  return null;
}

async function reseed(product) {
  const scenario = SCENARIOS[product.sku];
  console.log(`\n=== ${product.sku}: ${product.name} ===\n`);

  // Remember disputes that exist now, so only new ones are checked while waiting.
  const before = await api("GET", "/v1/customer/disputes?page_size=50");
  const knownIds = new Set((before.body.items ?? []).map((d) => d.dispute_id));

  const capture = await createOrder(product);

  console.log(`
Now open the dispute as the buyer:
  1. Go to https://www.sandbox.paypal.com and log in with the PERSONAL sandbox account
     (SANDBOX_PERSONAL_EMAIL / PASSWORD in your .env).
  2. Open Activity, find the Fernhill Goods payment of $${product.price} (just now).
  3. Click "Report a problem" (or go to Resolution Center > Report a problem).
  4. Choose: ${scenario.reason}
  5. When asked to describe the problem (at least 120 characters), you can paste:
       ${scenario.message}
     If it asks for a photo, skip it or use your own photo (never a web image).
  6. Submit.`);
  await ask("\nPress Enter once you've submitted the dispute... ");

  console.log("Waiting for PayPal to show the new dispute (checks every 15s, up to 20 min)...");
  const started = Date.now();
  let dispute = null;
  while (!dispute && Date.now() - started < TIMEOUT_MS) {
    dispute = await findDisputeFor(capture.id, knownIds);
    if (!dispute) await new Promise((r) => setTimeout(r, POLL_MS));
  }
  if (!dispute) {
    throw new Error(`No dispute found for transaction ${capture.id} after 20 min. Re-run save-disputes.js later.`);
  }

  fs.writeFileSync(path.join(root, "fixtures", "disputes", `${dispute.dispute_id}.json`), JSON.stringify(dispute, null, 2));

  const storeFile = path.join(root, "fixtures", "store", `${product.sku}.json`);
  const store = JSON.parse(fs.readFileSync(storeFile, "utf8"));
  store.capture_id = capture.id;
  store.dispute_id = dispute.dispute_id;
  fs.writeFileSync(storeFile, JSON.stringify(store, null, 2) + "\n");

  console.log(`
Found ${dispute.dispute_id}: ${dispute.reason}, ${dispute.dispute_life_cycle_stage}, ${dispute.status}.
(UNDER_REVIEW for the first few minutes is normal; it becomes WAITING_FOR_SELLER_RESPONSE.)
Saved fixtures/disputes/${dispute.dispute_id}.json and updated fixtures/store/${product.sku}.json.`);
  return dispute.dispute_id;
}

async function main() {
  const skus = process.argv.slice(2);
  const products = skus.map((sku) => PRODUCTS.find((p) => p.sku === sku && SCENARIOS[sku]));
  if (!skus.length || products.includes(undefined)) {
    console.log("Usage: node scripts/reseed.js <SKU> [SKU...]");
    console.log(`SKUs: ${Object.keys(SCENARIOS).join(", ")}`);
    process.exit(1);
  }

  const created = [];
  for (const product of products) created.push(await reseed(product));

  console.log(`
Done: ${created.join(", ")}
Next:
  - Open each new dispute in the app once; the AI analysis runs automatically.
  - To make that analysis the committed seed (so Reset demo shows it without using AI quota):
      cp data/analyses/<dispute id>.json fixtures/analyses/
  - Commit fixtures/ and push, so Render has the updated store records.`);
}

main().catch((e) => {
  console.error("\nError:", e.message);
  process.exit(1);
});
