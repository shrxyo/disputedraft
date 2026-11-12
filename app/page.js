import { listDisputeRows } from "../lib/disputes";
import Inbox from "./Inbox";
import ResetButton from "./ResetButton";

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
  const nextDue = open.map((r) => r.dueDate).filter(Boolean).sort()[0];
  const nextDays = nextDue ? Math.ceil((new Date(nextDue) - Date.now()) / 86_400_000) : null;

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Dispute inbox</h1>
          <p>Open a dispute and the agent builds the case. You approve before anything goes to PayPal.</p>
        </div>
        <ResetButton />
      </div>

      {rows && (
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Need your response</div>
            <div className="stat-value">{open.length}</div>
            <div className="stat-sub">of {rows.length} disputes</div>
          </div>
          <div className="stat">
            <div className="stat-label">Money on hold</div>
            <div className="stat-value">${atRisk.toFixed(2)}</div>
            <div className="stat-sub">across open disputes</div>
          </div>
          <div className="stat">
            <div className="stat-label">Next deadline</div>
            <div className="stat-value" style={{ color: nextDays !== null && nextDays <= 10 ? "#b42318" : undefined }}>
              {nextDays === null ? "—" : `${nextDays} days`}
            </div>
            <div className="stat-sub">
              {nextDue ? new Date(nextDue).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "nothing due"}
            </div>
          </div>
        </div>
      )}

      {error ? (
        <div className="panel" style={{ color: "#b42318" }}>
          Could not load disputes from PayPal: {error}
        </div>
      ) : (
        <Inbox rows={rows} />
      )}
    </main>
  );
}
