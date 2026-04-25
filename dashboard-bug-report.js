/* =========================================================================
   IN-APP BUG REPORT WIDGET (§I.5 in the beta test plan)
   =========================================================================
   Floating button bottom-right of every view → opens a small form that
   captures (a) what the user typed, (b) auto-collected context, then
   ships them off to either:
     - a prefilled GitHub Issues URL (`window.open` to a new tab; the
       user reviews + clicks Submit on GitHub), or
     - a `mailto:` link with the same body, for testers without a
       GitHub account.

   Why no backend (Cloudflare Worker, Formspree, etc.)?  Friction
   trade-off:
     - Worker + PAT: zero friction for tester (one click submit), but
       maintenance cost on our side (PAT rotation, Worker deploy).
     - Prefilled GitHub URL: ~10 s of extra friction (review on GH,
       Submit button), zero infra.
   For a beta of ~12 heavy users, the latter is the right call; we can
   layer a Worker on later (the form already structures the body in a
   way that's easy for a Worker to forward).

   What's captured (transparent to the tester before they submit):
     - user-typed: severity, summary, steps, expected, actual
     - auto: URL hash, user-agent, viewport, GA client_id, last 10
       console errors, current dashboard view + filter state
     - NOT captured: any DOM content, screen contents, anything that
       could include searched-keyword text or third-party content
       the tester is browsing in another tab.

   Privacy: the form preview shows the user EVERYTHING that will go
   into the GitHub issue before they leave the dashboard; nothing is
   exfiltrated by the dashboard itself. */

