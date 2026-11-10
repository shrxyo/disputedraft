// Server-side dispute data: live PayPal sandbox disputes joined with mock store data.
import fs from "fs";
import path from "path";
import { api } from "../scripts/paypal";

const storeDir = path.join(process.cwd(), "fixtures", "store");

export const REASON_LABELS = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Item not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorized",
  DUPLICATE_TRANSACTION: "Duplicate charge",
  CANCELED_RECURRING_BILLING: "Canceled subscription",
  CREDIT_NOT_PROCESSED: "Credit not processed",
  INCORRECT_AMOUNT: "Incorrect amount",
  PAYMENT_BY_OTHER_MEANS: "Paid by other means",
  PROBLEM_WITH_REMITTANCE: "Problem with remittance",
  OTHER: "Other",
};

export function getStoreRecord(sku) {
  if (!sku || !/^[A-Z0-9-]+$/.test(sku)) return null;
  const file = path.join(storeDir, `${sku}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

export async function getDispute(id) {
  const res = await api("GET", `/v1/customer/disputes/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`PayPal get dispute failed (HTTP ${res.status})`);
  return res.body;
}

// One row per dispute for the inbox. The list endpoint omits the SKU, so fetch details too.
export async function listDisputeRows() {
  const res = await api("GET", "/v1/customer/disputes");
  if (!res.ok) throw new Error(`PayPal list disputes failed (HTTP ${res.status})`);
  const details = await Promise.all((res.body.items ?? []).map((d) => getDispute(d.dispute_id)));

  return details.map((d) => {
    const txn = d.disputed_transactions?.[0] ?? {};
    const sku = txn.custom ?? txn.items?.[0]?.item_id ?? null;
    const store = getStoreRecord(sku);
    return {
      id: d.dispute_id,
      sku,
      product: store?.listing.title ?? sku ?? "Unknown item",
      buyer: txn.buyer?.name ?? null,
      reason: REASON_LABELS[d.reason] ?? d.reason,
      amount: Number(d.dispute_amount?.value ?? 0),
      currency: d.dispute_amount?.currency_code ?? "USD",
      stage: d.dispute_life_cycle_stage,
      status: d.status,
      dueDate: d.seller_response_due_date ?? null,
      createdAt: d.create_time,
    };
  });
}
