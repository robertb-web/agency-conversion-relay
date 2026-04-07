# GHL Conversion Relay Server

Receives GoHighLevel (GHL) webhook events and forwards conversion data to **Meta Conversions API**, **GA4 Measurement Protocol**, and **Google Ads Offline Conversion Upload** — with a password-protected monitoring dashboard.

## Quick Start

```bash
cp .env.example .env      # Fill in your credentials
npm start                 # Start on port 3000
```

Dashboard: `http://localhost:3000`
Webhook URL: `http://your-server/webhook/ghl`
Default login: `admin` / `admin` (change in `.env`)

## File Structure

```
server.js              Express entry point
routes/
  webhook.js           POST /webhook/ghl — GHL event receiver
  auth.js              Login/logout
  dashboard.js         Protected API for the dashboard
services/
  meta-capi.js         Meta Conversions API sender
  ga4.js               GA4 Measurement Protocol sender
  google-ads.js        Google Ads offline conversion uploader
  hasher.js            SHA-256 normalization/hashing utilities
  event-mapper.js      GHL workflow → ad platform event name mapping
db/
  database.js          SQLite setup, schema, and query helpers
public/
  index.html           Dashboard UI
  login.html           Login page
  app.js               Dashboard frontend logic
  style.css            Styles
.env.example           Required environment variables template
```

## Webhook Payload

GHL should POST to `/webhook/ghl`. The payload is routed by `location.id` to the correct client.

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3000) |
| `SESSION_SECRET` | Long random string for session encryption |
| `ADMIN_USERNAME` | Dashboard login username |
| `ADMIN_PASSWORD` | Dashboard login password |
| `DB_PATH` | SQLite database path |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Global Google Ads developer token (can also be set per-client) |

## Event Mapping (Default)

| GHL Workflow Name | Meta | GA4 | Google Ads |
|---|---|---|---|
| Conversion Event \| Lead | Lead | generate_lead | Lead |
| Conversion Event \| Webinar Reg | CompleteRegistration | webinar_registration | Webinar Registration |
| Conversion Event \| Webinar Attended | webinar_attended | webinar_attended | Webinar Attended |
| Conversion Event \| Webinar No Show | webinar_noshow | webinar_noshow | (skipped) |
| Conversion Event \| Consultation | Schedule | book_appointment | Consultation Booked |
| Conversion Event \| Sale | Purchase | purchase | Purchase |

Custom mappings can be set per-client in the dashboard.

## Google Ads Setup Notes

- `google_ads_conversion_action_id`: The **numeric ID** of the conversion action (e.g. `123456789`), not the display name. Find it via the Google Ads API: `GET customers/{id}/conversionActions`
- The conversion action resource name is constructed as: `customers/{customer_id}/conversionActions/{action_id}`
- Conversions are only sent if `gclid` is present on the contact (i.e., the lead came from a Google Ads click)

## Deploy to Railway

1. Push to GitHub
2. Connect repo to Railway.app
3. Set all environment variables in Railway dashboard
4. Railway provides HTTPS automatically

## Pilot Client

- **Serenity Life Doula LLC** — `locationId: Ux46JNnQmZYJisvk3sZ7`
