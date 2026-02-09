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
let applePay = null;
let googlePay = null;
let payments = null;
let selectedPaymentMethod = 'card';

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
   Payment Method Selection
========================= */

function initializePaymentMethodSelection() {
  const cardTab = document.getElementById("card-tab");
  const applePayTab = document.getElementById("applepay-tab");
  const googlePayTab = document.getElementById("googlepay-tab");
  const cashappTab = document.getElementById("cashapp-tab");
  
  const cardForm = document.getElementById("card-form");
  const applePayForm = document.getElementById("applepay-form");
  const googlePayForm = document.getElementById("googlepay-form");
  const cashappForm = document.getElementById("cashapp-form");
  
  const allTabs = [cardTab, applePayTab, googlePayTab, cashappTab];
  const allForms = [cardForm, applePayForm, googlePayForm, cashappForm];
  
  // Set initial state
  selectedPaymentMethod = "card";
  
  // Update pay button state based on payment method
  function updatePayButtonState() {
    const payBtn = document.getElementById("payBtn");
    if (!payBtn) return;
    
    switch (selectedPaymentMethod) {
      case "card":
        payBtn.disabled = !card;
        break;
      case "applepay":
        payBtn.disabled = !applePay;
        break;
      case "googlepay":
        payBtn.disabled = !googlePay;
        break;
      case "cashapp":
        payBtn.disabled = true; // Will be enabled by Cash App Pay events
        break;
      default:
        payBtn.disabled = true;
    }
  }
  
  // Function to switch payment method
  function switchPaymentMethod(method, activeTab, activeForm) {
    selectedPaymentMethod = method;
    
    // Update tab states
    allTabs.forEach(tab => tab?.classList.remove("active"));
    activeTab?.classList.add("active");
    
    // Update form visibility
    allForms.forEach(form => form?.classList.remove("active"));
    activeForm?.classList.add("active");
    
    updatePayButtonState();
  }
  
  updatePayButtonState();
  
  // Add event listeners for all tabs
  cardTab?.addEventListener("click", function() {
    switchPaymentMethod("card", cardTab, cardForm);
    setStatus("info", "Enter your card details, then tap Pay.");
  });
  
  applePayTab?.addEventListener("click", function() {
    switchPaymentMethod("applepay", applePayTab, applePayForm);
    setStatus("info", "Use Apple Pay for quick and secure checkout.");
  });
  
  googlePayTab?.addEventListener("click", function() {
    switchPaymentMethod("googlepay", googlePayTab, googlePayForm);
    setStatus("info", "Use Google Pay for fast and secure payment.");
  });
  
  cashappTab?.addEventListener("click", function() {
    switchPaymentMethod("cashapp", cashappTab, cashappForm);
    setStatus("info", "Click the Cash App Pay button above, then tap Pay to complete your purchase.");
  });
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

    // Initialize Apple Pay
    console.log("Attempting to initialize Apple Pay...");
    console.log("Available payment methods:", Object.keys(payments));
    
    try {
      // Check if Apple Pay is available first
      if (typeof payments.applePay !== 'function') {
        console.warn("Apple Pay method not available on payments object");
        throw new Error("Apple Pay not supported by Square SDK");
      }
      
      // Create payment request for Apple Pay
      const applePayRequest = payments.paymentRequest({
        countryCode: 'US',
        currencyCode: q.currency,
        total: {
          amount: (q.amountCents / 100).toFixed(2),
          label: 'Total',
        }
      });
      
      console.log("Apple Pay PaymentRequest created:", applePayRequest);
      
      // Try to initialize Apple Pay
      applePay = await payments.applePay(applePayRequest);
      console.log("Apple Pay object created successfully:", applePay);
      
      // Attach Apple Pay to container
      await applePay.attach("#apple-pay");
      console.log("Apple Pay attached to container successfully");
      
    } catch (error) {
      console.error("Apple Pay initialization failed:", error);
      console.error("Apple Pay error details:", error.message, error.stack);
      
      // Show a placeholder for Apple Pay with error info
      const applePayContainer = document.getElementById("apple-pay");
      if (applePayContainer) {
        let errorMsg = error.message;
        if (errorMsg.includes('not supported') || errorMsg.includes('not available')) {
          errorMsg = "Apple Pay not available on this device/browser";
        }
        
        applePayContainer.innerHTML = `<div style="padding: 12px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; color: #fff; font-size: 13px; text-align: center;">
          <div style="margin-bottom: 4px;">🍎</div>
          <div style="font-weight: 600; margin-bottom: 4px;">Apple Pay</div>
          <div style="font-size: 11px; opacity: 0.7;">${errorMsg}</div>
        </div>`;
      }
    }

    // Initialize Google Pay
    console.log("Attempting to initialize Google Pay...");
    try {
      const paymentRequest = payments.paymentRequest({
        countryCode: 'US',
        currencyCode: q.currency,
        total: {
          amount: (q.amountCents / 100).toFixed(2),
          label: 'Total',
        }
      });
      
      googlePay = await payments.googlePay(paymentRequest);
      console.log("Google Pay object created:", googlePay);
      
      await googlePay.attach("#google-pay");
      console.log("Google Pay attached to container");
      
    } catch (error) {
      console.error("Google Pay initialization failed:", error);
      const googlePayTab = document.getElementById("googlepay-tab");
      if (googlePayTab) {
        googlePayTab.style.display = "none";
      }
    }

    // Initialize Cash App Pay with PaymentRequest
    console.log("Attempting to initialize Cash App Pay...");
    console.log("Current URL:", window.location.href);
    
    try {
      // Check if payments object supports Cash App Pay
      if (typeof payments.cashAppPay !== 'function') {
        throw new Error("Cash App Pay method not available on payments object");
      }
      
      // Create PaymentRequest for Cash App Pay
      const paymentRequest = payments.paymentRequest({
        countryCode: 'US',
        currencyCode: q.currency,
        total: {
          amount: (q.amountCents / 100).toFixed(2),
          label: 'Total',
        }
      });
      
      console.log("PaymentRequest created:", paymentRequest);
      
      // Initialize Cash App Pay with PaymentRequest
      cashAppPay = await payments.cashAppPay(paymentRequest, {
        redirectURL: window.location.href,
        referenceId: crypto.randomUUID()
      });
      
      console.log("Cash App Pay object created:", cashAppPay);
      
      // Attach to container
      await cashAppPay.attach("#cash-app-pay");
      console.log("Cash App Pay attached to container");
      
      // Add event listeners for Cash App Pay interactions
      cashAppPay.addEventListener('ontokenization', (event) => {
        console.log('Cash App Pay tokenization event:', event);
        setStatus("info", "Cash App Pay authorized! Tap Pay to complete your purchase.");
        
        // Enable the pay button
        const payBtn = document.getElementById("payBtn");
        if (payBtn) {
          payBtn.disabled = false;
        }
      });
      
      cashAppPay.addEventListener('onpaymentmethodreceived', (event) => {
        console.log('Cash App Pay payment method received:', event);
        setStatus("info", "Payment method ready. Tap Pay to complete your purchase.");
      });
      
    } catch (error) {
      console.error("Cash App Pay initialization failed:", error);
      console.error("Error details:", error.message, error.stack);
      
      // Hide the Cash App Pay tab if initialization fails
      const cashAppTab = document.getElementById("cashapp-tab");
      if (cashAppTab) {
        cashAppTab.style.display = "none";
      }
    }

    // Initialize payment method selection
    initializePaymentMethodSelection();
    
    setStatus("info", "Select Card to enter details, or Cash App to authorize payment.");
    log("Square initialized successfully");
  } catch (error) {
    console.error("Square initialization error details:", error);
    setStatus("err", `Square initialization failed: ${error.message}`);
    log("Square init error:", error);
  }
}

