import { getSubmission, submitResponse } from "../../../../../lib/submit";

export const dynamic = "force-dynamic";

// GET: the saved submission record (404 if none). POST: send the approved response to PayPal.
// Body: { strategy, text, offer_amount }
export async function GET(_req, { params }) {
  const { id } = await params;
  const saved = getSubmission(id);
  return saved ? Response.json(saved) : Response.json({ error: "Not submitted yet" }, { status: 404 });
}

export async function POST(req, { params }) {
  const { id } = await params;
  const { strategy, text, offer_amount } = await req.json().catch(() => ({}));
  try {
    return Response.json(await submitResponse(id, { strategy, text, offerAmount: offer_amount }));
  } catch (err) {
    console.error(`Submit ${id} failed:`, err.message, err.paypal ?? "");
    return Response.json({ error: err.message, paypal: err.paypal ?? undefined }, { status: err.status ?? 500 });
  }
}
