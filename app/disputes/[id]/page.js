import Link from "next/link";
import { getDispute, getStoreRecord, REASON_LABELS, sellerResponse } from "../../../lib/disputes";
import { allowedActions } from "../../../lib/playbook";
import { getSavedAnalysis } from "../../../lib/agent";
import DisputeView from "./DisputeView";

export const dynamic = "force-dynamic";

export default async function DisputePage({ params }) {
  const { id } = await params;
  let dispute;
  try {
    dispute = await getDispute(id);
  } catch (err) {
    return (
      <main>
        <Link href="/">← Back to inbox</Link>
        <p style={{ color: "#b42318" }}>Could not load dispute {id} from PayPal: {err.message}</p>
      </main>
    );
  }

  const txn = dispute.disputed_transactions?.[0] ?? {};
  const sku = txn.custom ?? txn.items?.[0]?.item_id;
  const summary = {
    id: dispute.dispute_id,
    product: getStoreRecord(sku)?.listing.title ?? sku,
    sku,
    buyer: txn.buyer?.name,
    reason: REASON_LABELS[dispute.reason] ?? dispute.reason,
    amount: dispute.dispute_amount,
    stage: dispute.dispute_life_cycle_stage,
    status: dispute.status,
    dueDate: dispute.seller_response_due_date,
    buyerMessages: (dispute.messages ?? []).filter((m) => m.posted_by === "BUYER"),
    allowedActions: allowedActions(dispute),
    sellerResponse: sellerResponse(dispute),
  };

  return (
    <main style={{ maxWidth: 960 }}>
      <Link href="/">← Back to inbox</Link>
      <DisputeView summary={summary} initialAnalysis={getSavedAnalysis(id)} />
    </main>
  );
}
