# lapel — Backlog (discussed, not yet built)

Running list of ideas raised in design/usage discussions but not implemented. Each notes where it
came from. **For a fresh session:** read `CLAUDE.md` first (architecture + conventions), then this.
Design history lives in `docs/superpowers/{specs,plans}/`; the git log shows what's done.

**Status:** Plans 1–6 implemented + `lapel remove`. Runs on a Claude Pro/Max subscription by
default (`LAPEL_BACKEND=subscription`, no API key). 102 tests, on `main`.

## Workflow / CLI

- **`lapel score`** _(recommended next)_ — score pipeline jobs that are unscored (`score IS NULL`).
  Decouples `find --no-score` (free scout) from scoring; today you must `remove` + re-`find` to
  score scouted jobs (dedup skips already-stored rows). Small: a `getJobs` filter + reuse
  `makeScorer` + a CLI command + tests. (Raised when `pipeline` showed all "—" scores.)
- **`find --prune`** — auto-remove jobs from companies no longer in `companies.yaml`, so editing the
  watchlist "just works" without a separate `remove`.
- **`add` text/CSV inputs** — the ingest core already takes `NormalizedJob[]`; add a text/CSV builder
  (v1 is URL-only). Spec §6.4.

## Prefilter / scoring

- **Tune the role-family filter** — the conservative `OFF_FAMILY` list (Plan 6) misses some non-eng
  titles (e.g. "Creative Project Manager", "Senior Data Analyst", "Team Leader, Data Analytics" slip
  through and get scored). Consider deriving the wanted family more from the profile's `targetRoles`,
  or expanding the list — keep it conservative (don't drop real eng roles).

## Profile

- **`profile build` synth cleanup** — stop synthesizing fuzzy/cultural prefs ("Agile development",
  "Testing culture", "Some remote flexibility") into the hard-keyword `mustHave`/`dealbreakers`
  fields; route them to `notes`/summary. Deferred from Plan 6 — harmless now (the prefilter ignores
  those fields; the scorer reads them as soft context) but cleaner. (`src/agent/prompts/synthesize-profile.ts`.)

## Tailoring / output

- **Full tailored resume + PDF export** — optionally emit a complete tailored resume (not just the
  summary block `resume-summary.md`), and render `cover-letter.md`/resume to PDF. PDF is a current
  spec non-goal (§1) — a deliberate future item.

## Sources / ingest

- **JS-rendered pages (Workday/Zillow)** — `add` does plain `fetch` + `html-to-text`, so JS-heavy
  pages (Zillow Workday, some custom ATS) extract thin. Add a readability/headless fallback, or keep
  `tailor --text <file>` as the documented workaround.
- **`leads` — careers landing pages** — a landing-page URL (e.g. `rocketmoney.com/careers`) currently
  becomes a useless direct-add. Detect "not a single posting" and flag as unresolved instead.
- **`leads` — renamed companies** — name-probing won't find a board whose slug ≠ name (Rocket Money →
  `greenhouse/truebill`); these land in "unresolved". Consider an alias map / known-company lookup.
- **`leads` clobbers `companies.yaml` comments** — it rewrites via YAML serialization, dropping
  hand-written comments. Preserve comments, or append watchlist additions without a full rewrite.

## MCP

- **`score_job` MCP tool** — score a single posting without persisting (spec §9, optional).
- **LLM field-extraction in `add`** — extract company/title/location from posting text for cleaner
  records (Plan 3 optional follow-up).

## LLM backends

- **Local model backend** — a third `LAPEL_BACKEND=local` (e.g. Ollama) for fully-offline/free
  scoring at a lower quality tier. (Option D from the backend discussion.)

## Infra / project

- **Publish to GitHub** — set the remote (confirm owner; `package.json` `repository` currently
  guesses `ciwaskiw/lapel`), push `main`, verify CI runs (`.github/workflows/ci.yml`).
- **Quota / rate-limit handling** — for large boards, throttle/backoff scoring batches against
  subscription rate limits.
