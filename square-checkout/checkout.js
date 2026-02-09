/* =========================
   CONFIG
========================= */

// Sandbox Square App ID and Location ID
const SQUARE_APP_ID = "sandbox-sq0idb-RT3u-HhCpNdbMiGg5aXuVg";
const SQUARE_LOCATION_ID = "TC4Z3ZEBKRXRH";

// Your deployed HTTP Cloud Function
const CREATE_PAYMENT_URL =
  "https://us-central1-checkupv2.cloudfunctions.net/createSquarePaymentHttp";

// Optional: set to true while debugging
const DEBUG = false;

/* =========================
   UI helpers
========================= */

const $ = (id) => document.getElementById(id);

function setStatus(kind, msg) {
  const box = $("statusBox");
  box.style.display = "block";
  box.className = `status ${kind}`;
  box.textContent = msg;
}

function clearStatus() {
  const box = $("statusBox");
  box.style.display = "none";
  box.textContent = "";
}

function log(...args) {
  if (DEBUG) console.log("[checkout]", ...args);
}

function parseIntSafe(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function formatMoney({ amountCents, currency }) {
  const amount = (amountCents / 100).toFixed(2);
  // Keep it simple for now
  return currency === "USD" ? `$${amount}` : `${amount} ${currency}`;
}

// Hide context fields completely from user (customer-grade UX)
// We ONLY read from URL, never from form inputs.
function getQuery() {
  const u = new URL(window.location.href);

  const amountCents = parseIntSafe(u.searchParams.get("amount"), 0);
  const currency = (u.searchParams.get("currency") || "USD").toUpperCase();

  const contextType = u.searchParams.get("contextType") || ""; // ticket | booking | donation
  const contextId = u.searchParams.get("contextId") || "";
  const eventId = u.searchParams.get("eventId") || ""; // only for ticket

  return { amountCents, currency, contextType, contextId, eventId };
}

function validatePayload(q) {
  if (!q.amountCents || q.amountCents < 1) return "Invalid amount.";
  if (!q.contextType) return "Missing context type.";
  if (!q.contextId) return "Missing context id.";
  if (q.contextType === "ticket" && !q.eventId) return "Missing event id for ticket.";
  return null;
}

function setTokenReady(isReady) {
  const pill = $("tokenPill");
  const btn = $("payBtn");

  if (isReady) {
    pill.textContent = "Secure session received. You can pay now.";
    btn.disabled = false;
  } else {
    pill.textContent = "Waiting for secure session from the app…";
    btn.disabled = true;
  }
}

/* =========================
   State
========================= */

let firebaseIdToken = null;
let card = null;
let cashAppPay = null;
let payments = null;

const q = getQuery();

// ✅ fallback for testing
if (!q.amountCents || q.amountCents < 1) {
  q.amountCents = 100; // $1.00
  q.currency = "USD";
}

console.log("URL:", window.location.href);
console.log("Parsed query:", q);

// Render amount immediately (fixes the $0.00 issue)
if ($("amountText")) {
  $("amountText").textContent = formatMoney({
    amountCents: q.amountCents,
    currency: q.currency,
  });
}

/* =========================
   Receive token from Flutter
   (WebView postMessage)
========================= */

function handleIncomingMessage(data) {
  // Expect: { type: "AUTH_TOKEN", token: "..." }
  try {
    const msg = typeof data === "string" ? JSON.parse(data) : data;
    if (
      msg?.type === "AUTH_TOKEN" &&
      typeof msg.token === "string" &&
      msg.token.length > 20
    ) {
      firebaseIdToken = msg.token;
      setTokenReady(true);
      log("Token received");
    }
  } catch (_) {
    // ignore
  }
}

// Browser
window.addEventListener("message", (e) => handleIncomingMessage(e.data));

// WebView fallback
window.__setAuthTokenFromApp = (token) => {
  if (typeof token === "string" && token.length > 20) {
    firebaseIdToken = token;
    setTokenReady(true);
    log("Token received via __setAuthTokenFromApp");
  }
};

/* =========================
   Post result back to Flutter
========================= */

function postToApp(payload) {
  try {
    // Common JS channel bridge name (custom)
    if (window.CheckupBridge && typeof window.CheckupBridge.postMessage === "function") {
      window.CheckupBridge.postMessage(JSON.stringify(payload));
      return;
    }
  } catch (_) {}

  try {
    // Fallback for web testing
    window.parent?.postMessage(payload, "*");
  } catch (_) {}
}

/* =========================
   Square init
========================= */

async function initSquare() {
  const payloadErr = validatePayload(q);
  if (payloadErr) {
    setStatus("err", payloadErr);
    return;
  }

  // Add more detailed debugging for SDK loading
  console.log("Checking Square SDK availability...");
  console.log("window.Square:", window.Square);
  
  if (!window.Square) {
    setStatus("err", "Square Web Payments SDK failed to load. Please check your internet connection and try again.");
    console.error("Square SDK not found on window object");
    return;
  }

  console.log("Square SDK loaded successfully");
  console.log("Square.payments function:", typeof window.Square.payments);

  try {
    console.log("Initializing Square payments with:", SQUARE_APP_ID, SQUARE_LOCATION_ID);
    payments = window.Square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID);
    console.log("Payments object created:", payments);

    card = await payments.card({
      style: {
        input: {
          fontSize: '14px',
          color: '#000000'
        }
      }
    });
    console.log("Card object created:", card);
    
    await card.attach("#card-container");
    console.log("Card attached to container");

    // Initialize Cash App Pay
    console.log("Attempting to initialize Cash App Pay...");
    console.log("Current URL:", window.location.href);
    
    try {
      // Check if payments object supports Cash App Pay
      if (typeof payments.cashAppPay !== 'function') {
        throw new Error("Cash App Pay method not available on payments object");
      }
      
      // Initialize Cash App Pay with proper configuration
      cashAppPay = await payments.cashAppPay({
        redirectURL: window.location.href,
        referenceId: crypto.randomUUID()
      });
      
      console.log("Cash App Pay object created:", cashAppPay);
      
      // Attach to container
      await cashAppPay.attach("#cash-app-pay");
      console.log("Cash App Pay attached to container");
      
      // Make sure container is visible
      const cashAppContainer = document.getElementById("cash-app-pay");
      if (cashAppContainer) {
        cashAppContainer.style.display = "block";
        cashAppContainer.style.marginTop = "12px";
        console.log("Cash App Pay container made visible");
      }
      
    } catch (error) {
      console.error("Cash App Pay initialization failed:", error);
      console.error("Error details:", error.message, error.stack);
      
      // Show debugging information
      const cashAppContainer = document.getElementById("cash-app-pay");
      if (cashAppContainer) {
        let errorMsg = error.message;
        if (errorMsg.includes('not available') || errorMsg.includes('not supported')) {
          errorMsg = "Cash App Pay not available in sandbox environment";
        }
        
        cashAppContainer.innerHTML = `<div style="padding: 10px; background: rgba(255,255,255,0.1); border-radius: 8px; color: #fff; font-size: 12px; text-align: center;">
          <strong>Cash App Pay Debug:</strong><br>
          ${errorMsg}<br>
          <small>Check browser console for details</small>
        </div>`;
        cashAppContainer.style.display = "block";
        cashAppContainer.style.marginTop = "12px";
      }
    }

    setStatus("info", "Enter card details or use Cash App Pay, then tap Pay.");
    log("Square initialized successfully");
  } catch (error) {
    console.error("Square initialization error details:", error);
    setStatus("err", `Square initialization failed: ${error.message}`);
    log("Square init error:", error);
  }
}

