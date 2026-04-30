# Signafi Structured Products

Vercel-hosted frontend plus a Cloudflare Worker/D1 backend for BTC option market data, depth-aware DCN sell-put pricing, and internal admin verification.

## Structure

- `web/` - Next.js app for `/`, `/3-levers`, and `/admin`.
- `worker/` - Cloudflare Worker, Durable Object, D1 migrations, Deribit ingestion, and pricing APIs.

## Local development

1. Install dependencies:

   ```powershell
   npm.cmd install
   ```

2. Run the web app:

   ```powershell
   npm.cmd run dev -w web
   ```

The web app includes local mock responses if `WORKER_API_BASE_URL` is not configured.

## Environment

Web app:

- `WORKER_API_BASE_URL` - Cloudflare Worker base URL.
- `BACKEND_API_TOKEN` - Shared token sent from Vercel to Cloudflare Worker.
- `ADMIN_PASSWORD` - Password for `/admin`.

Worker:

- `BACKEND_API_TOKEN` - Shared token required for admin endpoints.
- `DERIBIT_BASE_URL` - Optional, defaults to `https://www.deribit.com/api/v2`.
- `DERIBIT_WS_URL` - Optional, defaults to `wss://www.deribit.com/ws/api/v2`.

## Cloudflare D1

Create a D1 database, update `worker/wrangler.toml`, then apply migrations:

```powershell
npx.cmd wrangler d1 migrations apply signafi_market
```
