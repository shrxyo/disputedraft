// Rule-based evidence playbook. Decides what evidence each dispute reason needs and whether
// the store has it. Deterministic on purpose: the AI explains and drafts, it doesn't grade.

const fmt = (iso) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";

const item = (id, label, status, detail) => ({ id, label, status, detail });

function tracking(s) {
  return s?.tracking_number
    ? item("tracking", "Tracking number + carrier", "found", `${s.carrier} ${s.tracking_number}, shipped ${fmt(s.shipped_at)}`)
    : item("tracking", "Tracking number + carrier", "missing", "No tracking on file for this order.");
}

function delivery(s) {
  if (s?.status === "DELIVERED") {
    return item("delivery", "Proof of delivery", "found", `Delivered ${fmt(s.delivered_at)}: ${s.proof_of_delivery ?? "carrier delivery scan"}`);
  }
  if (s?.status === "IN_TRANSIT") {
    return item("delivery", "Proof of delivery", "weak", `Not delivered yet. Last scan: ${s.last_scan}`);
  }
  return item("delivery", "Proof of delivery", "missing", "No delivery confirmation from the carrier.");
}

function addressMatch(s) {
  return s?.ship_to_matches_paypal_address
    ? item("address", "Shipped to buyer's PayPal address", "found", "Ship-to address matches the address on the PayPal transaction.")
    : item("address", "Shipped to buyer's PayPal address", "missing", "Ship-to address does not match (or isn't recorded).");
}

function sellerComms(messages) {
  const sent = messages.filter((m) => m.from === "seller");
  return sent.length
    ? item("seller_messages", "Seller kept buyer informed", "found", `${sent.length} message(s), first ${fmt(sent[0].at)}: "${sent[0].text}"`)
    : item("seller_messages", "Seller kept buyer informed", "weak", "No messages to the buyer on file.");
}

function buildChecklist(reason, store, policies) {
  const s = store?.shipment;
  const messages = store?.messages ?? [];
  const buyerMsgs = messages.filter((m) => m.from === "buyer");
  const listing = store?.listing;
  const policy = policies?.policy_shown_at_checkout
    ? item("policy", "Return/refund policy shown at checkout", "found", policies.refund_policy)
    : item("policy", "Return/refund policy shown at checkout", "missing", "No policy on file.");

  switch (reason) {
    case "MERCHANDISE_OR_SERVICE_NOT_RECEIVED":
      return [tracking(s), delivery(s), addressMatch(s), sellerComms(messages)];

    case "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED":
      return [
        listing?.text
          ? item("listing_text", "Product listing text", "found", `"${listing.text}"`)
          : item("listing_text", "Product listing text", "missing", "No listing text on file."),
        listing?.photo_file
          ? item("listing_photo", "Product photos", "found", listing.photo_file)
          : item("listing_photo", "Product photos", "missing", "No listing photo uploaded yet."),
        buyerMsgs.length
          ? item("buyer_messages", "Buyer messages", "found", buyerMsgs.map((m) => `${fmt(m.at)}: "${m.text}"`).join(" "))
          : item("buyer_messages", "Buyer messages", "weak", "Buyer never contacted the store before opening the dispute."),
        policy,
        delivery(s),
      ];

    case "UNAUTHORISED": {
      const past = store?.past_orders_same_buyer ?? [];
      return [
        addressMatch(s),
        past.length
          ? item("past_orders", "Buyer's past undisputed orders", "found",
              past.map((o) => `${o.order} (${o.date}, ${o.item}, $${o.amount}) to ${o.ship_to}: ${o.status}`).join("; "))
          : item("past_orders", "Buyer's past undisputed orders", "missing", "No earlier orders from this buyer."),
        delivery(s),
        tracking(s),
      ];
    }

    case "DUPLICATE_TRANSACTION":
      return [item("separate_orders", "Proof the charges were separate orders", "missing", "Not in store data."),
        item("refund", "Proof of refund", "missing", "Not in store data.")];

    case "CANCELED_RECURRING_BILLING":
      return [item("cancel_policy", "Cancellation policy", "missing", "Not in store data."),
        item("usage", "Usage after cancellation date", "missing", "Not in store data.")];

    default:
      return [tracking(s), delivery(s), policy];
  }
}

// Strategies the seller can pick, mapped to the PayPal action that carries them out.
// Only strategies whose action PayPal currently allows on this dispute are offered.
const STRATEGIES = {
  fight_with_evidence: { action: "provide_evidence", label: "Fight: submit evidence to PayPal", writes: "a note to PayPal's reviewer explaining the evidence" },
  explain_to_buyer: { action: "send_message", label: "Fight: explain to the buyer", writes: "a message to the buyer" },
  refund_with_return: { action: "make_offer", label: "Offer full refund after return", writes: "an offer note to the buyer" },
  partial_refund: { action: "make_offer", label: "Offer a partial refund", writes: "an offer note to the buyer" },
  accept: { action: "accept_claim", label: "Accept and refund", writes: "a short note to the buyer" },
};

function allowedActions(dispute) {
  return (dispute.links ?? []).map((l) => l.rel).filter((r) => r !== "self");
}

function availableStrategies(dispute) {
  const allowed = allowedActions(dispute);
  return Object.entries(STRATEGIES)
    .filter(([, s]) => allowed.includes(s.action))
    .map(([key, s]) => ({ key, ...s }));
}

// Picks the strategy from the checklist so the money decision is predictable; the AI only
// explains it and writes the draft. Falls back down the list if PayPal disallows an action.
function recommendStrategy(reason, checklist, strategies) {
  const has = (id, status = "found") => checklist.some((c) => c.id === id && c.status === status);
  let strength;
  let preferred;

  if (reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED") {
    if (has("delivery") && has("address")) [strength, preferred] = ["strong", ["fight_with_evidence", "explain_to_buyer"]];
    else if (has("tracking")) [strength, preferred] = ["medium", ["fight_with_evidence", "explain_to_buyer"]];
    else [strength, preferred] = ["weak", ["accept"]];
  } else if (reason === "UNAUTHORISED") {
    if (has("address") && has("delivery")) [strength, preferred] = [has("past_orders") ? "strong" : "medium", ["fight_with_evidence"]];
    else [strength, preferred] = ["weak", ["accept"]];
  } else if (reason === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED") {
    // A specific complaint the buyer raised with the store, without photos to rebut it, is hard to win.
    if (has("buyer_messages") && !has("listing_photo")) [strength, preferred] = ["weak", ["partial_refund", "refund_with_return"]];
    else if (has("listing_text")) [strength, preferred] = ["medium", ["explain_to_buyer", "refund_with_return", "fight_with_evidence"]];
    else [strength, preferred] = ["weak", ["partial_refund", "accept"]];
  } else {
    [strength, preferred] = ["weak", ["accept"]];
  }

  const keys = strategies.map((s) => s.key);
  const strategy = preferred.find((k) => keys.includes(k)) ?? keys[0];
  return { strength, strategy };
}

export { buildChecklist, availableStrategies, allowedActions, recommendStrategy, STRATEGIES };
