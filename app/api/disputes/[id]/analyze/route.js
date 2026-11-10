import { analyzeDispute, getSavedAnalysis } from "../../../../../lib/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET: last saved analysis (404 if none). POST: run the agent now and save the result.
export async function GET(_req, { params }) {
  const { id } = await params;
  const saved = getSavedAnalysis(id);
  return saved ? Response.json(saved) : Response.json({ error: "Not analyzed yet" }, { status: 404 });
}

export async function POST(_req, { params }) {
  const { id } = await params;
  try {
    return Response.json(await analyzeDispute(id));
  } catch (err) {
    console.error(`Analyze ${id} failed:`, err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
