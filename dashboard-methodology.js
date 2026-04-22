/* UHRI Dashboard — Methodology tab
 *
 * Extracted from dashboard.html as a low-risk seam. Owns the static
 * methodology view plus the live freshness-status card rendered inside it.
 */

/* Fetch + render the dataset freshness card on the Methodology tab.
   Reads from /uhri-api/refresh_status.json (nginx-static), plus
   /api/data/health for the upstream modified_at timestamp. */
async function renderFreshnessCard() {
  const card = document.getElementById('freshness-card');
  if (!card) return;
  try {
    const [status, health] = await Promise.all([
      fetch(API_BASE + '/refresh_status.json', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(API_BASE + '/api/data/health', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    const stages = (status && status.stages) || {};
    const fail = Number((status && status.fail_count) || 0);
    const finished = status && status.finished_at;
    const dsMod = health && health.modified_at;

    // Next scheduled — 1st of next month at 03:00 UTC
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(),
                                   now.getUTCMonth() + 1, 1, 3, 0, 0));
    const nextStr = next.toISOString().slice(0, 10);

    let kind = 'is-ok', banner = '✓ healthy';
    if (!finished) { kind = 'is-warn'; banner = '◷ no refresh yet'; }
    else if (fail > 0) { kind = 'is-fail'; banner = `✗ ${fail} stage failure${fail > 1 ? 's' : ''}`; }

    const fmtDays = (isoDate) => {
      if (!isoDate) return '—';
      const d = Math.round((Date.now() - new Date(isoDate).getTime()) / 86400000);
      return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`;
    };

    const stageOrder = [
      ['api-sync', 'OHCHR API pull'],
      ['stage1-3', 'Pipeline Stage 1+2+3'],
      ['publish-cleaned', 'Publish cleaned JSONL'],
      ['db-rebuild', 'SQLite rebuild v2'],
      ['fts-rebuild', 'FTS5 index rebuild'],
      ['precompute', 'Precompute warm'],
    ];

    const stageRows = stageOrder
      .map(([k, label]) => {
        const st = stages[k];
        if (!st) return '';
        const ok = st.rc === 0;
        return `<div class="stage">
          <span><span class="marker ${ok ? 'ok' : 'fail'}">${ok ? '✓' : '✗'}</span> ${sanitize(label)}</span>
          <span>${st.seconds}s</span>
        </div>`;
      })
      .filter(Boolean)
      .join('');

    card.className = 'freshness ' + kind;
    card.innerHTML = `
      <h3>Monthly refresh status · <span style="color:var(--ink)">${banner}</span></h3>
      <div class="row">
        <span class="lbl">Last refresh</span>
        <span class="val">${finished ? new Date(finished).toISOString().slice(0, 16).replace('T', ' ') + ' UTC · ' + fmtDays(finished) : 'never run'}</span>
      </div>
      <div class="row">
        <span class="lbl">Dataset file modified</span>
        <span class="val">${dsMod ? new Date(dsMod).toISOString().slice(0, 10) + ' · ' + fmtDays(dsMod) : 'unknown'}</span>
      </div>
      <div class="row">
        <span class="lbl">Next scheduled</span>
        <span class="val">${nextStr} at 03:00 UTC</span>
      </div>
      ${stageRows ? `<div class="stage-list">${stageRows}</div>` : ''}
      ${status && status.note ? `<div class="stage-list" style="color:var(--dim);font-style:italic">${sanitize(status.note)}</div>` : ''}
    `;
  } catch (err) {
    card.className = 'freshness is-warn';
    card.innerHTML = `<h3>Monthly refresh status</h3>
      <div class="row"><span class="lbl">Status endpoint unreachable</span><span class="val">${sanitize(String(err))}</span></div>`;
  }
}

const _METHODOLOGY_TOC = [
  ['me-data-source', 'Data source'],
  ['me-cleanup', 'Cleanup pipeline'],
  ['me-impact', 'Impact on results'],
  ['me-country-coverage', 'Country coverage'],
  ['me-search-semantics', 'Search semantics'],
  ['me-freshness', 'Dataset freshness'],
  ['me-regions', 'Regional classification'],
  ['me-glossary', 'Glossary'],
  ['me-labels', 'Labels workspace'],
];

function _wireMethodologyToc(root) {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  root.querySelectorAll('[data-meto-jump]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.metoJump;
      const target = id ? root.querySelector('#' + id) : null;
      if (!target) return;
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  });
}

function renderMethodology() {
  const root = $('#view-methodology');
  root.innerHTML = `
    <div class="me">
      <h1>Methodology <em style="color:var(--accent)">·</em> notes & caveats</h1>
      <p>This dashboard aggregates <strong>267,537 observations and recommendations</strong> addressed to UN Member States by Treaty Bodies, Special Procedures and the Universal Periodic Review, covering the twenty-year period 2006 – 2026. The raw OHCHR export carries 267,548 records; Stage 5 of our pipeline drops 11 of them as content-free artefacts (see below). Across the remaining 267,537, Stages 1–4 made at least one non-whitespace edit to <strong>~56,000 records (≈21 % of the dataset)</strong>; the rest passed through unchanged.</p>
      <p style="border-left:3px solid var(--accent);padding:10px 14px;background:var(--paper-2);color:var(--ink);font-size:13px;margin:-4px 0 18px"><strong>Monthly refresh.</strong> The full pipeline — download, clean, re-tag, re-index — runs automatically every month against the latest OHCHR UHRI export. You're always looking at a dataset that's no more than ~30 days behind upstream, with the exact refresh date shown in the <em>Dataset freshness</em> card below.</p>

      <nav class="me-toc" aria-label="Methodology contents">
        <div class="me-toc-title">On this page</div>
        <div class="me-toc-sub">Best fit for this amount of text: compact jump links inside the article, instead of a heavy sidebar.</div>
        <div class="me-toc-list">
          ${_METHODOLOGY_TOC.map(([id, label]) => `<button type="button" data-meto-jump="${id}">${label}</button>`).join('')}
        </div>
      </nav>

      <section class="me-sec" id="me-data-source">
        <h2>Data source</h2>
        <p>All records originate from the OHCHR <strong>Universal Human Rights Index</strong> (<a href="https://uhri.ohchr.org/" target="_blank" rel="noopener">uhri.ohchr.org</a>). By default this dashboard shows the cleaned dataset produced by our transparent <strong>five-stage content-cleaning pipeline</strong>. You can still switch to the <strong>raw upstream text</strong> using the <code>DATA · cleaned ▾</code> pill in the header; country, body and theme metadata remain pipeline-canonical in either mode.</p>
      </section>

      <section class="me-sec" id="me-cleanup">
        <h2>Cleanup approach — deterministic first</h2>
        <p>Across the dataset, the pipeline touched ~56,000 records in one or more of these five stages. Generative AI was used sparingly, only where rules couldn't recover the content:</p>
        <ul>
          <li><strong>Stage 1 — rule-based OCR & HTML cleanup.</strong> ~700 lines of Python, no AI. Cleans <strong>99.75 %</strong> of records — stripping stray HTML tags, repairing mid-word OCR splits (e.g. <code>"develop- ment"</code> → <code>"development"</code>), collapsing runs of whitespace, reconstructing quoted citations that the OCR had broken across lines.</li>
          <li><strong>Stage 2 — LLM-assisted residue review.</strong> Only <strong>412 records (0.15 %)</strong> with hard OCR corruption go through a bounded Claude Sonnet prompt with structural validation rails. (Earlier write-ups quoted ~712; that figure was from an older pipeline build before the Stage-1 rule set matured.)</li>
          <li><strong>Stage 3 — deterministic AnnotationType normalisation.</strong> ~3,294 records had missing or UUID-coded <code>type</code> fields. A multilingual regex classifier (EN/ES/FR/PT verbs + UPR imperatives) correctly re-labels <strong>2,603 of them (79 %)</strong>. Every change is audit-tagged in an <code>AnnotationTypeSource</code> field. No AI involved.</li>
          <li><strong>Stage 4 — country backfill from UN document symbol.</strong> <strong>104 records</strong> (0.04 %) arrived with no country metadata despite a country code being literally present in their symbol (<code>CEDAW/C/<strong>ALB</strong>/CO/4</code>, <code>CRPD/C/<strong>AZE</strong>/CO/1</code>). A single regex + data-derived ISO-alpha-3 lookup rescues <strong>all 104</strong> (mostly Azerbaijan CRPD-2014 + Albania CEDAW-2016 batches); a handful of thematic SR reports remain legitimately country-agnostic. Appends-only, tagged <code>source: inferred:symbol</code> in <code>record_country</code>.</li>
          <li><strong>Stage 5 — artefact drop.</strong> <strong>11 rows</strong> from the raw export (267,548 → 267,537) are removed because they carry no citable content after Stages 1–4. Three categories:
            <ul style="margin:6px 0 0">
              <li><em>Empty-text placeholders</em> — <code>Text</code> blank after HTML strip + whitespace collapse; section-header stubs the OHCHR exporter emits as paragraph separators.</li>
              <li><em>Duplicate annotation IDs</em> — records sharing an <code>AnnotationId</code> with another row (upstream re-export collision). We keep the one with richer metadata, drop the stub.</li>
              <li><em>HTML-only scaffolding</em> — rows whose entire text was table/figure markup that survived to the export; empty after Stage 1 cleanup.</li>
            </ul>
            <div style="color:var(--dim);font-size:12px;margin-top:6px">None of the 11 dropped rows carry a Treaty Body / SP / UPR recommendation or observation; they were always unusable upstream. Full list of dropped <code>AnnotationId</code>s available on request.</div>
          </li>
        </ul>
      </section>

      <section class="me-sec" id="me-impact">
        <h2>Does the cleaning change your results?</h2>
        <p>For large-trend analysis — top themes, country counts, 2006–2026 timelines, cross-region comparisons — cleaned and upstream datasets are functionally identical. The cleaning matters mainly in narrower slices where Stage 3 and Stage 5 concentrate: UPR second-cycle longitudinal work, the 2026 CRC/CEDAW/CMW batch, and Latin-American Spanish-language Special-Procedure visits.</p>
      </section>

      <section class="me-sec" id="me-country-coverage">
        <h2>Country coverage</h2>
        <p>The hex map shows <strong>198 state parties</strong> plus a <strong>European Union</strong> tile. The 198 are drawn from UN M49 member states + observer states that appear in UHRI records; every one has at least one Treaty Body / UPR / Special Procedure recommendation or observation attached. <strong>Kosovo*</strong> is included as an <strong>XKX</strong> hex in southern Europe — it sits outside UN M49 because of its contested status (serving-state-of-UN rules only), but the UHRI export carries 75 records against it and routing those into a visible hex makes the coverage audit-friendly. We retain the OHCHR asterisk in the source data to flag observer status.</p>
        <p style="color:var(--dim);font-size:12px;margin-top:-6px">The <strong>European Union</strong> tile (dashed border, top of the Europe cluster) is shown because the UHRI export carries 233 records against it as a regional bloc — Special Procedures country visits, joint communications with the EU, thematic dialogues. The bloc is <strong>not</strong> counted toward the 198 sovereign-states total, and the hex is visually distinguished (dashed stroke) so it doesn't read as a state. <strong>Bermuda</strong> was removed from the layout in the 2026-04-22 revision — it's a UK Overseas Territory, not a UN Member State, so OHCHR doesn't issue recommendations on it and leaving it as a permanently-grey hex was more misleading than useful.</p>
      </section>

      <section class="me-sec" id="me-search-semantics">
        <h2>Search semantics</h2>
        <p>The keyword box supports a small query language on top of SQLite FTS5 (Porter stemmer, unicode61, diacritics removed). Plain words imply <code>AND</code>; wrap them in quotes for exact phrases; the uppercase operators <code>AND</code> / <code>OR</code> / <code>NOT</code> and parentheses <code>( )</code> work as expected. Stemming collapses common inflections automatically (<code>torture</code> ≡ <code>tortured</code> ≡ <code>torturing</code>).</p>
        <p><strong>Irregular-plural auto-expansion.</strong> Eleven curated singular↔plural pairs where the Porter stemmer fails to collapse the two forms are expanded in place by the query rewriter. Typing <code>woman</code> rewrites to <code>("woman"* OR "women"*)</code> before FTS5 MATCH; a small chip under the keyword input tells you which pairs fired. Coverage (all bidirectional):</p>
        <ul style="margin-top:-8px">
          <li><strong>Suppletive English:</strong> man/men, woman/women, person/people, child/children</li>
          <li><strong>Latin/Greek plurals:</strong> medium/media, basis/bases, criterion/criteria, phenomenon/phenomena, crisis/crises, index/indices, analysis/analyses</li>
        </ul>
        <p style="color:var(--dim);font-size:12px;margin-top:-4px">Rejected for asymmetric impact: <em>detain/detention</em> (verb vs -ion noun are legally distinct). To disable expansion for a single query, wrap the term in quotes — <code>"woman"</code> matches only the exact token. Phrases (<code>"climate change"</code>) are never expanded.</p>
      </section>

      <section class="me-sec" id="me-freshness">
        <h2>Dataset freshness</h2>
        <div class="freshness" id="freshness-card">
          <h3>Monthly refresh status</h3>
          <div class="row"><span class="lbl">Loading…</span><span class="val">—</span></div>
        </div>
      </section>

      <section class="me-sec" id="me-architecture">
        <h2>Architecture</h2>
        <p>Three-column analyst layout: rail filters → main content → selected-record drawer. All analytics computed server-side on demand (<code>/api/data/facets</code>, <code>/api/data/analytics</code>, <code>/api/data/records</code>, <code>/api/data/map</code>) with a materialised-view cache on the VM for single-entity profile queries.</p>
      </section>

      <section class="me-sec" id="me-regions">
        <h2>Regional classification</h2>
        <p>Top-level regions on the hex map follow <strong>UN M49</strong> — <a href="https://unstats.un.org/unsd/methodology/m49/" target="_blank" rel="noopener">Standard Country or Area Codes for Statistical Use</a>. This gives you five regions — <em>Africa · Americas · Asia · Europe · Oceania</em> — and 22 sub-regions nested underneath (<em>Northern Africa</em>, <em>Western Asia</em>, <em>Caribbean</em>, <em>Melanesia</em>, and so on). The sub-region shows on the hex tooltip; tooltip over the ⓘ on the region row above the map documents the choice in-place.</p>
        <p style="color:var(--dim);font-size:12px;margin-top:-6px">Two caveats worth flagging:</p>
        <ul style="margin-top:0">
          <li><strong>M49 is statistical, not political.</strong> It classifies geography and is deliberately apolitical — it doesn't speak to sovereignty disputes, recognition, or membership in UN bodies.</li>
          <li><strong>The UN Human Rights machinery runs on different groupings.</strong> Treaty Body elections and Human Rights Council membership use <em>regional electoral groups</em> — African (54), Asia-Pacific (54), Eastern European (23), Latin American & Caribbean / GRULAC (33), Western European and Others / WEOG (29). Those cut across M49 lines (e.g. Australia, Canada, New Zealand, USA are WEOG despite sitting in Oceania/Americas geographically). This dashboard doesn't currently expose electoral groups as a filter — they're on the roadmap.</li>
        </ul>
      </section>

      <section class="me-sec" id="me-glossary">
        <h2>Glossary</h2>
        <dl class="grid-def">
          <dt>Recommending body</dt><dd>The UN mechanism that issued the paragraph (UPR, Treaty Body, or Special Procedure).</dd>
          <dt>Theme</dt><dd>Primary thematic tag assigned by OHCHR — records typically carry more than one.</dd>
          <dt>Concerned groups</dt><dd>Populations specifically addressed (children, women, persons with disabilities, migrants, etc.).</dd>
          <dt>SDG</dt><dd>Mapping to the corresponding Sustainable Development Goal (OHCHR crosswalk). Includes sub-targets (e.g. SDG 16.3).</dd>
          <dt>Type</dt><dd><strong>Recommendation</strong> (formal call-to-action addressed to the State), <strong>Concern/Observation</strong> (noted concern, welcomed measure, positive aspect), or <strong>Other</strong> (unresolved after Stage 3).</dd>
          <dt>AnnotationTypeSource</dt><dd>Provenance tag — <code>upstream</code> when the original UHRI label is used, <code>inferred:*</code> when Stage 3 applied a rule, <code>unresolved</code> when classification failed.</dd>
        </dl>
      </section>

      <section class="me-sec" id="me-caveats">
        <h2>Caveats</h2>
        <p>Volume differences across countries reflect review frequency and substantive coverage; they are not a direct measure of human-rights performance. Counts per theme may double-count where a recommendation addresses multiple issues. Use this dashboard to identify trends and retrieve primary sources — not as a scoring instrument.</p>
      </section>

      <section class="me-sec" id="me-citation">
        <h2>Citation</h2>
        <p>Szoszkiewicz, L. (2026). <em>UN Human Rights Analytics Dashboard — Cleaned UHRI Dataset v2026.04</em>. Independent project built on OHCHR UHRI data.</p>
      </section>

      <section class="me-sec" id="me-acknowledgements">
        <h2>Acknowledgements</h2>
        <p>Supported by <a href="https://reconstitution.eu" target="_blank" rel="noopener"><strong>re:constitution — Exchange and Analysis on Democracy and the Rule of Law in Europe</strong></a>, a joint programme of the <em>Forum Transregionale Studien</em> and <em>Democracy Reporting International</em>, funded by <em>Stiftung Mercator</em>.</p>
        <p style="color:var(--dim);font-size:12px;margin-top:-6px">Research hosted by Adam Mickiewicz University, Poznań. Documentation expertise provided by HURIDOCS. Data source: OHCHR Universal Human Rights Index — this project is independent of OHCHR and the United Nations; data use does not imply endorsement.</p>
      </section>

      <section class="me-sec" id="me-labels">
        <h2>Labels workspace <em style="color:#b88400">· β</em></h2>
        <p>Tab 10 (<strong>Labels</strong>) lets you define your own label taxonomy as explicit <strong>boolean FTS5 queries</strong>. Each label is one query that runs server-side against the same full-text index as the Search tab — <em>deterministic, fully explainable in a methodology section, no 300 MB download required</em>. A TF-IDF term-suggestion helper accelerates query construction by proposing candidate terms from a small sample of tagged examples. The workspace is flagged <strong>β</strong> while we collect feedback on the rule model and term-suggester — core behaviour is stable, edge-cases (CSV export of very broad rules, set-migration corner cases) may still surprise.</p>
        <ul>
          <li><strong>Rule model.</strong> Each rule has three term lists: <em>MUST</em> (OR-ed inside, required), <em>AND</em> (OR-ed inside, required when non-empty), <em>NOT</em> (OR-ed inside, excluded). They compile to FTS5 as <code>(must-1 OR must-2) AND (also-1 OR also-2) NOT (not-1)</code>. Stemming, irregular-plural expansion, quoted phrases and <code>*</code> wildcards work exactly as in the Search tab. A per-rule "raw FTS5" escape hatch is available for power users.</li>
          <li><strong>Evaluation.</strong> Every rule count is a single API call to <code>/api/data/records</code> with the compiled query — same code path as the Search tab, same performance (100–300 ms typical). Counts respect the current rail filter, so a <em>Judicial independence</em> rule on a Country=Poland rail counts Poland records only.</li>
          <li><strong>⚡ Suggest-terms helper.</strong> Per-rule modal: tag 10–20 records as <em>positive / negative / skip</em>, the browser runs TF-IDF centroid comparison on that small sample (≤50 ms), returns two ranked term lists. Click chips to add picked terms to MUST / AND / NOT. Tagged examples are persisted with the rule so the modal resumes where you left off. No Instant Mode required — the sample comes from the current rail filter (API page 1) or from <code>offline.data</code> if Instant Mode happens to be on.</li>
          <li><strong>Exports.</strong> <em>JSON</em> — full rule set, re-importable, shareable. <em>CSV</em> — records × rules assignment matrix (one row per record, one 1/0 column per rule plus a joined <code>labels</code> string). <em>Coverage</em> — union count (records matching ≥1 rule) and overlap count (records matching ≥2 rules). CSV / Coverage require one API round-trip per rule plus pagination of matching IDs; typically a few seconds for a 5-rule set with median match sizes.</li>
          <li><strong>Suitable for.</strong> Literature-review scaffolding with a defensible methodology annex, hypothesis probing ("how many UHRI records mention X AND Y but NOT Z?"), team-shared coding schemas that any collaborator with the UHRI can re-apply by pasting the compiled FTS5 string, reproducible research outputs.</li>
          <li><strong>Not suitable for.</strong> Fuzzy semantic matching where the target phrase rewrites heavily ("independent judiciary" surfaced as "courts free from political pressure"). Rules match the literal terms you declare — widen them with synonyms via OR, or use the Suggest-terms helper to discover vocabulary you'd missed.</li>
          <li><strong>Persistence.</strong> Rule sets live in your browser's <code>localStorage</code> per origin — clear cache and they are gone. Use <strong>⬇ JSON</strong> for durable copies and team sharing. Saved sets from the earlier TF-IDF workspace can be converted into rule stubs on first open (your tagged examples seed the Suggest-terms modal so you can bootstrap term lists with one click).</li>
        </ul>
      </section>
    </div>`;
  _wireMethodologyToc(root);
  renderFreshnessCard().catch(err => console.warn('[freshness] render failed:', err));
}
