# DDoS / abuse protection runbook

As of April 2026 this dashboard has:

- **Frontend** — static on GitHub Pages.  GitHub's CDN absorbs any realistic traffic spike.  Nothing to do.
- **Backend API** — single Python/FastAPI + SQLite on one university-hosted VM (`150.254.115.204`).  **This is the exposure point.**

Three defensive layers, in order of effort.  You can ship layer 1 alone and skip the rest if traffic stays low; layer 2 is recommended before a launch that might attract attention; layer 3 is the belt-and-braces for a tool that ends up being broadly cited.

---

## Layer 1 — nginx rate-limits + cache (low effort, ~30 min, zero cost)

Copy-paste `docs/nginx-rate-limit.conf` into the VM's nginx config.  What you get:

| Protection | Value |
|---|---|
| Per-IP request rate | 20 req/s sustained, burst to 60 |
| Per-IP concurrent connections | max 10 (stops slow-loris) |
| Bulk-endpoint rate | 30 req/min (covers `/api/data/full` + `/export`) |
| Scanner-UA block | `nuclei` / `nikto` / `sqlmap` / `masscan` / empty UA → 403 |
| Cached endpoints | `facets`, `map`, `analytics`, `health` for 60 s; `records` for 30 s |
| Stale-while-revalidate | Live users never wait for a cache refill even if upstream is sluggish |

**Apply:**

```bash
sudo cp docs/nginx-rate-limit.conf /etc/nginx/conf.d/uhri-rate-limit.conf
sudo nginx -t && sudo systemctl reload nginx
```

**Verify:**

```bash
# Hammer the API with 50 parallel identical requests
seq 50 | xargs -n1 -P10 -I{} curl -sk -o /dev/null -w "%{http_code}\n" \
  https://150.254.115.204/uhri-api/api/data/facets | sort | uniq -c

# Expected: first ~60 get 200, rest 429 OR served from cache (check X-Cache-Status).
```

**Estimated capacity after layer 1**: ~5 k concurrent distinct-user sessions on a small VM without breaking a sweat.  Repeated burst attacks get 429'd.

---

## Layer 2 — Cloudflare free tier (medium effort, ~2 hrs, zero cost if you use a subdomain)

Put Cloudflare in front of the VM.  Gives you globally-distributed DDoS mitigation, bot fight mode, Browser Integrity Check, and a WAF — all on the free plan.

