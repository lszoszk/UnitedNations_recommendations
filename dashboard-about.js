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
      <p>This dashboard is an <strong>independent research tool</strong> that aggregates <strong>275,737 observations and recommendations</strong> issued by UN human-rights mechanisms — Treaty Bodies, Special Procedures and the Universal Periodic Review — in their review of States, covering the twenty-year period <strong>2006 – 2026</strong>. It is built for human-rights advocates, researchers, journalists and civil-society practitioners who need to <em>search, cite and compare</em> the primary material — not a substitute for reading the underlying reports.</p>

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

      <section class="me-sec" id="ab-support">
        <h2>Support this project</h2>
        <p>UHRI+ is free to use. Three things help keep it going — none of them involves money.</p>
        <div class="me-support">
          <div class="me-support-row">
            <p><strong>Cite it</strong> in your work. The full reference is in the next section; keep the version tag so readers can reproduce your counts.</p>
            <div class="me-support-act"><button type="button" data-ab-copy="abCiteText">Copy citation</button><button type="button" data-ab-copy="abBibtex">Copy BibTeX</button></div>
          </div>
          <div class="me-support-row">
            <p><strong>Report a problem</strong> — a mis-classified record, a filter that returns too much, a count that looks wrong. The form fills in the page details for you.</p>
            <div class="me-support-act"><button type="button" data-ab-report>Report a problem</button></div>
          </div>
          <div class="me-support-row">
            <p><strong>Tell us how you use it</strong> — a report, a UPR submission, a course, a thesis; two lines are enough. Examples of real use are what keeps a free tool funded. The email asks whether we may mention yours; nothing is named without a yes.</p>
            <div class="me-support-act"><a href="mailto:l.szoszkiewicz@amu.edu.pl?subject=How%20I%20use%20UHRI%2B&amp;body=What%20I%20used%20UHRI%2B%20for%20%28a%20report%2C%20a%20submission%2C%20a%20course%2C%20a%20thesis...%29%3A%0A%0ALink%2C%20if%20it%20is%20public%3A%0A%0AMay%20we%20mention%20it%20when%20we%20report%20to%20the%20project%27s%20funders%3F%0A%5B%20%5D%20yes%2C%20with%20my%20name%20%20%20%5B%20%5D%20yes%2C%20without%20my%20name%20%20%20%5B%20%5D%20no%0A" data-ab-tell>Write two lines</a></div>
          </div>
        </div>
      </section>

      <section class="me-sec" id="ab-citation">
        <h2>Citation</h2>
        <p>Please cite this dashboard if you use it in research or reporting:</p>
        <pre id="abCiteText" style="background:var(--paper-2);padding:10px 12px;border-left:3px solid var(--accent);font-family:var(--mono);font-size:12px;line-height:1.5;white-space:pre-wrap;margin:0 0 8px">Szoszkiewicz, Ł. (2026). UHRI+ — UN Human Rights Recommendations Dashboard [Computer software and dataset, version v2026.10]. Zenodo. https://doi.org/10.5281/zenodo.21319464</pre>
        <details class="me-bibtex"><summary>BibTeX</summary><pre id="abBibtex">@software{szoszkiewicz_uhri_2026,
  author    = {Szoszkiewicz, Łukasz},
  title     = {{UHRI+} --- {UN} Human Rights Recommendations Dashboard},
  year      = {2026},
  version   = {v2026.10},
  publisher = {Zenodo},
  doi       = {10.5281/zenodo.21319464},
  url       = {https://doi.org/10.5281/zenodo.21319464}
}</pre></details>
        <p style="color:var(--dim);font-size:12px;margin-top:-4px">If you cite the cleaned dataset specifically, please add the version tag (<code>v2026.10</code>) so readers can reproduce your counts — a monthly pipeline refresh increments it. Full data lineage is documented in the <a data-nav="methodology" style="color:var(--dim);border-bottom:1px dotted var(--dim);text-decoration:none;cursor:pointer">Methodology tab</a>.</p>
      </section>

      <section class="me-sec" id="ab-ack">
        <h2>Acknowledgements</h2>
        <p>Supported by <a href="https://reconstitution.eu" target="_blank" rel="noopener"><strong>re:constitution — Exchange and Analysis on Democracy and the Rule of Law in Europe</strong></a>, a joint programme of the <em>Forum Transregionale Studien</em> and <em>Democracy Reporting International</em>, funded by <em>Stiftung Mercator</em>.</p>
        <p style="color:var(--dim);font-size:12px;margin-top:-6px">Research hosted by <strong>Adam Mickiewicz University, Poznań</strong>. Documentation-standards expertise provided by <strong>HURIDOCS</strong>. Upstream data: <strong>OHCHR Universal Human Rights Index</strong>. The supporters listed fund, host and advise the project; they do not speak for it.</p>
        <!-- Personal thanks kept as its own sentence rather than folded into
             the institutional line above: that line is deliberately formal and
             ends with a disclaimer ("they do not speak for it"), which is the
             wrong register for thanking a person. -->
        <p>Particular thanks to <strong>Gabriel Piles Gonzalez</strong> (HURIDOCS), who supervised the fellowship during which this dashboard was built.</p>
      </section>

      <section class="me-sec" id="ab-privacy">
        <h2>Privacy</h2>
        <p>This dashboard uses two tools to understand how it is used. <strong>Google Analytics 4</strong> measures which features get used; it is described first, below. A second, much simpler tool, <strong>GoatCounter</strong>, only counts visits — see <em>Visit counting</em> after the lists. Google Analytics is <strong>consent-gated</strong>: a banner on your first visit lets you accept or reject; the default is "off".  Your choice persists in <code>localStorage</code>.  You can change it any time by clearing site data.</p>
        <p><strong>What is sent</strong> (only after you accept):</p>
        <ul>
          <li>Which tab you opened — <code>overview</code>, <code>country</code>, <code>search</code>, <code>methodology</code>, etc.</li>
          <li>A few discrete actions — dataset toggle <em>cleaned ↔ raw</em>, Upload button clicked, Instant Mode clicked.</li>
          <li><strong>Search metadata</strong> (introduced 2026-04-24): when you run a search we log <em>how</em> you structured the query without logging <em>what</em> you typed.  Specifically, five derived flags per search — word count (1 / 2 / 3-5 / 6+), whether boolean operators (AND/OR/NOT) were used, whether the <code>*</code> wildcard was used, whether phrase-quotes were used, and the result-count bucket (0 / 1-10 / 11-100 / 101-1k / 1k-10k / 10k+).  The raw query string is never written to any analytics call.  This lets us see <em>e.g.</em> "power users run boolean queries 8× more often than casuals" without ever seeing the topic a user researched.</li>
          <li>Anonymised aggregates Google collects by default — approximate country (from truncated IP), device type, referrer.</li>
        </ul>
        <p><strong>What is never sent</strong>: the text of your keyword queries, the specific records you open in the reader, your saved notes or bookmarks, rule names in the Labels workspace, the contents of an uploaded dataset, your IP address in clear.  Ad personalisation and Google signals are disabled by configuration.  If your browser sends the <code>Do Not Track</code> header, Google Analytics is not loaded at all — not even in default-denied mode.</p>
        <p><strong>Visit counting</strong> (GoatCounter, added 2026-10-06). The landing page, this dashboard and the AI-connector guide are counted by <a href="https://www.goatcounter.com" target="_blank" rel="noopener">GoatCounter</a>, an open-source, cookieless counter. Unlike Google Analytics it does not wait for the banner above, because it sets no cookie, stores nothing on your device, and keeps no IP address and no tracker ID (see its <a href="https://www.goatcounter.com/privacy" target="_blank" rel="noopener">privacy policy</a>). Whether that is enough to need no consent is a legal judgement, not a technical fact — GoatCounter itself says only that notices are "probably not" required — so it is switched off whenever your browser sends <code>Do Not Track</code>, exactly as Google Analytics is.</p>
        <ul>
          <li><strong>Sent</strong>: only the name of the page or tab — <code>dashboard/country</code>, never which country; <code>dashboard/search</code>, never what you searched — and the site you arrived from. The dashboard's address (which can hold your query, filters and the record you are reading) is never read or sent.</li>
          <li><strong>Stored</strong>: those page names and referrers; browser and operating-system <em>name</em>; screen width; country (and region, for the US, Russia and China only); and a short-lived anonymous session marker (up to 8 hours) so a reload is not counted as a new visitor. Not stored: individual pageviews, IP addresses, language, any identifier that persists on your device. Everything it holds is deleted after 365 days.</li>
          <li><strong>Where</strong>: GoatCounter's hosted service, on servers in Finland and Germany. Not loaded at all on a local or self-hosted copy.</li>
        </ul>
        <p><strong>On our server</strong> (the university VM that answers the searches). Its web log (your address, your browser and each request, including what you searched) is kept for 14 days for security and troubleshooting, then deleted. From it we keep only daily totals per tool: how many people used it, from which countries (looked up on our server; IP Geolocation by <a href="https://db-ip.com" target="_blank" rel="noopener">DB-IP</a>), and how many requests came from AI assistants and other programs. Never an address, a browser or a search.</p>
        <p><strong>&ldquo;Who are you?&rdquo;</strong> Once, after you have used the site for a while, a small box asks whether you are a lawyer, researcher, student, NGO, court or public institution. Answering is optional and anonymous: a click sends only that category to GoatCounter, and this browser remembers that it was answered or closed (<code>who-v1:uhri-plus</code>) so it is not asked again.</p>
        <p style="color:var(--dim);font-size:12px;margin-top:-4px">Why we track at all: a research tool nobody can tell is being used risks losing its supporter funding and never learning which pieces actually land.  The measurement ID is <code>G-F3XBX45HQC</code>; the policy above is enforced by the code in <code>dashboard-analytics.js</code> which you can read in the public repository.</p>
      </section>

      <section class="me-sec" id="ab-mcp">
        <h2>Query it from your AI assistant (MCP)</h2>
        <p>UHRI+ is also a <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener">Model Context Protocol</a> server. Add <code>https://150.254.115.204/unhrdb-mcp-rpc/mcp</code> as a custom connector in Claude, ChatGPT or any MCP-capable client and the assistant can search the same recommendations this dashboard shows and quote them <strong>verbatim with their UN document symbol</strong> — instead of reconstructing them from memory. Five read-only tools; no account, no key. A one-page guide you can paste into the assistant itself is at <a href="./ai.html" target="_blank" rel="noopener">ai.html</a>; source at <a href="https://github.com/lszoszk/mcp-unhrdb" target="_blank" rel="noopener">github.com/lszoszk/mcp-unhrdb</a>.</p>
      </section>

      <section class="me-sec" id="ab-agents">
        <h2>For AI agents + crawlers</h2>
        <p>If you're an AI agent (ChatGPT, Claude, Perplexity, etc.) reading on behalf of a researcher, the curated pointer-list is at <a href="./llms.txt" target="_blank" rel="noopener">llms.txt</a> — Markdown site summary with deep links and a machine-readable description of our search semantics.  Sitemap at <a href="./sitemap.xml" target="_blank" rel="noopener">sitemap.xml</a>, robots policy at <a href="./robots.txt" target="_blank" rel="noopener">robots.txt</a>.  Both pages carry Open Graph + Twitter Card + JSON-LD <code>WebApplication</code> / <code>Dataset</code> schemas so social unfurlers and Schema.org-aware agents have the clean summary without scraping the SPA.</p>
        <p style="color:var(--dim);font-size:12px;margin-top:-4px">Kindly: the data API lives on a single university VM.  Bulk-corpus needs should go to <a href="https://uhri.ohchr.org" target="_blank" rel="noopener">OHCHR UHRI</a> directly.  For interactive queries please throttle to a few requests per second — well-behaved agents are welcome.</p>
      </section>

      <section class="me-sec" id="ab-feedback">
        <h2>Feedback &amp; contact</h2>
        <p>Spotted a mis-classified record, a cleaning regression, a country that should have a hex, or a missing feature? Email <a href="mailto:l.szoszkiewicz@amu.edu.pl">l.szoszkiewicz@amu.edu.pl</a> or open an issue on the <a href="https://github.com/lszoszk/UnitedNations_recommendations" target="_blank" rel="noopener">GitHub repository</a>. Bug reports with a URL (copy the address bar — filter state is encoded in the hash) plus a one-line description of what you expected are the fastest to triage.</p>
      </section>
    </div>`;
  // Support section: copy the citation / BibTeX, open the bug-report form.
  root.querySelectorAll('[data-ab-copy]').forEach(b => b.addEventListener('click', () => {
    const src = document.getElementById(b.dataset.abCopy);
    if (!src) return;
    const write = navigator.clipboard?.writeText ? navigator.clipboard.writeText(src.textContent.trim()) : Promise.reject(new Error('no clipboard'));
    write.then(() => toast(b.textContent.replace('Copy ', '') + ' copied', false, 1800),
               () => toast('Could not copy — select the text in the Citation section instead', true));
  }));
  root.querySelector('[data-ab-report]')?.addEventListener('click', () => {
    if (window.__bugReport?.open) window.__bugReport.open();
    else location.href = 'mailto:l.szoszkiewicz@amu.edu.pl?subject=' + encodeURIComponent('UHRI+ problem report');
  });
  // data-nav links inside the page (e.g. "Methodology tab") are handled
  // by the global delegated click handler in dashboard.html, so we don't
  // wire per-link listeners here.
}