async function tokenizeCard() {
  console.log("Starting card tokenization...");
  
  if (!card) {
    throw new Error("Card payment method not initialized");
  }
  
  const result = await card.tokenize();
  console.log("Card tokenization result:", result);
  
  if (result.status !== "OK") {
    console.error("Card tokenization failed:", result);
    const errMsg =
      result?.errors?.map((e) => e.message).join(", ") || "Card tokenization failed.";
    throw new Error(errMsg);
  }
  
  console.log("Card tokenization successful, token:", result.token);
  return result.token; // Square nonce
}

async function tokenizeApplePay() {
  console.log("Starting Apple Pay tokenization...");
  
  if (!applePay) {
    throw new Error("Apple Pay not initialized");
  }
  
  const result = await applePay.tokenize();
  console.log("Apple Pay tokenization result:", result);
  
  if (result.status !== "OK") {
    console.error("Apple Pay tokenization failed:", result);
    const errMsg =
      result?.errors?.map((e) => e.message).join(", ") || "Apple Pay tokenization failed.";
    throw new Error(errMsg);
  }
  
  console.log("Apple Pay tokenization successful, token:", result.token);
  return result.token; // Square nonce
}

async function tokenizeGooglePay() {
  console.log("Starting Google Pay tokenization...");
  
  if (!googlePay) {
    throw new Error("Google Pay not initialized");
  }
  
  const result = await googlePay.tokenize();
  console.log("Google Pay tokenization result:", result);
  
  if (result.status !== "OK") {
    console.error("Google Pay tokenization failed:", result);
    const errMsg =
      result?.errors?.map((e) => e.message).join(", ") || "Google Pay tokenization failed.";
    throw new Error(errMsg);
  }
  
  console.log("Google Pay tokenization successful, token:", result.token);
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
    apiVersion: "2025-01-23"
  };

  console.log("Payment request body:", JSON.stringify(body, null, 2));
  console.log("Payment endpoint URL:", CREATE_PAYMENT_URL);
  console.log("Firebase token present:", !!firebaseIdToken);
  log("Calling payment endpoint", body);

  const resp = await fetch(CREATE_PAYMENT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${firebaseIdToken}`,
      // Add Square API version header
      "Square-Version": "2025-01-23"
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text().catch(() => "");
  console.log("Payment response status:", resp.status);
  console.log("Payment response headers:", Object.fromEntries(resp.headers.entries()));
  console.log("Payment response body:", text);
  
  if (!resp.ok) {
    let errorMessage = `Payment request failed (${resp.status})`;
    try {
      const errorData = JSON.parse(text);
      console.error("Payment error data:", errorData);
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
  
  // Update button text based on payment method
  switch (selectedPaymentMethod) {
    case "card":
      btn.innerHTML = `<span class="spinner"></span>&nbsp;Processing Card Payment…`;
      break;
    case "applepay":
      btn.innerHTML = `<span class="spinner"></span>&nbsp;Processing Apple Pay…`;
      break;
    case "googlepay":
      btn.innerHTML = `<span class="spinner"></span>&nbsp;Processing Google Pay…`;
      break;
    case "cashapp":
      btn.innerHTML = `<span class="spinner"></span>&nbsp;Completing Cash App Payment…`;
      break;
    default:
      btn.innerHTML = `<span class="spinner"></span>&nbsp;Processing Payment…`;
  }

  try {
    let nonce;
    
    // Tokenize based on selected payment method
    switch (selectedPaymentMethod) {
      case "card":
        setStatus("info", "Processing your card payment...");
        nonce = await tokenizeCard();
        break;
      case "applepay":
        setStatus("info", "Processing your Apple Pay payment...");
        nonce = await tokenizeApplePay();
        break;
      case "googlepay":
        setStatus("info", "Processing your Google Pay payment...");
        nonce = await tokenizeGooglePay();
        break;
      case "cashapp":
        setStatus("info", "Completing your Cash App payment...");
        nonce = await tokenizeCashAppPay();
        break;
      default:
        throw new Error("No payment method selected");
    }
    
    setStatus("info", "Finalizing payment with merchant...");
    const result = await createPayment({ sourceId: nonce });

    setStatus("ok", "Payment successful! Redirecting to your ticket...");

    postToApp({
      type: "PAYMENT_RESULT",
      ok: true,
      result,
    });
  } catch (e) {
    console.error("Payment failed:", e);
    setStatus("err", e?.message || "Payment failed. Please try again.");
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