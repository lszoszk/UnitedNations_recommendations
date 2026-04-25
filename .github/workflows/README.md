# GitHub Actions workflows

Two workflows, intentional split:

## `test.yml` — per-push / per-PR (blocking gate)

Runs on every push to `gh-pages` and on every PR targeting `gh-pages`.
Single Chromium job that mirrors `npm test` locally — smoke + integrity
+ a11y + analytics + topbar + bug-report + web-vitals + tab-walk.

**Target time:** < 2 minutes.

**Why blocking:** the smoke suite is the lowest-cost, highest-value
guard. Every regression it catches today costs zero dollars; the same
regression on a beta tester's session costs trust.

To make this a required status check on PR merges (manual setup, repo
owner only):
1. GitHub repo → Settings → Branches → Branch protection rules
2. Pattern: `gh-pages`
3. Check "Require status checks to pass before merging"
4. Add `Test (smoke) / smoke + integrity + a11y (Chromium)` to the
   required list.

## `nightly.yml` — scheduled deeper checks (informational)

Runs at 03:30 UTC daily plus on-demand via workflow_dispatch.

Three independent jobs (each `continue-on-error: true` so a single
failure doesn't poison the others):

* **contracts** — `npm run test:contracts` against the live VM.
  Catches schema drift, CORS regressions, p95 latency degradations.
  Failures = an issue should be opened (semi-manual today; can
  auto-create via `gh issue create` in a follow-up).

* **cross-browser** — matrix over Firefox / WebKit / mobile (iPhone 13
  viewport). Each runs `npm run test:<browser>`. Will currently
  surface the regressions documented in `docs/cross-browser-status.md`
  — that's intentional, the failures are the work-list for the
  pre-beta cross-browser fix sweep.

* **live-flows** — `npm run test:live-flows` against the deployed
  GitHub Pages site. Most flake-prone (depends on VM uptime + rate
  limits + GA consent banner timing). Treated as informational +
  the per-flow report in `test-results/` is the actual deliverable.

**Why nightly, not every push:** these are slow (~15 min total) and
flaky enough that running them per-push would erode the value of the
blocking gate. Out-of-critical-path daily check + Slack/email
notification on failure is the right cadence.

## Triage routine (post-launch)

Every Monday morning:

1. Open the Actions tab.
2. Scan the last 7 nightly runs.
3. For each red:
   - cross-browser → update `docs/cross-browser-status.md` if state
     changed; otherwise ignore.
   - contracts → if backend genuinely regressed, file a P0 ticket
     and ping the VM ops.
   - live-flows → check the flow report markdown, decide which
     flow regressed.
4. For each green-since-last-week → close the corresponding issue.
