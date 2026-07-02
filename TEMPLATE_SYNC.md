# Template sync (Albo OS → template)

Backlog of **"core"** improvements made in Albo OS that are worth pushing back
into the [`albo-ouvre-boite`](https://github.com/Albo-Club/albo-ouvre-boite)
template. This is the **reverse direction** of [`UPGRADING.md`](UPGRADING.md)
(which pulls template changes *into* Albo OS).

There is no automation here on purpose: the agent only **flags** candidates,
Benjamin/Clément **port** the code into the template by hand when they choose
to. Keeping the human in the loop avoids leaking business logic upstream and
lets us generalise the code before it lands in the starter.

## Workflow

1. **At each PR** (see `CLAUDE.md` § "Pre-PR doc audit", question 6): if the
   change touches reusable core code, the agent adds a row to the backlog
   below **and** a short "Template sync" section to the PR description.
2. **When you want to upstream one**: port the code into `albo-ouvre-boite`
   (de-branding / removing any Albo OS specifics as needed), open the PR
   there, then update the row's **Status** here.
3. **Once landed or dropped**: mark the row `✅ upstreamed (#PR)` or
   `❌ dropped (reason)`. Prune rows that are fully resolved when the table
   gets long — git history keeps the trace.

## What qualifies

✅ **Push to the template** — generic, project-agnostic:

- Auth / Better Auth config, multi-tenant plumbing, `convex/lib/` helpers.
- Security (CORS, headers, HMAC webhook verify, rate limiting).
- Reusable UI primitives in `src/components/ui/*`, i18n / SSR patterns.
- DX & tooling: scripts, CI workflows, config, the skills pipeline.
- Bug fixes in code the template also ships.

❌ **Stays in Albo OS** — business/domain specific:

- Portfolio domain: deals, companies, valuations, KPIs, cash, forecasts,
  liabilities, transaction pointage.
- Domain-specific AI tools (`convex/agentTools*.ts`) and their prompts.
- Anything tied to CALTE / Albo Club org structure or seeds.

When a change is *mostly* generic but carries a domain detail, flag the
generic slice only and note what needs stripping before it goes upstream.

## Backlog

| Date       | Candidate | Files (Albo OS) | Why it's generic | Status |
| ---------- | --------- | --------------- | ---------------- | ------ |
| 2026-07-02 | `InlineField` — click-to-edit field primitive | `src/components/ui/inline-field.tsx` | Generic inline editor (click → format-aware input → Enter/blur save, Esc cancel) usable on any fiche. **Strip before upstream:** decouple from `~/lib/parse` `FieldFormat`/`parseField`/`rawToInput` (instrument display formats) — make the format/parse layer injectable so it isn't tied to the portfolio domain. | ⏳ flagged |
