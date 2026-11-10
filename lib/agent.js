// The DisputeDraft agent. Stage 1: Gemini investigates with PayPal Agent Toolkit tools plus
// store tools. Stage 2: the rule playbook grades the evidence. Stage 3: Gemini recommends a
// strategy (limited to actions PayPal allows) and drafts the response from those facts only.
import fs from "fs";
import path from "path";
import { generateText, Output, stepCountIs, tool } from "ai";
import { google } from "@ai-sdk/google";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { z } from "zod";
import { getDispute, getStoreRecord, REASON_LABELS } from "./disputes";
import { availableStrategies, buildChecklist, recommendStrategy } from "./playbook";

// Free-tier Gemini quotas are per model and small, and models are sometimes overloaded,
// so fall through a list of models when one is rate-limited or busy.
const MODELS = [process.env.GEMINI_MODEL || "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3-flash-preview"];

async function withModelFallback(call) {
  let lastErr;
  for (const id of MODELS) {
    try {
      return { result: await call(google(id)), model: id };
    } catch (err) {
      lastErr = err;
      if (!/quota|rate|high demand|overloaded|unavailable|timeout|aborted|429|503/i.test(err.message)) throw err;
    }
  }
  throw lastErr;
}
const analysesDir = path.join(process.cwd(), "data", "analyses");
// Pre-generated analyses committed for the demo, used when no fresh run exists.
const seedDir = path.join(process.cwd(), "fixtures", "analyses");
const policiesFile = path.join(process.cwd(), "fixtures", "store", "policies.json");

let toolkit = null;
function paypalTools() {
  toolkit ??= new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET,
    configuration: { actions: { disputes: { get: true } }, context: { sandbox: true } },
  });
  return toolkit.getTools();
}

// The toolkit ships tools in the older AI SDK shape (`parameters`); rewrap for the current one.
function adapt(t) {
  return tool({
    description: t.description,
    inputSchema: t.parameters,
    execute: async (args) => {
      const out = await t.execute(args);
      try {
        return typeof out === "string" ? JSON.parse(out) : out;
      } catch {
        return out;
      }
    },
  });
}

// Store data the AI may see. Drops our internal test notes (`scenario`, `listing.note`).
function storeForAgent(sku) {
  const rec = getStoreRecord(sku);
  if (!rec) return null;
  const { scenario, capture_id, dispute_id, ...rest } = rec;
  const { note, ...listing } = rec.listing;
  return { ...rest, listing };
}

function readPolicies() {
  return JSON.parse(fs.readFileSync(policiesFile, "utf8"));
}

// Stage 1: let the agent gather the case file. Falls back to direct calls if it skips a step.
async function investigate(disputeId) {
  const pp = paypalTools();
  const tools = {
    get_dispute: adapt(pp.get_dispute),
    get_store_order: tool({
      description: "Get Fernhill Goods' own records for an order by SKU: product listing, shipment and tracking, buyer/seller messages, and the buyer's past orders.",
      inputSchema: z.object({ sku: z.string().describe("Product SKU, e.g. FH-MUG-01") }),
      execute: async ({ sku }) => storeForAgent(sku) ?? { error: `No store record for SKU ${sku}` },
    }),
    get_store_policies: tool({
      description: "Get Fernhill Goods' refund, return, and shipping policies.",
      inputSchema: z.object({ store: z.string().optional().describe("Store name (optional)") }),
      execute: async () => readPolicies(),
    }),
  };

  const trace = [];
  let dispute = null;
  let store = null;
  let policies = null;

  // Free-tier Gemini allows ~5 requests/minute, so keep the loop short: stop as soon as the
  // case file is complete instead of asking for a closing summary.
  const gathered = ({ steps }) => {
    const names = new Set(steps.flatMap((s) => s.toolResults.map((r) => r.toolName)));
    return ["get_dispute", "get_store_order", "get_store_policies"].every((n) => names.has(n));
  };

  try {
    const { result } = await withModelFallback((model) => generateText({
      model,
      temperature: 0,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(25_000),
      tools,
      stopWhen: [gathered, stepCountIs(4)],
      system:
        "You are a dispute investigator for a small online store that sells through PayPal. " +
        "Gather the facts with your tools; do not guess. Step 1: call get_dispute for the given ID. " +
        "Step 2: in a single turn, call both get_store_order (SKU from disputed_transactions[0].custom " +
        "or items[0].item_id) and get_store_policies.",
      prompt: `Investigate PayPal dispute ${disputeId}.`,
    }));
    for (const r of result.steps.flatMap((s) => s.toolResults)) {
      trace.push({ tool: r.toolName, input: r.input, source: r.toolName === "get_dispute" ? "PayPal Agent Toolkit" : "Store records" });
      if (r.toolName === "get_dispute" && r.output?.dispute_id === disputeId) dispute = r.output;
      if (r.toolName === "get_store_order" && !r.output?.error) store = r.output;
      if (r.toolName === "get_store_policies") policies = r.output;
    }
  } catch (err) {
    trace.push({ tool: "agent", input: null, source: `Agent error, used direct calls: ${err.message}` });
  }

  // Guarantee a complete case file even if the model skipped a tool.
  if (!dispute) {
    dispute = await getDispute(disputeId);
    trace.push({ tool: "get_dispute", input: { dispute_id: disputeId }, source: "PayPal REST (fallback)" });
  }
  const txn = dispute.disputed_transactions?.[0] ?? {};
  const sku = txn.custom ?? txn.items?.[0]?.item_id;
  if (!store || store.sku !== sku) {
    store = storeForAgent(sku);
    trace.push({ tool: "get_store_order", input: { sku }, source: "Store records (fallback)" });
  }
  if (!policies) {
    policies = readPolicies();
    trace.push({ tool: "get_store_policies", input: {}, source: "Store records (fallback)" });
  }
  // Use the untouched PayPal record (with links) for allowed actions, not the model's copy.
  if (!dispute.links) dispute = await getDispute(disputeId);

  return { dispute, store, policies, trace };
}

