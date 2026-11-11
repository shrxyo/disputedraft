"use client";

import { useEffect, useState } from "react";

const STATUS_STYLE = {
  found: { icon: "✓", color: "#067647", bg: "#ecfdf3", text: "Found" },
  weak: { icon: "!", color: "#b54708", bg: "#fffaeb", text: "Weak" },
  missing: { icon: "✕", color: "#b42318", bg: "#fef3f2", text: "Missing" },
};

const STRENGTH_COLOR = { strong: "#067647", medium: "#b54708", weak: "#b42318" };

const card = { border: "1px solid #eaecf0", borderRadius: 10, padding: "16px 20px", marginTop: 16, background: "#fff" };
const muted = { color: "#475467" };
const h2 = { fontSize: 16, margin: "0 0 12px" };

const money = (v, currency = "USD") => Number(v).toLocaleString("en-US", { style: "currency", currency });
const shortDate = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const ACTION_TEXT = {
  provide_evidence: "submit this evidence to PayPal's reviewer",
  make_offer: "send this refund offer to the buyer",
  send_message: "send this message to the buyer",
};

export default function DisputeView({ summary, initialAnalysis }) {
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(initialAnalysis?.recommendation.response_text ?? "");
  const [offer, setOffer] = useState(initialAnalysis?.recommendation.offer_amount ?? null);
  const [submission, setSubmission] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/disputes/${summary.id}/analyze`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setAnalysis(body);
      setDraft(body.recommendation.response_text);
      setOffer(body.recommendation.offer_amount);
    } catch (err) {
      const busy = /quota|rate|high demand|timeout|aborted/i.test(err.message);
      setError(busy ? "The AI model is busy right now (free-tier limit). Wait a minute and try again." : err.message);
    } finally {
      setRunning(false);
    }
  }

  async function submit() {
    const rec = analysis.recommendation;
    const what = ACTION_TEXT[rec.action] ?? rec.action;
    const amount = rec.action === "make_offer" ? ` (${money(offer, summary.amount.currency_code)})` : "";
    if (!window.confirm(`Approve and ${what}${amount}?\n\nThis goes to PayPal and can't be undone.`)) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/disputes/${summary.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy: rec.strategy, text: draft, offer_amount: offer }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setSubmission(body);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // First visit: run the agent automatically.
  useEffect(() => {
    if (!initialAnalysis) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rec = analysis?.recommendation;
  const canAct = rec && summary.allowedActions.includes(rec.action);
  const daysLeft = Math.ceil((new Date(summary.dueDate) - Date.now()) / 86_400_000);

  return (
    <>
      <h1 style={{ margin: "12px 0 4px" }}>{summary.product}</h1>
      <p style={{ ...muted, marginTop: 0 }}>
        {summary.reason} · {money(summary.amount.value, summary.amount.currency_code)} ·{" "}
        {summary.stage === "CHARGEBACK" ? "Chargeback" : "Inquiry"} · buyer {summary.buyer} · {summary.id}
        <br />
        <strong style={{ color: daysLeft <= 10 ? "#b42318" : "#344054" }}>
          Respond by {shortDate(summary.dueDate)} ({daysLeft} days left)
        </strong>
      </p>

      {summary.buyerMessages.length > 0 && (
        <div style={card}>
          <h2 style={h2}>What the buyer told PayPal</h2>
          {summary.buyerMessages.map((m, i) => (
            <p key={i} style={{ margin: "4px 0" }}>
              “{m.content}” <span style={muted}>({shortDate(m.time_posted)})</span>
            </p>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20 }}>
        <button onClick={run} disabled={running} style={btn(false)}>
          {running ? "Agent is investigating…" : analysis ? "Re-run AI analysis" : "Run AI analysis"}
        </button>
        {analysis && !running && (
          <span style={{ ...muted, fontSize: 13 }}>
            Analyzed {new Date(analysis.created_at).toLocaleString()} with {analysis.model}
          </span>
        )}
      </div>
      {running && (
        <p style={muted}>Pulling the dispute from PayPal, checking store records, and drafting a response (about 20 seconds)…</p>
      )}
      {error && <p style={{ color: "#b42318" }}>{error}</p>}

      {rec && (
        <>
          <div style={card}>
            <h2 style={h2}>
              {rec.case_type}{" "}
              <span style={{ fontSize: 13, color: STRENGTH_COLOR[rec.evidence_strength], marginLeft: 8 }}>
                ● {rec.evidence_strength} evidence
              </span>
            </h2>
            <p style={{ margin: "0 0 8px" }}>{rec.case_summary}</p>
            <p style={{ ...muted, margin: 0 }}>
              <strong>Buyer's claim:</strong> {rec.buyer_claim}
            </p>
          </div>

          <div style={card}>
            <h2 style={h2}>Evidence checklist</h2>
            {analysis.checklist.map((c) => {
              const s = STATUS_STYLE[c.status];
              return (
                <div key={c.id} style={{ display: "flex", gap: 12, padding: "8px 0", borderTop: "1px solid #f2f4f7" }}>
                  <span
                    style={{ minWidth: 76, height: 22, fontSize: 12, fontWeight: 600, borderRadius: 11, textAlign: "center",
                      lineHeight: "22px", color: s.color, background: s.bg }}
                  >
                    {s.icon} {s.text}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{c.label}</div>
                    <div style={{ ...muted, fontSize: 14 }}>{c.detail}</div>
                  </div>
                </div>
              );
            })}
            {rec.evidence_to_add.length > 0 && (
              <p style={{ ...muted, fontSize: 14, marginBottom: 0 }}>
                <strong>Could strengthen the case:</strong> {rec.evidence_to_add.join("; ")}
              </p>
            )}
          </div>

          <div style={card}>
            <h2 style={h2}>Recommended: {rec.strategy_label}</h2>
            <p style={{ margin: "0 0 8px" }}>{rec.strategy_rationale}</p>
            <p style={{ ...muted, fontSize: 13, margin: 0 }}>
              PayPal action: <code>{rec.action}</code>. Other options PayPal allows now:{" "}
              {analysis.strategies.filter((s) => s.key !== rec.strategy).map((s) => s.label).join(", ") || "none"}
            </p>
          </div>

          {submission && <SubmittedPanel submission={submission} />}
          {!submission && summary.sellerResponse && <PayPalResponsePanel response={summary.sellerResponse} status={summary.status} />}
          {!submission && !canAct && !summary.sellerResponse && (
            <div style={card}>
              <p style={{ ...muted, margin: 0 }}>
                PayPal doesn't allow <code>{rec.action}</code> on this dispute right now (status {summary.status}).
              </p>
            </div>
          )}
          {!submission && canAct && (
            <div style={card}>
              <h2 style={h2}>Draft response</h2>
              {rec.action === "make_offer" && (
                <label style={{ display: "block", marginBottom: 10 }}>
                  Offer amount ({summary.amount.currency_code}):{" "}
                  <input
                    type="number"
                    min="0.01"
                    max={summary.amount.value}
                    step="0.01"
                    value={offer ?? ""}
                    onChange={(e) => setOffer(e.target.value)}
                    style={{ width: 100, padding: 4 }}
                  />{" "}
                  <span style={muted}>of {money(summary.amount.value, summary.amount.currency_code)}</span>
                </label>
              )}
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={9}
                style={{ width: "100%", boxSizing: "border-box", padding: 10, font: "inherit", borderRadius: 6, border: "1px solid #d0d5dd" }}
              />
              <p style={{ ...muted, fontSize: 13 }}>
                <strong>Facts cited:</strong> {rec.key_facts.join(" · ")}
              </p>
              <button onClick={submit} disabled={submitting || running || !draft.trim()} style={btn(true)}>
                {submitting ? "Sending to PayPal…" : "Approve & submit to PayPal"}
              </button>
              {submitError && <p style={{ color: "#b42318", marginBottom: 0 }}>{submitError}</p>}
            </div>
          )}

          <details style={{ ...card, fontSize: 14 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>How the agent investigated ({analysis.agent.trace.length} tool calls)</summary>
            <ol style={{ marginBottom: 0 }}>
              {analysis.agent.trace.map((t, i) => (
                <li key={i}>
                  <code>{t.tool}</code>({t.input ? Object.values(t.input).join(", ") : ""}) <span style={muted}>· {t.source}</span>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </>
  );
}

const STATUS_TEXT = {
  WAITING_FOR_BUYER_RESPONSE: "Waiting on the buyer",
  WAITING_FOR_SELLER_RESPONSE: "Needs your response",
  UNDER_REVIEW: "Under review by PayPal",
  RESOLVED: "Resolved",
};

// Built from PayPal's dispute record, so it shows on any server and after a Reset demo.
function PayPalResponsePanel({ response: r, status }) {
  const sellerOffers = r.offers.filter((o) => o.actor === "SELLER");
  const buyerReplies = r.offers.filter((o) => o.actor === "BUYER");
  return (
    <div style={{ ...card, borderColor: "#abefc6", background: "#f6fef9" }}>
      <h2 style={{ ...h2, color: "#067647" }}>✓ Response on file with PayPal</h2>
      <p style={{ margin: "0 0 8px" }}>
        Dispute status: <strong>{STATUS_TEXT[status] ?? status}</strong>
      </p>
      {r.evidence.map((e, i) => (
        <div key={i}>
          <p style={{ ...muted, margin: "0 0 8px" }}>
            Evidence: {e.type}
            {e.tracking && ` · ${e.tracking.carrier_name} ${e.tracking.tracking_number}`} · {shortDate(e.date)}
          </p>
          {e.notes && <p style={quote}>{e.notes}</p>}
        </div>
      ))}
      {sellerOffers.map((o, i) => (
        <p key={i} style={{ ...muted, margin: "0 0 8px" }}>
          Offer: {o.type} · {money(o.amount.value, o.amount.currency_code)} · {shortDate(o.date)}
        </p>
      ))}
      {buyerReplies.map((o, i) => (
        <p key={i} style={{ margin: "0 0 8px" }}>
          Buyer {o.event.toLowerCase()} the offer · {shortDate(o.date)}
        </p>
      ))}
      {r.messages.map((m, i) => (
        <p key={i} style={quote}>
          {m.content}
        </p>
      ))}
    </div>
  );
}

const quote = { whiteSpace: "pre-wrap", background: "#fff", border: "1px solid #eaecf0", borderRadius: 6, padding: 10 };

function SubmittedPanel({ submission: s }) {
  const ev = s.request.evidences?.[0];
  const tracking = ev?.evidence_info?.tracking_info?.[0];
  return (
    <div style={{ ...card, borderColor: "#abefc6", background: "#f6fef9" }}>
      <h2 style={{ ...h2, color: "#067647" }}>✓ Submitted to PayPal</h2>
      <p style={{ margin: "0 0 8px" }}>
        {new Date(s.submitted_at).toLocaleString()} · <code>{s.action}</code> · PayPal replied HTTP {s.paypal_http_status}
      </p>
      <p style={{ margin: "0 0 8px" }}>
        Dispute status: <strong>{s.status_before}</strong> → <strong>{s.status_after}</strong> ({s.stage_after})
      </p>
      {ev && (
        <p style={{ ...muted, margin: "0 0 8px" }}>
          Evidence: {ev.evidence_type}
          {tracking && ` · ${tracking.carrier_name} ${tracking.tracking_number}`}
        </p>
      )}
      {s.request.offer_type && (
        <p style={{ ...muted, margin: "0 0 8px" }}>
          Offer: {s.request.offer_type} · {money(s.request.offer_amount.value, s.request.offer_amount.currency_code)}
        </p>
      )}
      <p style={{ whiteSpace: "pre-wrap", background: "#fff", border: "1px solid #eaecf0", borderRadius: 6, padding: 10 }}>
        {ev?.notes ?? s.request.note}
      </p>
      <p style={{ ...muted, fontSize: 13, margin: 0 }}>
        PayPal now allows: {s.allowed_actions_after.join(", ") || "no seller actions"}
      </p>
    </div>
  );
}

function btn(primary) {
  return {
    padding: "8px 16px",
    borderRadius: 6,
    border: primary ? "none" : "1px solid #d0d5dd",
    background: primary ? "#0070e0" : "#fff",
    color: primary ? "#fff" : "#344054",
    fontWeight: 600,
    cursor: "pointer",
  };
}
