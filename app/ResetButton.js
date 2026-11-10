"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ResetButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function reset() {
    const ok = window.confirm(
      "Reset the demo?\n\nThis clears DisputeDraft's saved AI analyses and submission records. " +
        "Disputes already submitted to PayPal stay submitted on PayPal's side."
    );
    if (!ok) return;
    setBusy(true);
    await fetch("/api/reset", { method: "POST" });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      onClick={reset}
      disabled={busy}
      style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #d0d5dd", background: "#fff", color: "#344054", cursor: "pointer" }}
    >
      {busy ? "Resetting…" : "Reset demo"}
    </button>
  );
}
