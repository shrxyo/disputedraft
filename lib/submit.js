// Sends the seller-approved response to PayPal. This is the only code that moves a dispute
// forward, so it re-checks everything server-side: the action must still be allowed by PayPal,
// the text and amount must be valid, and evidence comes from store records, not the client.
import fs from "fs";
import path from "path";
import { api, apiForm } from "../scripts/paypal";
import { getDispute, getStoreRecord } from "./disputes";
import { allowedActions, STRATEGIES } from "./playbook";

const submissionsDir = path.join(process.cwd(), "data", "submissions");
const policiesFile = path.join(process.cwd(), "fixtures", "store", "policies.json");

class SubmitError extends Error {
  constructor(message, status = 400, paypal = null) {
    super(message);
    this.status = status;
    this.paypal = paypal;
  }
}

function safeId(id) {
  if (!/^[A-Z0-9-]+$/i.test(id)) throw new SubmitError("Invalid dispute ID");
  return id;
}

// provide-evidence: multipart with the evidence JSON in a part named "input" (confirmed with
// scripts/probe-evidence.js). Tracking from store records makes it PROOF_OF_FULFILLMENT.
function evidenceRequest(store, text) {
  const s = store?.shipment;
  const evidence = s?.tracking_number
    ? {
        evidence_type: "PROOF_OF_FULFILLMENT",
        evidence_info: { tracking_info: [{ carrier_name: s.carrier, tracking_number: s.tracking_number }] },
        notes: text,
      }
    : { evidence_type: "OTHER", notes: text };
  return { evidences: [evidence] };
}

// make-offer: plain JSON. REFUND_WITH_RETURN needs the store's return address.
function offerRequest(strategy, text, amount, currency) {
  const req = { note: text, offer_amount: { currency_code: currency, value: amount.toFixed(2) } };
  if (strategy === "refund_with_return") {
    const { return_address } = JSON.parse(fs.readFileSync(policiesFile, "utf8"));
    return { ...req, offer_type: "REFUND_WITH_RETURN", return_shipping_address_info: { address: return_address } };
  }
  return { ...req, offer_type: "REFUND" };
}

export async function submitResponse(disputeId, { strategy, text, offerAmount }) {
  safeId(disputeId);
  const chosen = STRATEGIES[strategy];
  if (!chosen) throw new SubmitError(`Unknown strategy "${strategy}"`);

  text = String(text ?? "").trim();
  if (!text || text.length > 2000) throw new SubmitError("The response must be 1 to 2,000 characters.");

  const dispute = await getDispute(disputeId);
  if (!allowedActions(dispute).includes(chosen.action)) {
    throw new SubmitError(`PayPal no longer allows ${chosen.action} on this dispute (status ${dispute.status}).`, 409);
  }

  const txn = dispute.disputed_transactions?.[0] ?? {};
  const store = getStoreRecord(txn.custom ?? txn.items?.[0]?.item_id);
  const { value, currency_code } = dispute.dispute_amount;
  const path_ = `/v1/customer/disputes/${disputeId}`;
  let request;
  let res;

  if (chosen.action === "provide_evidence") {
    request = evidenceRequest(store, text);
    const form = new FormData();
    form.append("input", new Blob([JSON.stringify(request)], { type: "application/json" }));
    res = await apiForm("POST", `${path_}/provide-evidence`, form);
  } else if (chosen.action === "make_offer") {
    const amount = Math.round(Number(offerAmount) * 100) / 100;
    if (!(amount > 0 && amount <= Number(value))) {
      throw new SubmitError(`Offer must be between 0.01 and ${value} ${currency_code}.`);
    }
    request = offerRequest(strategy, text, amount, currency_code);
    res = await api("POST", `${path_}/make-offer`, request);
  } else {
    // send-message and accept-claim formats aren't verified in sandbox yet.
    throw new SubmitError(`Submitting "${chosen.label}" isn't supported yet.`);
  }

  if (!res.ok) {
    const detail = (res.body.details ?? []).map((d) => d.issue).join(", ");
    throw new SubmitError(`PayPal rejected the submission (HTTP ${res.status}${detail ? `: ${detail}` : ""}).`, 502, res.body);
  }

  const after = await getDispute(disputeId);
  const submission = {
    dispute_id: disputeId,
    submitted_at: new Date().toISOString(),
    strategy,
    action: chosen.action,
    request,
    paypal_http_status: res.status,
    status_before: dispute.status,
    status_after: after.status,
    stage_after: after.dispute_life_cycle_stage,
    allowed_actions_after: allowedActions(after),
  };
  fs.mkdirSync(submissionsDir, { recursive: true });
  fs.writeFileSync(path.join(submissionsDir, `${disputeId}.json`), JSON.stringify(submission, null, 2));
  return submission;
}

export function getSubmission(disputeId) {
  const file = path.join(submissionsDir, `${safeId(disputeId)}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

export { SubmitError };
