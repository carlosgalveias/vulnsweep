/**
 * VulnSweep License Payment Verification Worker
 *
 * A thin PayPal payment verification gateway. Verifies that a PayPal
 * transaction is real, completed, and for the correct amount.
 * Does NOT generate or store licenses.
 *
 * Security hardened: pessimistic locking, write-first rate limiting,
 * structured activation tokens, API key auth, PayPal token caching.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://vulnsweep.app',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TXN_REGEX = /^[A-Za-z0-9]{13,20}$/;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/dev/seed-transaction' && request.method === 'POST') {
      return handleDevSeed(request, env);
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    if (url.pathname === '/verify' && request.method === 'POST') {
      return handleVerify(request, env);
    }

    return json({ error: 'not_found' }, 404);
  },
};

async function handleVerify(request, env) {
  // I2: API Key authentication
  const clientKey = request.headers.get('X-API-Key');
  if (!clientKey || clientKey !== env.CLIENT_API_KEY) {
    return json({ verified: false, error: 'unauthorized' }, 401);
  }

  // C1: Rate limiting (write-first approach)
  const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
  const maxReqs = parseInt(env.RATE_LIMIT_MAX || '5');
  const window = parseInt(env.RATE_LIMIT_WINDOW_SECONDS || '60');

  if (!(await checkRateLimit(ip, env.ACTIVATIONS, maxReqs, window))) {
    return json({ verified: false, error: 'rate_limited' }, 429);
  }

  // Parse and validate input
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ verified: false, error: 'invalid_json' }, 400);
  }

  const { email, transactionId } = body;

  if (!email || !EMAIL_REGEX.test(email)) {
    return json({ verified: false, error: 'invalid_email' }, 400);
  }
  if (!transactionId || !TXN_REGEX.test(transactionId)) {
    return json({ verified: false, error: 'invalid_transaction_id' }, 400);
  }

  // C2: Pessimistic locking — check existing transaction with JSON.parse try-catch (I7)
  const existing = await env.ACTIVATIONS.get(`txn:${transactionId}`);
  if (existing) {
    let stored;
    try {
      stored = JSON.parse(existing);
    } catch {
      return json({ verified: false, error: 'internal_error' }, 500);
    }
    if (stored.status === 'pending') {
      return json({ verified: false, error: 'verification_in_progress' }, 409);
    }
    if (stored.email === email) {
      // Re-activation with same email — allow (OS reinstall scenario)
      const token = await generateActivationToken(transactionId, email, env.HMAC_SECRET);
      return json({ verified: true, activationToken: token });
    }
    return json({ verified: false, error: 'already_used' }, 409);
  }

  // C2: Lock — mark as pending immediately (120s TTL as safety net)
  await env.ACTIVATIONS.put(
    `txn:${transactionId}`,
    JSON.stringify({ status: 'pending', email, lockedAt: new Date().toISOString() }),
    { expirationTtl: 120 }
  );

  // A6: Authenticate with PayPal (with token caching)
  let paypalToken;
  try {
    paypalToken = await getPayPalToken(
      env.PAYPAL_CLIENT_ID,
      env.PAYPAL_SECRET,
      env.PAYPAL_API_URL,
      env.ACTIVATIONS
    );
  } catch {
    // Release lock on failure
    await env.ACTIVATIONS.delete(`txn:${transactionId}`);
    return json({ verified: false, error: 'payment_provider_error' }, 500);
  }

  // Verify transaction with PayPal
  const result = await verifyTransaction(paypalToken, transactionId, env.PAYPAL_API_URL);

  if (!result.found) {
    // Release lock on failure
    await env.ACTIVATIONS.delete(`txn:${transactionId}`);
    return json({ verified: false, error: 'transaction_not_found' }, 404);
  }

  if (result.status !== 'COMPLETED') {
    // Release lock on failure
    await env.ACTIVATIONS.delete(`txn:${transactionId}`);
    return json({ verified: false, error: 'transaction_not_completed' }, 400);
  }

  // Validate amount
  const expectedAmounts = (env.EXPECTED_AMOUNTS || '29.99,99.99').split(',').map(Number);
  if (!expectedAmounts.includes(result.amount)) {
    // Release lock on failure
    await env.ACTIVATIONS.delete(`txn:${transactionId}`);
    return json({ verified: false, error: 'invalid_amount' }, 400);
  }

  // C2: On success — overwrite with final data (no expiration)
  await env.ACTIVATIONS.put(
    `txn:${transactionId}`,
    JSON.stringify({
      email,
      amount: result.amount,
      currency: result.currency,
      verifiedAt: new Date().toISOString(),
    })
  );

  // C3: Generate structured activation token
  const token = await generateActivationToken(transactionId, email, env.HMAC_SECRET);
  return json({ verified: true, activationToken: token });
}

/**
 * A6: Get PayPal OAuth token with KV caching.
 * Caches for 1 hour (PayPal tokens last ~8 hours).
 */
