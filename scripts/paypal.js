// Shared sandbox helpers for scripts. Secrets are read from .env and never printed.

const path = require("path");

process.loadEnvFile(path.join(__dirname, "..", ".env"));

const {
  PAYPAL_CLIENT_ID: id,
  PAYPAL_CLIENT_SECRET: secret,
  PAYPAL_BASE_URL: base = "https://api-m.sandbox.paypal.com",
} = process.env;

if (!base.includes("sandbox")) {
  throw new Error("PAYPAL_BASE_URL is not the sandbox URL. Refusing to continue.");
}

let cached = null;

async function getToken() {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Token request failed (HTTP ${res.status}): ${body.error_description}`);
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
  return cached.token;
}

// Calls a PayPal API path and returns { status, body }. Never throws on HTTP errors.
async function api(method, apiPath, json) {
  const res = await fetch(`${base}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "application/json",
    },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body };
}

module.exports = { getToken, api };
