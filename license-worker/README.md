# VulnSweep License Worker

A Cloudflare Worker that acts as a thin PayPal payment verification gateway for VulnSweep license activation.

## What It Does

- Verifies PayPal transactions are real, completed, and for the correct amount
- Prevents transaction reuse across different emails
- Allows re-verification for the same email (OS reinstall scenarios)
- Returns an HMAC-signed activation token upon successful verification
- Rate-limits requests by IP address

**Important:** This worker does NOT generate or store licenses. License generation happens locally on the user's machine using sludge-crypt. The activation token simply proves "this payment was verified by our server."

## Setup & Deployment

### 1. Prerequisites

Before starting, ensure you have:

- [Node.js](https://nodejs.org/) (v18 or later)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed globally:
  ```bash
  npm install -g wrangler
  ```
- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A [PayPal Developer account](https://developer.paypal.com/) (set up in step 5)

### 2. Install Dependencies

```bash
cd license-worker
npm install
```

### 3. Authenticate with Cloudflare

Log in to your Cloudflare account via the CLI:

```bash
wrangler login
```

This opens a browser window for OAuth authentication. Once complete, Wrangler stores credentials locally.

### 4. Create KV Namespaces

Create the production KV namespace for storing activation records:

```bash
wrangler kv namespace create ACTIVATIONS
```

Copy the returned `id` into `wrangler.toml` under the `[[kv_namespaces]]` binding:

```toml
[[kv_namespaces]]
binding = "ACTIVATIONS"
id = "<paste-production-id-here>"
```

Then create a preview namespace for local development:

```bash
wrangler kv namespace create ACTIVATIONS --preview
```

Copy the returned `id` into `wrangler.toml` as `preview_id`:

```toml
[[kv_namespaces]]
binding = "ACTIVATIONS"
id = "<production-id>"
preview_id = "<paste-preview-id-here>"
```

### 5. Set Up PayPal

1. Go to the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox)
2. Create a new **REST API** application
3. Note down the **Client ID** and **Secret**

> **Sandbox vs Production:**
>
> - For testing, use Sandbox credentials. The `PAYPAL_API_URL` in `wrangler.toml` defaults to `https://api-m.sandbox.paypal.com`.
> - For production, use Live credentials and set `PAYPAL_API_URL` to `https://api-m.paypal.com` (already configured in `[env.production.vars]`).

### 6. Generate Security Keys

Generate a strong random secret for HMAC token signing:

```bash
openssl rand -hex 32
```

Save this value — you'll use it as `HMAC_SECRET` in step 7.

Generate a separate strong random key for API authentication:

```bash
openssl rand -hex 32
```

Save this value — you'll use it as `CLIENT_API_KEY` in step 7. This is the key that the VulnSweep CLI and UI send via the `X-API-Key` header to authenticate requests to this worker.

> **Note:** The `CLIENT_API_KEY` value you generate here must also be configured in the VulnSweep app itself (in `src/main/config/constants.js` or via the app's secure store) so that the app knows what key to send when contacting the worker.

### 7. Configure Secrets

Set all four secrets using Wrangler. Each command prompts for the value interactively:

```bash
wrangler secret put PAYPAL_CLIENT_ID
wrangler secret put PAYPAL_SECRET
wrangler secret put HMAC_SECRET
wrangler secret put CLIENT_API_KEY
```

| Secret             | Value Source                                   |
| ------------------ | ---------------------------------------------- |
| `PAYPAL_CLIENT_ID` | From PayPal Developer Dashboard (step 5)       |
| `PAYPAL_SECRET`    | From PayPal Developer Dashboard (step 5)       |
| `HMAC_SECRET`      | Generated with `openssl rand -hex 32` (step 6) |
| `CLIENT_API_KEY`   | Generated with `openssl rand -hex 32` (step 6) |

### 8. Deploy (Sandbox)

Deploy the worker to Cloudflare (uses sandbox PayPal by default):

```bash
npm run deploy
```

### 9. Verify Deployment

Confirm the worker is running by hitting the health endpoint:

```bash
curl https://vulnsweep-license.<your-subdomain>.workers.dev/health
```

Expected response:

```json
{ "status": "ok", "timestamp": "2024-01-01T00:00:00.000Z" }
```

### 10. Production Deployment

When ready to go live, set production secrets (with `--env production`):

```bash
wrangler secret put PAYPAL_CLIENT_ID --env production
wrangler secret put PAYPAL_SECRET --env production
wrangler secret put HMAC_SECRET --env production
wrangler secret put CLIENT_API_KEY --env production
```

Then deploy to production:

```bash
npm run deploy:production
```

> Production uses `https://api-m.paypal.com` as the PayPal API URL (configured in `[env.production.vars]` in `wrangler.toml`). Make sure you use your **Live** PayPal credentials for production secrets.

## Environment Variables

| Variable                    | Type   | Description                                 |
| --------------------------- | ------ | ------------------------------------------- |
| `PAYPAL_API_URL`            | var    | PayPal REST API base URL                    |
| `EXPECTED_AMOUNTS`          | var    | Comma-separated valid payment amounts       |
| `RATE_LIMIT_MAX`            | var    | Max requests per window per IP              |
| `RATE_LIMIT_WINDOW_SECONDS` | var    | Rate limit window in seconds                |
| `PAYPAL_CLIENT_ID`          | secret | PayPal REST app client ID                   |
| `PAYPAL_SECRET`             | secret | PayPal REST app secret                      |
| `HMAC_SECRET`               | secret | Secret key for signing activation tokens    |
| `CLIENT_API_KEY`            | secret | API key clients send via `X-API-Key` header |

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
