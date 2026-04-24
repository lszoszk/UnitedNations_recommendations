/* UHRI Dashboard — About tab
 *
 * Extracted from Methodology on 2026-04-23 as part of the "split by
 * audience" IA pass. Methodology stays research-oriented (data lineage,
 * cleaning pipeline, search semantics, glossary); About carries the
 * project-identity / citation / acknowledgement / feedback content
 * that isn't methodology but that users will eventually ask about.
 *
 * Reuses the `.me` and `.me-sec` classes from the Methodology tab so
 * typography, list styling, and the definition-list grid look
 * consistent without a second stylesheet. */

function renderAbout() {
  const root = $('#view-about');
  if (!root) return;
  root.innerHTML = `
    <div class="me">
      <h1>About <em style="color:var(--accent)">·</em> this project</h1>
      <p>This dashboard is an <strong>independent research tool</strong> that aggregates <strong>267,537 observations and recommendations</strong> addressed to UN Member States by Treaty Bodies, Special Procedures and the Universal Periodic Review, covering the twenty-year period <strong>2006 – 2026</strong>. It is built for human-rights advocates, researchers, journalists and civil-society practitioners who need to <em>search, cite and compare</em> the primary material — not a substitute for reading the underlying reports.</p>

      <section class="me-sec" id="ab-independence">
        <h2>Independence</h2>
        <p>This is a <strong>research project, not an OHCHR product</strong>. It republishes data from the OHCHR Universal Human Rights Index (<a href="https://uhri.ohchr.org/" target="_blank" rel="noopener">uhri.ohchr.org</a>) under the terms made public there. Data use does not imply endorsement by OHCHR, the United Nations, or any of the Member States involved in the underlying records. The views, cleaning decisions and interface choices are the author's alone.</p>
        <p style="color:var(--dim);font-size:12px;margin-top:-6px"><strong>Corpus validated against UHRI.</strong> On 2026-04-24 we ran a 20-query test battery against both this dashboard and the native OHCHR search. Literal-token queries agreed within 0.2 %, confirming both surfaces look at the same ~267,000-record corpus; observed divergences on semantic queries (plurals, stemmed forms, boolean operators) are explained by our richer FTS5 configuration. Full report: <a href="./docs/uhri-comparison.md" target="_blank" rel="noopener" style="color:var(--dim);border-bottom:1px dotted var(--dim);text-decoration:none">docs/uhri-comparison.md</a>.</p>
      </section>

      <section class="me-sec" id="ab-what-for">
        <h2>What it's for — and what it isn't</h2>
        <p>Good fit: trend-spotting across bodies and decades, building literature-review scaffolding, retrieving citable primary text, pinning 20 recommendations into a compare view, teaching human-rights-mechanism coverage to students, auditing one country's full record.</p>
        <p style="color:var(--dim);font-size:12px;margin-top:-6px">Not a scoring instrument. Record volume per country reflects <em>review frequency and substantive scope</em>, not human-rights performance. Counts per theme may double-count where a recommendation addresses multiple issues. Use the dashboard to find trends and primary sources — not to rank states.</p>
      </section>

      <section class="me-sec" id="ab-citation">
        <h2>Citation</h2>
        <p>Please cite this dashboard if you use it in research or reporting:</p>
        <pre style="background:var(--paper-2);padding:10px 12px;border-left:3px solid var(--accent);font-family:var(--mono);font-size:12px;line-height:1.5;white-space:pre-wrap;margin:0 0 8px">Szoszkiewicz, L. (2026). UN Human Rights Analytics Dashboard — Cleaned UHRI Dataset v2026.04. Independent project built on OHCHR UHRI data. https://lszoszk.github.io/</pre>
        <p style="color:var(--dim);font-size:12px;margin-top:-4px">If you cite the cleaned dataset specifically, please add the version tag (<code>v2026.04</code>) so readers can reproduce your counts — a monthly pipeline refresh increments it. Full data lineage is documented in the <a data-nav="methodology" style="color:var(--dim);border-bottom:1px dotted var(--dim);text-decoration:none;cursor:pointer">Methodology tab</a>.</p>
      </section>

      <section class="me-sec" id="ab-ack">
        <h2>Acknowledgements</h2>
        <p>Supported by <a href="https://reconstitution.eu" target="_blank" rel="noopener"><strong>re:constitution — Exchange and Analysis on Democracy and the Rule of Law in Europe</strong></a>, a joint programme of the <em>Forum Transregionale Studien</em> and <em>Democracy Reporting International</em>, funded by <em>Stiftung Mercator</em>.</p>
        <p style="color:var(--dim);font-size:12px;margin-top:-6px">Research hosted by <strong>Adam Mickiewicz University, Poznań</strong>. Documentation-standards expertise provided by <strong>HURIDOCS</strong>. Upstream data: <strong>OHCHR Universal Human Rights Index</strong>. The supporters listed fund, host and advise the project; they do not speak for it.</p>
      </section>

      <section class="me-sec" id="ab-privacy">
        <h2>Privacy</h2>
        <p>This dashboard uses <strong>Google Analytics 4</strong> to understand which features get used — nothing more.  It is <strong>consent-gated</strong>: a banner on your first visit lets you accept or reject; the default is "off".  Your choice persists in <code>localStorage</code>.  You can change it any time by clearing site data.</p>
        <p><strong>What is sent</strong> (only after you accept): which tab you opened (<code>overview</code>, <code>country</code>, <code>search</code>, etc.), a few discrete actions (dataset toggle cleaned↔raw, upload button clicked, Instant Mode clicked), and the anonymised aggregates Google collects by default (approximate country from truncated IP, device type, referrer).</p>
        <p><strong>What is never sent</strong>: the text of your keyword queries, the specific records you open in the reader, your saved notes or bookmarks, rule names in the Labels workspace, the contents of an uploaded dataset, your IP address in clear.  Ad personalisation and Google signals are disabled by configuration.  If your browser sends the <code>Do Not Track</code> header, Google Analytics is not loaded at all — not even in default-denied mode.</p>
        <p style="color:var(--dim);font-size:12px;margin-top:-4px">Why we track at all: a research tool nobody can tell is being used risks losing its supporter funding and never learning which pieces actually land.  The measurement ID is <code>G-F3XBX45HQC</code>; the policy above is enforced by the code in <code>dashboard-analytics.js</code> which you can read in the public repository.</p>
      </section>

      <section class="me-sec" id="ab-feedback">
        <h2>Feedback &amp; contact</h2>
        <p>Spotted a mis-classified record, a cleaning regression, a country that should have a hex, or a missing feature? Email <a href="mailto:l.szoszkiewicz@amu.edu.pl">l.szoszkiewicz@amu.edu.pl</a> or open an issue on the <a href="https://github.com/lszoszk/UnitedNations_recommendations" target="_blank" rel="noopener">GitHub repository</a>. Bug reports with a URL (copy the address bar — filter state is encoded in the hash) plus a one-line description of what you expected are the fastest to triage.</p>
      </section>
    </div>`;
  // data-nav links inside the page (e.g. "Methodology tab") are handled
  // by the global delegated click handler in dashboard.html, so we don't
  // wire per-link listeners here.
}
