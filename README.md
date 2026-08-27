# Solution Ideas

An internal catalog of applications Impact System Marketing could build, served at
**https://ismorg.com/solutions** (behind HTTP basic-auth until deliberately made public).

Modeled on the structure of evyus.com/workflows — a searchable, filterable card grid, one
detail page per idea with a structured brief, a build-phases breakdown, a hand-built
prototype of the deliverable, and anonymous voting.

## Stack

| Part | What |
|---|---|
| Site | [Astro](https://astro.build) static build, MDX content collection (`src/content/solutions/*.mdx`) |
| Design | ISM brand tokens in `src/styles/ism.css` (crimson + charcoal, Archivo, radius 0, 2px rules) |
| Voting | `service/server.mjs` — zero-dependency Node HTTP service, votes in one JSON file |
| Host | nginx on the Contabo VPS (`ssh vps`), `location /solutions/` + `/solutions/api/` on the existing `ismorg.com` vhost |
| Deploy | `git pull` on the box, then `deploy/deploy.sh` (build + rsync + restart) |

## Local development

Requires Node 18+.

```bash
npm install
npm run dev        # http://localhost:4321/solutions
```

The vote widget calls `/solutions/api/votes`; with no service running it degrades to a
disabled control showing `0`. To exercise voting locally, in a second terminal:

```bash
cd service && PORT=4310 DATA_FILE=./votes.json node server.mjs
```

…and run Astro behind a proxy that maps `/solutions/api/` to `:4310`, or just test the
service directly with `curl`.

## Adding or editing an idea

Create `src/content/solutions/<slug>.mdx`. Frontmatter is validated by
`src/content/config.ts`:

```mdx
---
title: My Idea
number: 7                     # catalog order + the visible "No. 07"
one_liner: One sentence for the card.
status: spark                 # spark | exploring | prototyping | building | live | parked
category: Operations & Admin  # must be one of the nine in config.ts
tags: [automation, ai]
effort: M                     # S | M | L (optional)
target_user: Who it is for    # optional
visibility: internal          # internal ideas vanish when PUBLIC_BUILD=1
created: 2026-08-27
updated: 2026-08-27
---

import Prototype from '../../components/Prototype.astro';
import TeamOnly from '../../components/TeamOnly.astro';

## The problem
...
## What it does
...
## Who it is for
...
## How it works
...

<TeamOnly>

## Why it is worth building
...
## Build phases
### Phase 1 — ...
### Phase 2 — ...
### Phase 3 — ...
## Stack and dependencies
...
## Open questions and risks
...

<Prototype label="What they see" caption="Illustrative mockup.">
  <div class="mock">
    <h4>Title</h4>
    <div class="row"><span>Label</span><span>Value</span></div>
  </div>
</Prototype>

</TeamOnly>
```

### Two levels of gating

| Lever | Effect |
|---|---|
| `visibility: internal` in frontmatter | the **whole idea** is dropped from a `PUBLIC_BUILD=1` build (card and page) |
| `<TeamOnly>…</TeamOnly>` around sections | those **sections** are dropped from a public build; a "sign in to see the rest" note shows instead. In the private build they render with an "Internal" marker. |

Convention for the seed ideas: the card + everything through **How it works** is the public
pitch people vote on; **Why it is worth building** onward (phases, stack, risks, prototype)
is wrapped in `<TeamOnly>`. Keep blank lines around the `<TeamOnly>` tags so the markdown
inside still renders.

The `.mock` helper classes (`.row`, `.score`, `.btnrow`, `h4`/`h5`, `.tagline`) are styled
in `src/components/Prototype.astro` — enough to fake an email, a dashboard panel, or a
result card without writing CSS.

Then deploy (below). Nothing else to wire up.

---

## First-time VPS setup

One-time, as root on `ssh vps`.

```bash
# 1. code
mkdir -p /opt/ismorg-solutions
git clone <REPO_URL> /opt/ismorg-solutions
cd /opt/ismorg-solutions

# 2. basic-auth gate for /solutions (pick your own password at the prompt)
apt-get install -y apache2-utils
htpasswd -c /etc/nginx/.htpasswd-solutions robert

# 3. vote service
mkdir -p /var/lib/ismorg-solutions && chown www-data:www-data /var/lib/ismorg-solutions
cp deploy/ismorg-solutions-votes.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ismorg-solutions-votes
curl -fsS http://127.0.0.1:4310/api/health && echo      # -> {"ok":true}

# 4. nginx: edit /etc/nginx/sites-available/ismorg.com to match
#    deploy/ismorg.com.nginx (adds /solutions/ and /solutions/api/)
nginx -t && systemctl reload nginx

# 5. first build + publish
./deploy/deploy.sh
```

Then browse to `https://ismorg.com/solutions/` and authenticate.

### Notes

- Build output publishes to `/var/www/ismorg.com/solutions/`. The `ismorg.com` root
  (`/var/www/ismorg.com/html/index.html`) gets the landing page from
  `deploy/root-index.html`.
- The vote service runs as `www-data` on `127.0.0.1:4310`, data at
  `/var/lib/ismorg-solutions/votes.json`. Add that path to the box's Backblaze backup set.
- `node` on the box is v22 — `deploy.sh` uses `npm ci`, so `package-lock.json` must be
  committed.

## Ongoing deploy

```bash
ssh vps
cd /opt/ismorg-solutions && git pull && ./deploy/deploy.sh
```

## Making it public later

The intended public shape is a **teaser**: anyone can see each idea's pitch (card +
problem / what it does / who it's for / how it works) and vote; the build internals stay
private. Mechanism:

1. For each idea you want publicly listed, set `visibility: public` in its frontmatter.
   Its `<TeamOnly>` sections still won't render in the public build.
2. Build the public bundle: `PUBLIC_BUILD=1 npm run build`.
3. Serve two bundles:
   - **public** bundle at `/solutions/` — remove the `auth_basic` lines from the
     `/solutions/` and `/solutions/_astro/` blocks (keep them on `/solutions/api/` or not,
     your call), `nginx -t && systemctl reload nginx`.
   - **full** bundle (normal `npm run build`, everything visible) published to
     `/var/www/ismorg.com/solutions-full/` with a matching `location /solutions-full/`
     block that keeps `auth_basic`. That's your logged-in view of the complete pages.
4. Loosen `public/robots.txt` and drop the `noindex` meta in `src/layouts/Base.astro` only
   if you want search engines to index the public teaser.

Until then everything stays behind one `auth_basic` gate and the split is only cosmetic
(the `<TeamOnly>` marker shows what *would* be hidden).
