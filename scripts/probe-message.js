// Learns the send-message request format by sending one real message to an already-used
// dispute. Tries plain JSON first, then multipart with an "input" part (the format
// provide-evidence needed). Stops at the first success so the buyer gets at most one message.
//
// Usage: node scripts/probe-message.js [disputeId]   (defaults to the used-up mug dispute)

const { api, apiForm } = require("./paypal");

const id = process.argv[2] || "PP-R-VXU-10197619";
const message = "Hi, just checking in: the tracking for your order shows it on the way. Let us know if it hasn't arrived.";

async function snapshot() {
  const res = await api("GET", `/v1/customer/disputes/${id}`);
  const actions = (res.body.links ?? []).map((l) => l.rel).filter((r) => r !== "self");
  return { status: res.body.status, actions, messages: res.body.messages ?? [] };
}

function report(name, res) {
  console.log(`${name}\n  HTTP ${res.status} ${res.body.name ?? ""}: ${res.body.message ?? ""}`);
  for (const d of res.body.details ?? []) {
    console.log(`  - ${d.issue}${d.field ? ` (field: ${d.field})` : ""}: ${d.description ?? ""}`);
  }
  console.log();
}

(async () => {
  const before = await snapshot();
  console.log(`Dispute ${id} before: ${before.status}, ${before.messages.length} messages`);
  console.log(`Allowed: ${before.actions.join(", ")}\n`);
  if (!before.actions.includes("send_message")) {
    console.log("send_message isn't allowed on this dispute. Stopping.");
    return;
  }

  const probes = [
    ["A. plain JSON { message }", () => api("POST", `/v1/customer/disputes/${id}/send-message`, { message })],
    [
      "B. multipart 'input' part { message }",
      () => {
        const form = new FormData();
        form.append("input", new Blob([JSON.stringify({ message })], { type: "application/json" }));
        return apiForm("POST", `/v1/customer/disputes/${id}/send-message`, form);
      },
    ],
  ];

  for (const [name, run] of probes) {
    const res = await run();
    report(name, res);
    if (res.ok) {
      console.log("PayPal accepted this format. Stopping.");
      break;
    }
  }

  const after = await snapshot();
  console.log(`Dispute ${id} after: ${after.status}, ${after.messages.length} messages`);
  console.log(`Allowed: ${after.actions.join(", ")}`);
  const last = after.messages.at(-1);
  if (last) console.log(`Latest message: [${last.posted_by}] ${last.content}`);
})();