async function getPayPalToken(clientId, secret, apiUrl, kv) {
  // Check cache first
  const cached = await kv.get('paypal:access_token');
  if (cached) return cached;

  // Get new token
  const response = await fetch(`${apiUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new Error('PayPal auth failed');
  const data = await response.json();

  // Cache for 1 hour (PayPal tokens last ~8 hours)
  await kv.put('paypal:access_token', data.access_token, { expirationTtl: 3600 });

  return data.access_token;
}

async function verifyTransaction(token, transactionId, apiUrl) {
  // Try captures endpoint first
  let response = await fetch(`${apiUrl}/v2/payments/captures/${transactionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.ok) {
    const capture = await response.json();
    return {
      found: true,
      status: capture.status,
      amount: parseFloat(capture.amount?.value || '0'),
      currency: capture.amount?.currency_code,
    };
  }

  // I6: Fallback — Transaction search with 90-day window
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);

  response = await fetch(
    `${apiUrl}/v1/reporting/transactions?transaction_id=${transactionId}&fields=all&start_date=${startDate.toISOString()}&end_date=${new Date().toISOString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (response.ok) {
    const data = await response.json();
    if (data.transaction_details?.length > 0) {
      const txn = data.transaction_details[0].transaction_info;
      return {
        found: true,
        status: txn.transaction_status === 'S' ? 'COMPLETED' : 'PENDING',
        amount: Math.abs(parseFloat(txn.transaction_amount?.value || '0')),
        currency: txn.transaction_amount?.currency_code,
      };
    }
  }

  return { found: false };
}

/**
 * C3: Generate a structured, verifiable activation token.
 * Format: base64(payload).base64(HMAC-SHA256 signature)
 */
async function generateActivationToken(transactionId, email, secret) {
  const encoder = new TextEncoder();
  const expiry = Date.now() + 3600000; // 1 hour
  const payload = JSON.stringify({ txn: transactionId, email, exp: expiry });
  const payloadB64 = btoa(payload);

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return `${payloadB64}.${sigB64}`;
}

/**
 * C1: Write-first rate limiter — increment immediately, THEN check.
 * Prevents race conditions in concurrent requests.
 */
async function checkRateLimit(ip, kv, maxRequests, windowSeconds) {
  const minute = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `rl:${ip}:${minute}`;
  // Write-first: increment immediately, THEN check
  const current = parseInt((await kv.get(key)) || '0') + 1;
  await kv.put(key, String(current), { expirationTtl: windowSeconds });
  return current <= maxRequests;
}

async function handleDevSeed(request, env) {
  // Safety: only works when Worker is configured for sandbox
  if (!env.PAYPAL_API_URL || !env.PAYPAL_API_URL.includes('sandbox')) {
    return json({ error: 'not_available' }, 404);
  }

  // Same API key auth as /verify
  const clientKey = request.headers.get('X-API-Key');
  if (!clientKey || clientKey !== env.CLIENT_API_KEY) {
    return json({ error: 'unauthorized' }, 401);
  }

  const body = await request.json();
  const { email, transactionId, amount } = body;

  if (!email || !transactionId) {
    return json({ error: 'missing_fields' }, 400);
  }

  // Store in KV in the same format as a real verified transaction
  const record = {
    email: email.toLowerCase().trim(),
    amount: amount || '29.99',
    currency: 'EUR',
    status: 'COMPLETED',
    verifiedAt: new Date().toISOString(),
    devSeeded: true,
  };

  await env.ACTIVATIONS.put(`txn:${transactionId}`, JSON.stringify(record));

  return json({ seeded: true, transactionId }, 200);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
