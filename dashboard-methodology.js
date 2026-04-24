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

/* Trimmed on 2026-04-23: Citation / Acknowledgements / Caveats moved to
   the new About tab (project-identity content — not methodology).
   Labels workspace moved to the Labels tab itself (collapsible "How
   rules work" panel). Architecture section cut entirely — it was a
   dev-oriented 40-word paragraph nobody read; the module map lives
   in ARCHITECTURE.md where contributors look for it. Country coverage
   + Regional classification merged into one "Coverage" section since
   they describe two facets of the same topic (geography).
   2026-04-24: added "UHRI comparison" section after Search semantics
   — anticipates the "why do my counts differ?" question researchers
   ask when they cross-check against uhri.ohchr.org. */
const _METHODOLOGY_TOC = [
  ['me-data-source', 'Data source'],
  ['me-cleanup', 'Cleanup pipeline'],
  ['me-impact', 'Impact on results'],
  ['me-coverage', 'Country & region coverage'],
  ['me-search-semantics', 'Search semantics'],
  ['me-uhri-comparison', 'Comparison with OHCHR UHRI'],
  ['me-freshness', 'Dataset freshness'],
  ['me-glossary', 'Glossary'],
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

      <section class="me-sec" id="me-coverage">
        <h2>Country &amp; region coverage</h2>
        <p>The hex map shows <strong>198 state parties</strong> plus a <strong>European Union</strong> tile. The 198 are UN M49 member states + observer states that appear in UHRI records; every one has at least one Treaty Body / UPR / Special Procedure recommendation or observation attached. <strong>Kosovo*</strong> is included as an <strong>XKX</strong> hex in southern Europe — it sits outside UN M49 because of its contested status, but the UHRI export carries 75 records against it and routing those into a visible hex makes the coverage audit-friendly; the OHCHR asterisk is retained in the source data to flag observer status. The <strong>European Union</strong> hex (dashed border, top of the Europe cluster) exists because the UHRI export carries 233 records against it as a regional bloc — Special Procedures country visits, joint communications, thematic dialogues. The bloc is <strong>not</strong> counted toward the 198 sovereign-states total. <strong>Bermuda</strong> was dropped from the layout in the 2026-04-22 revision — it's a UK Overseas Territory, not a UN Member State, so OHCHR doesn't issue recommendations on it.</p>
        <p>Top-level regions on the hex map follow <strong>UN M49</strong> — <a href="https://unstats.un.org/unsd/methodology/m49/" target="_blank" rel="noopener">Standard Country or Area Codes for Statistical Use</a>. Five regions (<em>Africa · Americas · Asia · Europe · Oceania</em>) with 22 sub-regions nested underneath (<em>Northern Africa</em>, <em>Western Asia</em>, <em>Caribbean</em>, <em>Melanesia</em>, …). The sub-region is shown in the hex tooltip; the ⓘ on the region row above the map documents the choice in-place.</p>
        <p style="color:var(--dim);font-size:12px;margin-top:-6px">Two caveats worth flagging: (1) <strong>M49 is statistical, not political</strong> — it classifies geography and is deliberately apolitical; it doesn't speak to sovereignty disputes or recognition. (2) <strong>The UN Human Rights machinery runs on different groupings</strong> — Treaty Body elections and HRC membership use <em>regional electoral groups</em>: African (54), Asia-Pacific (54), Eastern European (23), GRULAC (33), WEOG (29). Those cut across M49 lines (e.g. Australia, Canada, New Zealand, USA are WEOG despite sitting in Oceania/Americas geographically). The dashboard does not currently expose electoral groups as a filter — they're on the roadmap.</p>
      </section>

      <section class="me-sec" id="me-search-semantics">
        <h2>Search semantics</h2>
        <p>The keyword box supports a small query language on top of SQLite FTS5 (Porter stemmer, unicode61, diacritics removed). Plain words imply <code>AND</code>; wrap them in quotes for exact phrases; the uppercase operators <code>AND</code> / <code>OR</code> / <code>NOT</code> and parentheses <code>( )</code> work as expected. Stemming collapses common inflections automatically (<code>torture</code> ≡ <code>tortured</code> ≡ <code>torturing</code>).</p>
        <p><strong>Trailing-<code>*</code> prefix match.</strong> Append <code>*</code> to any token to match every word starting with that prefix — <code>democra*</code> catches <em>democracy, democracies, democratic, democratisation</em>; <code>LGBT*</code> catches <em>LGBTQ, LGBTI, LGBT+</em>; <code>non-discriminat*</code> captures the hyphenated forms the Porter stemmer doesn't collapse. Use <code>*</code> explicitly for acronyms and variant spellings the stemmer can't help with — for regular English verbs and nouns the default stemming usually handles the inflections already.</p>
        <p><strong>Irregular-plural auto-expansion.</strong> Eleven curated singular↔plural pairs where the Porter stemmer fails to collapse the two forms are expanded in place by the query rewriter. Typing <code>woman</code> rewrites to <code>("woman"* OR "women"*)</code> before FTS5 MATCH; a small chip under the keyword input tells you which pairs fired. Coverage (all bidirectional):</p>
        <ul style="margin-top:-8px">
          <li><strong>Suppletive English:</strong> man/men, woman/women, person/people, child/children</li>
          <li><strong>Latin/Greek plurals:</strong> medium/media, basis/bases, criterion/criteria, phenomenon/phenomena, crisis/crises, index/indices, analysis/analyses</li>
        </ul>
        <p style="color:var(--dim);font-size:12px;margin-top:-4px">Rejected for asymmetric impact: <em>detain/detention</em> (verb vs -ion noun are legally distinct). To disable expansion for a single query, wrap the term in quotes — <code>"woman"</code> matches only the exact token. Phrases (<code>"climate change"</code>) are never expanded.</p>
      </section>

      <section class="me-sec" id="me-uhri-comparison">
        <h2>Comparison with OHCHR UHRI native search</h2>
        <p>Running the same keyword through this dashboard and through the native search at <a href="https://uhri.ohchr.org" target="_blank" rel="noopener">uhri.ohchr.org</a> will often return different hit counts. On <strong>2026-04-24</strong> we ran a 20-query battery against both systems on the same day. The headline findings:</p>
        <ul>
          <li><strong>Corpus equivalence confirmed.</strong> Literal single-word queries (<code>torture</code>, <code>judiciary</code>, <code>migrant</code>, <code>cyberbullying</code>) agree within <strong>0.2 %</strong>. We're looking at the same 267k records, minus the 11 Stage-5 artefacts.</li>
          <li><strong>Our dashboard finds 10–60× more hits</strong> on queries that benefit from FTS5 semantics: Porter stemming (<code>discriminate</code> → <code>discrimin*</code> matches <em>discrimination, discriminatory</em>), irregular-plural expansion (<code>woman</code> → <code>woman OR women</code>), diacritic normalisation (<code>Türkiye</code> matches <em>Turkiye</em>/<em>Turkey</em>), and stopword-aware phrase tokenisation (<code>rule of law</code> → <code>rule AND law</code>).</li>
          <li><strong>Boolean operators only work here.</strong> UHRI's search treats uppercase <code>AND</code>/<code>OR</code>/<code>NOT</code> as literal words; we parse them as operators.</li>
          <li><strong>One reverse case — <code>LGBTQ</code> — closes with one keystroke.</strong> UHRI returned 262 hits vs our 24. UHRI treats bare tokens as implicit prefix patterns (≈ our trailing-<code>*</code>), so their <code>LGBTQ</code> catches <em>LGBTQ, LGBTQI, LGBTQIA+</em>. Typing <code>LGBTQ*</code> on our side returns 258 — within 1.5 % of UHRI. We keep the literal default because it gives you explicit control over prefix expansion; append <code>*</code> for UHRI-like breadth on acronyms and variant spellings.</li>
        </ul>
        <p style="color:var(--dim);font-size:12px;margin-top:-4px"><strong>If you want UHRI-like behaviour here</strong>, wrap every keyword in double quotes — that disables the plural rewriter and narrows phrase matching. <strong>To reproduce the test</strong>, see the full 20-query table, per-category analysis, and raw data in the <a href="./docs/uhri-comparison.md" target="_blank" rel="noopener" style="color:var(--accent);border-bottom:1px dotted var(--accent);text-decoration:none">UHRI comparison document</a>.</p>
      </section>

      <section class="me-sec" id="me-freshness">
        <h2>Dataset freshness</h2>
        <div class="freshness" id="freshness-card">
          <h3>Monthly refresh status</h3>
          <div class="row"><span class="lbl">Loading…</span><span class="val">—</span></div>
        </div>
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

      <p style="color:var(--dim);font-size:12px;margin-top:18px">Project identity, citation, acknowledgements and feedback contact live on the <a data-nav="about" style="color:var(--dim);border-bottom:1px dotted var(--dim);text-decoration:none;cursor:pointer">About tab</a>. How the Labels workspace (Tab 10) evaluates rules is documented on the <a data-nav="labels" style="color:var(--dim);border-bottom:1px dotted var(--dim);text-decoration:none;cursor:pointer">Labels tab</a> itself.</p>
    </div>`;
  _wireMethodologyToc(root);
  renderFreshnessCard().catch(err => console.warn('[freshness] render failed:', err));
}
