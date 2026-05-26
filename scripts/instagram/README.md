# Instagram Graph API Scraper

Standalone proof-of-concept that fetches recent posts from an Instagram
Business or Creator account via the **official Meta Instagram Graph API** and
returns normalised JSON suitable for PaceFinder's race-event pipeline.

No browser scraping. No image storage. Only source URLs and derived event facts
are kept.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js ≥ 18 | Uses native `fetch` |
| `tsx` (or `ts-node`) | For running TypeScript directly |
| A Meta Developer account | <https://developers.facebook.com> |
| An Instagram Business or Creator account | Connected to a Facebook Page |

---

## 1 — Create a Meta App

1. Go to <https://developers.facebook.com/apps/> → **Create App**.
2. Choose **Business** as the app type.
3. Under **Add Products**, add **Instagram Graph API**.

---

## 2 — Connect an Instagram Account

Your Instagram account must be a **Business** or **Creator** account and must
be linked to a Facebook Page you manage.

1. In the Facebook Page settings → **Instagram** → connect your account.
2. In Meta App Dashboard → **Instagram** → **API setup with Instagram login**
   or **API setup with Facebook login** (either works for the Graph API).

---

## 3 — Required Permissions

| Permission | Purpose |
|---|---|
| `instagram_basic` | Read account info and media |
| `pages_show_list` | List Facebook Pages (needed for token exchange) |
| `pages_read_engagement` | Access Page-linked IG account |

For development/testing you can use tokens generated in the **Graph API
Explorer** without going through App Review. Production use of the Instagram
Graph API for third-party accounts requires App Review.

---

## 4 — Generate an Access Token

### Quick (testing only)

1. Open <https://developers.facebook.com/tools/explorer/>.
2. Select your app → **Generate Access Token**.
3. Add the permissions above.
4. Click **Generate** → copy the **User Access Token**.

This token expires in ~1 hour. Exchange it for a **long-lived token** (60 days):

```
GET https://graph.facebook.com/v21.0/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id={app-id}
  &client_secret={app-secret}
  &fb_exchange_token={short-lived-token}
```

### For a Page-connected account

```
# 1. Get your Instagram Business Account ID
GET https://graph.facebook.com/v21.0/me/accounts
  ?fields=instagram_business_account
  &access_token={long-lived-user-token}

# 2. Use the numeric IG User ID as INSTAGRAM_ACCOUNT_ID
```

---

## 5 — Setup

```bash
# From the repo root
cd scripts/instagram
cp .env.example .env
# Edit .env with your token and (optionally) account ID
```

Install `tsx` if you don't have it:

```bash
npm install -g tsx
# or use npx tsx (no install needed)
```

---

## 6 — Run

```bash
# From repo root
npx tsx scripts/instagram/scraper.ts

# Pretty-print
npx tsx scripts/instagram/scraper.ts | jq .

# Save output
npx tsx scripts/instagram/scraper.ts > output.json

# Fetch more posts
INSTAGRAM_MAX_POSTS=50 npx tsx scripts/instagram/scraper.ts
```

Progress and diagnostics are written to **stderr**; clean JSON is written to
**stdout**, making it easy to pipe or redirect.

---

## 7 — Output Format

```jsonc
{
  "source": "instagram",
  "account": {
    "id": "17841400455970028",
    "username": "myrunningclub",
    "type": "instagram"
  },
  "posts": [
    {
      "id": "18023456789012345",
      "caption": "🏃 Oslo Maraton 10km — påmelding åpen! ...",
      "timestamp": "2026-05-01T09:00:00+0000",
      "permalink": "https://www.instagram.com/p/ABC123/",
      "media_type": "IMAGE",
      "media_url": null,        // not stored per policy
      "race_candidate": true,
      "extracted_event": {
        "name": "🏃 Oslo Maraton 10km — påmelding åpen!",
        "city": "Oslo",
        "date": "01.09",
        "distance": "10km",
        "registration_hint": "påmelding",
        "medal_hint": null,
        "timing_hint": null,
        "confidence": 0.75,
        "missing_fields": []
      }
    }
  ]
}
```

> **Note on `media_url`:** The API returns a short-lived CDN URL. The scraper
> captures it in JSON as a reference but does not download or cache images.
> Per Meta's Platform Policy, do not store or redistribute Instagram media
> files.

---

## 8 — Race-Event Classifier

The built-in classifier uses keyword pattern matching (Norwegian + English) to:

- Flag posts as `race_candidate: true/false`.
- Extract distance, date, city, registration/medal/timing hints.
- Compute a `confidence` score (0.0–1.0) based on how many signals are present.

This is intentionally simple — upgrade to an LLM call for production.

---

## 9 — Rate Limits

The Instagram Graph API allows **200 calls per hour** per token. The scraper
inserts a 300 ms delay between paginated requests and well within this limit
even for large fetches.

---

## 10 — Permissions & Privacy

- Only fetch accounts that have explicitly granted your Meta App access.
- Do not store media files or personally identifiable information beyond what
  is shown publicly on Instagram.
- Comply with Meta's [Platform Terms](https://developers.facebook.com/terms/)
  and [Developer Policies](https://developers.facebook.com/devpolicy/).
