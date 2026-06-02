# PaceFinder — Product & Redesign Spec

> Status: **APPROVED** — Nordics-first, refined dark + electric lime, UX+scraping in
> parallel, full rewrite latitude.
> Goal: Turn PaceFinder into an addictive, beautifully polished app that helps runners
> discover the right upcoming races — and reliably finds the races worth surfacing.

---

## 1. Vision

PaceFinder is a **race-discovery feed** that feels like a cross between Strava's polish,
a premium travel app, and a "for you" feed. A runner opens it and immediately sees a
small, curated set of races that fit *them* — their city, their distances, their
ambitions — each one beautiful, scannable, and one tap away from "I'm in."

Two pillars:

1. **Discovery that delights** (front-end / UX) — a cohesive, premium, motion-rich
   interface that makes browsing races genuinely fun and habit-forming.
2. **Discovery that works** (back-end / agent) — an aggressive, LLM-powered pipeline
   that finds the relevant races across the web. Token cost is **not** a constraint;
   relevance and coverage are.

---

## 2. What we keep (good foundations)

- **Stack**: SvelteKit 2 + Svelte 5 runes, Tailwind v4, Drizzle ORM + Postgres,
  better-auth, Redis, Vercel AI SDK (OpenAI + Anthropic).
- **Data model**: `race_series → race_editions → race_distances` (3 levels). Excellent —
  keep it. Plus per-user triage, comments, results, agent runs, budget tracking.
- **Nordic timing-system scrapers** (EQ Timing, SportsTiming, Tímataka, RaceTimer,
  Kondis, Friidrett) — these are authoritative structured sources. Keep & expand.
- Admin dashboard, agent-run history, results/leaderboard scraping.

## 3. What we change

### 3.1 Design system (new, cohesive)

Replace the random-rainbow-per-card look with **one deliberate design language**.

- **Theme**: Refined dark theme ("midnight track"). Single primary accent —
  an energetic **electric lime** (`#c2f04c`-ish) used sparingly for actions/brand,
  plus a **warm signal orange** for urgency. Neutrals are true slate, not muddy navy.
- **Category color = meaning, not random.** Color is derived from *category/distance*
  (e.g. Local = teal, Travel/Nordic = violet, Bucket-list = amber), so the palette is
  consistent and informative.
- **Typography**: Properly self-host/load a premium variable font pair —
  display font for headlines (e.g. *Clash Display* / *Satoshi* / *General Sans*), and
  Inter for body. Tight, confident type scale.
- **Iconography**: Replace emoji-as-UI with a real icon set (Lucide) for chips, stats,
  and actions. Keep at most a few intentional emoji as personality accents.
- **Imagery**: Stop relying on hotlinked Instagram/FB images that break. Strategy:
  - Cache/proxy real race images server-side when we have a usable source.
  - When no image, render a **designed gradient + topographic/contour pattern**
    keyed to the race location (deterministic, not random rainbow) — looks intentional.
- **Motion & delight**: Tasteful entrance animations, spring-based card press, a
  satisfying "Save/Track" interaction (heart fill + subtle haptic-style pop),
  skeleton loaders, view-transition page nav.
- **Responsive**: Real layouts at every breakpoint.
  - Mobile: single-column feed (current width is fine).
  - Tablet/desktop: multi-column masonry/grid + optional split map view.

### 3.2 Information architecture

- **Home = "For You"** — a personalized, sectioned feed:
  - "Closing soon near you" (urgency)
  - "Medal runs in {city}"
  - "Worth the trip" (Nordic weekend)
  - "Bucket list" (international majors)
  - "Just discovered" (fresh finds this week)
  Sections are horizontal carousels on mobile, grids on desktop.