async function tokenizeCard() {
  const result = await card.tokenize();
  if (result.status !== "OK") {
    const errMsg =
      result?.errors?.map((e) => e.message).join(", ") || "Card tokenization failed.";
    throw new Error(errMsg);
  }
  return result.token; // Square nonce
}

async function tokenizeCashAppPay() {
  if (!cashAppPay) {
    throw new Error("Cash App Pay not initialized");
  }
  const result = await cashAppPay.tokenize();
  if (result.status !== "OK") {
    const errMsg =
      result?.errors?.map((e) => e.message).join(", ") || "Cash App Pay tokenization failed.";
    throw new Error(errMsg);
  }
  return result.token; // Square nonce
}

/* =========================
   Call backend
========================= */

async function createPayment({ sourceId }) {
  if (!firebaseIdToken) {
    throw new Error("Secure session missing. Please return to the app and retry.");
  }

  const body = {
    sourceId,
    idempotencyKey: crypto.randomUUID(),
    amount: { amount: q.amountCents, currency: q.currency },
    locationId: SQUARE_LOCATION_ID,
    contextType: q.contextType,
    contextId: q.contextId,
    eventId: q.eventId || undefined,
    // Add API version for compatibility
    apiVersion: "2026-01-22"
  };

  log("Calling payment endpoint", body);

  const resp = await fetch(CREATE_PAYMENT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${firebaseIdToken}`,
      // Add Square API version header
      "Square-Version": "2026-01-22"
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    let errorMessage = `Payment request failed (${resp.status})`;
    try {
      const errorData = JSON.parse(text);
      if (errorData.message) {
        errorMessage = errorData.message;
      } else if (errorData.errors && errorData.errors.length > 0) {
        errorMessage = errorData.errors.map(e => e.detail || e.message).join(", ");
      }
    } catch (e) {
      errorMessage += `. ${text}`;
    }
    throw new Error(errorMessage);
  }

  return JSON.parse(text);
}

/* =========================
   Pay handler
========================= */

async function onPay() {
  clearStatus();

  const btn = $("payBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>&nbsp;Processing…`;

  try {
    const nonce = await tokenizeCard();
    const result = await createPayment({ sourceId: nonce });

    setStatus("ok", "Payment completed. Returning to app…");

    postToApp({
      type: "PAYMENT_RESULT",
      ok: true,
      result,
    });
  } catch (e) {
    setStatus("err", e?.message || "Payment failed.");
    postToApp({
      type: "PAYMENT_RESULT",
      ok: false,
      error: e?.message || "Payment failed.",
    });
  } finally {
    btn.disabled = false;
    btn.textContent = "Pay";
  }
}

$("payBtn")?.addEventListener("click", onPay);

/* Start */
setTokenReady(false);

// Wait for DOM and Square SDK to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
  // Give the Square SDK a moment to fully initialize
  setTimeout(() => {
    initSquare();
  }, 100);
});