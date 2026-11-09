// Confirms the server can reach the PayPal sandbox. Never returns the token itself.
import { api } from "../../../scripts/paypal";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await api("GET", "/v1/customer/disputes");
    return Response.json({
      paypal: res.ok ? "connected" : `error (HTTP ${res.status})`,
      disputes: res.body.items?.length ?? 0,
    });
  } catch (err) {
    return Response.json({ paypal: "error", message: err.message }, { status: 500 });
  }
}
