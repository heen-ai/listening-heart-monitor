# Listening Heart Monitor

A service that monitors [Listening Heart](https://listening-heart.onrender.com) tasks for new notes and posts notifications to Discord webhooks.

## Features

- **x402 Payment Gate**: Subscriptions require 0.001 USDC payment on Base Sepolia testnet
- **Automatic Polling**: Checks for new notes every 5 minutes (via Cloudflare Cron)
- **Discord Notifications**: Posts rich embeds with note content, author, type, and timestamp

## Deployment

### Cloudflare Workers (Recommended - Free)

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

### Manual/Other Platforms

```bash
npm install
npm start
```

## API Endpoints

### POST /subscribe
Subscribe to notifications for a task.

**Headers:**
- `Authorization: x402` (x402 payment header)

**Body:**
```json
{
  "taskId": "0x...",
  "webhookUrl": "https://discord.com/api/webhooks/..."
}
```

**Response (402 Payment Required):**
```json
{
  "error": "Payment required",
  "payment": {
    "network": "eip155:84532",
    "currency": "USDC",
    "amount": "0.001"
  }
}
```

### DELETE /subscribe/:taskId
Unsubscribe from a task.

### GET /health
Health check endpoint.

### GET /subscriptions
List active subscriptions.

## Configure Cron Trigger

In Cloudflare Dashboard:
1. Go to Workers > listening-heart-monitor > Triggers
2. Add a Cron Trigger that runs every 5 minutes

## License

MIT
