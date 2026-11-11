// Creates one sandbox order, waits for you to approve it as the buyer, then captures it.
// Usage:  node scripts/create-order.js <product number 1-6>
// Saves the raw PayPal responses to fixtures/orders/. Also used by reseed.js via createOrder().

const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { api } = require("./paypal");

// Fictional store "Fernhill Goods". sku links each order to mock store data later.
const PRODUCTS = [
  { sku: "FH-MUG-01", name: "Hand-thrown Ceramic Mug", price: "28.00" },
  { sku: "FH-THROW-02", name: "Linen Throw Blanket", price: "64.00" },
  { sku: "FH-CANDLE-03", name: "Soy Candle Trio", price: "35.00" },
  { sku: "FH-NOTE-04", name: "Leather Field Notebook", price: "42.00" },
  { sku: "FH-POT-05", name: "Terracotta Planter Set", price: "55.00" },
  { sku: "FH-TEA-06", name: "Loose-leaf Tea Sampler", price: "22.00" },
];

// Creates, waits for approval, captures and saves one order. Returns the capture, or
// throws with a readable message.
async function createOrder(product) {
  // 1. Create the order
  const created = await api("POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: product.sku,
        custom_id: product.sku,
        description: product.name,
        amount: {
          currency_code: "USD",
          value: product.price,
          breakdown: { item_total: { currency_code: "USD", value: product.price } },
        },
        items: [
          {
            name: product.name,
            sku: product.sku,
            quantity: "1",
            category: "PHYSICAL_GOODS",
            unit_amount: { currency_code: "USD", value: product.price },
          },
        ],
      },
    ],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: "Fernhill Goods",
          user_action: "PAY_NOW",
          return_url: "https://example.com/approved",
          cancel_url: "https://example.com/cancelled",
        },
      },
    },
  });

  if (!created.ok) {
    throw new Error(`Create order failed (HTTP ${created.status}): ${JSON.stringify(created.body, null, 2)}`);
  }

  const orderId = created.body.id;
  const approveLink = created.body.links.find((l) => l.rel === "payer-action" || l.rel === "approve");
  console.log(`Created order ${orderId} for ${product.name} ($${product.price}).\n`);
  console.log("Open this link in a browser and log in with the PERSONAL (buyer) sandbox account:");
  console.log(`\n  ${approveLink.href}\n`);
  console.log("Approve the payment. You'll land on an example.com page; that's expected, just close it.");

  // 2. Wait for the buyer to approve
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("\nPress Enter here once you've approved it... ");
  rl.close();

  // 3. Capture the payment
  const captured = await api("POST", `/v2/checkout/orders/${orderId}/capture`, {});
  if (!captured.ok) {
    const hint =
      captured.body.details?.[0]?.issue === "ORDER_NOT_APPROVED"
        ? "\n-> The buyer hasn't approved yet. Open the link, approve, and run this again."
        : "";
    throw new Error(`Capture failed (HTTP ${captured.status}): ${JSON.stringify(captured.body, null, 2)}${hint}`);
  }

  const capture = captured.body.purchase_units[0].payments.captures[0];
  console.log(`\nSUCCESS: captured ${capture.amount.value} ${capture.amount.currency_code}, status ${capture.status}.`);
  console.log(`Capture (transaction) ID: ${capture.id}`);

  // 4. Save raw responses for fixtures
  const dir = path.join(__dirname, "..", "fixtures", "orders");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${product.sku}_${orderId}.json`);
  fs.writeFileSync(file, JSON.stringify({ product, created: created.body, captured: captured.body }, null, 2));
  console.log(`Saved to ${path.relative(process.cwd(), file)}`);
  return capture;
}

async function main() {
  const product = PRODUCTS[Number(process.argv[2]) - 1];
  if (!product) {
    console.log("Pick a product number:");
    PRODUCTS.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} ($${p.price})`));
    console.log("\nExample: node scripts/create-order.js 1");
    process.exit(1);
  }
  await createOrder(product);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("Error:", e.message);
    process.exit(1);
  });
}

module.exports = { PRODUCTS, createOrder };
