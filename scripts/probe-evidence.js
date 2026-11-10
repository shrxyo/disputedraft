// Learns the provide-evidence request format without submitting anything.
// Every probe below is deliberately invalid, so PayPal should reject it and its error
// message tells us which fields it expects. Stops immediately if a probe ever succeeds.
//
// Usage: node scripts/probe-evidence.js [disputeId]   (defaults to the mug dispute)

const { getToken, api } = require("./paypal");

const base = process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com";
const id = process.argv[2] || "PP-R-VXU-10197619";

const multipart = (input) => {
  const form = new FormData();
  form.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }));
  return { body: form };
};

const probes = [
  {
    name: "A. multipart 'input' part, invalid evidence_type",
    ...multipart({ evidences: [{ evidence_type: "NOT_A_REAL_TYPE", notes: "probe" }] }),
  },
  {
    name: "B. multipart 'input' part, PROOF_OF_FULFILLMENT missing tracking_number",
    ...multipart({
      evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", evidence_info: { tracking_info: [{ carrier_name: "USPS" }] } }],
    }),
  },
  {
    name: "C. plain JSON body, invalid evidence_type",
    body: JSON.stringify({ evidences: [{ evidence_type: "NOT_A_REAL_TYPE", notes: "probe" }] }),
    contentType: "application/json",
  },
];

async function status() {
  const res = await api("GET", `/v1/customer/disputes/${id}`);
  return `${res.body.status} / ${res.body.dispute_life_cycle_stage}`;
}

(async () => {
  console.log(`Dispute ${id} before: ${await status()}\n`);

  for (const p of probes) {
    const headers = { Authorization: `Bearer ${await getToken()}` };
    if (p.contentType) headers["Content-Type"] = p.contentType; // FormData sets its own boundary
    const res = await fetch(`${base}/v1/customer/disputes/${id}/provide-evidence`, { method: "POST", headers, body: p.body });
    const body = await res.json().catch(() => ({}));

    console.log(`${p.name}\n  HTTP ${res.status} ${body.name ?? ""}: ${body.message ?? ""}`);
    for (const d of body.details ?? []) {
      console.log(`  - ${d.issue}${d.field ? ` (field: ${d.field})` : ""}: ${d.description ?? ""}`);
    }
    console.log();

    if (res.ok) {
      console.log("!! PayPal accepted this probe. Stopping. Check the dispute status below.");
      break;
    }
  }

  console.log(`Dispute ${id} after: ${await status()}`);
})();
