import { listDisputeRows } from "../lib/disputes";
import Inbox from "./Inbox";

export const dynamic = "force-dynamic";

export default async function Home() {
  let rows = null;
  let error = null;
  try {
    rows = await listDisputeRows();
  } catch (err) {
    error = err.message;
  }

  const open = rows?.filter((r) => r.status === "WAITING_FOR_SELLER_RESPONSE") ?? [];
  const atRisk = open.reduce((sum, r) => sum + r.amount, 0);

  return (
    <main>
      <h1 style={{ marginBottom: 4 }}>Dispute inbox</h1>
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