function caseFacts(dispute, store, policies) {
  const txn = dispute.disputed_transactions?.[0] ?? {};
  return {
    dispute: {
      id: dispute.dispute_id,
      reason: REASON_LABELS[dispute.reason] ?? dispute.reason,
      stage: dispute.dispute_life_cycle_stage,
      status: dispute.status,
      amount: dispute.dispute_amount,
      opened: dispute.create_time,
      respond_by: dispute.seller_response_due_date,
      buyer_name: txn.buyer?.name,
      buyer_requested: dispute.offer?.buyer_requested_amount,
      messages_in_paypal: dispute.messages ?? [],
      seller_protection: txn.seller_protection_type,
    },
    store,
    policies: {
      store: policies.store,
      refund_policy: policies.refund_policy,
      shipping_policy: policies.shipping_policy,
      policy_url: policies.policy_url,
      policy_shown_at_checkout: policies.policy_shown_at_checkout,
    },
  };
}

// Stage 3: the playbook has already picked the strategy; the AI explains it and drafts.
async function recommend(facts, checklist, chosen, decision) {
  const amount = Number(facts.dispute.amount?.value ?? 0);
  const schema = z.object({
    case_type: z.string().describe("Short plain-language label, e.g. 'Item not received: package still in transit'"),
    buyer_claim: z.string().describe("One sentence: what the buyer says happened, based only on the facts"),
    case_summary: z.string().describe("2-3 sentences for the seller: what happened and where they stand"),
    strategy_rationale: z.string().describe("2-3 sentences: why this strategy, citing checklist items"),
    offer_amount: z.number().nullable().describe(`For partial_refund only: a fair refund in ${facts.dispute.amount?.currency_code}, usually 20-50% of ${amount}; otherwise null`),
    key_facts: z.array(z.string()).describe("The specific facts the response relies on, each taken from the case file"),
    response_text: z.string().describe("The draft the seller will send (see instructions for who reads it)"),
    evidence_to_add: z.array(z.string()).describe("Missing or weak evidence the seller could still add, or empty"),
  });

  const { result, model } = await withModelFallback((model) => generateText({
    model,
    temperature: 0.2,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(30_000),
    output: Output.object({ schema }),
    system: [
      "You are a PayPal dispute specialist helping a small seller, Fernhill Goods.",
      "RULES: Use only facts in the case file and checklist. Never invent tracking numbers, dates, addresses, photos, or messages.",
      "If something is missing, say it is missing; do not imply it exists.",
      `The dispute reason is "${facts.dispute.reason}". Describe the case in those terms.`,
      `The store's playbook rated the evidence ${decision.strength} and chose the strategy "${chosen.label}" (${chosen.key}).`,
      "Explain why that strategy fits, citing checklist items, and write the draft for it. Do not argue for a different strategy.",
      `response_text is ${chosen.writes}. Write it in a calm, factual, professional tone, under 1,200 characters, plain text (no markdown).`,
      "Do not include placeholders like [Name]; sign off as 'Fernhill Goods'.",
    ].join("\n"),
    prompt: JSON.stringify({ today: new Date().toISOString().slice(0, 10), case_file: facts, evidence_checklist: checklist }, null, 1),
  }));
  const object = result.output;

  // Guardrails on the model's money decision.
  if (chosen.key === "partial_refund") {
    const v = Number(object.offer_amount);
    object.offer_amount = v > 0 && v < amount ? Math.round(v * 100) / 100 : Math.round(amount * 50) / 100;
  } else if (chosen.key === "refund_with_return" || chosen.key === "accept") {
    object.offer_amount = amount;
  } else {
    object.offer_amount = null;
  }
  return { ...object, model };
}

export async function analyzeDispute(disputeId) {
  const started = Date.now();
  const { dispute, store, policies, trace } = await investigate(disputeId);
  const checklist = buildChecklist(dispute.reason, store, policies);
  const strategies = availableStrategies(dispute);
  if (!strategies.length) throw new Error("PayPal allows no seller actions on this dispute right now.");

  const decision = recommendStrategy(dispute.reason, checklist, strategies);
  const chosen = strategies.find((s) => s.key === decision.strategy);
  const facts = caseFacts(dispute, store, policies);
  const rec = await recommend(facts, checklist, chosen, decision);

  const analysis = {
    dispute_id: disputeId,
    created_at: new Date().toISOString(),
    model: rec.model,
    took_ms: Date.now() - started,
    agent: { trace },
    checklist,
    strategies,
    recommendation: {
      ...rec,
      evidence_strength: decision.strength,
      strategy: chosen.key,
      strategy_label: chosen.label,
      action: chosen.action,
    },
  };
  fs.mkdirSync(analysesDir, { recursive: true });
  fs.writeFileSync(path.join(analysesDir, `${safeId(disputeId)}.json`), JSON.stringify(analysis, null, 2));
  return analysis;
}

export function getSavedAnalysis(disputeId) {
  for (const dir of [analysesDir, seedDir]) {
    const file = path.join(dir, `${safeId(disputeId)}.json`);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  return null;
}

function safeId(id) {
  if (!/^[A-Z0-9-]+$/i.test(id)) throw new Error("Invalid dispute ID");
  return id;
}
