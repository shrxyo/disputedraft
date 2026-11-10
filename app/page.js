import { listDisputeRows } from "../lib/disputes";
import { getSubmission } from "../lib/submit";
import Inbox from "./Inbox";
import ResetButton from "./ResetButton";

export const dynamic = "force-dynamic";

export default async function Home() {
  let rows = null;
  let error = null;
  try {
    rows = (await listDisputeRows()).map((r) => ({ ...r, submitted: Boolean(getSubmission(r.id)) }));
  } catch (err) {
    error = err.message;
  }

  const open = rows?.filter((r) => r.status === "WAITING_FOR_SELLER_RESPONSE") ?? [];
  const atRisk = open.reduce((sum, r) => sum + r.amount, 0);

  return (
    <main>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ marginBottom: 4 }}>Dispute inbox</h1>
        <ResetButton />
      </div>
      <p style={{ marginTop: 0, color: "#475467" }}>
        Fernhill Goods · PayPal sandbox
        {rows && ` · ${open.length} need a response · $${atRisk.toFixed(2)} on hold`}
      </p>
      {error ? (
        <p style={{ color: "#b42318" }}>Could not load disputes from PayPal: {error}</p>
      ) : (
        <Inbox rows={rows} />
      )}
    </main>
  );
}