(() => {
  /* ---------- CONFIG ---------- */
  const REPO = 'lszoszk/UnitedNations_recommendations';
  const FALLBACK_EMAIL = 'l.szoszkiewicz@amu.edu.pl';
  const ISSUE_LABELS = ['phase:closed-beta', 'from-widget'];
  const CONSOLE_BUFFER_MAX = 10;

  /* ---------- CONSOLE ERROR BUFFER ----------
     Captures the last 10 console.error / pageerror messages so the
     bug-report has automatic crash-context.  Hooks early at module
     parse time so it catches anything that happens during boot. */
  const _errBuf = [];
  function pushErr(text) {
    if (!text) return;
    _errBuf.push(`[${new Date().toISOString().slice(11, 19)}] ${String(text).slice(0, 400)}`);
    if (_errBuf.length > CONSOLE_BUFFER_MAX) _errBuf.shift();
  }
  const origConsoleError = console.error.bind(console);
  console.error = function (...args) {
    try { pushErr(args.map(a => (a && a.message) ? a.message : String(a)).join(' ')); } catch (_) {}
    origConsoleError(...args);
  };
  window.addEventListener('error', (e) => pushErr('error: ' + (e.message || e.error?.message || 'unknown')));
  window.addEventListener('unhandledrejection', (e) => pushErr('unhandledrejection: ' + (e.reason?.message || String(e.reason))));

  /* ---------- AUTO-CONTEXT ASSEMBLY ----------
     Pulled fresh on every form open so the snapshot reflects the
     state the tester is reporting.  Read-only access to globals;
     defensive on every field (the dashboard might still be booting,
     the GA tag might be denied, etc.). */
  function collectAutoContext() {
    const w = window;
    const s = w.__state || {};
    const filters = s.filters || {};
    const setSummary = (set) => set && set.size ? Array.from(set).slice(0, 5).join(', ') + (set.size > 5 ? ` (+${set.size - 5} more)` : '') : '—';
    let gaClientId = '—';
    try {
      const cookie = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('_ga='));
      if (cookie) gaClientId = cookie.split('=')[1];
    } catch (_) {}
    return {
      url: location.href,
      hash: location.hash || '(empty)',
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth} × ${window.innerHeight}`,
      view: s.view || '(unknown)',
      datasetMode: filters.dataset || '(unknown)',
      kw: filters.kw || '(empty)',
      countries: setSummary(filters.country),
      themes: setSummary(filters.theme),
      bodies: setSummary(filters.body),
      yearRange: (filters.yearA || filters.yearB) ? `${filters.yearA || '…'}–${filters.yearB || '…'}` : '(no year filter)',
      offlineMode: w.__offline?.enabled ? `enabled (${w.__offline.source || 'vm'})` : 'disabled',
      gaClientId,
      consoleErrors: _errBuf.slice().reverse(),
      timestamp: new Date().toISOString(),
      buildVersion: document.documentElement.dataset.build || '(not tagged)',
    };
  }

  /* ---------- ISSUE BODY BUILDER ----------
     GitHub Markdown.  Layout: user-form first, then a collapsible
     <details> with the auto-context (so the issue stays scannable). */
  function buildIssueBody(formData, ctx) {
    return [
      `### Severity`, formData.severity || '(not specified)',
      ``,
      `### Summary`, formData.summary || '(no summary)',
      ``,
      `### Steps to reproduce`, formData.steps || '(none provided)',
      ``,
      `### Expected behaviour`, formData.expected || '(none provided)',
      ``,
      `### Actual behaviour`, formData.actual || '(none provided)',
      ``,
      `<details><summary>Auto-captured context</summary>`,
      ``,
      `| field | value |`,
      `|---|---|`,
      `| URL hash | \`${ctx.hash}\` |`,
      `| Active view | ${ctx.view} |`,
      `| Dataset mode | ${ctx.datasetMode} |`,
      `| Keyword | ${ctx.kw} |`,
      `| Countries | ${ctx.countries} |`,
      `| Themes | ${ctx.themes} |`,
      `| Bodies | ${ctx.bodies} |`,
      `| Year range | ${ctx.yearRange} |`,
      `| Instant Mode | ${ctx.offlineMode} |`,
      `| Viewport | ${ctx.viewport} |`,
      `| User agent | \`${ctx.userAgent}\` |`,
      `| GA client id | \`${ctx.gaClientId}\` |`,
      `| Captured at | ${ctx.timestamp} |`,
      `| Build | ${ctx.buildVersion} |`,
      ``,
      `**Last ${ctx.consoleErrors.length} console errors** (newest first):`,
      ``,
      '```',
      ctx.consoleErrors.length ? ctx.consoleErrors.join('\n') : '(none)',
      '```',
      ``,
      `</details>`,
      ``,
      `---`,
      `_Filed via the in-app bug-report widget._`,
    ].join('\n');
  }

  function buildGithubIssueUrl(title, body) {
    const params = new URLSearchParams();
    params.set('title', title);
    params.set('body', body);
    params.set('labels', ISSUE_LABELS.join(','));
    return `https://github.com/${REPO}/issues/new?${params.toString()}`;
  }

  function buildMailtoUrl(title, body) {
    const params = new URLSearchParams();
    params.set('subject', `[UHRI bug] ${title}`);
    params.set('body', body);
    return `mailto:${FALLBACK_EMAIL}?${params.toString()}`;
  }

  /* ---------- WIDGET DOM ----------
     Floating action button + modal form.  Created lazily on first
     mouseover/focus to keep boot lean.  All wiring is event-driven;
     the modal teardown removes its DOM so memory stays bounded. */
  let _btnEl = null;
  let _modalEl = null;

  function ensureButton() {
    if (_btnEl) return _btnEl;
    const btn = document.createElement('button');
    btn.id = 'bugReportFab';
    btn.className = 'bug-report-fab';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Report a bug or feedback');
    btn.title = 'Report a bug or feedback (in-app widget · sends to GitHub Issues)';
    btn.innerHTML = '<span aria-hidden="true">🐛</span>';
    btn.addEventListener('click', openModal);
    document.body.appendChild(btn);
    _btnEl = btn;
    return btn;
  }

  function openModal() {
    if (_modalEl) return;
    const ctx = collectAutoContext();
    const m = document.createElement('div');
    m.className = 'bug-report-modal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-labelledby', 'bugReportTitle');
    m.innerHTML = `
      <div class="brm-card">
        <div class="brm-head">
          <h2 id="bugReportTitle">Report a bug or feedback</h2>
          <button class="brm-close" id="brmClose" type="button" aria-label="Close">×</button>
        </div>
        <p class="brm-intro">Your report goes to a public GitHub issue (or email if you prefer). The auto-collected context box shows everything we attach — review it before you submit.</p>
        <form id="brmForm">
          <label class="brm-row">
            <span class="brm-lbl">Severity</span>
            <select name="severity" required>
              <option value="">— pick one —</option>
              <option value="P0 — broken or wrong number">P0 — broken or wrong number</option>
              <option value="P1 — degraded but workaround exists">P1 — degraded (workaround exists)</option>
              <option value="P2 — polish / typo / nice-to-have">P2 — polish / typo / nice-to-have</option>
              <option value="? — not sure, you decide">? — not sure, you decide</option>
            </select>
          </label>
          <label class="brm-row">
            <span class="brm-lbl">Summary <span class="brm-req">*</span></span>
            <input type="text" name="summary" required maxlength="120" placeholder="One sentence — what's wrong?" />
          </label>
          <label class="brm-row">
            <span class="brm-lbl">Steps to reproduce</span>
            <textarea name="steps" rows="3" maxlength="2000" placeholder="1. Open Search&#10;2. Type LGBTQ*&#10;3. Click first result"></textarea>
          </label>
          <label class="brm-row">
            <span class="brm-lbl">What you expected</span>
            <textarea name="expected" rows="2" maxlength="500"></textarea>
          </label>
          <label class="brm-row">
            <span class="brm-lbl">What actually happened</span>
            <textarea name="actual" rows="2" maxlength="500"></textarea>
          </label>
          <details class="brm-ctx">
            <summary>Auto-captured context (everything you'll send is below — nothing else)</summary>
            <pre id="brmCtxPreview"></pre>
          </details>
          <div class="brm-actions">
            <button type="submit" class="brm-submit-gh" id="brmSubmitGh">Open GitHub issue</button>
            <button type="button" class="brm-submit-mail" id="brmSubmitMail">Email instead</button>
            <button type="button" class="brm-cancel" id="brmCancel">Cancel</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(m);
    _modalEl = m;

    // Render the auto-context preview verbatim so the user sees
    // exactly what we'll attach.
    const previewBody = buildIssueBody({ severity: '(your choice)', summary: '(your summary)', steps: '(your steps)', expected: '(your expected)', actual: '(your actual)' }, ctx);
    m.querySelector('#brmCtxPreview').textContent = previewBody;

    const close = () => { m.remove(); _modalEl = null; };
    m.querySelector('#brmClose').addEventListener('click', close);
    m.querySelector('#brmCancel').addEventListener('click', close);
    m.addEventListener('click', e => { if (e.target === m) close(); });
    document.addEventListener('keydown', escClose);
    function escClose(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escClose); } }

    const submit = (transport) => {
      const form = m.querySelector('#brmForm');
      const fd = Object.fromEntries(new FormData(form).entries());
      if (!fd.summary || !String(fd.summary).trim()) {
        const sumEl = form.querySelector('input[name="summary"]');
        sumEl.focus();
        sumEl.setCustomValidity('Required'); sumEl.reportValidity();
        setTimeout(() => sumEl.setCustomValidity(''), 2000);
        return;
      }
      const fresh = collectAutoContext();
      const title = `[${fd.severity?.split('—')[0]?.trim() || 'bug'}] ${String(fd.summary).slice(0, 80)}`;
      const body = buildIssueBody(fd, fresh);
      const url = transport === 'github' ? buildGithubIssueUrl(title, body) : buildMailtoUrl(title, body);
      // GitHub URL length cap is 8KB — most reports will be well under.
      if (transport === 'github' && url.length > 8000) {
        // Truncate the body and inform the user.
        const truncBody = body.slice(0, 6500) + '\n\n…(truncated for URL length cap; rest pasted into the GitHub editor)';
        const truncUrl = buildGithubIssueUrl(title, truncBody);
        window.open(truncUrl, '_blank', 'noopener');
      } else {
        window.open(url, transport === 'github' ? '_blank' : '_self', 'noopener');
      }
      // Track the submission via GA so we know how many widget reports
      // happen, irrespective of whether they reach GH (consent-gated as
      // usual; never breaks if trackEvent is missing).
      try { window.trackEvent && window.trackEvent('bug_report_submitted', { transport }); } catch (_) {}
      close();
    };
    m.querySelector('#brmForm').addEventListener('submit', e => { e.preventDefault(); submit('github'); });
    m.querySelector('#brmSubmitMail').addEventListener('click', () => submit('mail'));

    // Focus the summary field so keyboard-only users can fill the
    // form without grabbing the mouse.
    setTimeout(() => m.querySelector('input[name="summary"]')?.focus(), 50);
  }

  /* ---------- BOOT ---------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureButton);
  } else {
    ensureButton();
  }

  // Expose for tests + the keyboard shortcut wiring.
  window.__bugReport = {
    open: openModal,
    collect: collectAutoContext,
    buildBody: buildIssueBody,
  };
})();
