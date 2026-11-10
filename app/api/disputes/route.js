import { listDisputeRows } from "../../../lib/disputes";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ disputes: await listDisputeRows() });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