### Prerequisites
1. A domain name you control (Cloudflare free plan requires a domain; `lszoszk.github.io` can't be behind CF because GitHub controls the apex).  If you have a domain, even a cheap one — `uhri-dashboard.org` or similar — point an A record there.
2. DNS provider change permission for that domain.

### Setup

1. Sign up at [cloudflare.com](https://www.cloudflare.com) → Add a Site → enter your domain → select Free plan.
2. Cloudflare reads your existing DNS records.  **Add an A record** for a subdomain you'll use for the API, e.g. `api.your-domain.example → 150.254.115.204`.  Make sure the orange-cloud "Proxy" toggle is **ON** (means CF intercepts).
3. Change your domain's nameservers to the two Cloudflare provides.  Propagation: typically <1h.
4. Once green-checked, in Cloudflare → Security → Bots, enable **Bot Fight Mode**.  Free.
5. In Cloudflare → Security → WAF → Managed Rules, enable the **Cloudflare Managed Ruleset**.  Free.
6. In Cloudflare → Security → Settings, set Security Level to **Medium** (or High if you're under attack).
7. In Cloudflare → Rules → Rate Limiting Rules, add a rule:
   - Match: `URI Path contains "/api/data/full"` OR `"/api/data/export"`
   - Action: Block for 1 minute if more than 3 requests per 10 seconds per IP.
8. Update the frontend's `API_BASE` constant from `https://150.254.115.204/uhri-api` to `https://api.your-domain.example/uhri-api`.  (In this repo: `dashboard-data.js:6`.)

### What you get

| Protection | Free-tier behaviour |
|---|---|
| DDoS mitigation | Unlimited.  CF absorbs volumetric attacks at their edge, your VM never sees them. |
| Bot fight mode | Known-bad bots get challenged (lightweight JS challenge or block). |
| WAF Managed Ruleset | OWASP Top 10 protections — SQL injection attempts, XSS in query strings, etc. |
| Caching | CF can cache public GET responses automatically with `Cache-Control` headers.  Your `/api/data/facets` etc. become effectively infinite-throughput. |
| Analytics | Free traffic analytics in CF dashboard — you see where requests come from, UA breakdown, threat attempts blocked. |
| SSL | Full-strength SSL at the edge, even if your origin is self-signed. |

### Limitations (free tier)

- No custom WAF rules (the managed ruleset is all you get).
- Rate-limiting: free tier allows 10k requests/month into the Rate Limiting rules engine.  Past that, requests fall through without rate-checking.  For a niche research tool this is more than enough.
- Caching keys are URL-based by default; doesn't understand our POST-body queries.  No big loss since agents mostly hit GETs.

### Cost of adding a domain

If you don't already own a domain, a `.org` or `.eu` is €10-15/year from Namecheap / Gandi.  One-time setup, no recurring cost after that.

---

## Layer 3 — application-layer quota + API key gating (high effort, ~1 day)

Only do this if you've been hit hard despite layers 1-2, OR you want to give heavy users (researcher with a grant, a partner NGO) explicit higher limits without raising everyone.

- Issue API keys to verified researchers via email.
- FastAPI middleware reads `Authorization: Bearer <key>` header.
- Unauthenticated requests get tight limits (matching what Cloudflare gives anonymous users); authenticated requests get 10× or 100× quotas.
- Heavy endpoints (`/api/data/full`, `/api/data/export`) require a key — no public access.

This is **not** recommended unless you're under sustained load, because:
- Every legitimate researcher now has to email you for a key (friction).
- You have a key-management burden forever.
- Adding an auth layer complicates the "free, open, no login" messaging on the landing.

**Alternative that preserves openness**: offer the full-corpus download as a versioned S3 file (monthly snapshot) + put its URL on the Methodology tab.  That moves the one legitimate use-case for `/api/data/full` off the VM entirely; the endpoint then only serves interactive use, where normal per-IP limits suffice.

---

## Monitoring

Ship layer 1 alone, then watch:

```bash
# 429s per day
grep " 429 " /var/log/nginx/access.log | awk '{print $4}' | cut -c2-12 | sort | uniq -c

# Top source IPs by request count (last 1000 lines)
tail -n10000 /var/log/nginx/access.log | awk '{print $1}' | sort | uniq -c | sort -rn | head

# Cache hit ratio (requires enabling X-Cache-Status header — already in the nginx conf)
grep -o 'X-Cache-Status: [A-Z]*' /var/log/nginx/access.log | sort | uniq -c

# Current connection count per IP (real-time)
ss -tn state established '( sport = :443 )' | awk '{print $5}' | cut -d: -f1 | sort | uniq -c | sort -rn | head
```

Set up UptimeRobot (free tier — 5-min checks) on `https://150.254.115.204/uhri-api/api/data/health` so you get an email if the VM falls over.

---

## Honest assessment

- **Normal operations** (a few hundred daily visits from a research mailing list, a newsletter mention, word-of-mouth): layer 1 alone is plenty.  You will not notice load.
- **A viral moment** (Twitter/LinkedIn post by a well-followed HR researcher, 10k visits in an hour): layer 1 holds, but the VM CPU might redline on the rare queries that escape the cache.  Graceful degradation: users get slower response times but no 503s.
- **Targeted attack** (somebody specifically tries to knock you offline): layer 1 stops the casual 100-req/sec scripter.  A determined adversary sending 10k req/sec from a botnet will exhaust bandwidth before nginx has a chance to throttle.  That's when Cloudflare is worth the setup day.

Most independent research tools never need layer 2.  If you're unsure, ship layer 1 now and add CF if/when you see the first real problem.
