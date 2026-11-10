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

export default function DisputeView({ summary, initialAnalysis }) {
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(initialAnalysis?.recommendation.response_text ?? "");
  const [offer, setOffer] = useState(initialAnalysis?.recommendation.offer_amount ?? null);

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

  // First visit: run the agent automatically.
  useEffect(() => {
    if (!initialAnalysis) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rec = analysis?.recommendation;
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
            <button disabled style={btn(true)} title="Coming next: submits to PayPal">
              Approve & submit to PayPal
            </button>
          </div>

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
