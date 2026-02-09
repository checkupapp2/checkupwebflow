/* =========================
   CONFIG
========================= */

// Sandbox Square App ID and Location ID
const SQUARE_APP_ID = "sandbox-sq0idb-5awH7pRxnmXlok7AeOD2gA";
const SQUARE_LOCATION_ID = "LA65TW7HVTEQY";

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
let ach = null;
let googlePay = null;
let applePay = null;
let payments = null;
let currentPaymentMethod = 'card';

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

  if (!window.Square) {
    setStatus("err", "Square Web Payments SDK failed to load.");
    return;
  }

  payments = window.Square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID);

  // Initialize card payment method
  await initCardPayment();
  
  // Initialize other payment methods
  await initACHPayment();
  await initGooglePay();
  await initApplePay();
  
  // Set up payment method switching
  setupPaymentMethodSwitching();

  setStatus("info", "Choose your payment method and complete payment.");
  log("Square initialized with multiple payment methods");
}

async function tokenizePaymentMethod() {
  let result;
  
  switch (currentPaymentMethod) {
    case 'card':
      if (!card) throw new Error('Card payment method not initialized');
      result = await card.tokenize();
      break;
    case 'ach':
      if (!ach) throw new Error('ACH payment method not initialized');
      result = await ach.tokenize();
      break;
    case 'google-pay':
      if (!googlePay) throw new Error('Google Pay not initialized');
      result = await googlePay.tokenize();
      break;
    case 'apple-pay':
      if (!applePay) throw new Error('Apple Pay not initialized');
      result = await applePay.tokenize();
      break;
    default:
      throw new Error('Unknown payment method');
  }
  
  if (result.status !== "OK") {
    const errMsg =
      result?.errors?.map((e) => e.message).join(", ") || "Payment tokenization failed.";
    throw new Error(errMsg);
  }
  return result.token; // Square nonce
}

/* =========================
   Payment Method Initialization
========================= */

async function initCardPayment() {
  try {
    card = await payments.card();
    await card.attach("#card-container");
    log("Card payment method initialized");
  } catch (e) {
    log("Card payment method failed to initialize:", e);
  }
}

async function initACHPayment() {
  try {
    ach = await payments.ach({
      redirectURI: window.location.href,
      transactionId: crypto.randomUUID()
    });
    await ach.attach("#ach-container");
    log("ACH payment method initialized");
  } catch (e) {
    log("ACH payment method failed to initialize:", e);
    // Hide ACH option if not available
    const achOption = document.querySelector('[data-method="ach"]');
    if (achOption) achOption.style.display = 'none';
  }
}

async function initGooglePay() {
  try {
    googlePay = await payments.googlePay({
      countryCode: 'US',
      currencyCode: q.currency,
      total: {
        amount: (q.amountCents / 100).toString(),
        label: 'Total'
      }
    });
    await googlePay.attach("#google-pay-container");
    log("Google Pay initialized");
  } catch (e) {
    log("Google Pay failed to initialize:", e);
    // Hide Google Pay option if not available
    const googlePayOption = document.querySelector('[data-method="google-pay"]');
    if (googlePayOption) googlePayOption.style.display = 'none';
  }
}

async function initApplePay() {
  try {
    applePay = await payments.applePay({
      countryCode: 'US',
      currencyCode: q.currency,
      total: {
        amount: (q.amountCents / 100).toString(),
        label: 'Total'
      }
    });
    await applePay.attach("#apple-pay-container");
    log("Apple Pay initialized");
  } catch (e) {
    log("Apple Pay failed to initialize:", e);
    // Hide Apple Pay option if not available
    const applePayOption = document.querySelector('[data-method="apple-pay"]');
    if (applePayOption) applePayOption.style.display = 'none';
  }
}

function setupPaymentMethodSwitching() {
  const paymentMethods = document.querySelectorAll('.payment-method');
  const containers = document.querySelectorAll('[id$="-container"]');
  
  paymentMethods.forEach(method => {
    method.addEventListener('click', () => {
      const methodType = method.dataset.method;
      
      // Update active states
      paymentMethods.forEach(m => m.classList.remove('active'));
      method.classList.add('active');
      
      // Show/hide containers
      containers.forEach(container => {
        container.classList.remove('active');
        if (container.id === `${methodType}-container`) {
          container.classList.add('active');
        }
      });
      
      // Update current payment method
      currentPaymentMethod = methodType;
      log(`Switched to payment method: ${methodType}`);
    });
  });
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
  };

  log("Calling payment endpoint", body);

  const resp = await fetch(CREATE_PAYMENT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${firebaseIdToken}`,
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    throw new Error(`Payment request failed (${resp.status}). ${text}`);
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
    const nonce = await tokenizePaymentMethod();
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
initSquare();