- **Explore** — full searchable/filterable catalog (today's Browse), upgraded with a
  **map view toggle**, distance/date/region/medal facets, and sort.
- **Race detail** — hero image, distances selector, key facts (date, price if known,
  registration deadline w/ countdown), "why it fits you," medal info, past results /
  leaderboard, comments, and a prominent **Register / Track** CTA.
- **Saved / My Races** — the tracked list becomes a real surface with states
  (Interested → Registered → Done), bib numbers, and a personal timeline.

### 3.3 Addictive loop (gamification, tasteful)

- **Personalization onboarding**: ask home city, target distances, and ambition level
  ("local medals" vs "destination marathons"). Feeds the "For You" ranking.
- **Urgency signals**: live "registration closes in N days" countdowns; "spots filling"
  cues when known.
- **Save/streak dopamine**: smooth save animation, a small "races saved" counter, and a
  personal goal ("2 of 3 races booked this season").
- **Fresh-finds notifications** (in-app first): "5 new races matched your profile."
- **Shareable race cards** for social proof.

> Note: gamification stays *tasteful* — no dark patterns, no fake scarcity. Urgency is
> only shown when backed by real data.

### 3.4 Scraping & LLM strategy (relevance over cost)

The agent's job: **find every relevant upcoming running race and surface it well.**

**Layered source strategy:**

1. **Structured timing-system APIs/scrapers** (already strong) — fast, cheap, reliable.
   Expand coverage: add more aggregators (e.g. ahotu, RunSignup-style, regional
   federations, Marathons of the world directories, country athletics calendars).
2. **Search-driven discovery** — use a search API (Tavily/Brave/Google CSE) with a
   *rotating, broad* query set (per region, per major city, per distance, per season)
   to catch races not on timing platforms.
3. **LLM-powered web extraction (the big upgrade)** — for promising leads (especially
   a race's own official site), fetch the page and use an LLM to extract structured
   fields: exact date, distances offered, registration URL + status + deadline, price,
   medal/finisher info, and a quality "why it fits" blurb. Use a **strong** model here
   (cost is not a concern) for accuracy. Cache by URL + content hash.
4. **Agentic deep-research mode (optional/admin-triggered)** — for a target city or
   region, run a multi-step LLM agent that searches, opens pages, follows registration
   links, and assembles a verified race list. This is the "find the relevant races at
   any cost" mode.

**Quality pipeline:**
- Keep the pure-logic pre-filter (drop non-running, recurring jogs, kids, virtual, <3km).
- LLM classification + enrichment with rich schema (add price, deadline, surface type,
  elevation/scenic flag, field size if available).
- **Image acquisition**: extract a hero image from the official site / OpenGraph tags;
  cache it; fall back to designed gradient art.
- Robust dedup across sources (series + edition fingerprints already exist — extend to
  fuzzy-match name variants).
- Confidence scoring; low-confidence leads can be flagged for admin review.

**Schema additions (migrations):**
- `race_editions`: `registration_deadline`, `price_min`/`price_max`/`currency`,
  `field_size`, `registration_url` (edition-level), `confidence`.
- `race_distances`: keep; add `elevation_gain_m`, `surface` (road/trail/mixed) optional.
- `race_series`: `hero_image_cached_url`, `topo/region key` for art.
- New `race_images` (optional) for cached/proxied images.
- `user`: `target_distances` (array), `ambition` (enum), `travel_radius_km`,
  optional `home_lat`/`home_lng` for distance ranking.

> Migrations are free to drop/rebuild dummy data as needed (per your go-ahead).

---

## 4. Scope & phasing

**Phase 1 — Design system + feed redesign (highest visual impact)**
- New theme, fonts, icons, tokens. Rebuild `RaceCard`, hero, nav, layout.
- Responsive desktop layout. Fix broken-image strategy with designed fallback art.
- Polished Save interaction + motion.

**Phase 2 — IA + personalization**
- "For You" sectioned home, onboarding for city/distance/ambition, ranking.
- Explore page with map toggle + facets. Saved/My Races surface.

**Phase 3 — Race detail + urgency**
- Redesigned detail page, countdowns, deadlines, results/leaderboard polish.

**Phase 4 — Scraping/LLM upgrade**
- Schema migrations, LLM web-extraction enrichment, image caching, expanded sources,
  optional agentic deep-research mode, confidence scoring.

**Phase 5 — Addictive loop polish**
- Streaks/goals, in-app notifications, shareable cards, micro-delight pass.

---

## 5. Non-goals (for now)

- Payments / actual race registration (we link out to official sites).
- Native mobile apps (responsive web only).
- Real-time push/email delivery (in-app notifications first).

---

## 6. Open questions for you

1. **Geographic focus** — is the audience primarily Norway/Nordics with international
   "bucket list" races, or fully global? (Affects source priority + ranking.)
2. **Design direction** — happy with "refined dark + electric lime," or do you want me
   to explore a lighter / more editorial look too before committing?
3. **Rewrite latitude** — OK to fully replace `RaceCard`, the home feed, layout/theme,
   and run schema migrations (dropping dummy data) as needed? (You said yes — confirming.)
4. **Build order** — start with Phase 1 (visual redesign) so you can see/feel it fast,
   then proceed through the phases? Or prioritize the scraping upgrade first?
