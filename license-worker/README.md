# VulnSweep License Worker

A Cloudflare Worker that acts as a thin PayPal payment verification gateway for VulnSweep license activation.

## What It Does

- Verifies PayPal transactions are real, completed, and for the correct amount
- Prevents transaction reuse across different emails
- Allows re-verification for the same email (OS reinstall scenarios)
- Returns an HMAC-signed activation token upon successful verification
- Rate-limits requests by IP address

**Important:** This worker does NOT generate or store licenses. License generation happens locally on the user's machine using sludge-crypt. The activation token simply proves "this payment was verified by our server."

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed globally
- [PayPal Developer account](https://developer.paypal.com/) with REST API credentials

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create KV Namespace

```bash
wrangler kv:namespace create ACTIVATIONS
```

Copy the returned `id` into `wrangler.toml` replacing `REPLACE_WITH_KV_NAMESPACE_ID`.

For local development, also create a preview namespace:

```bash
wrangler kv:namespace create ACTIVATIONS --preview
```

Copy the returned `id` into `wrangler.toml` replacing `REPLACE_WITH_PREVIEW_KV_NAMESPACE_ID`.

### 3. Set Secrets

```bash
wrangler secret put PAYPAL_CLIENT_ID
wrangler secret put PAYPAL_SECRET
wrangler secret put HMAC_SECRET
```

Generate a strong HMAC secret:

```bash
openssl rand -hex 32
```

### 4. Configure PayPal API URL

In `wrangler.toml`, the `PAYPAL_API_URL` defaults to sandbox:

- **Sandbox:** `https://api-m.sandbox.paypal.com`
- **Production:** `https://api-m.paypal.com`

### 5. Deploy

```bash
npm run deploy
```

## Environment Variables

| Variable                    | Type   | Description                              |
| --------------------------- | ------ | ---------------------------------------- |
| `PAYPAL_API_URL`            | var    | PayPal REST API base URL                 |
| `EXPECTED_AMOUNTS`          | var    | Comma-separated valid payment amounts    |
| `RATE_LIMIT_MAX`            | var    | Max requests per window per IP           |
| `RATE_LIMIT_WINDOW_SECONDS` | var    | Rate limit window in seconds             |
| `PAYPAL_CLIENT_ID`          | secret | PayPal REST app client ID                |
| `PAYPAL_SECRET`             | secret | PayPal REST app secret                   |
| `HMAC_SECRET`               | secret | Secret key for signing activation tokens |

## API Endpoints

### `GET /health`

Returns service health status.

```json
{ "status": "ok", "timestamp": "2024-01-01T00:00:00.000Z" }
```

### `POST /verify`

Verifies a PayPal payment.

**Request:**

```json
{
  "email": "user@example.com",
  "transactionId": "ABC123DEF456GHI"
}
```

**Success Response (200):**

```json
{
  "verified": true,
  "activationToken": "base64-encoded-hmac-signature"
}
```

**Error Responses:**

| Status | Error Code                  | Description                                     |
| ------ | --------------------------- | ----------------------------------------------- |
| 400    | `invalid_json`              | Request body is not valid JSON                  |
| 400    | `invalid_email`             | Email format invalid                            |
| 400    | `invalid_transaction_id`    | Transaction ID must be 13-20 alphanumeric chars |
| 400    | `transaction_not_completed` | Transaction exists but not completed            |
| 400    | `invalid_amount`            | Transaction amount doesn't match expected       |
| 404    | `transaction_not_found`     | Transaction not found in PayPal                 |
| 409    | `already_used`              | Transaction already used by a different email   |
| 429    | `rate_limited`              | Too many requests from this IP                  |
| 500    | `payment_provider_error`    | Failed to authenticate with PayPal              |

## Local Development

```bash
npm run dev
```

This starts a local dev server using Wrangler. You can test with:

```bash
curl http://localhost:8787/health
```

## Testing with PayPal Sandbox

1. Create a sandbox app at [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox)
2. Use sandbox credentials in your secrets
3. Create test transactions using sandbox buyer accounts
4. Use those transaction IDs to test the `/verify` endpoint

## Architecture

```
User CLI/UI → POST /verify { email, txnId }
                    ↓
         [Rate Limit Check (KV)]
                    ↓
         [Duplicate Check (KV)]
                    ↓
         [PayPal OAuth2 Auth]
                    ↓
         [Verify Capture / Search Txn]
                    ↓
         [Validate Status & Amount]
                    ↓
         [Store txn in KV + Sign Token]
                    ↓
         Response: { verified, activationToken }
```

## License

Proprietary — VulnSweep © 2024
