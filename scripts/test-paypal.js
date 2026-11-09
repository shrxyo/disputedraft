// Step 3 check: get a PayPal sandbox token, show its scopes, list disputes.
// Run from the project root:  node scripts/test-paypal.js
// Secrets are read from .env and never printed.

const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");
if (!fs.existsSync(envPath)) {
  console.error("No .env file found in the project root.");
  process.exit(1);
}
process.loadEnvFile(envPath);

const {
  PAYPAL_CLIENT_ID: id,
  PAYPAL_CLIENT_SECRET: secret,
  PAYPAL_BASE_URL: base = "https://api-m.sandbox.paypal.com",
} = process.env;

if (!id || !secret || secret.startsWith("PASTE_")) {
  console.error(
    "Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in .env.\n" +
      "Get the secret from developer.paypal.com > Apps & Credentials (Sandbox) > your app > Secret."
  );
  process.exit(1);
}
if (!base.includes("sandbox")) {
  console.error("PAYPAL_BASE_URL is not the sandbox URL. Refusing to continue.");
  process.exit(1);
}

async function main() {
  // 1. Access token
  const tokenRes = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const tokenBody = await tokenRes.json().catch(() => ({}));

  if (!tokenRes.ok) {
    console.error(`Token request failed (HTTP ${tokenRes.status}):`, tokenBody.error_description || tokenBody);
    if (tokenRes.status === 401)
      console.error("-> Client ID/secret are wrong, or they are LIVE credentials instead of Sandbox.");
    process.exit(1);
  }

  console.log("Got access token. Expires in", tokenBody.expires_in, "seconds.");
  const scopes = (tokenBody.scope || "").split(" ");
  console.log("Dispute-related scopes:", scopes.filter((s) => s.includes("disputes")));

  // 2. List disputes
  const res = await fetch(`${base}/v1/customer/disputes?page_size=10`, {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
  });
  const body = await res.json().catch(() => ({}));

  if (res.status === 403) {
    console.error("403 Forbidden: enable the 'Disputes' feature for your app in the Developer Dashboard.");
    console.error(body);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`List disputes failed (HTTP ${res.status}):`, body);
    process.exit(1);
  }

  const items = body.items || [];
  console.log(`\nSUCCESS: GET /v1/customer/disputes returned HTTP ${res.status} with ${items.length} dispute(s).`);
  for (const d of items) {
    console.log(`- ${d.dispute_id} | ${d.reason} | ${d.status} | ${d.dispute_amount?.value} ${d.dispute_amount?.currency_code}`);
  }
}

main().catch((e) => {
  console.error("Unexpected error:", e.message);
  process.exit(1);
});
