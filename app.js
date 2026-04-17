        // ========== GLOBAL STATE ==========
        let rawData = [];
        let filteredData = [];
        let chartData = [];
        let charts = {};
        let currentSort = { column: null, direction: 'asc' };
        let currentPage = 1;
        const ROWS_PER_PAGE = 100;
        const MAX_CHART_RECORDS = 50000;
        const MAX_BIGRAM_RECORDS = 20000;
        const SERVER_ANALYSIS_EXPORT_LIMIT_DEFAULT = 50000;
        const EXCLUDED_LABEL = 'excluded';
        const DEFAULT_VM_BASE_URL = 'https://150.254.115.204/uhri-api';
        const VM_BASE_STORAGE_KEY = 'un_hr_dashboard_vm_base';
        let fileFormat = '';
        let fileName = '';
        let searchDebounceTimer = null;
        let recordMap = new Map();
        let modalTextCache = '';
        const UI_MODE_STORAGE_KEY = 'un_hr_dashboard_ui_mode';
        let uiMode = 'expert';
        let serverBrowseMode = false;
        let serverState = {
            loaded: false,
            page: 1,
            pageSize: ROWS_PER_PAGE,
            totalPages: 1,
            totalRecords: 0,
            records: [],
            facets: null,
            summary: null,
            mapCountryCounts: [],
            analysisLimit: SERVER_ANALYSIS_EXPORT_LIMIT_DEFAULT,
            analytics: {
                trends: null,
                themes: null,
                text: null
            },
            analyticsLoading: {},
            analyticsFilterKey: ''
        };
        // Track in-flight analytics fetch promises so concurrent callers can
        // await the same request instead of spinning in an infinite microtask loop.
        const _analyticsInflight = {};
        const CUSTOM_WIDGETS_STORAGE_KEY = 'un_hr_dashboard_custom_widgets_v1';
        const selectedRowIds = new Set();
        const customCharts = {};
        let customWidgetOrder = [];
        let customDragIndex = null;
        let lastRenderedPageData = [];
        let activeDataSource = 'upload';
        let datasetMetadata = {
            downloadedAt: '',
            modifiedAt: '',
            datasetPath: ''
        };
        let overviewBootstrapMode = false;
        let fullDatasetBackgroundReady = false;
        let fullDatasetBackgroundPromise = null;
        let bootstrapAnalyticsReady = false;
        let preferredActiveTab = 'overview';

        function readSearchParam(name) {
            try {
                const url = new URL(window.location.href);
                const value = url.searchParams.get(name);
                return value ? String(value).trim() : '';
            } catch {
                return '';
            }
        }

        function normalizeBaseUrl(value) {
            const str = String(value || '').trim();
            if (!str) return '';
            return str.replace(/\/+$/, '');
        }

        function isGithubPagesHost() {
            return /\.github\.io$/i.test(String(window.location.hostname || ''));
        }

        function buildApiUrl(baseUrl, path) {
            const normalizedBase = normalizeBaseUrl(baseUrl);
            if (!normalizedBase) return '';
            return `${normalizedBase}${path.startsWith('/') ? path : `/${path}`}`;
        }

        function resolveVmBaseUrl() {
            const queryBase = normalizeBaseUrl(readSearchParam('vm_base'));
            if (queryBase) return queryBase;

            const configuredBase = normalizeBaseUrl(window.UNHR_DASHBOARD_CONFIG?.vmBaseUrl);
            if (configuredBase) return configuredBase;

            try {
                const stored = normalizeBaseUrl(localStorage.getItem(VM_BASE_STORAGE_KEY));
                if (stored) return stored;
            } catch {
                // Ignore storage access errors.
            }

            return isGithubPagesHost() ? DEFAULT_VM_BASE_URL : '';
        }

        function resolveDatasetApiUrl(vmBaseUrl) {
            const explicitUrl = String(readSearchParam('dataset_api') || window.UNHR_DASHBOARD_CONFIG?.datasetApiUrl || '').trim();
            if (explicitUrl) return explicitUrl;
            return buildApiUrl(vmBaseUrl, '/api/data/full');
        }

        // Classification runs entirely in the browser (TF-IDF based)

        const VM_BASE_URL = resolveVmBaseUrl();
        const DATASET_API_URL = resolveDatasetApiUrl(VM_BASE_URL);
        const DATASET_HEALTH_URL = buildApiUrl(VM_BASE_URL, '/api/data/health');
        const DATASET_FACETS_URL = buildApiUrl(VM_BASE_URL, '/api/data/facets');
        const DATASET_MAP_URL = buildApiUrl(VM_BASE_URL, '/api/data/map');
        const DATASET_SAMPLE_URL = buildApiUrl(VM_BASE_URL, '/api/data/sample');
        const DATASET_SUMMARY_URL = buildApiUrl(VM_BASE_URL, '/api/data/summary');
        const DATASET_RECORDS_URL = buildApiUrl(VM_BASE_URL, '/api/data/records');
        const DATASET_EXPORT_URL = buildApiUrl(VM_BASE_URL, '/api/data/export');
        const DATASET_ANALYTICS_URL = buildApiUrl(VM_BASE_URL, '/api/data/analytics');
        // (SetFit API base removed)

        const invalidCountryTokens = new Set([
            '', 'all', 'all countries', 'global', 'international', 'multiple countries',
            'various countries', 'regional', 'unknown', 'n/a', 'na'
        ]);
        const countryNameAliases = {
            'united states of america': 'United States',
            'usa': 'United States',
            'u.s.a.': 'United States',
            'u.s.': 'United States',
            'united kingdom of great britain and northern ireland': 'United Kingdom',
            'uk': 'United Kingdom',
            'russian federation': 'Russia',
            'iran islamic republic of': 'Iran',
            'syrian arab republic': 'Syria',
            'venezuela bolivarian republic of': 'Venezuela',
            'bolivia plurinational state of': 'Bolivia',
            'democratic people\'s republic of korea': 'North Korea',
            'korea democratic people\'s republic of': 'North Korea',
            'republic of korea': 'South Korea',
            'korea republic of': 'South Korea',
            'viet nam': 'Vietnam',
            'lao people\'s democratic republic': 'Laos',
            'moldova republic of': 'Moldova',
            'tanzania united republic of': 'Tanzania',
            'state of palestine': 'Palestine',
            'palestine state of': 'Palestine',
            'cabo verde': 'Cape Verde',
            'cote d\'ivoire': 'Cote d\'Ivoire',
            'côte d’ivoire': 'Cote d\'Ivoire',
            'myanmar': 'Myanmar',
            'timor-leste': 'Timor-Leste',
            'eswatini': 'Eswatini',
            'brunei darussalam': 'Brunei',
            'democratic republic of the congo': 'Dem. Rep. Congo',
            'republic of moldova': 'Moldova',
            'united republic of tanzania': 'Tanzania',
            'micronesia federated states of': 'Micronesia',
            'micronesia (federated states of)': 'Micronesia',
            'iran (islamic republic of)': 'Iran',
            'bolivia (plurinational state of)': 'Bolivia',
            'venezuela (bolivarian republic of)': 'Venezuela',
            'türkiye': 'Turkey',
            'turkiye': 'Turkey',
            'pk': 'Pakistan',
            'my': 'Malaysia',
            'id': 'Indonesia',
            'iq': 'Iraq',
            'au': 'Australia',
            'co': 'Colombia',
            'et': 'Ethiopia',
            'sv': 'El Salvador',
            'mv': 'Maldives',
            'cz': 'Czechia',
            'gh': 'Ghana',
            'es': 'Spain',
            'sg': 'Singapore',
        };

        // Reverse map: Plotly display name → UHRI DB name for API queries
        const plotlyToDbCountry = {
            'Russia': 'Russian Federation',
            'United States': 'United States of America',
            'United Kingdom': 'United Kingdom of Great Britain and Northern Ireland',
            'Iran': 'Iran (Islamic Republic of)',
            'Syria': 'Syrian Arab Republic',
            'Venezuela': 'Venezuela (Bolivarian Republic of)',
            'Bolivia': 'Bolivia (Plurinational State of)',
            'North Korea': "Democratic People's Republic of Korea",
            'South Korea': 'Republic of Korea',
            'Vietnam': 'Viet Nam',
            'Laos': "Lao People's Democratic Republic",
            'Moldova': 'Republic of Moldova',
            'Tanzania': 'United Republic of Tanzania',
            'Palestine': 'State of Palestine',
            'Cape Verde': 'Cabo Verde',
            'Brunei': 'Brunei Darussalam',
            'Dem. Rep. Congo': 'Democratic Republic of the Congo',
            'Micronesia': 'Micronesia (Federated States of)',
            'Turkey': 'Türkiye',
        };

        function resolveCountryForApi(plotlyName) {
            return plotlyToDbCountry[plotlyName] || plotlyName;
        }
        const customWidgetCatalog = [
            { id: 'worldMap', title: 'World Map Frequency', sourceType: 'plotly' },
            { id: 'yearlyTrend', title: 'Recommendations by Year', sourceType: 'chartjs', sourceChartKey: 'yearlyTrend' },
            { id: 'bodyDistribution', title: 'Distribution by Recommending Body', sourceType: 'chartjs', sourceChartKey: 'bodyDistribution' },
            { id: 'regionDistribution', title: 'Distribution by Region', sourceType: 'chartjs', sourceChartKey: 'regionDistribution' },
            { id: 'stackedTrend', title: 'Stacked Recommendations Over Time', sourceType: 'chartjs', sourceChartKey: 'stackedTrend', tall: true },
            { id: 'themeTrends', title: 'Theme Trends Over Time', sourceType: 'chartjs', sourceChartKey: 'themeTrends', tall: true },
            { id: 'rightsScatter', title: 'Selected Rights Frequency', sourceType: 'chartjs', sourceChartKey: 'rightsScatter', tall: true },
            { id: 'labelDistribution', title: 'Label Distribution', sourceType: 'chartjs', sourceChartKey: 'labelDistribution', tall: true },
            { id: 'labelTrends', title: 'Label Trends Over Time', sourceType: 'chartjs', sourceChartKey: 'labelTrends' },
            { id: 'labelBigrams', title: 'Top Bigrams (Assigned Labels)', sourceType: 'chartjs', sourceChartKey: 'labelBigrams' },
            { id: 'labelBodies', title: 'Labeled Distribution by Body', sourceType: 'chartjs', sourceChartKey: 'labelBodies' }
        ];

        // ========== TRAINING STATE ==========
        let trainingState = {
            taskType: 'classification',
            categories: [],
            samples: [],
            currentSampleIndex: 0,
            labeledSamples: new Map(), // sampleId -> [labels]
            method: 'tfidf_centroid',
            model: null,
            vocabulary: {},
            idf: {},
            categoryVectors: {},
            benchmark: null
        };

        const classifierMethodMeta = {
            tfidf_centroid: {
                label: 'TF-IDF centroid',
                hint: 'Balanced precision/recall with sparse text vectors. Requires labeled samples.',
                defaultThreshold: 0.15
            },
            keyword_overlap: {
                label: 'Keyword overlap',
                hint: 'Fast baseline using overlap with category-specific keywords. Requires labeled samples.',
                defaultThreshold: 0.08
            },
            char_ngram_centroid: {
                label: 'Character n-gram centroid',
                hint: 'More tolerant to noisy spelling and short snippets. Requires labeled samples.',
                defaultThreshold: 0.16
            },
            random_forest: {
                label: 'Random Forest',
                hint: 'Ensemble of decision trees. Best with 30+ labeled examples per category — may overfit with fewer.',
                defaultThreshold: 0.35
            }
        };

        // ========== CLASSIFICATION ENGINE ==========
        // TF-IDF and keyword-based classification — lightweight, no ML dependencies.
        function normalizeLabelName(label) {
            return String(label || '').trim().toLowerCase();
        }

        const EXCLUDED_ALIASES = new Set([EXCLUDED_LABEL, 'unrelated']);
        function isExcludedCategory(label) {
            return EXCLUDED_ALIASES.has(normalizeLabelName(label));
        }

        /**
         * Build enriched text for classification by prepending key metadata.
         * Body and AffectedPersons give strong thematic signal without
         * conflicting with user-defined categories the way OHCHR Themes might.
         */
        function getClassificationText(record) {
            const parts = [];
            const body = (record._body || '').replace(/^-\s*/, '').trim();
            if (body) parts.push(`UN Body: ${body}.`);
            const persons = (record._affectedPersons || '').replace(/\n/g, ', ').trim();
            if (persons) parts.push(`Affected groups: ${persons}.`);
            const countries = (record._countries || '').replace(/\n/g, ', ').trim();
            if (countries) parts.push(`Country: ${countries}.`);
            const text = (record._text || '').trim();
            if (text) parts.push(text);
            return parts.join(' ');
        }

        function getStatisticsCategories(categories = []) {
            return categories.filter(c => !isExcludedCategory(c));
        }

        function normalizePredictedLabels(labels) {
            return [...new Set((labels || []).map(normalizeAssignedLabel).filter(Boolean))];
        }

        function normalizePredictedLabelsForStats(labels) {
            return normalizePredictedLabels(labels).filter(l => !isExcludedCategory(l));
        }

        function setUIMode(mode) {
            uiMode = mode === 'guided' ? 'guided' : 'expert';
            document.body.classList.remove('mode-guided', 'mode-expert');
            document.body.classList.add(`mode-${uiMode}`);

            // Sync legacy toggle buttons (hidden but kept for backward compat)
            const guidedBtn = document.getElementById('modeGuidedBtn');
            const expertBtn = document.getElementById('modeExpertBtn');
            if (guidedBtn) guidedBtn.classList.toggle('active', uiMode === 'guided');
            if (expertBtn) expertBtn.classList.toggle('active', uiMode === 'expert');

            // Sync settings panel checkbox
            const annotationsToggle = document.getElementById('annotationsToggle');
            if (annotationsToggle) annotationsToggle.checked = (uiMode === 'guided');

            try {
                localStorage.setItem(UI_MODE_STORAGE_KEY, uiMode);
            } catch {
                // Ignore storage errors in restricted contexts.
            }
        }

        function loadSavedUIMode() {
            let isFirstVisit = true;
            try {
                const stored = localStorage.getItem(UI_MODE_STORAGE_KEY);
                if (stored === 'guided' || stored === 'expert') {
                    isFirstVisit = false;
                    setUIMode(stored);
                    return;
                }
                // Check if user has ever visited (via returning-user key)
                if (localStorage.getItem('un_hr_dashboard_visited')) {
                    isFirstVisit = false;
                }
            } catch {
                // Ignore storage access errors.
            }
            // First-time visitors get annotations by default
            setUIMode(isFirstVisit ? 'guided' : 'expert');
        }

        /* ── Settings panel toggle ── */
        function toggleSettingsPanel() {
            const panel = document.getElementById('settingsPanel');
            if (panel) panel.classList.toggle('open');
        }
        // Close settings panel and search help popover on outside click
        document.addEventListener('click', function(e) {
            const panel = document.getElementById('settingsPanel');
            const gear = document.getElementById('settingsGearBtn');
            if (panel && panel.classList.contains('open') && !panel.contains(e.target) && e.target !== gear) {
                panel.classList.remove('open');
            }
            const searchHelp = document.getElementById('searchHelpPopover');
            if (searchHelp && !searchHelp.classList.contains('hidden') && !searchHelp.contains(e.target) && !e.target.closest('[aria-label="Search help"]') && !e.target.closest('[aria-label="Filter search help"]')) {
                searchHelp.classList.add('hidden');
            }
            const filterHelp = document.getElementById('filterSearchHelp');
            if (filterHelp && !filterHelp.classList.contains('hidden') && !filterHelp.contains(e.target) && !e.target.closest('[aria-label="Filter search help"]')) {
                filterHelp.classList.add('hidden');
            }
            const recentPanel = document.getElementById('recentFiltersPanel');
            const recentBtn = document.getElementById('headerRecentBtn');
            if (recentPanel && recentPanel.classList.contains('open') && !recentPanel.contains(e.target) && e.target !== recentBtn) {
                recentPanel.classList.remove('open');
            }
        });

        /* ── Auto-load preference ── */
        const AUTOLOAD_STORAGE_KEY = 'un_hr_dashboard_autoload';
        function toggleAutoLoad(enabled) {
            try {
                localStorage.setItem(AUTOLOAD_STORAGE_KEY, enabled ? '1' : '0');
            } catch { /* ignore */ }
        }
        function isAutoLoadEnabled() {
            try {
                return localStorage.getItem(AUTOLOAD_STORAGE_KEY) === '1';
            } catch { return false; }
        }

        /* ── Count-up animation for hero stats ── */
        function animateCountUp(el, target, duration) {
            const start = performance.now();
            const formatter = new Intl.NumberFormat();
            el.classList.add('counting');
            function tick(now) {
                const elapsed = now - start;
                const progress = Math.min(elapsed / duration, 1);
                // Ease-out cubic
                const eased = 1 - Math.pow(1 - progress, 3);
                const current = Math.round(target * eased);
                el.textContent = formatter.format(current);
                if (progress < 1) {
                    requestAnimationFrame(tick);
                } else {
                    el.classList.remove('counting');
                }
            }
            requestAnimationFrame(tick);
        }

        function runHeroCountUp() {
            const stats = document.querySelectorAll('.hero-stat-value[data-target]');
            stats.forEach(el => {
                const target = parseInt(el.getAttribute('data-target'), 10);
                if (!isNaN(target) && target > 0) {
                    const duration = target > 1000 ? 2000 : target > 100 ? 1500 : 800;
                    animateCountUp(el, target, duration);
                }
            });
            // Handle the text-based span stat
            const spanEl = document.getElementById('heroStatSpan');
            if (spanEl) {
                setTimeout(() => {
                    spanEl.textContent = spanEl.getAttribute('data-target-text') || '2006–2026';
                }, 600);
            }
        }

        /* ── Update hero stats from live API data ── */
        function updateHeroStatsFromApi(summary) {
            if (!summary) return;
            const recsEl = document.getElementById('heroStatRecs');
            const countriesEl = document.getElementById('heroStatCountries');
            const bodiesEl = document.getElementById('heroStatBodies');
            const spanEl = document.getElementById('heroStatSpan');
            const formatter = new Intl.NumberFormat();

            if (summary.total_records && recsEl) {
                recsEl.setAttribute('data-target', summary.total_records);
                recsEl.textContent = formatter.format(summary.total_records);
                updateAllRecordCounts(summary.total_records);
            }
            if (summary.country_counts && countriesEl) {
                const count = Array.isArray(summary.country_counts) ? summary.country_counts.length : 0;
                if (count > 0) {
                    countriesEl.textContent = formatter.format(count);
                }
            }
            if (summary.body_counts && bodiesEl) {
                const count = Array.isArray(summary.body_counts) ? summary.body_counts.length : 0;
                const current = parseInt(bodiesEl.getAttribute('data-target'), 10) || 0;
                if (count > current) {
                    bodiesEl.setAttribute('data-target', count);
                    bodiesEl.textContent = formatter.format(count);
                }
            }
            if (summary.yearly_counts && spanEl) {
                const years = summary.yearly_counts.map(y => y.year || y[0]).filter(Boolean);
                if (years.length) {
                    const minY = Math.min(...years);
                    const maxY = Math.max(...years);
                    spanEl.textContent = `${minY}–${maxY}`;
                }
            }
        }

        function hasAppliedDashboardFilters() {
            const textQuery = String(document.getElementById('filterText')?.value || '').trim();
            return !!textQuery || getActiveFilters().length > 0;
        }

        function syncHeroStatsVisibility() {
            const heroStats = document.getElementById('heroStats');
            if (!heroStats) return;
            heroStats.classList.toggle('hidden', hasAppliedDashboardFilters());
        }

        /* ── Update all hardcoded record counts from live data ── */
        function updateAllRecordCounts(totalRecords) {
            if (!totalRecords || totalRecords <= 0) return;
            const approx = Math.floor(totalRecords / 500) * 500;
            // Format with commas explicitly (locale-independent)
            const approxText = approx.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '+';
            // Regex that matches any prior formatted number (commas, dots, spaces, non-breaking spaces) followed by + and "UN human rights"
            const countPattern = /\d[\d,.\s\u00a0]*\+?\s*UN human rights/;
            const replacement = approxText + ' UN human rights';
            // Hero tagline
            const tagline = document.querySelector('.hero-tagline');
            if (tagline) tagline.innerHTML = tagline.innerHTML.replace(countPattern, replacement);
            // Welcome banner
            const guidance = document.querySelector('.guidance-card');
            if (guidance) guidance.innerHTML = guidance.innerHTML.replace(countPattern, replacement);
            // About modal subtitle
            const aboutSub = document.querySelector('.about-subtitle');
            if (aboutSub) aboutSub.innerHTML = aboutSub.innerHTML.replace(countPattern, replacement);
            // Coach step text spans
            document.querySelectorAll('.dynamic-rec-count').forEach(el => { el.textContent = approxText; });
            // Coach steps array (for future renders)
            if (typeof coachSteps !== 'undefined' && coachSteps[0]) {
                coachSteps[0].text = coachSteps[0].text.replace(/>\d[\d,.\s\u00a0]*\+?</, '>' + approxText + '<');
            }
        }

        /* ── Living Data Canvas: mini-chart rendering ── */
        const miniCharts = {};
        const MINI_CHART_COLORS = ['#2d6ea3','#3d8fd4','#5aa5e0','#7bbbea','#a0d0f2','#c4e3f9','#1a7a3a','#28a745'];

        function renderMiniThemesChart(themeData) {
            const top = themeData.slice(0, 7);
            const canvas = document.getElementById('miniThemesChart');
            const loading = document.getElementById('miniThemesLoading');
            if (!canvas || !top.length) return;
            loading.style.display = 'none';
            canvas.style.display = 'block';
            if (miniCharts.themes) miniCharts.themes.destroy();
            const labels = top.map(t => {
                const name = (t.theme || '').replace(/^-\s*/, '');
                return name.length > 30 ? name.slice(0, 28) + '…' : name;
            });
            miniCharts.themes = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{ data: top.map(t => t.count), backgroundColor: MINI_CHART_COLORS, borderRadius: 4 }]
                },
                options: {
                    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => Number(ctx.raw).toLocaleString() + ' recommendations' } } },
                    scales: { x: { display: false }, y: { ticks: { font: { size: 11 } }, grid: { display: false } } },
                    onClick: (evt, elements) => {
                        if (elements.length) quickExploreChip('themes', themeData[elements[0].index]?.theme);
                    }
                }
            });
        }

        function renderMiniPersonsChart(personsData) {
            const top = personsData.slice(0, 6);
            const canvas = document.getElementById('miniPersonsChart');
            const loading = document.getElementById('miniPersonsLoading');
            if (!canvas || !top.length) return;
            loading.style.display = 'none';
            canvas.style.display = 'block';
            if (miniCharts.persons) miniCharts.persons.destroy();
            const labels = top.map(p => {
                const name = (p.affected_person || '').replace(/^-\s*/, '');
                return name.length > 28 ? name.slice(0, 26) + '…' : name;
            });
            miniCharts.persons = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{ data: top.map(p => p.count), backgroundColor: ['#e07c3e','#d4a03d','#3d8fd4','#2d6ea3','#7b68ee','#28a745'], borderRadius: 4 }]
                },
                options: {
                    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => Number(ctx.raw).toLocaleString() + ' recommendations' } } },
                    scales: { x: { display: false }, y: { ticks: { font: { size: 11 } }, grid: { display: false } } },
                    onClick: (evt, elements) => {
                        if (elements.length) quickExploreChip('affected_persons', personsData[elements[0].index]?.affected_person);
                    }
                }
            });
        }

        function renderMiniCountriesChart(countryData) {
            const top = countryData.slice(0, 8);
            const canvas = document.getElementById('miniCountriesChart');
            const loading = document.getElementById('miniCountriesLoading');
            if (!canvas || !top.length) return;
            loading.style.display = 'none';
            canvas.style.display = 'block';
            if (miniCharts.countries) miniCharts.countries.destroy();
            const labels = top.map(c => {
                const name = (c.country || '').replace(/^-\s*/, '');
                return name.length > 24 ? name.slice(0, 22) + '…' : name;
            });
            miniCharts.countries = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{ data: top.map(c => c.count), backgroundColor: MINI_CHART_COLORS, borderRadius: 4 }]
                },
                options: {
                    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => Number(ctx.raw).toLocaleString() + ' recommendations' } } },
                    scales: { x: { display: false }, y: { ticks: { font: { size: 11 } }, grid: { display: false } } },
                    onClick: (evt, elements) => {
                        if (elements.length) quickExploreChip('countries', countryData[elements[0].index]?.country);
                    }
                }
            });
        }

        function renderMiniTrendChart(yearlyData) {
            const canvas = document.getElementById('miniTrendChart');
            const loading = document.getElementById('miniTrendLoading');
            if (!canvas || !yearlyData.length) return;
            loading.style.display = 'none';
            canvas.style.display = 'block';
            if (miniCharts.trend) miniCharts.trend.destroy();
            const years = yearlyData.map(y => String(y.year));
            const counts = yearlyData.map(y => y.count);
            miniCharts.trend = new Chart(canvas, {
                type: 'line',
                data: {
                    labels: years,
                    datasets: [{
                        data: counts,
                        borderColor: '#2d6ea3',
                        backgroundColor: 'rgba(45,110,163,0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 2,
                        pointHoverRadius: 5,
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => Number(ctx.raw).toLocaleString() + ' recommendations' } } },
                    scales: {
                        x: { ticks: { font: { size: 10 }, maxRotation: 45 }, grid: { display: false } },
                        y: { beginAtZero: true, ticks: { font: { size: 10 }, callback: v => v >= 1000 ? (v/1000).toFixed(0) + 'k' : v }, grid: { color: '#f0f0f0' } }
                    }
                }
            });
        }

        /* Destroy mini-charts when transitioning to full dashboard */
        function destroyMiniCharts() {
            for (const key of Object.keys(miniCharts)) {
                if (miniCharts[key]) { miniCharts[key].destroy(); miniCharts[key] = null; }
            }
        }

        /* Populate the living canvas from bootstrap data */
        function populateLandingCanvas(bootstrapData) {
            if (!bootstrapData) return;
            const summary = bootstrapData.summary || {};
            const analytics = bootstrapData.analytics || {};
            const themes = analytics.themes?.theme_counts || [];
            const persons = analytics.text?.affected_person_counts || [];
            const countries = bootstrapData.map_country_counts || [];
            const yearly = summary.yearly_counts || [];

            // Update hero stats with real data
            updateHeroStatsFromApi(summary);

            // Render mini charts
            if (themes.length) renderMiniThemesChart(themes);
            if (persons.length) renderMiniPersonsChart(persons);
            if (countries.length) renderMiniCountriesChart(countries);
            if (yearly.length) renderMiniTrendChart(yearly);
        }

        /* Quick explore chip — loads dashboard with a pre-set filter */
        function quickExploreChip(filterType, value) {
            if (!value) return;
            // Store the desired filter for after load
            window._quickExploreFilter = { type: filterType, value: value };
            // Trigger full dashboard load
            if (DATASET_API_URL || isGithubPagesHost()) {
                loadOverviewBootstrapThenServerBrowse(false);
            } else {
                loadBundledSampleData(false);
            }
        }

        /* Auto-fetch bootstrap for living canvas on page load */
        function autoFetchLandingPreview() {
            const bootstrapPath = './sample-data/overview-bootstrap.json';
            // Expose the in-flight promise so fetchOverviewBootstrap (called later during
            // server-browse init) can await THIS fetch instead of starting a second one.
            // Both used to race to fetch the same 227KB JSON on every cold start.
            window._landingBootstrapPromise = fetch(bootstrapPath, { cache: 'default' })
                .then(r => r.ok ? r.json() : Promise.reject('HTTP ' + r.status))
                .then(data => {
                    window._landingBootstrapData = data;
                    populateLandingCanvas(data);
                    buildSearchIndex(data);
                    return data;
                })
                .catch(err => {
                    console.debug('Landing preview fetch skipped:', err);
                    document.querySelectorAll('.landing-canvas-loading').forEach(el => {
                        el.innerHTML = '<span style="color:#aab;font-size:12px;">Click "Explore" to load data</span>';
                    });
                    window._landingBootstrapPromise = null;
                    throw err;
                });
        }

        /* ══════════════════════════════════════════════════
           PHASE 3: Search/Autocomplete Bar
           ══════════════════════════════════════════════════ */
        let searchIndex = [];

        function buildSearchIndex(bootstrapData) {
            searchIndex = [];
            if (!bootstrapData) return;
            const analytics = bootstrapData.analytics || {};
            const summary = bootstrapData.summary || {};

            // Countries
            (bootstrapData.map_country_counts || []).forEach(c => {
                searchIndex.push({
                    label: (c.country || '').replace(/^-\s*/, ''),
                    type: 'country',
                    filterType: 'countries',
                    value: c.country,
                    count: c.count
                });
            });
            // Themes
            (analytics.themes?.theme_counts || []).forEach(t => {
                searchIndex.push({
                    label: (t.theme || '').replace(/^-\s*/, ''),
                    type: 'theme',
                    filterType: 'themes',
                    value: t.theme,
                    count: t.count
                });
            });
            // Bodies
            (summary.body_counts || []).forEach(b => {
                searchIndex.push({
                    label: (b.body || '').replace(/^-\s*/, ''),
                    type: 'body',
                    filterType: 'bodies',
                    value: b.body,
                    count: b.count
                });
            });
            // Affected persons
            (analytics.text?.affected_person_counts || []).forEach(p => {
                searchIndex.push({
                    label: (p.affected_person || '').replace(/^-\s*/, ''),
                    type: 'person',
                    filterType: 'affected_persons',
                    value: p.affected_person,
                    count: p.count
                });
            });
            // Regions
            (summary.region_counts || []).forEach(r => {
                searchIndex.push({
                    label: (r.region || '').replace(/^-\s*/, ''),
                    type: 'region',
                    filterType: 'regions',
                    value: r.region,
                    count: r.count
                });
            });
        }

        function initLandingSearch() {
            const input = document.getElementById('landingSearchInput');
            const dropdown = document.getElementById('landingSearchDropdown');
            if (!input || !dropdown) return;
            let activeIdx = -1;

            input.addEventListener('input', () => {
                const q = input.value.trim().toLowerCase();
                if (q.length < 1) { dropdown.classList.add('hidden'); return; }
                const matches = searchIndex
                    .filter(item => item.label.toLowerCase().includes(q))
                    .slice(0, 10);
                if (!matches.length) {
                    dropdown.innerHTML = '<div class="landing-search-item" style="color:#8899aa;cursor:default;">No matches found</div>';
                    dropdown.classList.remove('hidden');
                    return;
                }
                activeIdx = -1;
                dropdown.innerHTML = matches.map((m, i) => `
                    <div class="landing-search-item" data-idx="${i}" data-filter-type="${m.filterType}" data-value="${escapeHtml(m.value)}">
                        <span class="search-type-badge ${m.type}">${m.type}</span>
                        <span>${highlightMatch(escapeHtml(m.label), q)}</span>
                        <span class="search-count">${Number(m.count).toLocaleString()}</span>
                    </div>
                `).join('');
                dropdown.classList.remove('hidden');

                dropdown.querySelectorAll('.landing-search-item[data-idx]').forEach(el => {
                    el.addEventListener('click', () => {
                        const ft = el.getAttribute('data-filter-type');
                        const val = el.getAttribute('data-value');
                        input.value = '';
                        dropdown.classList.add('hidden');
                        quickExploreChip(ft, val);
                    });
                });
            });

            input.addEventListener('keydown', (e) => {
                const items = dropdown.querySelectorAll('.landing-search-item[data-idx]');
                if (!items.length) return;
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    activeIdx = Math.min(activeIdx + 1, items.length - 1);
                    items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    activeIdx = Math.max(activeIdx - 1, 0);
                    items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (activeIdx >= 0 && items[activeIdx]) {
                        items[activeIdx].click();
                    } else if (items[0]) {
                        items[0].click();
                    }
                } else if (e.key === 'Escape') {
                    dropdown.classList.add('hidden');
                    input.blur();
                }
            });

            // Close dropdown on outside click
            document.addEventListener('click', (e) => {
                if (!input.contains(e.target) && !dropdown.contains(e.target)) {
                    dropdown.classList.add('hidden');
                }
            });
        }

        function highlightMatch(text, query) {
            const idx = text.toLowerCase().indexOf(query.toLowerCase());
            if (idx === -1) return text;
            return text.slice(0, idx) + '<strong>' + text.slice(idx, idx + query.length) + '</strong>' + text.slice(idx + query.length);
        }

        /**
         * Autocomplete for the main #filterText input — reuses the same searchIndex
         * the landing search uses (countries/bodies/themes/regions/affected persons,
         * each with a count). Clicking a suggestion routes through the proper
         * multi-select filter via quickExploreChip → applyQuickExploreFilter, so a
         * click on "Ghana" selects the Ghana country filter (not a text LIKE search).
         *
         * Typing a phrase that doesn't match any facet just falls through — the user
         * presses Enter and the text runs as a regular search.
         */
        function initFilterTextAutocomplete() {
            const input = document.getElementById('filterText');
            const dropdown = document.getElementById('filterTextAutocomplete');
            if (!input || !dropdown) return;
            let activeIdx = -1;

            input.addEventListener('input', () => {
                const q = input.value.trim().toLowerCase();
                if (q.length < 2) { dropdown.classList.add('hidden'); return; }
                if (!searchIndex.length) { dropdown.classList.add('hidden'); return; }
                const matches = searchIndex
                    .filter(item => item.label && item.label.toLowerCase().includes(q))
                    .slice(0, 8);
                if (!matches.length) { dropdown.classList.add('hidden'); return; }
                activeIdx = -1;
                const badgeStyle = 'display:inline-block; padding:1px 6px; border-radius:3px; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; margin-right:8px;';
                const typeStyles = {
                    country: 'background:#e0ebf7; color:#1a4d7a;',
                    theme:   'background:#fdebd4; color:#8c5a00;',
                    body:    'background:#e6dff5; color:#52388c;',
                    region:  'background:#d6f0e3; color:#1e6b4a;',
                    person:  'background:#fbdfe0; color:#8a2326;'
                };
                dropdown.innerHTML = matches.map((m, i) => `
                    <div class="filter-ac-item" data-idx="${i}" data-filter-type="${escapeHtml(m.filterType)}" data-value="${escapeHtml(m.value || '')}"
                         style="display:flex; align-items:center; gap:6px; padding:8px 12px; cursor:pointer; border-bottom:1px solid #f0f2f5; font-size:12.5px;"
                         role="option">
                        <span style="${badgeStyle} ${typeStyles[m.type] || ''}">${m.type}</span>
                        <span style="flex:1; color:#233;">${highlightMatch(escapeHtml(m.label), q)}</span>
                        <span style="color:#8899aa; font-size:11px;">${Number(m.count || 0).toLocaleString()}</span>
                    </div>
                `).join('');
                dropdown.classList.remove('hidden');
                dropdown.querySelectorAll('.filter-ac-item').forEach(el => {
                    el.addEventListener('mouseenter', () => {
                        activeIdx = parseInt(el.dataset.idx, 10);
                        dropdown.querySelectorAll('.filter-ac-item').forEach((x, i) => {
                            x.style.background = (i === activeIdx) ? '#f0f7ff' : '';
                        });
                    });
                    el.addEventListener('click', () => {
                        const ft = el.getAttribute('data-filter-type');
                        const val = el.getAttribute('data-value');
                        input.value = '';
                        dropdown.classList.add('hidden');
                        // Route through the landing's quick-explore pipeline so the
                        // correct multi-select filter (country/theme/body/…) gets set.
                        quickExploreChip(ft, val);
                    });
                });
            });

            input.addEventListener('keydown', (e) => {
                const items = dropdown.querySelectorAll('.filter-ac-item');
                if (!items.length || dropdown.classList.contains('hidden')) return;
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    activeIdx = Math.min(activeIdx + 1, items.length - 1);
                    items.forEach((el, i) => el.style.background = (i === activeIdx) ? '#f0f7ff' : '');
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    activeIdx = Math.max(activeIdx - 1, 0);
                    items.forEach((el, i) => el.style.background = (i === activeIdx) ? '#f0f7ff' : '');
                } else if (e.key === 'Enter' && activeIdx >= 0 && items[activeIdx]) {
                    e.preventDefault();
                    items[activeIdx].click();
                } else if (e.key === 'Escape') {
                    dropdown.classList.add('hidden');
                }
            });

            document.addEventListener('click', (e) => {
                if (!input.contains(e.target) && !dropdown.contains(e.target)) {
                    dropdown.classList.add('hidden');
                }
            });
        }

        /* ══════════════════════════════════════════════════
           PHASE 3: Coach Mark Overlay (First Visit Tour)
           ══════════════════════════════════════════════════ */
        const COACH_STORAGE_KEY = 'un_hr_dashboard_coach_done';

        const coachSteps = [
            {
                emoji: '🇺🇳',
                title: 'OHCHR UHRI Data',
                text: 'This dashboard is built on the <a href="https://uhri.ohchr.org/en" target="_blank" style="color:var(--accent);text-decoration:underline;">Universal Human Rights Index</a> published by the Office of the UN High Commissioner for Human Rights. It includes <span class="dynamic-rec-count">267,500+</span> country-specific observations and recommendations from Treaty Bodies, Special Procedures, and the Universal Periodic Review.'
            },
            {
                emoji: '🔍',
                title: 'Search & Explore',
                text: 'Use the search bar to find any country, theme, or treaty body. Select a result to instantly open the full dashboard filtered to your topic.'
            },
            {
                emoji: '🏷️',
                title: 'Classify & Label',
                text: 'Open the Labeling Tool to tag recommendations with your own categories, train a classifier, and auto-label thousands of records. Export your results or visualize them in the My Labels tab.'
            },
            {
                emoji: '📂',
                title: 'Use Your Own Data',
                text: 'You can also upload your own UHRI export (download from <a href="https://uhri.ohchr.org/en/our-data-api" target="_blank" style="color:var(--accent);text-decoration:underline;">uhri.ohchr.org</a>) or any dataset in XLSX/CSV format via the 📂 icon. The dashboard works with any tabular human rights data.'
            }
        ];

        function showCoachMarks() {
            // Only show on first visit if landing page is visible
            try {
                if (localStorage.getItem(COACH_STORAGE_KEY)) return;
            } catch { return; }
            const uploadSection = document.getElementById('uploadSection');
            if (!uploadSection || uploadSection.classList.contains('hidden')) return;

            let step = 0;
            renderCoachStep(step);

            function renderCoachStep(idx) {
                // Remove existing overlay
                document.querySelector('.coach-overlay')?.remove();

                if (idx >= coachSteps.length) {
                    try { localStorage.setItem(COACH_STORAGE_KEY, '1'); } catch {}
                    return;
                }

                const s = coachSteps[idx];
                const overlay = document.createElement('div');
                overlay.className = 'coach-overlay';
                overlay.innerHTML = `
                    <div class="coach-card">
                        <div class="coach-step-indicator">
                            ${coachSteps.map((_, i) => `<div class="coach-dot ${i === idx ? 'active' : ''}"></div>`).join('')}
                        </div>
                        <div class="coach-emoji">${s.emoji}</div>
                        <div class="coach-title">${s.title}</div>
                        <div class="coach-text">${s.text}</div>
                        <div class="coach-actions">
                            <button class="coach-btn ghost" id="coachSkip">${idx === 0 ? 'Skip tour' : 'Back'}</button>
                            <button class="coach-btn primary" id="coachNext">${idx === coachSteps.length - 1 ? 'Get started!' : 'Next →'}</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(overlay);

                overlay.querySelector('#coachNext').addEventListener('click', () => {
                    step = idx + 1;
                    renderCoachStep(step);
                });
                overlay.querySelector('#coachSkip').addEventListener('click', () => {
                    if (idx === 0) {
                        // Skip all
                        overlay.remove();
                        try { localStorage.setItem(COACH_STORAGE_KEY, '1'); } catch {}
                    } else {
                        // Go back
                        step = idx - 1;
                        renderCoachStep(step);
                    }
                });
                // Click outside card to dismiss
                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) {
                        overlay.remove();
                        try { localStorage.setItem(COACH_STORAGE_KEY, '1'); } catch {}
                    }
                });
            }
        }

        function loadCustomWidgetsFromStorage() {
            try {
                const raw = localStorage.getItem(CUSTOM_WIDGETS_STORAGE_KEY);
                const parsed = raw ? JSON.parse(raw) : [];
                const allowed = new Set(customWidgetCatalog.map(w => w.id));
                customWidgetOrder = Array.isArray(parsed)
                    ? parsed.filter(id => allowed.has(id))
                    : [];
            } catch {
                customWidgetOrder = [];
            }
        }

        function saveCustomWidgetsToStorage() {
            try {
                localStorage.setItem(CUSTOM_WIDGETS_STORAGE_KEY, JSON.stringify(customWidgetOrder));
            } catch {
                // Ignore storage errors.
            }
        }

        function normalizeAssignedLabel(label) {
            return String(label || '')
                .replace(/^[\-\u2022•\s]+/, '')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function extractAssignedLabelsFromRow(row) {
            const labelColumnCandidates = [
                'My Labels',
                'My labels',
                'My Label',
                'My label',
                'MyLabels',
                'My_Labels',
                'Assigned Labels',
                'assigned_labels',
                'Predicted Labels',
                '_predictedLabels'
            ];
            let raw = '';
            for (const key of labelColumnCandidates) {
                const value = row?.[key];
                if (value !== undefined && value !== null && String(value).trim() !== '') {
                    raw = value;
                    break;
                }
            }
            return normalizePredictedLabels(toArr(raw, { splitCommas: true }));
        }

        function getCategoryByNormalizedName(name) {
            const normalized = normalizeLabelName(name);
            return trainingState.categories.find(c => normalizeLabelName(c) === normalized) || null;
        }

        function ensureExcludedCategory() {
            if (!getCategoryByNormalizedName(EXCLUDED_LABEL)) {
                trainingState.categories.push(EXCLUDED_LABEL);
            }
            trainingState.categories = trainingState.categories.map(cat => (
                isExcludedCategory(cat) ? EXCLUDED_LABEL : cat
            ));
            const seen = new Set();
            trainingState.categories = trainingState.categories.filter(cat => {
                const normalized = normalizeLabelName(cat);
                if (!normalized || seen.has(normalized)) return false;
                seen.add(normalized);
                return true;
            });
        }

        function sanitizeSampleLabels(labels) {
            const categoryByNormalized = new Map(trainingState.categories.map(c => [normalizeLabelName(c), c]));
            let normalizedLabels = normalizePredictedLabels(labels)
                .map(l => categoryByNormalized.get(normalizeLabelName(l)) || null)
                .filter(Boolean);
            const hasExcluded = normalizedLabels.some(isExcludedCategory);
            if (hasExcluded) {
                normalizedLabels = [EXCLUDED_LABEL];
            }
            return normalizedLabels;
        }

        // ========== RIGHTS THEMES (FROM UHRI "Themes" TAGS) ==========
        const rightsThemeMap = {
            "1) Right to education": ["- Right to education"],
            "2) Right to health": ["- Right to health"],
            "3) Labour rights": ["- Labour rights and right to work", "- Trade union rights"],
            "4) Cultural rights": ["- Cultural rights"],
            "5) Other ESCR": [
                "- Right to adequate housing",
                "- Right to food",
                "- Right to an adequate standard of living",
                "- Economic, social & cultural rights - general measures of implementation",
                "- Sexual & reproductive health and rights",
                "- Right to social security",
                "- Human rights & poverty",
                "- Safe drinking water & sanitation",
                "- Land & property rights"
            ],
            "6) Freedom of expression": ["- Freedom of opinion and expression & access to information"],
            "7) Right to privacy": ["- Private life & privacy"],
            "8) Sexual violence": ["- Sexual & gender-based violence"],
            "9) Right to public participation": [
                "- Right to participate in public affairs & right to vote",
                "- Right to peaceful assembly",
                "- Freedom of association"
            ],
            "10) Other CCPR rights": [
                "- Right to life",
                "- Civil & political rights - general measures of implementation",
                "- Right to physical & moral integrity",
                "- Liberty & security of the person",
                "- Prohibition of torture & ill-treatment (including cruel, inhuman or degrading treatment)",
                "- Conditions of detention",
                "- Arbitrary arrest & detention",
                "- Enforced disappearances",
                "- Freedom of movement"
            ]
        };
        const escRights = new Set([
            "1) Right to education",
            "2) Right to health",
            "3) Labour rights",
            "4) Cultural rights",
            "5) Other ESCR"
        ]);
        const ccprRights = new Set([
            "6) Freedom of expression",
            "7) Right to privacy",
            "8) Sexual violence",
            "9) Right to public participation",
            "10) Other CCPR rights"
        ]);
        const rightsThemeCatalog = buildRightsThemeCatalog();
        const rightsThemeLookup = rightsThemeCatalog.reduce((acc, item) => {
            acc[item.key] = item;
            return acc;
        }, {});

        // ========== TEXT FILTERS (NLP CLEANING) ==========
        const englishStopwords = [
            'a', 'about', 'above', 'after', 'again', 'against', 'ain', 'all', 'am', 'an', 'and',
            'any', 'are', 'aren', "aren't", 'as', 'at', 'be', 'because', 'been', 'before', 'being',
            'below', 'between', 'both', 'but', 'by', 'can', 'couldn', "couldn't", 'd', 'did', 'didn',
            "didn't", 'do', 'does', 'doesn', "doesn't", 'doing', 'don', "don't", 'down', 'during',
            'each', 'few', 'for', 'from', 'further', 'had', 'hadn', "hadn't", 'has', 'hasn', "hasn't",
            'have', 'haven', "haven't", 'having', 'he', "he'd", "he'll", "he's", 'her', 'here', 'hers',
            'herself', 'him', 'himself', 'his', 'how', 'i', "i'd", "i'll", "i'm", "i've", 'if', 'in',
            'into', 'is', 'isn', "isn't", 'it', "it'd", "it'll", "it's", 'its', 'itself', 'just', 'll',
            'm', 'ma', 'me', 'mightn', "mightn't", 'more', 'most', 'mustn', "mustn't", 'my', 'myself',
            'needn', "needn't", 'no', 'nor', 'not', 'now', 'o', 'of', 'off', 'on', 'once', 'only', 'or',
            'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 're', 's', 'same', 'shan',
            "shan't", 'she', "she'd", "she'll", "she's", 'should', "should've", 'shouldn', "shouldn't",
            'so', 'some', 'such', 't', 'than', 'that', "that'll", 'the', 'their', 'theirs', 'them',
            'themselves', 'then', 'there', 'these', 'they', "they'd", "they'll", "they're", "they've",
            'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 've', 'very', 'was', 'wasn',
            "wasn't", 'we', "we'd", "we'll", "we're", "we've", 'were', 'weren', "weren't", 'what',
            'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'won', "won't",
            'wouldn', "wouldn't", 'y', 'you', "you'd", "you'll", "you're", "you've", 'your', 'yours',
            'yourself', 'yourselves'
        ];
        const customStopwords = [
            'including', 'exclusively', 'state', 'party', 'committee', 'recommends',
            'article', 'art', 'nbsp', 'true', 'false', 'table', 'list', 'report',
            'reports', 'written', 'submitted'
        ];
        const stopwordSet = new Set([...englishStopwords, ...customStopwords]);
        const ignoredBigrams = new Set([
            'accent w', 'also concerned', 'art committee', 'article convention', 'article covenant',
            'best practice', 'children including', 'colorful accent', 'committe notes', 'committee also',
            'committee concerned', 'committee recommends', 'concerned reports', 'concluding observations',
            'expression including', 'false grid', 'false list', 'false true', 'general comment',
            'good practice', 'grid table', 'groups children', 'human rights', 'including internet',
            'list table', 'lsdexception false', 'nbsp nbsp', 'notes concern', 'order generate',
            'per cent', 'promising practice', 'recommends state', 'report written', 'state party',
            'state submitted', 'table colorful', 'true list', 'true table', 'true true',
            'united nations', 'w lsdexception', 'widely available', 'written replies'
        ]);

        // ========== COLORS ==========
        const colors = {
            primary: ['#4a90d9', '#50c878', '#ff6b6b', '#ffd93d', '#6c5ce7', '#a8e6cf', '#fdcb6e', '#74b9ff', '#e17055', '#00b894', '#fd79a8', '#636e72'],
            bodies: ['#1e3a5f', '#2d5a87', '#4a90d9', '#6bb3f0', '#8ecae6', '#219ebc', '#023047', '#ffb703', '#fb8500', '#e63946', '#457b9d', '#a8dadc'],
            regions: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#606c38', '#283618', '#dda15e', '#bc6c25']
        };

        // ========== FILE UPLOAD ==========
        const uploadSection = document.getElementById('uploadSection');
        const fileInput = document.getElementById('fileInput');
        const vmLoadBtn = document.getElementById('vmLoadBtn');
        const BUNDLED_SAMPLE_PATH = './sample-data/rule-of-law-6225.xlsx';
        const BUNDLED_SAMPLE_NAME = 'rule-of-law-6225.xlsx';
        const OVERVIEW_BOOTSTRAP_PATH = './sample-data/overview-bootstrap.json';

        // ── localStorage caches for facets + bootstrap analytics (perf optimization) ──
        const FACETS_STORAGE_KEY = 'un_hr_dashboard_facets_v1';
        const FACETS_TTL_MS = 24 * 60 * 60 * 1000; // 24h safety cap
        const BOOTSTRAP_STORAGE_KEY = 'un_hr_dashboard_bootstrap_v1';
        const BOOTSTRAP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7d safety cap when no ETag

        function loadFacetsFromCache(vmBase) {
            try {
                const raw = localStorage.getItem(FACETS_STORAGE_KEY);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (!parsed || parsed.vm !== vmBase) return null;
                if (Date.now() - (parsed.cachedAt || 0) > FACETS_TTL_MS) return null;
                return { modifiedAt: parsed.modifiedAt || '', facets: parsed.facets || null };
            } catch { return null; }
        }

        function saveFacetsToCache(vmBase, modifiedAt, facets) {
            try {
                localStorage.setItem(FACETS_STORAGE_KEY, JSON.stringify({
                    vm: vmBase, modifiedAt: modifiedAt || '', facets, cachedAt: Date.now()
                }));
            } catch {}
        }

        function loadBootstrapFromCache() {
            try {
                const raw = localStorage.getItem(BOOTSTRAP_STORAGE_KEY);
                if (!raw) return null;
                const parsed = JSON.parse(raw);
                if (!parsed || !parsed.body) return null;
                if (Date.now() - (parsed.cachedAt || 0) > BOOTSTRAP_MAX_AGE_MS) return null;
                return parsed; // { etag, body, cachedAt }
            } catch { return null; }
        }

        function saveBootstrapToCache(etag, body) {
            try {
                localStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify({
                    etag: etag || '', body, cachedAt: Date.now()
                }));
            } catch {
                // quota exceeded — drop cache silently so load isn't blocked
                try { localStorage.removeItem(BOOTSTRAP_STORAGE_KEY); } catch {}
            }
        }

        // ── Inline validation error for filter text (replaces blocking alert) ──
        let _regexErrorEl = null;
        function showFilterTextError(msg) {
            const tIn = document.getElementById('filterText');
            if (!tIn) return;
            if (!_regexErrorEl) {
                _regexErrorEl = document.createElement('div');
                _regexErrorEl.className = 'filter-text-error';
                _regexErrorEl.style.cssText = 'color:#c62828;font-size:12px;margin:4px 0 0 0;padding:4px 8px;background:#ffebee;border-radius:4px;';
                const row = tIn.closest('.search-row, .filter-row, div') || tIn.parentElement;
                row?.insertAdjacentElement('afterend', _regexErrorEl);
            }
            _regexErrorEl.textContent = msg;
            _regexErrorEl.style.display = msg ? 'block' : 'none';
        }
        function clearFilterTextError() { if (_regexErrorEl) _regexErrorEl.style.display = 'none'; }

        // ── Track in-flight apply + queue re-apply if user changes filters mid-flight (Bug #4) ──
        let _applyInFlightKey = null;
        let _applyPendingReapply = false;

        // ── Non-blocking server-error banner (replaces interrupting alerts).
        //    When a fetch fails with "timed out", includes a one-click link to enable
        //    Offline & Private Mode — the natural escape hatch for slow complex queries. ──
        function showServerErrorBanner(errorMessage, suggestOffline) {
            let el = document.getElementById('serverErrorBanner');
            if (!el) {
                el = document.createElement('div');
                el.id = 'serverErrorBanner';
                el.style.cssText = 'position:fixed; top:16px; left:50%; transform:translateX(-50%); z-index:2147483640; max-width:560px; background:#fff5f5; border:1px solid #f5b5b5; border-left:4px solid #c62828; color:#7a1f1f; padding:12px 16px 12px 14px; border-radius:8px; box-shadow:0 8px 28px rgba(0,0,0,0.18); font-size:13px; line-height:1.5;';
                document.body.appendChild(el);
            }
            const safeMsg = String(errorMessage || 'Unknown error').slice(0, 400)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const offlineBlock = suggestOffline
                ? `<div style="margin-top:8px; padding:8px 10px; background:#fff; border:1px solid #e0c8c8; border-radius:6px; color:#333; font-size:12.5px; line-height:1.5;">
                       🔒 Complex queries run instantly in <strong>Offline &amp; Private Mode</strong> — the dataset stays in your browser, no server round-trips.
                       <div style="margin-top:6px;">
                         <button class="btn btn-primary" onclick="document.getElementById('serverErrorBanner').remove(); openOfflineModeModal();" style="padding:5px 10px; font-size:12px;">🔒 Enable Offline &amp; Private Mode</button>
                       </div>
                   </div>`
                : '';
            el.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
                    <div style="flex:1;">
                        <div style="font-weight:600; margin-bottom:2px;">${suggestOffline ? 'Query timed out' : 'Server error'}</div>
                        <div style="color:#8a3a3a; font-size:12.5px;">${safeMsg}</div>
                        ${offlineBlock}
                    </div>
                    <button type="button" onclick="this.closest('#serverErrorBanner').remove()" aria-label="Dismiss" style="background:none; border:none; color:#8a3a3a; font-size:18px; line-height:1; cursor:pointer; padding:0 4px;">×</button>
                </div>`;
            el.style.display = 'block';
            // Auto-dismiss after 20s if user doesn't interact (timeouts are common during
            // troubleshooting; stale error banners shouldn't pile up).
            clearTimeout(el._dismissTimer);
            el._dismissTimer = setTimeout(() => el.remove(), suggestOffline ? 30000 : 15000);
        }

        // ── Plan C: fail-fast advisory for boolean queries that still compile to a
        //    multi-lookahead regex after widening. Surface the Offline Mode escape hatch
        //    BEFORE the 30s timeout instead of only showing it after the request dies.
        //    Guarded to once per session (per query text) so it doesn't spam. ──
        const _shownComplexQueryAdvisory = new Set();
        function showComplexQueryAdvisory(rawQuery) {
            // Only relevant when queries go to the server; skip in Offline Mode.
            if (typeof serverBrowseMode !== 'undefined' && !serverBrowseMode) return;
            const key = String(rawQuery || '').trim();
            if (!key || _shownComplexQueryAdvisory.has(key)) return;
            _shownComplexQueryAdvisory.add(key);
            let el = document.getElementById('complexQueryAdvisory');
            if (!el) {
                el = document.createElement('div');
                el.id = 'complexQueryAdvisory';
                el.style.cssText = 'position:fixed; top:16px; left:50%; transform:translateX(-50%); z-index:2147483639; max-width:560px; background:#eef7ff; border:1px solid #b8d8f5; border-left:4px solid #1a6fb5; color:#123a5c; padding:12px 16px; border-radius:8px; box-shadow:0 8px 28px rgba(0,0,0,0.14); font-size:13px; line-height:1.5;';
                document.body.appendChild(el);
            }
            const safeQ = key.slice(0, 120).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            el.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
                    <div style="flex:1;">
                        <div style="font-weight:600; margin-bottom:4px;">💡 Complex boolean query may be slow</div>
                        <div style="color:#234a6e; font-size:12.5px;">Your query <code style="background:#fff; padding:1px 5px; border-radius:3px; border:1px solid #cfe0f2;">${safeQ}</code> uses a shape the server runs via regex (can take 15–30s or time out).</div>
                        <div style="margin-top:8px; padding:8px 10px; background:#fff; border:1px solid #cfe0f2; border-radius:6px; font-size:12.5px;">
                            🔒 In <strong>Offline &amp; Private Mode</strong> the dataset stays in your browser, so complex regex/boolean queries run instantly.
                            <div style="margin-top:6px;">
                                <button class="btn btn-primary" onclick="document.getElementById('complexQueryAdvisory').remove(); openOfflineModeModal();" style="padding:5px 10px; font-size:12px;">🔒 Enable Offline Mode</button>
                            </div>
                        </div>
                    </div>
                    <button type="button" onclick="this.closest('#complexQueryAdvisory').remove()" aria-label="Dismiss" style="background:none; border:none; color:#234a6e; font-size:18px; line-height:1; cursor:pointer; padding:0 4px;">×</button>
                </div>`;
            el.style.display = 'block';
            clearTimeout(el._dismissTimer);
            el._dismissTimer = setTimeout(() => el.remove(), 20000);
        }

        // ── Optimistic UI helpers: mark charts/table as "updating" until fresh data lands ──
        function markSectionStale(section = 'all') {
            if (section === 'all' || section === 'charts') {
                document.querySelectorAll('.chart-card').forEach(el => el.classList.add('chart-stale'));
                document.querySelectorAll('.kpi-value').forEach(el => el.classList.add('kpi-stale'));
            }
            if (section === 'all' || section === 'table') {
                const tbody = document.getElementById('tableBody');
                if (tbody && !tbody.dataset.skeletonActive) {
                    const cols = (tbody.querySelector('tr')?.children.length) || 6;
                    const skeletonRow = `<tr class="skeleton-row">${'<td></td>'.repeat(cols)}</tr>`;
                    tbody.dataset.skeletonActive = '1';
                    tbody.innerHTML = skeletonRow.repeat(5);
                }
            }
        }

        function markSectionFresh(section = 'all') {
            if (section === 'all' || section === 'charts') {
                document.querySelectorAll('.chart-card.chart-stale').forEach(el => el.classList.remove('chart-stale'));
                document.querySelectorAll('.kpi-value.kpi-stale').forEach(el => el.classList.remove('kpi-stale'));
            }
            if (section === 'all' || section === 'table') {
                const tbody = document.getElementById('tableBody');
                if (tbody && tbody.dataset.skeletonActive) {
                    delete tbody.dataset.skeletonActive;
                    // Actual rows are re-populated by buildDataTable() after records arrive.
                }
            }
        }

        loadSavedUIMode();
        loadCustomWidgetsFromStorage();
        // updateTaskTypeUI() call removed
        updateRemoteDatasetUI();
        bindTabSwitching();

        // ── Run count-up animation on hero stats ──
        runHeroCountUp();
        syncHeroStatsVisibility();

        // ── Sync auto-load toggle in settings panel ──
        const autoLoadToggle = document.getElementById('autoLoadToggle');
        if (autoLoadToggle) autoLoadToggle.checked = isAutoLoadEnabled();

        // ── Auto-fetch bootstrap for Living Data Canvas (mini-charts on landing) ──
        autoFetchLandingPreview();

        // ── Initialize landing search bar ──
        initLandingSearch();
        initFilterTextAutocomplete();

        // ── Enter key on main filter query input triggers search ──
        document.getElementById('filterText')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); applyFilters(); }
        });

        // ── Global keyboard shortcuts (quick-feel upgrade for occasional users) ──
        // "/"      → focus main search (unless user is already typing somewhere)
        // "Esc"    → if focused on search, clear it; also closes any open autocomplete
        // Only binds outside of inputs so it doesn't hijack typing.
        document.addEventListener('keydown', (e) => {
            const t = e.target;
            const isTyping = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
            if (e.key === '/' && !isTyping) {
                e.preventDefault();
                const el = document.getElementById('filterText');
                if (el) { el.focus(); el.select(); }
                return;
            }
            if (e.key === 'Escape') {
                // Close autocomplete if open (added in Fix A), clear search if focused
                document.getElementById('filterTextAutocomplete')?.classList.add('hidden');
                if (t && t.id === 'filterText' && t.value) {
                    t.value = '';
                    t.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        });

        // ── Show coach marks for first-time visitors (delayed to let page settle) ──
        setTimeout(showCoachMarks, 1200);

        // ── Prefetch unfiltered summary for hero stats.
        // Stored as a Promise so refreshServerBrowseData's first (unfiltered) summary
        // fetch can await this same request instead of firing a duplicate ~1s call.
        // Measured: on cold start the summary endpoint was being hit twice — this
        // dedupe saves ~1s on the initial render. ──
        if (DATASET_SUMMARY_URL) {
            window._prefetchedSummaryPromise = fetch(DATASET_SUMMARY_URL, { signal: AbortSignal.timeout(8000) })
                .then(r => r.ok ? r.json() : Promise.reject('HTTP ' + r.status))
                .then(summary => {
                    updateHeroStatsFromApi(summary);
                    window._prefetchedSummary = summary;
                    return summary;
                })
                .catch(err => {
                    console.debug('Hero stats prefetch skipped:', err);
                    window._prefetchedSummaryPromise = null;
                    throw err;
                });
        }

        // ── Mark user as returning visitor ──
        try { localStorage.setItem('un_hr_dashboard_visited', '1'); } catch {}

        uploadSection.addEventListener('dragover', (e) => { e.preventDefault(); uploadSection.classList.add('dragover'); });
        uploadSection.addEventListener('dragleave', () => uploadSection.classList.remove('dragover'));
        uploadSection.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadSection.classList.remove('dragover');
            if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0], 'upload');
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) processFile(e.target.files[0], 'upload');
        });

        // ── Restore URL state (filters, tab, search from hash) ──
        const _hadUrlState = _restoreUrlState();
        updateRecentUI();

        // Bug #1 — React to hashchange (e.g. user pastes a URL in the already-open tab or
        // clicks a link that changes only the hash). _pushUrlState uses history.replaceState
        // which does NOT fire hashchange, so this listener only runs for user navigation.
        // Bug #5 — Reset form state first so a new hash REPLACES filters instead of merging
        // (e.g. setting #year_from=2020 shouldn't keep a stale country=Chile from before).
        window.addEventListener('hashchange', () => {
            try {
                ['filterCountry','filterBody','filterRegion','filterTheme','filterAffectedPersons','filterSdg']
                    .forEach(id => { const el = document.getElementById(id); if (el) Array.from(el.options).forEach(o => o.selected = false); });
                const typeEl = document.getElementById('filterType'); if (typeEl) typeEl.selectedIndex = 0;
                const textEl = document.getElementById('filterText'); if (textEl) textEl.value = '';
                _restoreUrlState();
                if (typeof _initChipSelects === 'function') _initChipSelects();
            } catch {}
            if (serverBrowseMode && typeof applyFilters === 'function') {
                applyFilters();
            }
        });

        // ── Rotating placeholder examples ──
        (function() {
            const examples = [
                'e.g. freedom of expression',
                'e.g. children AND education',
                'e.g. gender-based violence',
                'e.g. climate change OR environment',
                'e.g. disability rights',
                'e.g. refugees AND housing',
                'e.g. indigenous peoples',
                'e.g. "right to health"',
                'e.g. police brutality NOT military',
                'e.g. internet OR online OR digital',
                'e.g. forced labour',
                'e.g. women AND discrimination'
            ];
            let idx = 0;
            const input = document.getElementById('filterText');
            if (input) {
                setInterval(() => {
                    if (document.activeElement === input || input.value) return;
                    idx = (idx + 1) % examples.length;
                    input.placeholder = examples[idx];
                }, 4000);
            }
        })();

        // ── Returning user auto-load (if enabled in settings) ──
        if (shouldAutoLoadDemoData()) {
            loadBundledSampleData(false);
        } else if (isAutoLoadEnabled() && DATASET_API_URL) {
            // User opted into auto-load — skip landing page
            loadOverviewBootstrapThenServerBrowse(false);
        } else if (shouldAutoLoadRemoteData()) {
            loadOverviewBootstrapThenServerBrowse(false);
        } else if (_hadUrlState && DATASET_API_URL) {
            // URL has filter state but no auto-load — connect and apply
            loadOverviewBootstrapThenServerBrowse(false);
        }

        // Debounced Data-tab text-column filter — in server mode, re-queries the VM
        let _serverSearchFilter = '';  // current on-screen text filter sent to server
        document.getElementById('tableSearch').addEventListener('input', (e) => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                currentPage = 1;
                _pushUrlState();
                if (serverBrowseMode) {
                    const query = (e.target.value || '').trim();
                    _serverSearchFilter = query;
                    _serverSearchRefresh(query);
                } else {
                    renderTableBody();
                }
            }, 400);
        });

        // ── Infinite scroll for server mode ──
        const _infScroll = {
            records: [],         // accumulated records across pages
            nextPage: 2,         // next page to fetch
            totalPages: 1,
            totalRecords: 0,
            loading: false,
            searchTerm: '',
            observer: null,
            prefetchedRecords: null, // pre-loaded next batch
            prefetchedPage: null,
        };
        let _serverSearchAbort = null;

        function _infScrollReset(records, totalPages, totalRecords, searchTerm) {
            _infScroll.records = [...records];
            _infScroll.nextPage = 2;
            _infScroll.totalPages = totalPages;
            _infScroll.totalRecords = totalRecords;
            _infScroll.loading = false;
            _infScroll.searchTerm = searchTerm || '';
            _infScroll.prefetchedRecords = null;
            _infScroll.prefetchedPage = null;
            // Prefetch page 2 in background
            if (totalPages > 1) _infScrollPrefetch(2);
        }

        async function _infScrollFetchPage(page) {
            const opts = {
                page,
                includePagination: true,
                textFilter: _infScroll.searchTerm || undefined,
                pageSize: ROWS_PER_PAGE
            };
            const params = buildServerQueryParams(opts);
            const url = `${DATASET_RECORDS_URL}?${params.toString()}`;
            const resp = await fetch(url, { cache: 'no-store' });
            if (!resp.ok) throw new Error(`${resp.status}`);
            const data = await resp.json();
            return (data.records || []).map((row, idx) =>
                normalizeRecord(row, idx + ((page - 1) * (data.page_size || ROWS_PER_PAGE)))
            );
        }

        async function _infScrollPrefetch(page) {
            if (page > _infScroll.totalPages) return;
            try {
                const records = await _infScrollFetchPage(page);
                // Only store if still relevant
                if (_infScroll.nextPage === page) {
                    _infScroll.prefetchedRecords = records;
                    _infScroll.prefetchedPage = page;
                }
            } catch {}
        }

        async function _infScrollLoadMore() {
            if (_infScroll.loading || _infScroll.nextPage > _infScroll.totalPages) return;
            _infScroll.loading = true;
            _updateInfScrollSentinel('loading');

            try {
                let newRecords;
                if (_infScroll.prefetchedRecords && _infScroll.prefetchedPage === _infScroll.nextPage) {
                    // Use prefetched data — instant
                    newRecords = _infScroll.prefetchedRecords;
                    _infScroll.prefetchedRecords = null;
                    _infScroll.prefetchedPage = null;
                } else {
                    newRecords = await _infScrollFetchPage(_infScroll.nextPage);
                }

                _infScroll.records.push(...newRecords);
                _infScroll.nextPage++;
                registerRecords(newRecords);

                // Append cards/rows to DOM (avoid full re-render)
                const searchState = parseSearchQuery(document.getElementById('tableSearch').value);
                _appendRecordsToView(newRecords, searchState);
                _updateInfScrollInfo();

                // Prefetch the next page
                if (_infScroll.nextPage <= _infScroll.totalPages) {
                    _infScrollPrefetch(_infScroll.nextPage);
                }
            } catch (err) {
                console.warn('Infinite scroll load failed:', err);
            } finally {
                _infScroll.loading = false;
                _updateInfScrollSentinel(_infScroll.nextPage > _infScroll.totalPages ? 'done' : 'idle');
            }
        }

        function _appendRecordsToView(records, searchState) {
            // Append to card view
            const container = document.getElementById('cardListView');
            if (container && _currentTableView === 'card') {
                const sentinel = document.getElementById('infScrollSentinel');
                const fragment = document.createDocumentFragment();
                const wrapper = document.createElement('div');
                wrapper.innerHTML = records.map(r => _renderSingleCard(r, searchState)).join('');
                while (wrapper.firstChild) fragment.appendChild(wrapper.firstChild);
                if (sentinel) container.insertBefore(fragment, sentinel);
                else container.appendChild(fragment);
            }
            // Append to table view
            const tbody = document.getElementById('tableBody');
            if (tbody && _currentTableView === 'table') {
                const fragment = document.createDocumentFragment();
                const wrapper = document.createElement('tbody');
                wrapper.innerHTML = records.map(r => _renderSingleRow(r, searchState)).join('');
                while (wrapper.firstChild) fragment.appendChild(wrapper.firstChild);
                tbody.appendChild(fragment);
            }
            // Update lastRenderedPageData
            lastRenderedPageData = _infScroll.records;
        }

        function _updateInfScrollSentinel(state) {
            const el = document.getElementById('infScrollSentinel');
            if (!el) return;
            if (state === 'loading') {
                el.innerHTML = '<div style="padding:20px; text-align:center; color:#667; font-size:13px;">Loading more recommendations...</div>';
            } else if (state === 'done') {
                el.innerHTML = `<div style="padding:16px; text-align:center; color:#8899aa; font-size:12px;">All ${_infScroll.totalRecords.toLocaleString()} records loaded</div>`;
            } else {
                el.innerHTML = '';
            }
        }

        function _updateInfScrollInfo() {
            const infoEl = document.getElementById('tableInfo');
            if (!infoEl || !serverBrowseMode) return;
            const loaded = _infScroll.records.length;
            const total = _infScroll.totalRecords;
            const baseTotal = serverState.totalRecords || total;
            if (_serverSearchFilter) {
                const pct = baseTotal ? ((total / baseTotal) * 100).toFixed(1) : '0.0';
                infoEl.innerHTML = `<span style="background:#e8f0fe; color:#1a56db; padding:2px 8px; border-radius:4px; font-weight:600; font-size:inherit;">${total.toLocaleString()} hits</span> <span style="color:#667;">(${pct}% of ${baseTotal.toLocaleString()}) — showing ${loaded.toLocaleString()}</span>`;
            } else {
                infoEl.textContent = `Showing ${loaded.toLocaleString()} of ${total.toLocaleString()}`;
            }
        }

        function _setupInfScrollObserver() {
            if (_infScroll.observer) _infScroll.observer.disconnect();
            const sentinel = document.getElementById('infScrollSentinel');
            if (!sentinel) return;
            _infScroll.observer = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting && serverBrowseMode) {
                    _infScrollLoadMore();
                }
            }, { rootMargin: '400px' }); // trigger 400px before reaching bottom
            _infScroll.observer.observe(sentinel);
        }

        // Server-mode search: reset infinite scroll and re-fetch page 1
        async function _serverSearchRefresh(searchTerm) {
            if (!DATASET_RECORDS_URL) return;
            if (_serverSearchAbort) { try { _serverSearchAbort.abort(); } catch {} }
            _serverSearchAbort = new AbortController();

            const opts = {
                page: 1,
                includePagination: true,
                textFilter: searchTerm || undefined,
                pageSize: ROWS_PER_PAGE
            };
            const params = buildServerQueryParams(opts);
            const url = `${DATASET_RECORDS_URL}?${params.toString()}`;

            const target = _currentTableView === 'card'
                ? document.getElementById('cardListView')
                : document.getElementById('classicTableView');
            if (target) { target.style.transition = 'opacity 0.12s'; target.style.opacity = '0.35'; }

            try {
                const ctrl = _serverSearchAbort;
                const timer = setTimeout(() => ctrl.abort(), 30000);
                const resp = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
                clearTimeout(timer);
                if (!resp.ok) throw new Error(`${resp.status}`);
                const data = await resp.json();

                const records = (data.records || []).map((row, idx) =>
                    normalizeRecord(row, idx)
                );
                serverState.page = 1;
                serverState.pageSize = data.page_size || ROWS_PER_PAGE;
                serverState.searchTotalPages = data.total_pages || 1;
                serverState.searchTotalRecords = data.total_records || 0;
                serverState.records = records;
                filteredData = records;
                registerRecords(records);

                _infScrollReset(records, data.total_pages || 1, data.total_records || 0, searchTerm);
                buildDataTable();
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.warn('Server search failed:', err);
            } finally {
                if (target) { target.style.opacity = '1'; }
            }
        }

        function setProgress(pct, text) {
            document.getElementById('progressFill').style.width = pct + '%';
            if (text) document.getElementById('loadingText').textContent = text;
        }

        function updateRemoteDatasetUI() {
            const configured = !!(DATASET_API_URL && DATASET_FACETS_URL && DATASET_SUMMARY_URL && DATASET_RECORDS_URL);
            if (vmLoadBtn) {
                // Always show main CTA; if no API, it loads bootstrap/sample instead
                if (!configured) {
                    vmLoadBtn.textContent = '🔍 Explore Full Dashboard';
                    vmLoadBtn.onclick = function() {
                        loadOverviewBootstrapThenServerBrowse(false);
                    };
                }
                vmLoadBtn.classList.remove('hidden');
                vmLoadBtn.disabled = false;
            }
            const hint = document.getElementById('uploadHintDetail');
            if (!hint) return;
            if (!configured) {
                hint.textContent = '';
                return;
            }
            const sourceLabel = VM_BASE_URL ? ` via ${VM_BASE_URL}` : '';
            hint.innerHTML = `Connected to analytics server${escapeHtml(sourceLabel)}.`;
        }

        function shouldAutoLoadRemoteData() {
            if (!DATASET_API_URL) return false;
            try {
                const url = new URL(window.location.href);
                const source = String(url.searchParams.get('source') || '').toLowerCase();
                const autoload = String(url.searchParams.get('autoload') || '').toLowerCase();
                if (source === 'upload' || autoload === '0' || autoload === 'false') return false;
                if (source === 'vm' || autoload === '1' || autoload === 'true' || autoload === 'vm') return true;
            } catch {
                // Fall back to host-based default below.
            }
            return isGithubPagesHost();
        }

        function resetDatasetMetadata() {
            datasetMetadata = {
                downloadedAt: '',
                modifiedAt: '',
                datasetPath: ''
            };
        }

        function setDatasetMetadata(meta = {}) {
            datasetMetadata = {
                downloadedAt: String(meta.downloaded_at || meta.downloadedAt || '').trim(),
                modifiedAt: String(meta.modified_at || meta.modifiedAt || '').trim(),
                datasetPath: String(meta.dataset_path || meta.datasetPath || '').trim()
            };
        }

        function formatDatasetDate(value, includeTime = false) {
            const raw = String(value || '').trim();
            if (!raw) return '';
            const parsed = new Date(raw);
            if (!Number.isNaN(parsed.getTime())) {
                return includeTime
                    ? parsed.toLocaleString('en-GB')
                    : parsed.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
            }
            return raw;
        }

        function updateDatasetMetadataUI() {
            const value = document.getElementById('infoDatasetCutoff');
            if (!value) return;

            if (datasetMetadata.downloadedAt) {
                value.textContent = `Last update: ${formatDatasetDate(datasetMetadata.downloadedAt)}`;
                return;
            }

            if (activeDataSource === 'vm_api' && datasetMetadata.modifiedAt) {
                value.textContent = `Last update: ${formatDatasetDate(datasetMetadata.modifiedAt, true)}`;
                return;
            }

            value.textContent = '';
        }

        async function fetchRemoteDatasetHealth(timeoutMs = 10000) {
            if (!DATASET_HEALTH_URL) return null;
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeoutMs);
            try {
                const response = await fetch(DATASET_HEALTH_URL, { cache: 'no-store', signal: ctrl.signal });
                clearTimeout(timer);
                if (!response.ok) {
                    throw new Error(`Unable to fetch dataset metadata (${response.status})`);
                }
                return await response.json();
            } catch (err) {
                clearTimeout(timer);
                console.warn('Remote dataset health check failed:', err);
                return null;
            }
        }

        async function fetchOverviewBootstrap() {
            // Reuse the landing-preview copy if autoFetchLandingPreview already downloaded
            // it — same 227KB JSON, same payload. Previously bootstrap was fetched twice
            // on every cold start (once for mini-charts, once here for analytics).
            if (window._landingBootstrapData) {
                return window._landingBootstrapData;
            }
            // Or — much more common on cold start — if the landing fetch is still in
            // flight, await THAT promise instead of starting a duplicate.
            if (window._landingBootstrapPromise) {
                try {
                    const body = await window._landingBootstrapPromise;
                    if (body) return body;
                } catch { /* fall through to the normal path below */ }
            }
            const cached = loadBootstrapFromCache();
            const headers = cached?.etag ? { 'If-None-Match': cached.etag } : {};
            try {
                const response = await fetch(OVERVIEW_BOOTSTRAP_PATH, { cache: 'default', headers });
                if (response.status === 304 && cached) {
                    return cached.body;
                }
                if (!response.ok) {
                    if (cached) return cached.body; // last-resort fallback to stale cache
                    throw new Error(`Unable to fetch overview bootstrap JSON (${response.status})`);
                }
                const body = await response.json();
                const etag = response.headers.get('ETag');
                saveBootstrapToCache(etag, body);
                return body;
            } catch (err) {
                if (cached) {
                    console.debug('Bootstrap fetch failed; using cached copy:', err);
                    return cached.body;
                }
                throw err;
            }
        }

        function applyOverviewBootstrap(payload = {}) {
            const summary = payload.summary || {};
            const mapCountryCounts = Array.isArray(payload.map_country_counts) ? payload.map_country_counts : [];
            const precomputedAnalytics = payload.analytics_precomputed ? payload.analytics : null;
            overviewBootstrapMode = true;
            fullDatasetBackgroundReady = false;
            activeDataSource = 'overview_bootstrap';
            fileName = payload.file_name || 'overview-bootstrap.json';
            fileFormat = 'Bootstrap JSON';
            setDatasetMetadata(payload.dataset_metadata || {});
            resetServerState();
            serverState.summary = summary;
            serverState.totalRecords = Number(summary.total_records || 0);
            serverState.mapCountryCounts = mapCountryCounts;

            if (precomputedAnalytics) {
                serverState.analytics = {
                    trends: precomputedAnalytics.trends || null,
                    themes: precomputedAnalytics.themes || null,
                    text: precomputedAnalytics.text || null
                };
                serverState.analyticsLoading = {};
                bootstrapAnalyticsReady = true;
            }

            rawData = [];
            filteredData = [];
            chartData = [];
            recordMap = new Map();
            selectedRowIds.clear();

            document.getElementById('loadingIndicator').classList.add('hidden');
            uploadSection.classList.add('hidden');
            destroyMiniCharts(); // Free landing page mini-charts
            document.getElementById('dataInfo').classList.remove('hidden');
            updateDatasetMetadataUI();
            document.getElementById('sampleNotice').classList.add('hidden');
            document.getElementById('filtersSection').classList.remove('active');
            document.getElementById('kpiSection').classList.remove('hidden');
            { const _cc = document.getElementById('classifierCta'); if (_cc) { _cc.classList.remove('hidden'); _cc.classList.add('active'); } }
            // statsSection removed from DOM
            document.getElementById('tabsSection').classList.remove('hidden');
            document.getElementById('emptyState').classList.add('hidden');

            updateServerSummaryUI(summary);

            if (precomputedAnalytics) {
                setStatusBanner({
                    visible: true,
                    title: 'Full Dataset Analytics Ready',
                    message: `All charts loaded instantly from pre-computed analytics (${Number(summary.total_records || 0).toLocaleString()} records). VM browse mode is connecting for interactive filtering and the data table.`,
                    showAnalysisButton: false
                });
            } else {
                setStatusBanner({
                    visible: true,
                    title: 'Overview Snapshot Ready',
                    message: 'The first tab is loaded from a small JSON snapshot for speed. Interactive VM browse mode is loading in the background now.',
                    showAnalysisButton: false
                });
                setVmLoadingNotice(true, 'VM data is loading in the background. Please wait before expecting complete trends, themes, and text plots.');
            }
            activateTab('overview');
            updateSelectedCountInfo();

            // Apply quick-explore filter from landing page selection
            applyQuickExploreFilter();
        }

        function applyQuickExploreFilter() {
            if (!window._quickExploreFilter) return;
            const qf = window._quickExploreFilter;
            window._quickExploreFilter = null;
            setTimeout(() => {
                try {
                    // Map landing-chart / landing-search filter types to the dashboard's
                    // multi-select filter elements. Previously only countries / regions /
                    // bodies were routed properly — themes and affected_persons fell back
                    // to a quoted-phrase text search, which returned 0 records (theme
                    // names like "Constitutional & legislative reform" don't appear as
                    // literal text in the recommendations). Now all facet-backed filters
                    // route to their real multi-select, so clicking a bar applies the
                    // correct filter and shows real results.
                    const selectMap = {
                        countries: 'filterCountry',
                        regions: 'filterRegion',
                        bodies: 'filterBody',
                        themes: 'filterTheme',
                        affected_persons: 'filterAffectedPersons',
                        sdgs: 'filterSdg'
                    };
                    const selectId = selectMap[qf.type];
                    const cleanValue = (qf.value || '').replace(/^-+\s*/, '').trim();
                    let applied = false;

                    if (selectId) {
                        const select = document.getElementById(selectId);
                        if (select) {
                            const cleanLower = cleanValue.toLowerCase();
                            for (const opt of select.options) {
                                const optClean = opt.value.replace(/^-+\s*/, '').trim();
                                if (optClean === cleanValue
                                    || opt.value === qf.value
                                    || optClean.toLowerCase() === cleanLower) {
                                    opt.selected = true;
                                    applied = true;
                                    break;
                                }
                            }
                        }
                    }

                    if (applied) {
                        if (selectId && _chipSelects[selectId]) _chipSelects[selectId].sync();
                        // Open the filters section so the user sees the chip they just applied
                        const details = document.getElementById('filterFacetsDetails');
                        if (details) details.open = true;
                        applyFilters();
                    } else {
                        console.debug('Quick explore: no matching filter option for', qf);
                    }
                } catch (e) { console.debug('Quick explore filter apply failed:', e); }
            }, 500);
        }

        async function loadOverviewBootstrap(showErrors = true) {
            try {
                const payload = await fetchOverviewBootstrap();
                applyOverviewBootstrap(payload);
                return true;
            } catch (err) {
                console.error('Overview bootstrap load failed:', err);
                if (showErrors) {
                    alert('Failed to load the overview snapshot.\n\n' + (err?.message || err));
                }
                return false;
            }
        }

        async function fallbackToBundledSample(reason) {
            console.warn('Falling back to bundled sample data. Reason:', reason);
            removeAllTabLoadingSpinners();
            setVmLoadingNotice(false);
            overviewBootstrapMode = false;
            fullDatasetBackgroundReady = false;
            await loadBundledSampleData(false);
            setStatusBanner({
                visible: true,
                title: 'Loaded Sample Dataset',
                message: `The VM server could not be reached (${reason}). The dashboard loaded a bundled sample dataset so all tabs are fully interactive. Use the VM button to retry the server connection.`,
                showAnalysisButton: false
            });
        }

        async function loadOverviewBootstrapThenServerBrowse(showErrors = true) {
            const loadedBootstrap = await loadOverviewBootstrap(false);
            if (loadedBootstrap) {
                try {
                    await loadRemoteDatasetServerMode(false, { background: true, preserveBootstrapOnFailure: true });
                } catch (err) {
                    console.error('Background server browse init failed:', err);
                    if (bootstrapAnalyticsReady) {
                        console.info('VM unreachable but bootstrap analytics cover all chart tabs. Staying on bootstrap.');
                        setVmLoadingNotice(false);
                        setStatusBanner({
                            visible: true,
                            title: 'Full Dataset Analytics (Offline)',
                            message: `All charts show pre-computed analytics for ${Number(serverState.totalRecords || 0).toLocaleString()} records. The VM is not reachable, so filtering and the data table are unavailable. Use the VM button to retry.`,
                            showAnalysisButton: false
                        });
                    } else {
                        await fallbackToBundledSample(err?.message || 'connection failed');
                    }
                }
                return;
            }
            try {
                await loadRemoteDatasetServerMode(showErrors);
            } catch (err) {
                console.error('Direct server browse init failed:', err);
                await fallbackToBundledSample(err?.message || 'connection failed');
            }
        }

        function resetServerState() {
            serverState = {
                loaded: false,
                page: 1,
                pageSize: ROWS_PER_PAGE,
                totalPages: 1,
                totalRecords: 0,
                records: [],
                facets: null,
                summary: null,
                mapCountryCounts: [],
                analysisLimit: SERVER_ANALYSIS_EXPORT_LIMIT_DEFAULT,
                analytics: {
                    trends: null,
                    themes: null,
                    text: null
                },
                analyticsLoading: {},
                analyticsFilterKey: ''
            };
        }

        function _setDataStatus(state, label) {
            const dot = document.getElementById('dataStatusDot');
            const text = document.getElementById('dataStatusText');
            if (!dot || !text) return;
            const colors = { connecting: '#ff9800', connected: '#4caf50', ready: '#4caf50', loading: '#ff9800', error: '#c62828', local: '#4a90d9' };
            dot.style.background = colors[state] || '#999';
            if (state === 'connecting') {
                dot.style.animation = 'pulse 1.2s infinite';
            } else {
                dot.style.animation = 'none';
            }
            text.textContent = label || state;
        }

        function setStatusBanner({ visible = false, title = 'Server browse mode is active', message = '', showAnalysisButton = false } = {}) {
            const banner = document.getElementById('serverModeBanner');
            const titleEl = document.getElementById('serverModeTitle');
            const analysisBtn = document.getElementById('serverAnalysisBtn');
            if (banner) banner.classList.toggle('hidden', !visible);
            if (titleEl) titleEl.textContent = title;
            if (analysisBtn) analysisBtn.classList.toggle('hidden', !showAnalysisButton);
            setServerModeStatus(message);
        }

        function setServerModeStatus(message) {
            const statusEl = document.getElementById('serverModeStatus');
            if (statusEl) {
                statusEl.textContent = message || 'Browse and map run on the VM. Overview charts use server aggregates, other tabs use the current page until you load full analytics.';
            }
        }

        function setVmLoadingNotice(active = false, message = '') {
            const notice = document.getElementById('vmLoadingNotice');
            const textEl = document.getElementById('vmLoadingNoticeText');
            if (!notice || !textEl) return;
            notice.classList.toggle('hidden', !active);
            textEl.textContent = message || 'VM data is still loading. Please wait until this notice disappears before expecting complete charts in every tab.';
        }

        function showTabLoadingSpinner(tabName, message) {
            const target = document.getElementById(`tab-${tabName}`);
            if (!target) return;
            if (target.querySelector('.tab-loading-overlay')) return;
            const overlay = document.createElement('div');
            overlay.className = 'tab-loading-overlay';
            overlay.innerHTML = `<div class="spinner"></div>`
                + `<div class="tab-loading-message">${message || 'Loading data from the server...'}</div>`
                + `<div class="tab-loading-fallback-hint">If this takes too long, sample data will load automatically.</div>`;
            target.prepend(overlay);
        }

        function removeTabLoadingSpinner(tabName) {
            const target = document.getElementById(`tab-${tabName}`);
            if (!target) return;
            const overlay = target.querySelector('.tab-loading-overlay');
            if (overlay) overlay.remove();
        }

        function removeAllTabLoadingSpinners() {
            document.querySelectorAll('.tab-loading-overlay').forEach(el => el.remove());
        }

        function activateTab(tabName = 'overview') {
            preferredActiveTab = tabName;
            const target = document.getElementById(`tab-${tabName}`);
            if (!target) return;
            document.querySelectorAll('.tab').forEach(tab => {
                tab.classList.toggle('active', tab.dataset.tab === tabName);
            });
            document.querySelectorAll('.charts-section, .data-table-section').forEach(section => {
                section.classList.remove('active');
            });
            target.classList.add('active');
            requestAnimationFrame(() => {
                renderTabContent(tabName);
            });
        }

        function bindTabSwitching() {
            document.querySelectorAll('.tab').forEach(tab => {
                tab.onclick = () => {
                    activateTab(tab.dataset.tab);
                    _pushUrlState();
                };
            });
        }

        // ── Shareable URL state ──
        // Encodes filters, tab, and search into the URL hash so users can
        // bookmark and share specific views.
        // Format: #tab=data&q=asylum+seekers&country=PL,DE&body=CRC&year=2020-2024&search=child
        function _copyShareLink(btn) {
            _pushUrlState();
            setTimeout(() => {
                const url = window.location.href;
                navigator.clipboard.writeText(url).then(() => {
                    const orig = btn.innerHTML;
                    btn.innerHTML = '✓ Copied!';
                    btn.style.color = '#2e7d32';
                    setTimeout(() => { btn.innerHTML = orig; btn.style.color = '#667'; }, 2000);
                }).catch(() => {
                    prompt('Copy this link:', url);
                });
            }, 400);
        }

        let _urlStatePushTimer = null;

        function _pushUrlState() {
            clearTimeout(_urlStatePushTimer);
            _urlStatePushTimer = setTimeout(() => {
                const params = new URLSearchParams();
                const tab = preferredActiveTab || 'overview';
                if (tab !== 'overview') params.set('tab', tab);

                // Main filters
                const filters = getServerFilterState();
                if (filters.textQuery) params.set('q', filters.textQuery);
                if (filters.countries.length) params.set('country', filters.countries.join(','));
                if (filters.bodies.length) params.set('body', filters.bodies.join(','));
                if (filters.regions.length) params.set('region', filters.regions.join(','));
                if (filters.annotationType.length) params.set('type', filters.annotationType.join(','));
                // Theme / SDG / affected_persons values may contain commas (e.g. "Children:
                // definition; general principles; protection"), so we use `|` as the delimiter
                // — the same convention as the VM API for these fields.
                if (filters.themes.length) params.set('theme', filters.themes.join('|'));
                if (filters.sdgs.length) params.set('sdg', filters.sdgs.join('|'));
                if (filters.affectedPersons.length) params.set('affected', filters.affectedPersons.join('|'));
                if (filters.yearStart) params.set('year_from', String(filters.yearStart));
                if (filters.yearEnd) params.set('year_to', String(filters.yearEnd));

                // Data tab search
                const tableSearch = (document.getElementById('tableSearch')?.value || '').trim();
                if (tableSearch) params.set('search', tableSearch);

                const hash = params.toString();
                const newUrl = hash ? `#${hash}` : window.location.pathname + window.location.search;
                if (window.location.hash.slice(1) !== hash) {
                    history.replaceState(null, '', newUrl);
                }
            }, 300);
        }

        function _restoreUrlState() {
            const hash = window.location.hash.slice(1);
            if (!hash) return false;
            try {
                const params = new URLSearchParams(hash);
                let restored = false;

                // Restore main filter text
                const q = params.get('q');
                if (q) {
                    const el = document.getElementById('filterText');
                    if (el) { el.value = q; restored = true; }
                }

                // Restore country
                const country = params.get('country');
                if (country) {
                    _restoreMultiSelect('filterCountry', country.split(','));
                    restored = true;
                }

                // Restore body
                const body = params.get('body');
                if (body) {
                    _restoreMultiSelect('filterBody', body.split(','));
                    restored = true;
                }

                // Restore region
                const region = params.get('region');
                if (region) {
                    _restoreMultiSelect('filterRegion', region.split(','));
                    restored = true;
                }

                // Restore theme / sdg / affected_persons — pipe-delimited because values
                // can contain commas (e.g. "Children: definition; general principles").
                const theme = params.get('theme');
                if (theme) { _restoreMultiSelect('filterTheme', theme.split('|')); restored = true; }
                const sdg = params.get('sdg');
                if (sdg) { _restoreMultiSelect('filterSdg', sdg.split('|')); restored = true; }
                const affected = params.get('affected');
                if (affected) { _restoreMultiSelect('filterAffectedPersons', affected.split('|')); restored = true; }

                // Restore type
                const type = params.get('type');
                if (type) {
                    const el = document.getElementById('filterType');
                    if (el) { el.value = type; restored = true; }
                }

                // Restore year range
                const yearFrom = params.get('year_from');
                const yearTo = params.get('year_to');
                if (yearFrom) { const el = document.getElementById('filterYearStart'); if (el) { el.value = yearFrom; restored = true; } }
                if (yearTo) { const el = document.getElementById('filterYearEnd'); if (el) { el.value = yearTo; restored = true; } }

                // Restore Data tab search
                const search = params.get('search');
                if (search) {
                    const el = document.getElementById('tableSearch');
                    if (el) { el.value = search; _serverSearchFilter = search; }
                }

                // Restore active tab
                const tab = params.get('tab');
                if (tab) {
                    setTimeout(() => activateTab(tab), 100);
                }

                return restored;
            } catch (e) {
                console.warn('Failed to restore URL state:', e);
                return false;
            }
        }

        function _restoreMultiSelect(selectId, values) {
            const el = document.getElementById(selectId);
            if (!el) return;
            Array.from(el.options).forEach(opt => {
                opt.selected = values.includes(opt.value);
            });
            if (_chipSelects[selectId]) _chipSelects[selectId].sync();
        }

        function renderTabContent(tabName = 'overview') {
            // Inject copy-to-clipboard buttons and context subtitles on chart cards after rendering.
            requestAnimationFrame(() => {
                if (typeof initChartCopyButtons === 'function') initChartCopyButtons();
                if (typeof updateChartContextSubtitles === 'function') updateChartContextSubtitles();
            });
            if (overviewBootstrapMode && !fullDatasetBackgroundReady && tabName !== 'overview') {
                if (bootstrapAnalyticsReady && tabName !== 'data') {
                    // Pre-computed analytics available — render charts directly
                } else if (tabName === 'data') {
                    showTabLoadingSpinner(tabName, 'The data table requires a VM connection for browsing records. Connecting...');
                    return;
                } else {
                    showTabLoadingSpinner(tabName, 'Connecting to the VM server to load this tab...');
                    return;
                }
            }
            if (serverBrowseMode) {
                const requiredSections = getServerAnalyticsSectionsForTab(tabName);
                if (requiredSections.length && !areServerAnalyticsSectionsReady(requiredSections)) {
                    showTabLoadingSpinner(tabName, `Loading ${requiredSections.join(', ')} analytics from the server...`);
                    ensureServerAnalyticsSections(requiredSections, false)
                        .then(() => {
                            removeTabLoadingSpinner(tabName);
                            const target = document.getElementById(`tab-${tabName}`);
                            if (target && target.classList.contains('active')) {
                                renderTabContent(tabName);
                            }
                        })
                        .catch(err => {
                            removeTabLoadingSpinner(tabName);
                            console.error(`Failed to hydrate ${tabName} analytics from VM:`, err);
                        });
                    return;
                }
            }
            removeTabLoadingSpinner(tabName);
            if (tabName === 'overview') {
                updateOverviewWorldMap();
                updateYearlyTrendChart();
                updateBodyDistributionChart();
                updateRegionDistributionChart();
                resizeOverviewWorldMap();
                return;
            }
            if (tabName === 'trends') {
                updateStackedChart();
                updateCumulativeChart();
                updateYoYChart();
                return;
            }
            if (tabName === 'themes') {
                updateThemeRadarChart();
                updateTopThemesChart();
                updateThemeTrendsChart();
                updateEscCcprTrendChart();
                updateRightsScatterChart();
                return;
            }
            if (tabName === 'bodies') {
                updateBodyScatterChart();
                updateBodyHeatmapChart();
                updateRegionComparisonChart();
                return;
            }
            if (tabName === 'compare') {
                _initCompareSelects();
                updateCompareCharts();
                return;
            }
            if (tabName === 'text') {
                const hasTextData = useServerAnalytics()
                    ? !!serverState.analytics?.text
                    : (chartData && chartData.length > 0);
                const placeholder = document.getElementById('textAnalyticsPlaceholder');
                const container = document.getElementById('textChartsContainer');
                if (useServerAnalytics() && !hasTextData) {
                    // Text analytics not yet computed for this filter — show
                    // "Generate Text Analytics" button instead of auto-fetching
                    if (placeholder) placeholder.classList.remove('hidden');
                    if (container) container.classList.add('hidden');
                    // Reset the generate button state in case it was previously used
                    const btn = document.getElementById('generateTextAnalyticsBtn');
                    const spinner = document.getElementById('textAnalyticsSpinner');
                    if (btn) btn.disabled = false;
                    if (spinner) spinner.classList.add('hidden');
                } else if (hasTextData) {
                    if (placeholder) placeholder.classList.add('hidden');
                    if (container) container.classList.remove('hidden');
                    updateAffectedPersonsChart();
                    updateSDGsChart();
                    updateBigramsChart();
                    updateTextLengthChart();
                    updateTextSamplingDisclaimer(
                        useServerAnalytics() ? serverState.analytics?.text : null
                    );
                } else {
                    // No server analytics and no local data — show empty state
                    if (placeholder) placeholder.classList.add('hidden');
                    if (container) container.classList.remove('hidden');
                    updateAffectedPersonsChart();
                    updateSDGsChart();
                    updateBigramsChart();
                    updateTextLengthChart();
                    updateTextSamplingDisclaimer(null);
                }
                return;
            }
            if (tabName === 'labels') {
                const hasLabels = (chartData || []).some(r => r._predictedLabels && r._predictedLabels.length > 0);
                const emptyEl = document.getElementById('labelsEmptyState');
                const chartsEl = document.getElementById('labelsChartsContent');
                if (emptyEl) emptyEl.classList.toggle('hidden', hasLabels);
                if (chartsEl) chartsEl.classList.toggle('hidden', !hasLabels);
                // Show the Offline & Private Mode CTA only when we're in server-browse
                // mode (full dataset not loaded locally). Classifier training requires
                // the full dataset in memory, which is exactly what Offline Mode enables.
                const offlineCta = document.getElementById('labelsOfflineModeCta');
                if (offlineCta) {
                    const fullDatasetLoaded = rawData && rawData.length >= 100000;
                    offlineCta.classList.toggle('hidden', hasLabels || fullDatasetLoaded);
                }
                if (hasLabels) {
                    updateLabelCoverageChart();
                    updateLabelDistributionChart();
                    updateLabelTrendsChart();
                    updateLabelPairsChart();
                    updateLabelBigramsChart();
                    updateLabelStatsGrid();
                    updateLabelYearlyChart();
                    updateLabelBodiesChart();
                    updateLabelThemeTrendsChart();
                    updateLabelEscCcprChart();
                    updateLabelBodyScatterChart();
                }
                return;
            }
            if (tabName === 'data') {
                buildDataTable();
            }
        }

        function setServerBrowseMode(active) {
            serverBrowseMode = !!active;
            overviewBootstrapMode = false;
            // Keep bootstrapAnalyticsReady true during transition so tabs stay
            // functional until fresh VM analytics arrive and replace them.
            if (!active) bootstrapAnalyticsReady = false;
            removeAllTabLoadingSpinners();
            const banner = document.getElementById('serverModeBanner');
            const trainBtn = document.getElementById('trainClassifierBtn');
            const exportAllBtn = document.getElementById('exportAllBtn');
            const exportFilteredBtn = document.getElementById('exportFilteredBtn');
            const analysisBtn = document.getElementById('serverAnalysisBtn');
            const tableSearch = document.getElementById('tableSearch');
            const searchHint = document.getElementById('pageTextFilterHint');
            const mapNote = document.getElementById('overviewWorldMapNote');

            if (banner) banner.classList.toggle('hidden', !serverBrowseMode);
            if (trainBtn) {
                trainBtn.disabled = false;
                trainBtn.textContent = 'Open Labeling Tool';
            }
            if (analysisBtn) {
                analysisBtn.disabled = false;
            }
            if (exportAllBtn) {
                exportAllBtn.textContent = '⬇ Export 100 rows on screen';
            }
            if (exportFilteredBtn) {
                exportFilteredBtn.textContent = serverBrowseMode
                    ? '📥 Export full filtered result (up to 50 000)'
                    : '📥 Export full filtered result';
            }
            if (tableSearch) {
                tableSearch.placeholder = serverBrowseMode
                    ? 'Filter on-screen text only...'
                    : 'Filter the text column on this page...';
            }
            if (searchHint) {
                searchHint.textContent = serverBrowseMode
                    ? 'On-screen only. Use Search Text above for the full filtered dataset.'
                    : 'On-screen only. Refines the visible page/cards without changing the main dataset filter.';
            }
            if (mapNote) {
                mapNote.textContent = serverBrowseMode
                    ? 'Zoom with mouse wheel and drag to pan. Colors represent recommendation frequency across the full current VM filter.'
                    : 'Zoom with mouse wheel and drag to pan. Colors represent recommendation frequency in the current filter.';
            }
            document.querySelectorAll('#tabsSection .tab').forEach(tab => {
                tab.classList.remove('hidden');
            });
            if (serverBrowseMode) {
                activateTab(preferredActiveTab || 'overview');
            }
            if (!serverBrowseMode) {
                resetServerState();
                setServerModeStatus('');
            }
        }

        function populateServerFacets() {
            const facets = serverState.facets || {};
            populateSelect('filterCountry', facets.countries || []);
            populateSelect('filterBody', [...new Set((facets.bodies || []).map(_standardizeBody).filter(Boolean))].sort());
            populateSelect('filterRegion', facets.regions || []);
            const _clean = s => s.replace(/^-+\s*/, '').trim();
            populateSelect('filterTheme', (facets.themes || []).map(_clean).filter(t => t && t.length > 2).sort());
            populateSelect('filterAffectedPersons', (facets.affected_persons || []).map(_clean).filter(t => t && t.length > 2).sort());
            populateSelect('filterSdg', (facets.sdgs || []).map(_clean).filter(t => t && t.length > 1).sort());
            const cleanTypes = (facets.types || [])
                .map(t => t.replace(/^-+\s*/, '').trim())
                .filter(t => t && t.length > 2 && !/^[0-9a-f-]{20,}$/i.test(t) && !/^\W+$/.test(t));
            populateSelect('filterType', ['All', ...cleanTypes]);
            if (Number.isFinite(facets.min_year)) {
                document.getElementById('filterYearStart').value = facets.min_year;
            }
            if (Number.isFinite(facets.max_year)) {
                document.getElementById('filterYearEnd').value = facets.max_year;
            }
            _initChipSelects();
            // Bug #1 — On initial load, _restoreUrlState() runs before facets are loaded,
            // so multi-select restores silently no-op (no options exist to match against).
            // Re-run it here now that the selects are populated so hash filters actually take
            // effect. refreshServerBrowseData (called by the outer loader) will then pick up
            // the restored form values when it builds its query.
            try { _restoreUrlState(); } catch (e) { console.debug('URL state re-restore skipped:', e); }
        }

        function getServerFilterState() {
            return {
                countries: getSelectedValues('filterCountry'),
                bodies: getSelectedValues('filterBody'),
                regions: getSelectedValues('filterRegion'),
                themes: getSelectedValues('filterTheme'),
                affectedPersons: getSelectedValues('filterAffectedPersons'),
                sdgs: getSelectedValues('filterSdg'),
                annotationType: (() => {
                    const value = document.getElementById('filterType').value;
                    return value && value !== 'All' ? [value] : [];
                })(),
                yearStart: parseInt(document.getElementById('filterYearStart').value, 10) || null,
                yearEnd: parseInt(document.getElementById('filterYearEnd').value, 10) || null,
                textQuery: String(document.getElementById('filterText').value || '').trim()
            };
        }

        function buildServerFilterCacheKey() {
            return JSON.stringify(getServerFilterState());
        }

        function appendCsvQueryParam(params, key, values) {
            if (Array.isArray(values) && values.length) {
                params.set(key, values.join(','));
            }
        }

        /**
         * For boolean queries of the form "A NOT B" (or "NOT B"), the server now accepts
         * a separate text_exclude param that becomes a NOT LIKE clause — much faster than
         * the (?!.*B) negative-lookahead regex we used to compile (which was timing out on
         * the VM at 30+ seconds). This function detects splittable patterns and returns
         * { text_query, text_exclude }; otherwise it falls back to the regex path.
         *
         * Patterns split to native params (fast, no regex):
         *   "A NOT B"       → text_query=A, text_exclude=B
         *   "NOT B"         → text_query="", text_exclude=B
         *   "\"phrase\" NOT B" → text_query=phrase, text_exclude=B
         *
         * Patterns still using regex (harder to express without regex):
         *   multi-term OR with mixed positives/negatives
         *   multiple negatives ("A NOT B NOT C")  — only first negative splits, rest stay as regex
         *   complex AND+OR mixes
         */
        function buildTextQueryParams(rawQuery) {
            const raw = String(rawQuery || '').trim();
            const empty = { text_query: '', text_exclude: '', text_query_any: [], text_query_all: [] };
            if (!raw) return empty;

            // Regex mode — pass through untouched.
            if (raw.startsWith('re:') || (raw.startsWith('/') && raw.lastIndexOf('/') > 0)) {
                return { ...empty, text_query: raw };
            }
            // No boolean operators at all → plain substring LIKE.
            if (!/\b(AND|OR|NOT)\b/.test(raw) && !raw.includes('"')) {
                return { ...empty, text_query: raw };
            }

            // Parse the query so we can pick the cheapest native-LIKE form.
            const tokens = [];
            const re = /"([^"]+)"|(\bAND\b|\bOR\b|\bNOT\b)|(\S+)/g;
            let m;
            while ((m = re.exec(raw)) !== null) {
                if (m[1] !== undefined) tokens.push({ type: 'phrase', value: m[1] });
                else if (m[2]) tokens.push({ type: 'op', value: m[2] });
                else if (m[3]) tokens.push({ type: 'word', value: m[3] });
            }
            const orGroups = [[]];
            let negate = false;
            for (const tok of tokens) {
                if (tok.type === 'op') {
                    if (tok.value === 'OR') { orGroups.push([]); negate = false; }
                    else if (tok.value === 'NOT') { negate = true; }
                } else {
                    orGroups[orGroups.length - 1].push({ term: tok.value, negate });
                    negate = false;
                }
            }

            // Shape 1 — "A NOT B" or "NOT B" or "A AND B NOT C": one OR-group, N positives,
            // exactly 1 negative. Use text_query/text_query_all + text_exclude so the backend
            // runs native LIKE + NOT LIKE instead of a PCRE regex with chained lookaheads.
            // Widened from the prior ≤1-positive rule to cover common shapes like
            //   "\"freedom of expression\" AND women NOT minors" (observed 30s timeout).
            if (orGroups.length === 1) {
                const g = orGroups[0];
                const positives = g.filter(c => !c.negate);
                const negatives = g.filter(c => c.negate);
                if (negatives.length === 1) {
                    if (positives.length >= 2) {
                        return { ...empty, text_query_all: positives.map(c => c.term), text_exclude: negatives[0].term };
                    }
                    return { ...empty, text_query: positives[0]?.term || '', text_exclude: negatives[0].term };
                }

                // Shape 2 — "A AND B AND C": one OR-group, multiple positives, no negative.
                // Route to text_query_all → (LIKE %a% AND LIKE %b% AND …). Native scans.
                if (negatives.length === 0 && positives.length >= 2) {
                    return { ...empty, text_query_all: positives.map(c => c.term) };
                }
            }

            // Shape 3 — "A OR B OR C": multiple OR-groups, each with exactly one
            // positive clause, no negatives anywhere. Route to text_query_any →
            // (LIKE %a% OR LIKE %b% OR …). Native scans, no regex.
            const isPureOr = orGroups.length >= 2 && orGroups.every(g => g.length === 1 && !g[0].negate);
            if (isPureOr) {
                return { ...empty, text_query_any: orGroups.map(g => g[0].term) };
            }

            // Fall back to regex for mixed shapes (AND+OR, multi-NOT, phrases with ops, etc.)
            // Plan C: surface Offline Mode as the fast escape hatch before the inevitable 30s
            // timeout. Triggered only when the compiled regex uses ≥2 lookarounds — the
            // pattern that empirically saturates the backend REGEXP scan on the VM.
            const fallback = convertTextQueryForServer(raw);
            const lookaroundCount = (fallback.match(/\(\?[=!<]/g) || []).length;
            if (lookaroundCount >= 2 && typeof showComplexQueryAdvisory === 'function') {
                try { showComplexQueryAdvisory(raw); } catch (_) { /* non-critical */ }
            }
            return { ...empty, text_query: fallback };
        }

        /**
         * Convert a client-side text query (which may contain AND/OR/NOT/quotes)
         * into a format the server API understands. The server supports plain text
         * (LIKE %needle%) and regex (re:pattern). It does NOT parse boolean operators.
         *
         * Strategy:
         *  - Plain text queries → sent as-is (server LIKE match)
         *  - Regex queries (re: or /.../) → sent as-is
         *  - Boolean queries (AND/OR/NOT/"phrases") → converted to regex:
         *      OR groups  → (term1|term2)
         *      AND terms  → (?=.*term1)(?=.*term2)
         *      NOT terms  → (?!.*term)
         *      Phrases    → treated as literal text within the pattern
         */
        function convertTextQueryForServer(rawQuery) {
            const raw = String(rawQuery || '').trim();
            if (!raw) return '';

            // Already regex? Pass through.
            if (raw.startsWith('re:')) return raw;
            if (raw.startsWith('/') && raw.lastIndexOf('/') > 0) return raw;

            // Not boolean? Pass through (server handles plain LIKE).
            if (!/\b(AND|OR|NOT)\b/.test(raw) && !raw.includes('"')) return raw;

            // Parse into boolean token groups (same logic as parseBooleanQuery)
            const tokens = [];
            const re = /"([^"]+)"|(\bAND\b|\bOR\b|\bNOT\b)|(\S+)/g;
            let m;
            while ((m = re.exec(raw)) !== null) {
                if (m[1] !== undefined) tokens.push({ type: 'phrase', value: m[1] });
                else if (m[2]) tokens.push({ type: 'op', value: m[2] });
                else if (m[3]) tokens.push({ type: 'word', value: m[3] });
            }
            if (!tokens.length) return raw;

            // Build OR groups, each with AND/NOT clauses
            const orGroups = [[]];
            let negate = false;
            for (const tok of tokens) {
                if (tok.type === 'op') {
                    if (tok.value === 'OR') { orGroups.push([]); negate = false; }
                    else if (tok.value === 'NOT') { negate = true; }
                    // AND is implicit
                } else {
                    orGroups[orGroups.length - 1].push({ term: tok.value, negate });
                    negate = false;
                }
            }

            // Convert each OR group into a regex pattern
            // Each group: positive terms as lookaheads (?=.*term), negatives as (?!.*term)
            // Groups joined by |
            const escRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Fix (Obs #2): a single quoted phrase (or any single positive clause with no
            // operators) should be sent as plain text. Server uses LIKE '%needle%' which
            // is the correct semantics for a phrase and avoids regex overhead entirely.
            if (orGroups.length === 1 && orGroups[0].length === 1 && !orGroups[0][0].negate) {
                return orGroups[0][0].term;
            }

            // Fix (Obs #3): pure OR of single positive terms (no AND within any group,
            // no NOT anywhere) can use simple alternation (a|b|c) instead of per-term
            // lookaheads. ~3–5× faster on the VM for queries like "prison OR jail OR
            // detention" because it avoids Python regex's quadratic lookahead behaviour.
            const isPureOr = orGroups.every(g => g.length === 1 && !g[0].negate);
            if (isPureOr && orGroups.length > 1) {
                const terms = orGroups.map(g => escRx(g[0].term)).join('|');
                return `re:(?i)(?:${terms})`;
            }

            const groupPatterns = orGroups.map(group => {
                const parts = [];
                for (const clause of group) {
                    const escaped = escRx(clause.term);
                    if (clause.negate) {
                        parts.push(`(?!.*${escaped})`);
                    } else {
                        parts.push(`(?=.*${escaped})`);
                    }
                }
                // Lookaheads must all succeed at position 0, then match rest
                return parts.join('') + '.*';
            });

            let pattern;
            if (groupPatterns.length === 1) {
                pattern = groupPatterns[0];
            } else {
                pattern = groupPatterns.map(p => `(?:${p})`).join('|');
            }

            return `re:(?i)${pattern}`;
        }

        function buildServerQueryParams(options = {}) {
            const filters = getServerFilterState();
            const params = new URLSearchParams();
            appendCsvQueryParam(params, 'countries', filters.countries);
            appendCsvQueryParam(params, 'bodies', filters.bodies);
            appendCsvQueryParam(params, 'regions', filters.regions);
            appendCsvQueryParam(params, 'themes', filters.themes);
            appendCsvQueryParam(params, 'affected_persons', filters.affectedPersons);
            appendCsvQueryParam(params, 'sdgs', filters.sdgs);
            appendCsvQueryParam(params, 'annotation_type', filters.annotationType);
            if (filters.yearStart) params.set('year_start', String(filters.yearStart));
            if (filters.yearEnd) params.set('year_end', String(filters.yearEnd));
            if (filters.textQuery) {
                // Route through buildTextQueryParams which picks the cheapest native-LIKE
                // shape the server can handle:
                //   text_query           — plain substring        (LIKE %x%)
                //   text_exclude         — "A NOT B"              (LIKE + NOT LIKE)
                //   text_query_all       — "A AND B AND C"        (N × LIKE, AND'd)
                //   text_query_any       — "A OR B OR C"          (N × LIKE, OR'd)
                //   text_query (regex)   — everything else        (re: fallback)
                // Measured on VM: "women OR expression" went from 30s+ timeout to ~7s.
                const tq = buildTextQueryParams(filters.textQuery);
                if (tq.text_query) params.set('text_query', tq.text_query);
                if (tq.text_exclude) params.set('text_exclude', tq.text_exclude);
                if (tq.text_query_any && tq.text_query_any.length) params.set('text_query_any', tq.text_query_any.join('|'));
                if (tq.text_query_all && tq.text_query_all.length) params.set('text_query_all', tq.text_query_all.join('|'));
            }
            if (options.textFilter) params.set('text_filter', options.textFilter);

            if (options.includePagination !== false) {
                params.set('page', String(options.page || currentPage || 1));
                params.set('page_size', String(options.pageSize || serverState.pageSize || ROWS_PER_PAGE));
            }
            if (options.includeSort !== false && currentSort.column) {
                params.set('sort_by', currentSort.column);
                params.set('sort_dir', currentSort.direction || 'asc');
            }
            if (options.limit) {
                params.set('limit', String(options.limit));
            }
            return params;
        }

        // ── Plan A: LRU + TTL response cache. Keyed on full URL (which encodes every
        //    filter param and sort/page), so repeat navigations (tab switches, back-button,
        //    filter-then-unfilter) render instantly instead of re-hitting the VM's 15-19s
        //    analytics path. Caller can opt out via `options.skipCache`. Health/status
        //    endpoints are never cached so the user always sees a fresh heartbeat. ──
        const _serverResponseCache = new Map();
        const _SERVER_CACHE_MAX = 50;
        const _SERVER_CACHE_TTL_MS = 5 * 60 * 1000;
        function _shouldCacheUrl(url) {
            if (!url) return false;
            if (/\/api\/data\/health\b/.test(url)) return false;
            if (/\/api\/data\/export\b/.test(url)) return false;
            return true;
        }
        function _getServerCached(url) {
            const entry = _serverResponseCache.get(url);
            if (!entry) return null;
            if (entry.expiresAt < Date.now()) {
                _serverResponseCache.delete(url);
                return null;
            }
            _serverResponseCache.delete(url);
            _serverResponseCache.set(url, entry);
            return entry.body;
        }
        function _putServerCached(url, body) {
            if (body == null) return;
            if (_serverResponseCache.size >= _SERVER_CACHE_MAX) {
                const oldestKey = _serverResponseCache.keys().next().value;
                _serverResponseCache.delete(oldestKey);
            }
            _serverResponseCache.set(url, { body, expiresAt: Date.now() + _SERVER_CACHE_TTL_MS });
        }
        function invalidateServerCache() { _serverResponseCache.clear(); }

        // ── Plan B: progressive slow-request notice.
        //    At 8s → "Still loading…" with Cancel. At 20s → upgrade to Offline Mode CTA
        //    (10s before the 30s hard timeout, so users see the escape hatch earlier).
        //    Reference-counted across parallel fetches; auto-clears when all settle. ──
        const _activeAbortControllers = new Set();
        let _slowRequestPendingCount = 0;
        function _renderSlowRequestNotice(phase) {
            let el = document.getElementById('slowRequestNotice');
            if (!el) {
                el = document.createElement('div');
                el.id = 'slowRequestNotice';
                el.style.cssText = 'position:fixed; top:16px; left:50%; transform:translateX(-50%); z-index:2147483641; max-width:520px; background:#fff; border:1px solid #e3e8ef; border-left:4px solid #6b7280; color:#1f2937; padding:10px 14px; border-radius:8px; box-shadow:0 8px 28px rgba(0,0,0,0.12); font-size:13px; line-height:1.5;';
                document.body.appendChild(el);
            }
            if (phase === 'slow') {
                el.style.borderLeftColor = '#6b7280';
                el.innerHTML = `
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div class="spinner" style="width:14px; height:14px; border:2px solid #d1d5db; border-top-color:#4b5563; border-radius:50%; animation:spin 0.8s linear infinite; flex:0 0 auto;"></div>
                        <div style="flex:1;">Still loading…</div>
                        <button type="button" onclick="_cancelSlowRequests()" style="background:#f3f4f6; border:1px solid #d1d5db; color:#1f2937; padding:4px 10px; font-size:12px; border-radius:4px; cursor:pointer;">Cancel</button>
                    </div>`;
            } else {
                el.style.borderLeftColor = '#1a6fb5';
                el.innerHTML = `
                    <div>
                        <div style="font-weight:600; margin-bottom:4px;">⏳ This query is taking longer than usual</div>
                        <div style="color:#374151; font-size:12.5px;">The server may still respond, or it may time out at 30s. Complex boolean/regex queries run instantly in Offline Mode — the dataset stays in your browser.</div>
                        <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
                            <button class="btn btn-primary" onclick="document.getElementById('slowRequestNotice').remove(); openOfflineModeModal();" style="padding:5px 10px; font-size:12px;">🔒 Enable Offline Mode</button>
                            <button type="button" onclick="_cancelSlowRequests()" style="background:#f3f4f6; border:1px solid #d1d5db; color:#1f2937; padding:5px 10px; font-size:12px; border-radius:4px; cursor:pointer;">Cancel request</button>
                        </div>
                    </div>`;
            }
        }
        function _dismissSlowRequestNotice() {
            const el = document.getElementById('slowRequestNotice');
            if (el) el.remove();
        }
        window._cancelSlowRequests = function () {
            for (const ctrl of _activeAbortControllers) {
                try { ctrl.abort('user-cancelled'); } catch (_) { /* already aborted */ }
            }
            _activeAbortControllers.clear();
            _dismissSlowRequestNotice();
        };

        async function fetchServerJson(url, errorPrefix, timeoutMs = 30000, options = {}) {
            const canCache = !options.skipCache && _shouldCacheUrl(url);
            if (canCache) {
                const cached = _getServerCached(url);
                if (cached !== null) return cached;
            }

            const ctrl = new AbortController();
            _activeAbortControllers.add(ctrl);
            _slowRequestPendingCount += 1;
            const timer = setTimeout(() => ctrl.abort(), timeoutMs);
            const slowTimer = setTimeout(() => {
                if (_slowRequestPendingCount > 0) _renderSlowRequestNotice('slow');
            }, 8000);
            const offlineTimer = setTimeout(() => {
                if (_slowRequestPendingCount > 0 && serverBrowseMode) _renderSlowRequestNotice('offline');
            }, 20000);
            const cleanup = () => {
                clearTimeout(timer);
                clearTimeout(slowTimer);
                clearTimeout(offlineTimer);
                _activeAbortControllers.delete(ctrl);
                _slowRequestPendingCount = Math.max(0, _slowRequestPendingCount - 1);
                if (_slowRequestPendingCount === 0) _dismissSlowRequestNotice();
            };

            let response;
            try {
                response = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
            } catch (err) {
                cleanup();
                if (err.name === 'AbortError') {
                    if (ctrl.signal.reason === 'user-cancelled') {
                        throw new Error(`${errorPrefix}: request cancelled.`);
                    }
                    throw new Error(`${errorPrefix}: request timed out after ${(timeoutMs / 1000).toFixed(0)}s. Is the VM running?`);
                }
                throw new Error(`${errorPrefix}: network error (${err.message})`);
            }
            let body = null;
            try {
                body = await response.json();
            } catch {
                body = null;
            }
            cleanup();
            if (!response.ok) {
                const detail = body?.detail || body?.message || `${errorPrefix} (${response.status})`;
                throw new Error(detail);
            }
            if (canCache) _putServerCached(url, body);
            return body;
        }

        function useServerAnalytics() {
            return serverBrowseMode || bootstrapAnalyticsReady;
        }

        function getServerAnalyticsSectionsForTab(tabName = 'overview') {
            if (!serverBrowseMode) return [];
            if (tabName === 'trends' || tabName === 'bodies') return ['trends'];
            if (tabName === 'themes') return ['themes'];
            // Text tab is NOT included here — it uses an on-demand "Generate"
            // button instead of auto-fetching (text analytics is the slowest section).
            return [];
        }

        function areServerAnalyticsSectionsReady(sections = []) {
            return sections.every(section => Boolean(serverState.analytics?.[section]));
        }

        function hasPendingServerAnalyticsLoads() {
            return Object.values(serverState.analyticsLoading || {}).some(Boolean);
        }

        async function ensureServerAnalyticsSections(sections = [], showErrors = false) {
            const requiredSections = [...new Set((sections || []).filter(Boolean))];
            if (!requiredSections.length || !DATASET_ANALYTICS_URL) return null;

            const sectionsToRequest = requiredSections.filter(section => (
                !serverState.analytics?.[section] && !serverState.analyticsLoading?.[section]
            ));

            // If nothing new to fetch, check whether any requested sections are
            // still being loaded by a prior call.  If so, wait for that in-flight
            // promise instead of returning null (which would cause the caller's
            // .then() to fire immediately and re-trigger renderTabContent in an
            // infinite microtask loop).
            if (!sectionsToRequest.length) {
                const inflightToWait = requiredSections
                    .filter(s => serverState.analyticsLoading?.[s] && _analyticsInflight[s])
                    .map(s => _analyticsInflight[s]);
                if (inflightToWait.length) {
                    await Promise.all(inflightToWait);
                }
                return null;
            }

            sectionsToRequest.forEach(section => {
                serverState.analyticsLoading[section] = true;
            });

            setVmLoadingNotice(true, `Loading full-filter ${sectionsToRequest.join(', ')} analytics from the VM. Please wait until this notice disappears before reading those charts.`);

            const fetchPromise = (async () => {
                try {
                    const params = buildServerQueryParams({ includePagination: false, includeSort: false });
                    params.set('sections', sectionsToRequest.join(','));
                    const payload = await fetchServerJson(
                        `${DATASET_ANALYTICS_URL}?${params.toString()}`,
                        'Unable to load full-filter VM analytics'
                    );
                    sectionsToRequest.forEach(section => {
                        serverState.analytics[section] = payload?.[section] || null;
                        serverState.analyticsLoading[section] = false;
                    });
                    if (!hasPendingServerAnalyticsLoads() && !overviewBootstrapMode) {
                        setVmLoadingNotice(false);
                    }
                    return payload;
                } catch (err) {
                    console.error('Server analytics load failed:', err);
                    sectionsToRequest.forEach(section => {
                        serverState.analyticsLoading[section] = false;
                    });
                    if (!hasPendingServerAnalyticsLoads() && !overviewBootstrapMode) {
                        setVmLoadingNotice(false);
                    }
                    if (showErrors) {
                        alert('Failed to load full-filter VM analytics.\n\n' + (err?.message || err));
                    }
                    throw err;
                } finally {
                    // Clean up inflight tracking so future calls start fresh.
                    sectionsToRequest.forEach(section => {
                        if (_analyticsInflight[section] === fetchPromise) {
                            delete _analyticsInflight[section];
                        }
                    });
                }
            })();

            // Register this promise so concurrent callers can await it.
            sectionsToRequest.forEach(section => {
                _analyticsInflight[section] = fetchPromise;
            });

            return fetchPromise;
        }

        function updateTextSamplingDisclaimer(textData) {
            const disclaimer = document.getElementById('textSamplingDisclaimer');
            const message = document.getElementById('textSamplingMessage');
            if (!disclaimer) return;
            if (textData && textData.sampled) {
                const sampleSize = Number(textData.sample_size || 0).toLocaleString();
                const totalRecords = Number(textData.total_records || 0).toLocaleString();
                if (message) {
                    message.textContent = `These charts were computed from a random sample of ${sampleSize} out of ${totalRecords} matching records for performance. Results are statistically representative (95% CI, \u00b12%) but may show minor variation on each generation.`;
                }
                disclaimer.classList.remove('hidden');
            } else {
                disclaimer.classList.add('hidden');
            }
        }

        async function generateTextAnalyticsOnDemand() {
            const btn = document.getElementById('generateTextAnalyticsBtn');
            const spinner = document.getElementById('textAnalyticsSpinner');
            if (btn) btn.disabled = true;
            if (spinner) spinner.classList.remove('hidden');

            try {
                await ensureServerAnalyticsSections(['text'], true);
                const placeholder = document.getElementById('textAnalyticsPlaceholder');
                const container = document.getElementById('textChartsContainer');
                if (placeholder) placeholder.classList.add('hidden');
                if (container) container.classList.remove('hidden');
                updateAffectedPersonsChart();
                updateSDGsChart();
                updateBigramsChart();
                updateTextLengthChart();
                updateTextSamplingDisclaimer(serverState.analytics?.text);
            } catch (err) {
                console.error('On-demand text analytics failed:', err);
            } finally {
                if (btn) btn.disabled = false;
                if (spinner) spinner.classList.add('hidden');
            }
        }

        // renderStatsFromSummary() removed — populated hidden .stats-section

        /**
         * Smart empty-state panel for 0-result queries. Reads the current filter form
         * state and builds a row of clickable "remove this filter" chips plus a
         * "Reset all" button. Each chip clears exactly one dimension and re-applies,
         * converting "no results" into one click to a useful result.
         */
        function renderNoResultsPanel(totalRecords) {
            const panel = document.getElementById('noResultsPanel');
            const container = document.getElementById('noResultsSuggestions');
            if (!panel || !container) return;
            if (totalRecords !== 0 || !serverBrowseMode) {
                panel.classList.add('hidden');
                return;
            }
            const fs = getServerFilterState();
            const suggestions = [];

            const mkChip = (label, onclick) => `<button type="button" onclick="${onclick}" style="background:#fff; border:1px solid #d4a840; color:#6b4e00; font-size:12px; padding:6px 12px; border-radius:6px; cursor:pointer; font-weight:500;">${label}</button>`;

            if (fs.textQuery) {
                suggestions.push(mkChip(`✕ Clear text: "${escapeHtml(fs.textQuery.length > 28 ? fs.textQuery.slice(0, 26) + '…' : fs.textQuery)}"`, `document.getElementById('filterText').value=''; applyFilters();`));
            }
            if (fs.countries.length) {
                suggestions.push(mkChip(`✕ Remove ${fs.countries.length > 1 ? fs.countries.length + ' countries' : 'country ' + escapeHtml(fs.countries[0])}`, `clearFilter('filterCountry'); applyFilters();`));
            }
            if (fs.bodies.length) {
                suggestions.push(mkChip(`✕ Remove ${fs.bodies.length > 1 ? fs.bodies.length + ' bodies' : 'body ' + escapeHtml(fs.bodies[0])}`, `clearFilter('filterBody'); applyFilters();`));
            }
            if (fs.regions.length) {
                suggestions.push(mkChip(`✕ Remove region filter`, `clearFilter('filterRegion'); applyFilters();`));
            }
            if (fs.themes.length) {
                suggestions.push(mkChip(`✕ Remove theme filter`, `clearFilter('filterTheme'); applyFilters();`));
            }
            if (fs.affectedPersons.length) {
                suggestions.push(mkChip(`✕ Remove affected-persons filter`, `clearFilter('filterAffectedPersons'); applyFilters();`));
            }
            if (fs.sdgs.length) {
                suggestions.push(mkChip(`✕ Remove SDG filter`, `clearFilter('filterSdg'); applyFilters();`));
            }
            // Year narrowing is common; suggest widening to the full dataset span
            const fMin = Number.isFinite(serverState.facets?.min_year) ? serverState.facets.min_year : 2006;
            const fMax = Number.isFinite(serverState.facets?.max_year) ? serverState.facets.max_year : 2026;
            if (fs.yearStart && fs.yearEnd && (fs.yearStart > fMin || fs.yearEnd < fMax)) {
                suggestions.push(mkChip(`📅 Widen years to ${fMin}–${fMax}`,
                    `document.getElementById('filterYearStart').value=${fMin}; document.getElementById('filterYearEnd').value=${fMax}; applyFilters();`));
            }
            // Always offer the nuclear option
            suggestions.push(`<button type="button" onclick="resetFilters()" style="background:#fff3cd; border:1px solid #d4a840; color:#5a3b00; font-size:12px; padding:6px 12px; border-radius:6px; cursor:pointer; font-weight:600;">↺ Reset all filters</button>`);

            container.innerHTML = suggestions.join('');
            panel.classList.remove('hidden');
        }

        function updateServerSummaryUI(summary = {}) {
            document.getElementById('infoFileName').textContent = datasetMetadata.datasetPath
                ? datasetMetadata.datasetPath.split('/').pop()
                : 'uhri-export.json';
            document.getElementById('infoFormat').textContent = 'Server API';
            document.getElementById('infoRecords').textContent = Number(summary.total_records || 0).toLocaleString();
            updateAllRecordCounts(summary.total_records);
            const _vmTotal = Number(summary.total_records || 0);
            const _vmSearchTerm = (document.getElementById('filterText')?.value || '').trim();
            if (_vmTotal === 0) {
                document.getElementById('filterCount').innerHTML = _vmSearchTerm
                    ? `<span style="color:#c62828;">0 hits</span> for '${escapeHtml(_vmSearchTerm.length > 20 ? _vmSearchTerm.slice(0,18) + '…' : _vmSearchTerm)}'`
                    : `<span style="color:#c62828;">0 hits</span>`;
            } else {
                document.getElementById('filterCount').innerHTML = _vmSearchTerm
                    ? `${_vmTotal.toLocaleString()} hits for <em>'${escapeHtml(_vmSearchTerm.length > 20 ? _vmSearchTerm.slice(0,18) + '…' : _vmSearchTerm)}'</em>`
                    : `${_vmTotal.toLocaleString()} hits`;
            }
            // Smart empty-state: when 0 records, offer actionable next-click suggestions
            // based on which filters are actually active. Converts a dead-end into the
            // next user action — "remove body filter" / "widen years" / "clear text" /
            // "reset all". Zero guessing.
            renderNoResultsPanel(_vmTotal);
            document.getElementById('kpiTotal').textContent = Number(summary.total_records || 0).toLocaleString();
            document.getElementById('kpiCountries').textContent = Number(summary.countries_count || 0).toLocaleString();
            document.getElementById('kpiBodies').textContent = Number(summary.bodies_count || 0).toLocaleString();
            document.getElementById('kpiThemes').textContent = Number(summary.themes_count || 0).toLocaleString();
            document.getElementById('kpiYearSpan').textContent = summary.min_year && summary.max_year
                ? `${summary.min_year}-${summary.max_year}`
                : '-';
            document.getElementById('kpiAvgPerYear').textContent = Number(summary.avg_per_year || 0).toLocaleString();
            // renderStatsFromSummary removed (stats section was dead code)

            const ready = !!summary.analysis_ready;
            const limit = Number(summary.analysis_limit || serverState.analysisLimit || SERVER_ANALYSIS_EXPORT_LIMIT_DEFAULT);
            serverState.analysisLimit = limit;
            setServerModeStatus(
                ready
                    ? `Current filter matches ${Number(summary.total_records || 0).toLocaleString()} records. You can load full analytics now or classify the full filter directly.`
                    : `Current filter matches ${Number(summary.total_records || 0).toLocaleString()} records. Overview uses VM aggregates; other tabs use the current page until you load full analytics or classify the whole filter.`
            );
            const analysisBtn = document.getElementById('serverAnalysisBtn');
            if (analysisBtn) analysisBtn.disabled = !ready;
        }

        function initializeServerBrowseDashboard() {
            document.getElementById('dataInfo').classList.remove('hidden');
            updateDatasetMetadataUI();
            document.getElementById('sampleNotice').classList.add('hidden');
            document.getElementById('filtersSection').classList.remove('hidden');
            document.getElementById('filtersSection').classList.add('active');
            document.getElementById('kpiSection').classList.remove('hidden');
            { const _cc = document.getElementById('classifierCta'); if (_cc) { _cc.classList.remove('hidden'); _cc.classList.add('active'); } }
            // statsSection removed from DOM
            document.getElementById('tabsSection').classList.remove('hidden');
            document.getElementById('emptyState').classList.add('hidden');
            activateTab(preferredActiveTab || 'overview');
            updateSelectedCountInfo();
        }

        async function refreshServerBrowseData(page = 1, showErrors = true, options = {}) {
            if (!DATASET_SUMMARY_URL || !DATASET_RECORDS_URL) {
                if (showErrors) alert('VM browse API URLs are not configured yet.');
                return;
            }

            const background = !!options.background;
            const activateServerBrowse = !!options.activateServerBrowse;
            const analyticsFilterKey = buildServerFilterCacheKey();
            const filterChanged = serverState.analyticsFilterKey !== analyticsFilterKey;

            if (!background) {
                document.getElementById('loadingIndicator').classList.remove('hidden');
                uploadSection.classList.add('hidden');
                setProgress(14, 'Loading filtered records from VM...');
                setVmLoadingNotice(true, 'VM data is loading now. Please wait until this notice disappears before using all plots.');
            }

            try {
                const baseParams = buildServerQueryParams({ page, includePagination: false });
                const summaryUrl = `${DATASET_SUMMARY_URL}?${baseParams.toString()}`;
                const recordParams = buildServerQueryParams({ page, includePagination: true });
                const recordsUrl = `${DATASET_RECORDS_URL}?${recordParams.toString()}`;
                const mapUrl = `${DATASET_MAP_URL}?${baseParams.toString()}`;

                // Fire all 3 in parallel and render progressively (each arrives independently).
                // Tradeoff: 2-worker server will queue the 3rd request; wall-clock still
                // improves vs. sequential, but watch p95 under sustained load.

                // Reuse the hero-stats prefetch promise for the very first unfiltered
                // summary call. The prefetch fires right after page init (~140ms) with
                // the same URL our summary fetch would use when no filters are active —
                // without this dedupe the server handles two identical ~1s queries on
                // every cold load. Mark as consumed so subsequent refreshes always
                // fetch fresh data.
                const unfilteredBaseUrl = `${DATASET_SUMMARY_URL}?`; // buildServerQueryParams with no filters yields empty params
                const canReusePrefetch = window._prefetchedSummaryPromise
                    && summaryUrl === (DATASET_SUMMARY_URL + '?' + baseParams.toString())
                    && !baseParams.toString();
                const summaryP = canReusePrefetch
                    ? window._prefetchedSummaryPromise
                    : fetchServerJson(summaryUrl, 'Unable to load server summary');
                if (canReusePrefetch) { window._prefetchedSummaryPromise = null; }
                const recordsP = fetchServerJson(recordsUrl, 'Unable to load server records');
                const mapP = fetchServerJson(mapUrl, 'Unable to load server map data');

                // Analytics reset (filterChanged) must happen synchronously so progressive
                // renderers don't read stale analytics mid-flight.
                if (filterChanged) {
                    const hadBootstrapAnalytics = bootstrapAnalyticsReady && serverState.analytics;
                    if (!hadBootstrapAnalytics) {
                        serverState.analytics = { trends: null, themes: null, text: null };
                    }
                    serverState.analyticsLoading = {};
                }
                serverState.analyticsFilterKey = analyticsFilterKey;

                if (activateServerBrowse) {
                    setServerBrowseMode(true);
                }

                // Records: render data table as soon as records arrive (don't wait for summary/map).
                const recordsHandled = recordsP.then(recordPayload => {
                    const normalizedRecords = (recordPayload.records || []).map((row, idx) =>
                        normalizeRecord(row, idx + ((recordPayload.page - 1) * (recordPayload.page_size || ROWS_PER_PAGE)))
                    );
                    serverState.loaded = true;
                    _setDataStatus('connected', 'Connected — search ready');
                    serverState.page = recordPayload.page || page;
                    serverState.pageSize = recordPayload.page_size || ROWS_PER_PAGE;
                    serverState.totalPages = recordPayload.total_pages || 1;
                    serverState.totalRecords = recordPayload.total_records || 0;
                    serverState.records = normalizedRecords;
                    _serverSearchFilter = '';
                    _infScrollReset(normalizedRecords, recordPayload.total_pages || 1, recordPayload.total_records || 0, '');

                    currentPage = serverState.page;
                    filteredData = normalizedRecords;
                    chartData = normalizedRecords;
                    rawData = [];
                    recordMap = new Map();
                    registerRecords(normalizedRecords);
                    refreshTrainingSampleReferences();
                    selectedRowIds.clear();

                    initializeServerBrowseDashboard();
                    renderFilterChips();
                    buildDataTable();
                    markSectionFresh('table');
                    return recordPayload;
                }).catch(err => {
                    console.error('Records fetch failed:', err);
                    markSectionFresh('table');
                    throw err;
                });

                // Map: render worldmap independently when country counts arrive.
                const mapHandled = mapP.then(mapPayload => {
                    serverState.mapCountryCounts = Array.isArray(mapPayload?.country_counts) ? mapPayload.country_counts : [];
                    updateOverviewWorldMap();
                    return mapPayload;
                }).catch(err => {
                    console.error('Map fetch failed:', err);
                    throw err;
                });

                // Summary: render KPIs + subtitles + active tab charts when summary arrives.
                const summaryHandled = summaryP.then(summary => {
                    serverState.summary = summary;
                    updateServerSummaryUI(summary);
                    const activeTab = document.querySelector('#tabsSection .tab.active')?.dataset?.tab || 'overview';
                    renderTabContent(activeTab);
                    updateChartContextSubtitles();
                    markSectionFresh('charts');
                    return summary;
                }).catch(err => {
                    console.error('Summary fetch failed:', err);
                    markSectionFresh('charts');
                    throw err;
                });

                // Wait for all (settled) so downstream control flow (analytics prefetch,
                // VM loading notice toggling, finally-block) still works correctly.
                const settled = await Promise.allSettled([summaryHandled, recordsHandled, mapHandled]);
                const firstReject = settled.find(r => r.status === 'rejected');
                if (firstReject) {
                    throw firstReject.reason;
                }

                // After the initial background transition, clear bootstrapAnalyticsReady
                // so that future filter changes properly wipe and re-fetch analytics.
                if (activateServerBrowse && bootstrapAnalyticsReady) {
                    bootstrapAnalyticsReady = false;
                }

                const fastSections = ['trends', 'themes'];
                const needsPrefetch = filterChanged || !areServerAnalyticsSectionsReady(fastSections);
                if (needsPrefetch) {
                    // Keep the VM loading notice visible while trends/themes
                    // are being fetched so users don't click tabs prematurely.
                    setVmLoadingNotice(true, 'Loading trends & themes analytics from the VM. Please wait until this notice disappears before reading those charts.');
                    ensureServerAnalyticsSections(fastSections, false)
                        .then(() => {
                            setVmLoadingNotice(false);
                            const activeTab = document.querySelector('#tabsSection .tab.active')?.dataset?.tab || 'overview';
                            renderTabContent(activeTab);
                        })
                        .catch(err => {
                            setVmLoadingNotice(false);
                            console.error('Background fast analytics prefetch failed:', err);
                        });
                } else {
                    setVmLoadingNotice(false);
                }
            } catch (err) {
                console.error('Server browse load failed:', err);
                setVmLoadingNotice(false);
                _setDataStatus('error', 'Server unreachable');
                if (background) {
                    throw err;
                } else if (showErrors) {
                    // Replace blocking alert with a non-blocking banner that surfaces
                    // Offline & Private Mode when the root cause looks like a timeout.
                    // On any other error we still show a banner (without the Offline
                    // Mode CTA) — alert() was interrupting the user on every failed
                    // fetch, which was particularly painful during slow complex queries.
                    const msg = String(err?.message || err);
                    const isTimeout = /timed out|timeout/i.test(msg);
                    showServerErrorBanner(msg, isTimeout);
                }
                if (!background) {
                    uploadSection.classList.remove('hidden');
                }
            } finally {
                if (!background) {
                    document.getElementById('loadingIndicator').classList.add('hidden');
                }
            }
        }

        async function loadRemoteDatasetServerMode(showErrors = true, options = {}) {
            if (!DATASET_RECORDS_URL || !DATASET_SUMMARY_URL || !DATASET_FACETS_URL) {
                if (showErrors) alert('VM browse API URLs are not configured yet.');
                return;
            }

            const background = !!options.background;
            const preserveBootstrapOnFailure = !!options.preserveBootstrapOnFailure;

            if (!background) {
                document.getElementById('loadingIndicator').classList.remove('hidden');
                uploadSection.classList.add('hidden');
                setProgress(8, 'Connecting to VM browse API...');
                document.getElementById('dataInfo').classList.remove('hidden');
                _setDataStatus('connecting', 'Connecting — please wait...');
                setVmLoadingNotice(true, 'Connecting to the VM and loading data. Please wait until this notice disappears before using all tabs.');
            } else if (bootstrapAnalyticsReady) {
                setStatusBanner({
                    visible: true,
                    title: 'Full Dataset Analytics Ready',
                    message: `All charts loaded instantly from pre-computed analytics (${Number(serverState.totalRecords || 0).toLocaleString()} records). VM browse mode is connecting for interactive filtering and the data table.`,
                    showAnalysisButton: false
                });
            } else {
                setStatusBanner({
                    visible: true,
                    title: 'Overview Snapshot Ready',
                    message: 'The first tab is ready. Lightweight VM browse mode is loading now so the other tabs become interactive without downloading the full dataset.',
                    showAnalysisButton: false
                });
                setVmLoadingNotice(true, 'VM browse mode is still loading in the background. Please wait before expecting complete plots outside Overview.');
            }

            try {
                // Stale-while-revalidate: if facets are cached for this VM base, apply them
                // immediately so filter UI is populated. We'll validate/refresh after health.
                const cachedFacets = loadFacetsFromCache(VM_BASE_URL);
                if (cachedFacets && cachedFacets.facets) {
                    serverState.facets = cachedFacets.facets;
                    try { populateServerFacets(); } catch (e) { console.debug('Cached facets populate failed:', e); }
                }

                const datasetHealth = await fetchRemoteDatasetHealth();
                if (datasetHealth && datasetHealth.dataset_ready === false) {
                    throw new Error(datasetHealth.message || 'VM dataset API reports that the dataset is unavailable.');
                }
                setDatasetMetadata(datasetHealth || {});
                if (datasetHealth?.analysis_export_limit) {
                    serverState.analysisLimit = datasetHealth.analysis_export_limit;
                }

                const healthModifiedAt = datasetHealth?.modified_at || datasetHealth?.dataset_metadata?.modified_at || '';
                const cacheIsFresh = cachedFacets && cachedFacets.modifiedAt && healthModifiedAt && cachedFacets.modifiedAt === healthModifiedAt;

                activeDataSource = 'vm_server';
                fileName = 'UHRI dataset (server browse)';
                fileFormat = 'Server API';

                // Fire the data fetch (summary + records + map) and, when cache isn't
                // fresh, the facets refresh too — IN PARALLEL rather than sequentially.
                // Previously records+map waited for facets (~1.3s on cold start); they
                // don't actually need facets, so firing them together saves ~1s on
                // records/map becoming visible. facetsP swallows its own errors so a
                // facets failure never blocks the main data load.
                let facetsP = null;
                if (!cacheIsFresh) {
                    facetsP = fetchServerJson(DATASET_FACETS_URL, 'Unable to fetch dataset facets')
                        .then(facets => {
                            serverState.facets = facets;
                            populateServerFacets();
                            saveFacetsToCache(VM_BASE_URL, healthModifiedAt, facets);
                            return facets;
                        })
                        .catch(err => {
                            console.warn('Background facets refresh failed:', err);
                            return null;
                        });
                }

                const refreshP = refreshServerBrowseData(1, showErrors, {
                    background,
                    activateServerBrowse: true
                });

                if (facetsP) {
                    const settled = await Promise.allSettled([refreshP, facetsP]);
                    if (settled[0].status === 'rejected') throw settled[0].reason;
                } else {
                    await refreshP;
                }
            } catch (err) {
                console.error('Remote browse init failed:', err);
                if (!background || !preserveBootstrapOnFailure) {
                    setServerBrowseMode(false);
                }
                setVmLoadingNotice(false);
                if (!background && showErrors) {
                    alert('Failed to initialize server browse mode.\n\n' + (err?.message || err));
                }
                if (!background || !preserveBootstrapOnFailure) {
                    uploadSection.classList.remove('hidden');
                    document.getElementById('loadingIndicator').classList.add('hidden');
                }
                if (background) {
                    throw err;
                }
            }
        }

        async function loadCurrentFilterForAnalytics(showErrors = true) {
            if (!DATASET_EXPORT_URL) {
                if (showErrors) alert('VM subset export API URL is not configured yet.');
                return;
            }
            const analysisBtn = document.getElementById('serverAnalysisBtn');
            if (analysisBtn) analysisBtn.disabled = true;

            document.getElementById('loadingIndicator').classList.remove('hidden');
            uploadSection.classList.add('hidden');
            setProgress(18, 'Loading filtered subset for full analytics...');

            try {
                const params = buildServerQueryParams({
                    includePagination: false,
                    includeSort: false,
                    limit: serverState.analysisLimit || SERVER_ANALYSIS_EXPORT_LIMIT_DEFAULT
                });
                const exportPayload = await fetchServerJson(
                    `${DATASET_EXPORT_URL}?${params.toString()}`,
                    'Unable to load filtered subset'
                );
                await applyLoadedRecords(exportPayload.records || [], {
                    fileName: 'UHRI filtered subset (VM API)',
                    fileFormat: 'API JSON',
                    source: 'vm_api',
                    datasetMetadata: datasetMetadata
                });
            } catch (err) {
                console.error('Subset analytics load failed:', err);
                if (showErrors) {
                    alert('Failed to load the filtered subset for full analytics.\n\n' + (err?.message || err));
                }
                document.getElementById('loadingIndicator').classList.add('hidden');
            } finally {
                if (analysisBtn) analysisBtn.disabled = !(serverState.summary?.analysis_ready);
            }
        }

        async function applyLoadedRecords(records, options = {}) {
            const sourceRecords = Array.isArray(records) ? records : [];
            fileName = String(options.fileName || fileName || 'dataset.json');
            fileFormat = String(options.fileFormat || fileFormat || 'JSON');
            activeDataSource = String(options.source || activeDataSource || 'upload');
            if (activeDataSource !== 'vm_server') {
                setServerBrowseMode(false);
            }
            if (options.datasetMetadata) {
                setDatasetMetadata(options.datasetMetadata);
            } else if (activeDataSource !== 'vm_api') {
                resetDatasetMetadata();
            }

            setProgress(55, 'Normalizing ' + sourceRecords.length.toLocaleString() + ' records...');
            await delay(20);

            rawData = sourceRecords.map((row, idx) => normalizeRecord(row, idx));

            setProgress(82, 'Building dashboard...');
            await delay(20);

            initializeDashboard();
            document.getElementById('loadingIndicator').classList.add('hidden');
        }

        async function processFile(file, source = 'upload') {
            fileName = file.name;
            const ext = file.name.split('.').pop().toLowerCase();
            activeDataSource = source;

            // Reset file input for re-upload
            fileInput.value = '';

            document.getElementById('loadingIndicator').classList.remove('hidden');
            uploadSection.classList.add('hidden');
            setProgress(10, 'Reading file...');

            try {
                if (ext === 'json') {
                    fileFormat = 'JSON';
                    await processJSON(file);
                } else {
                    fileFormat = 'Excel';
                    await processExcel(file);
                }
            } catch (error) {
                console.error('Error:', error);
                alert('Error processing file: ' + error.message);
                uploadSection.classList.remove('hidden');
                document.getElementById('loadingIndicator').classList.add('hidden');
            }
        }

        async function processJSON(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        setProgress(30, 'Parsing JSON...');
                        let jsonData;
                        try {
                            jsonData = JSON.parse(e.target.result);
                        } catch (parseErr) {
                            throw new Error('Invalid JSON format');
                        }

                        if (!Array.isArray(jsonData)) {
                            throw new Error('JSON must be an array of records');
                        }

                        await applyLoadedRecords(jsonData, {
                            fileName: file.name,
                            fileFormat: 'JSON',
                            source: 'upload'
                        });
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                };
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsText(file);
            });
        }

        function shouldAutoLoadDemoData() {
            try {
                const url = new URL(window.location.href);
                const demo = String(url.searchParams.get('demo') || '').toLowerCase();
                const source = String(url.searchParams.get('source') || '').toLowerCase();
                return source === 'demo' || demo === '1' || demo === 'true' || demo === 'yes';
            } catch {
                return false;
            }
        }

        async function loadRemoteDataset(showErrors = true, options = {}) {
            if (!DATASET_API_URL) {
                if (showErrors) alert('VM dataset API URL is not configured yet.');
                return;
            }
            const background = !!options.background;
            if (background && fullDatasetBackgroundPromise) {
                return fullDatasetBackgroundPromise;
            }

            const runner = async () => {
                if (vmLoadBtn) vmLoadBtn.disabled = true;
                if (!background) {
                    activeDataSource = 'vm_api';
                    fileName = 'UHRI full dataset (VM API)';
                    fileFormat = 'API JSON';

                    document.getElementById('loadingIndicator').classList.remove('hidden');
                    uploadSection.classList.add('hidden');
                    setProgress(8, 'Connecting to VM dataset API...');
                    setVmLoadingNotice(true, 'Full VM dataset is loading. Please wait until this notice disappears before using the dashboard.');
                } else {
                    setStatusBanner({
                        visible: true,
                        title: 'Loading Full Dataset',
                        message: 'Overview snapshot is ready. The full dataset is now downloading from the VM in the background.',
                        showAnalysisButton: false
                    });
                    setVmLoadingNotice(true, 'The full VM dataset is still downloading in the background. Please wait before expecting complete charts in every tab.');
                }

                try {
                    const datasetHealth = await fetchRemoteDatasetHealth();
                    if (datasetHealth && datasetHealth.dataset_ready === false) {
                        throw new Error(datasetHealth.message || 'VM dataset API reports that the dataset is unavailable.');
                    }

                    const response = await fetch(DATASET_API_URL, { cache: 'no-store' });
                    if (!response.ok) {
                        throw new Error(`Unable to fetch VM dataset (${response.status})`);
                    }

                    if (!background) {
                        setProgress(32, 'Downloading full dataset from VM...');
                    }
                    const body = await response.json();
                    const records = Array.isArray(body) ? body : (Array.isArray(body?.records) ? body.records : null);
                    if (!Array.isArray(records)) {
                        throw new Error('Dataset API returned unexpected JSON. Expected an array of records.');
                    }

                    await applyLoadedRecords(records, {
                        fileName: (datasetHealth?.dataset_path || '').split('/').pop() || 'uhri-export.json (VM API)',
                        fileFormat: 'API JSON',
                        source: 'vm_api',
                        datasetMetadata: datasetHealth || {}
                    });
                    fullDatasetBackgroundReady = true;
                    overviewBootstrapMode = false;
                    setVmLoadingNotice(false);
                } catch (err) {
                    console.error('Remote dataset load failed:', err);
                    if (background) {
                        fullDatasetBackgroundReady = false;
                        setVmLoadingNotice(false);
                        setStatusBanner({
                            visible: true,
                            title: 'Overview Snapshot Ready',
                            message: 'The overview snapshot is loaded, but the full dataset from the VM could not be downloaded automatically. Use "Load Full Dataset from VM" to retry.',
                            showAnalysisButton: false
                        });
                    } else {
                        setVmLoadingNotice(false);
                        if (showErrors) {
                            alert('Failed to load the VM dataset automatically. You can still upload a file manually.\n\n' + (err?.message || err));
                        }
                        uploadSection.classList.remove('hidden');
                        document.getElementById('loadingIndicator').classList.add('hidden');
                    }
                    throw err;
                } finally {
                    if (!background) {
                        document.getElementById('loadingIndicator').classList.add('hidden');
                    }
                    if (vmLoadBtn) vmLoadBtn.disabled = false;
                    if (background) {
                        fullDatasetBackgroundPromise = null;
                    }
                }
            };

            if (background) {
                fullDatasetBackgroundPromise = runner();
                return fullDatasetBackgroundPromise;
            }
            return runner();
        }

        async function loadBundledSampleData(showErrors = true) {
            const btn = document.getElementById('sampleLoadBtn');
            if (btn) btn.disabled = true;
            activeDataSource = 'sample';

            try {
                const response = await fetch(BUNDLED_SAMPLE_PATH, { cache: 'no-store' });
                if (!response.ok) {
                    throw new Error(`Unable to fetch sample data (${response.status})`);
                }
                const blob = await response.blob();
                const file = new File(
                    [blob],
                    BUNDLED_SAMPLE_NAME,
                    { type: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
                );
                await processFile(file, 'sample');
                const vcNotice = document.getElementById('veniceCommissionNotice');
                if (vcNotice) vcNotice.classList.remove('hidden');
            } catch (err) {
                console.error('Bundled sample load failed:', err);
                if (showErrors) {
                    alert('Failed to load bundled sample data. Please upload the file manually.');
                }
            } finally {
                if (btn) btn.disabled = false;
            }
        }

        async function processExcel(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    try {
                        setProgress(30, 'Parsing Excel...');
                        const data = new Uint8Array(e.target.result);
                        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

                        await applyLoadedRecords(jsonData, {
                            fileName: file.name,
                            fileFormat: 'Excel',
                            source: activeDataSource || 'upload'
                        });
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                };
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsArrayBuffer(file);
            });
        }

        function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

        // ========== DATA NORMALIZATION ==========
        function getRecordStableKey(record) {
            if (!record || typeof record !== 'object') return '';
            const stable = record._sourceId || record._annotationId || record._documentId || record.AnnotationId || record.DocumentId || record.id || record._id;
            return stable === null || stable === undefined ? '' : String(stable);
        }

        function registerRecords(records = []) {
            records.forEach(record => {
                if (!record) return;
                recordMap.set(String(record._id), record);
                const stableKey = getRecordStableKey(record);
                if (stableKey) {
                    recordMap.set(stableKey, record);
                }
            });
        }

        function refreshTrainingSampleReferences() {
            if (!Array.isArray(trainingState.samples) || !trainingState.samples.length) return;
            trainingState.samples = trainingState.samples.map(sample => recordMap.get(getSampleKey(sample)) || sample);
            if (trainingState.currentSampleIndex >= trainingState.samples.length) {
                trainingState.currentSampleIndex = Math.max(0, trainingState.samples.length - 1);
            }
        }

        // Standardize body names: full names → abbreviations
        const _bodyAbbreviations = {
            'committee on economic, social and cultural rights': 'CESCR',
            'committee on migrant workers': 'CMW',
            'committee on the elimination of discrimination against women': 'CEDAW',
            'committee on the rights of the child': 'CRC',
            'committee on the elimination of racial discrimination': 'CERD',
            'committee against torture': 'CAT',
            'committee on enforced disappearances': 'CED',
            'committee on the rights of persons with disabilities': 'CRPD',
            'human rights committee': 'CCPR',
            'subcommittee on prevention of torture': 'SPT',
            'universal periodic review': 'UPR',
            'special rapporteur on the situation of human rights in the palestinian territory occupied since 1967': 'SR Palestine',
            'special rapporteur on human rights in cambodia': 'SR Cambodia',
            'special rapporteur on the issue of human rights obligations relating to the enjoyment of a safe, clean, healthy and sustainable environment': 'SR Environment',
            'special rapporteur on the situation of human rights in afghanistan': 'SR Afghanistan',
            'special rapporteur on the situation of human rights in the islamic republic of iran': 'SR Iran',
            'independent expert appointed by the secretary-general on the situation of human rights in somalia': 'IE Somalia',
            'independent expert on the situation of human rights in central african republic': 'IE Central African Republic',
            'independent expert on the situation of human rights in mali': 'IE Mali',
            'sr on the situation of human rights in eritrea': 'SR Eritrea',
            'sr on the situation of human rights in myanmar': 'SR Myanmar',
            'sr on the situation of human rights in the democratic people republic of korea': 'SR DPRK',
        };

        function _standardizeBody(raw) {
            const cleaned = (raw || '').replace(/^-+\s*/, '').trim();
            if (!cleaned) return '';
            const lower = cleaned.toLowerCase();
            return _bodyAbbreviations[lower] || cleaned;
        }

        function normalizeRecord(row, idx) {
            const n = {};
            for (let key in row) n[key] = row[key];
            n._id = idx; // Stable internal id for UI interactions and maps
            n._sourceId = toStr(row['AnnotationId'] || row['DocumentId'] || row['id'] || row['_id'] || row['ID'] || idx);

            n._countries = toStr(row['Countries'] || row['Countries Concerned']);
            n._countriesArray = toArr(row['Countries'] || row['Countries Concerned']);
            n._body = _standardizeBody(toStr(row['Body'] || row['Reccomending Body'] || row['Recommending Body']));
            n._pubDate = row['PublicationDate'] || row['Document Publication Date'] || row['date'] || '';
            n._year = extractYear(n._pubDate);
            n._type = row['AnnotationType'] || row['Type'] || '';
            n._themes = toStr(row['Themes'] || row['themes'] || row['Theme']);
            n._themesArray = toArr(row['Themes'] || row['themes'] || row['Theme'], { splitCommas: false }).map(normalizeTheme).filter(Boolean);
            n._themeKeys = [...new Set(n._themesArray.map(toThemeKey).filter(Boolean))];
            n._rightThemeKeys = n._themeKeys.filter(k => Boolean(rightsThemeLookup[k]));
            n._affectedPersons = toStr(row['AffectedPersons'] || row['Affected Persons']);
            n._affectedPersonsArray = toArr(row['AffectedPersons'] || row['Affected Persons']);
            n._regions = toStr(row['Regions'] || row['Regions Concerned']);
            n._regionsArray = toArr(row['Regions'] || row['Regions Concerned']);
            n._sdgs = toStr(row['Sdgs'] || row['SDGs']);
            n._sdgsArray = toArr(row['Sdgs'] || row['SDGs']);
            n._text = stripHtml(toStr(row['Text'] || row['text'] || row['Recommendation'] || ''));
            n._symbol = toStr(row['Symbol'] || row['Document Symbol']);
            n._annotationId = toStr(row['AnnotationId'] || row['OHCHR Annotation Id'] || row['Annotation Id']);
            n._documentId = toStr(row['DocumentId']);
            n._citation = buildCitation(n);
            n._predictedLabels = extractAssignedLabelsFromRow(row); // Imported "My Labels" or classifier predictions

            return n;
        }

        function toStr(val) {
            if (val === null || val === undefined) return '';
            if (Array.isArray(val)) {
                return val.flatMap(v => Array.isArray(v) ? v : [v]).map(valueToScalar).filter(Boolean).join('\n');
            }
            if (typeof val === 'object') return valueToScalar(val);
            return String(val);
        }

        function valueToScalar(value) {
            if (value === null || value === undefined) return '';
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                return String(value).trim();
            }
            if (Array.isArray(value)) {
                return value.map(v => valueToScalar(v)).filter(Boolean).join(' ');
            }
            if (typeof value === 'object') {
                const preferred = ['label', 'name', 'value', 'title', 'text', 'code', 'id'];
                for (const key of preferred) {
                    if (value[key] !== null && value[key] !== undefined && String(value[key]).trim() !== '') {
                        return String(value[key]).trim();
                    }
                }
                try {
                    return JSON.stringify(value);
                } catch {
                    return String(value);
                }
            }
            return String(value).trim();
        }

        function toArr(val, opts = {}) {
            const splitCommas = !!opts.splitCommas;
            if (val === null || val === undefined || val === '') return [];

            let arr = [];
            if (Array.isArray(val)) {
                arr = val.flatMap(v => Array.isArray(v) ? v : [v]).map(valueToScalar);
            } else if (typeof val === 'object') {
                arr = [valueToScalar(val)];
            } else {
                const str = String(val);
                if (str.trim().startsWith('[') && str.trim().endsWith(']')) {
                    try {
                        const parsed = JSON.parse(str);
                        if (Array.isArray(parsed)) {
                            arr = parsed.flatMap(v => Array.isArray(v) ? v : [v]).map(valueToScalar);
                        }
                    } catch {
                        // Fall back to delimiter-based parsing below.
                    }
                }
                if (!arr.length) {
                    const pattern = splitCommas ? /\r?\n|[;|,]/ : /\r?\n|[;|]/;
                    arr = str.split(pattern).map(s => s.trim());
                }
            }

            return [...new Set(arr.map(s => String(s || '').trim()).filter(Boolean))];
        }

        function normalizeTheme(val) {
            return String(val || '').replace(/\s+/g, ' ').trim();
        }

        function toThemeKey(val) {
            return normalizeTheme(val)
                .replace(/^[\-\u2022•\s]+/, '')
                .toLowerCase();
        }

        function buildRightsThemeCatalog() {
            const catalog = [];
            const seen = new Set();
            Object.entries(rightsThemeMap).forEach(([group, subthemes]) => {
                const family = escRights.has(group) ? 'ESCR' : 'CCPR';
                subthemes.forEach(st => {
                    const label = normalizeTheme(st).replace(/^[\-\u2022•\s]+/, '');
                    const key = toThemeKey(label);
                    if (!key || seen.has(key)) return;
                    seen.add(key);
                    catalog.push({ key, label, family, group });
                });
            });
            return catalog;
        }

        function buildCitation(rec) {
            const parts = [];
            if (rec._body) parts.push(rec._body.replace(/^-+\s*/, ''));
            if (rec._countries) parts.push(rec._countries.split('\n')[0]);
            if (rec._symbol) parts.push(rec._symbol);
            if (rec._year) parts.push(String(rec._year));
            if (!parts.length) {
                return rec._annotationId || rec._documentId || '';
            }
            return parts.join(' | ');
        }

        function getUhriUrl(rec) {
            // Annotation-based URLs don't work (UHRI returns 404 page despite HTTP 200)
            // Only document-based URLs work reliably
            if (rec._documentId) return `https://uhri.ohchr.org/en/document/${rec._documentId}`;
            return '';
        }

        function getUnDocsUrl(rec) {
            if (rec._symbol) {
                const sym = rec._symbol.replace(/^-+\s*/, '').trim();
                if (sym) return `https://undocs.org/${encodeURIComponent(sym)}`;
            }
            return '';
        }

        function buildFormattedCitation(rec) {
            const body = (rec._body || '').replace(/^-+\s*/, '').trim();
            const country = (rec._countries || '').split('\n')[0].replace(/^-+\s*/, '').trim();
            const symbol = (rec._symbol || '').replace(/^-+\s*/, '').trim();
            const year = rec._year ? String(rec._year) : '';
            const uhriUrl = getUhriUrl(rec);

            // Academic-style citation: Body, "Recommendation concerning [Country]", Symbol (Year). Available at: URL
            const parts = [];
            if (body) parts.push(body);
            if (country) parts.push(country);
            if (symbol) parts.push(symbol);
            if (year) parts.push(`(${year})`);
            let citation = parts.join(', ');
            if (uhriUrl) citation += `. Available at: ${uhriUrl}`;
            const today = new Date().toISOString().slice(0, 10);
            citation += ` [Accessed ${today}]`;
            return citation;
        }

        function stripHtml(html) {
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            return tmp.textContent || tmp.innerText || '';
        }

        function extractYear(dateVal) {
            if (!dateVal) return null;
            if (dateVal instanceof Date) return dateVal.getFullYear();
            if (typeof dateVal === 'number') {
                const d = new Date((dateVal - 25569) * 86400 * 1000);
                return d.getFullYear();
            }
            const str = String(dateVal);
            const iso = str.match(/^(\d{4})-\d{2}-\d{2}/);
            if (iso) return parseInt(iso[1]);
            const yr = str.match(/(\d{4})/);
            if (yr) {
                const y = parseInt(yr[1]);
                if (y > 1990 && y < 2100) return y;
            }
            return null;
        }

        function parseRecordDate(dateVal) {
            if (!dateVal) return null;
            if (dateVal instanceof Date && !Number.isNaN(dateVal.getTime())) return dateVal;
            if (typeof dateVal === 'number') {
                const parsedExcel = new Date((dateVal - 25569) * 86400 * 1000);
                return Number.isNaN(parsedExcel.getTime()) ? null : parsedExcel;
            }
            const parsed = new Date(String(dateVal));
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }

        function buildYoYSeries(records = [], boundaryRecords = records) {
            const yearlyCounts = {};
            records.forEach(record => {
                if (Number.isFinite(record?._year)) {
                    yearlyCounts[record._year] = (yearlyCounts[record._year] || 0) + 1;
                }
            });

            const datedRecords = [];
            boundaryRecords.forEach(record => {
                const parsedDate = parseRecordDate(record?._pubDate);
                if (parsedDate) datedRecords.push(parsedDate);
            });

            const years = Object.keys(yearlyCounts)
                .map(year => Number(year))
                .filter(Number.isFinite)
                .sort((a, b) => a - b);

            const excludedYears = new Set();
            const noteParts = [];

            if (datedRecords.length) {
                datedRecords.sort((a, b) => a - b);
                const firstDate = datedRecords[0];
                const lastDate = datedRecords[datedRecords.length - 1];
                const firstYear = firstDate.getFullYear();
                const lastYear = lastDate.getFullYear();

                if (firstDate.getMonth() !== 0 || firstDate.getDate() !== 1) {
                    excludedYears.add(firstYear);
                    noteParts.push(`${firstYear} starts on ${formatDatasetDate(firstDate.toISOString())}`);
                }
                if (lastDate.getMonth() !== 11 || lastDate.getDate() !== 31) {
                    excludedYears.add(lastYear);
                    noteParts.push(`${lastYear} ends on ${formatDatasetDate(lastDate.toISOString())}`);
                }
            }

            const labels = [];
            const values = [];
            years.slice(1).forEach((year, index) => {
                const previousYear = years[index];
                if (excludedYears.has(previousYear) || excludedYears.has(year)) return;
                const previousCount = yearlyCounts[previousYear];
                if (!previousCount) return;
                labels.push(String(year));
                values.push(Number((((yearlyCounts[year] - previousCount) / previousCount) * 100).toFixed(1)));
            });

            let note = 'Bars compare each year to the previous full year.';
            if (noteParts.length) {
                note += ` Edge-year comparisons tied to partial years are excluded: ${noteParts.join('; ')}.`;
            }

            return { labels, values, note };
        }

        function buildYoYSeriesFromYearRows(yearRows = [], options = {}) {
            const yearlyCounts = {};
            (yearRows || []).forEach(row => {
                const year = Number(row?.year);
                const count = Number(row?.count || 0);
                if (!Number.isFinite(year) || !Number.isFinite(count) || count <= 0) return;
                yearlyCounts[year] = count;
            });

            const years = Object.keys(yearlyCounts)
                .map(Number)
                .filter(Number.isFinite)
                .sort((a, b) => a - b);

            const excludedYears = new Set();
            const noteParts = [];
            const firstDate = parseRecordDate(options.datasetFirstPublicationDate);
            const lastDate = parseRecordDate(options.datasetLastPublicationDate);

            if (firstDate && years.includes(firstDate.getFullYear()) && (firstDate.getMonth() !== 0 || firstDate.getDate() !== 1)) {
                excludedYears.add(firstDate.getFullYear());
                noteParts.push(`${firstDate.getFullYear()} starts on ${formatDatasetDate(firstDate.toISOString())}`);
            }
            if (lastDate && years.includes(lastDate.getFullYear()) && (lastDate.getMonth() !== 11 || lastDate.getDate() !== 31)) {
                excludedYears.add(lastDate.getFullYear());
                noteParts.push(`${lastDate.getFullYear()} ends on ${formatDatasetDate(lastDate.toISOString())}`);
            }

            const labels = [];
            const values = [];
            years.slice(1).forEach((year, index) => {
                const previousYear = years[index];
                if (excludedYears.has(previousYear) || excludedYears.has(year)) return;
                const previousCount = yearlyCounts[previousYear];
                if (!previousCount) return;
                labels.push(String(year));
                values.push(Number((((yearlyCounts[year] - previousCount) / previousCount) * 100).toFixed(1)));
            });

            let note = 'Bars compare each year to the previous full year.';
            if (noteParts.length) {
                note += ` Edge-year comparisons tied to partial years are excluded: ${noteParts.join('; ')}.`;
            }

            return { labels, values, note };
        }

        function getTopRightsConfigurationFromThemeCounts(themeCountRows = [], topN = 10) {
            const counts = {};
            (themeCountRows || []).forEach(row => {
                const key = toThemeKey(row?.theme || '');
                const count = Number(row?.count || 0);
                if (!key || !rightsThemeLookup[key] || !Number.isFinite(count) || count <= 0) return;
                counts[key] = (counts[key] || 0) + count;
            });
            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            const topKeys = sorted.slice(0, topN).map(([key]) => key);
            const dimensions = topKeys.map(key => ({
                key,
                label: rightsThemeLookup[key]?.label || key,
                family: rightsThemeLookup[key]?.family || 'CCPR',
                total: counts[key] || 0
            }));
            return {
                dimensions,
                topKeySet: new Set(topKeys),
                totalCounts: counts
            };
        }

        function getRightsYearlyDataFromThemeRows(themeRows = [], topKeySet = null) {
            const yearly = {};
            (themeRows || []).forEach(row => {
                const year = Number(row?.year);
                const key = toThemeKey(row?.theme || '');
                const count = Number(row?.count || 0);
                const meta = rightsThemeLookup[key];
                if (!Number.isFinite(year) || !meta || !Number.isFinite(count) || count <= 0) return;
                if (!yearly[year]) {
                    yearly[year] = { esc: 0, ccpr: 0, top: {}, otherEsc: 0, otherCcpr: 0 };
                }
                if (meta.family === 'ESCR') yearly[year].esc += count;
                else yearly[year].ccpr += count;

                if (topKeySet) {
                    if (topKeySet.has(key)) {
                        yearly[year].top[key] = (yearly[year].top[key] || 0) + count;
                    } else if (meta.family === 'ESCR') {
                        yearly[year].otherEsc += count;
                    } else {
                        yearly[year].otherCcpr += count;
                    }
                }
            });
            return yearly;
        }

        // ========== DASHBOARD INIT ==========
        function initializeDashboard() {
            setServerBrowseMode(false);
            filteredData = [...rawData];
            chartData = rawData.length > MAX_CHART_RECORDS ? sampleData(rawData, MAX_CHART_RECORDS) : rawData;
            recordMap = new Map();
            registerRecords(rawData);
            refreshTrainingSampleReferences();
            selectedRowIds.clear();

            document.getElementById('dataInfo').classList.remove('hidden');
            document.getElementById('infoFileName').textContent = fileName;
            document.getElementById('infoFormat').textContent = fileFormat;
            document.getElementById('infoRecords').textContent = rawData.length.toLocaleString();
            _setDataStatus('local', `${rawData.length.toLocaleString()} records loaded`);
            updateAllRecordCounts(rawData.length);
            updateDatasetMetadataUI();
            const vcNotice = document.getElementById('veniceCommissionNotice');
            if (vcNotice) vcNotice.classList.add('hidden');

            if (rawData.length > MAX_CHART_RECORDS) {
                document.getElementById('sampleNotice').classList.remove('hidden');
                document.getElementById('sampleSize').textContent = MAX_CHART_RECORDS.toLocaleString();
            } else {
                document.getElementById('sampleNotice').classList.add('hidden');
            }

            populateFilters();

            document.getElementById('filtersSection').classList.remove('hidden');
            document.getElementById('filtersSection').classList.add('active');
            document.getElementById('kpiSection').classList.remove('hidden');
            { const _cc = document.getElementById('classifierCta'); if (_cc) { _cc.classList.remove('hidden'); _cc.classList.add('active'); } }
            // statsSection removed from DOM
            document.getElementById('tabsSection').classList.remove('hidden');
            activateTab(preferredActiveTab || 'overview');

            // Load saved models
            loadSavedModels();
            updateDashboard();
            requestAnimationFrame(() => {
                resizeOverviewWorldMap();
            });

            // Apply quick-explore filter from landing page selection
            applyQuickExploreFilter();

            setProgress(100, 'Complete!');
        }

        function sampleData(data, max) {
            if (data.length <= max) return data;
            const step = Math.ceil(data.length / max);
            const sampled = [];
            for (let i = 0; i < data.length && sampled.length < max; i += step) {
                sampled.push(data[i]);
            }
            return sampled;
        }

        function resetDashboard() {
            setServerBrowseMode(false);
            overviewBootstrapMode = false;
            fullDatasetBackgroundReady = false;
            fullDatasetBackgroundPromise = null;
            preferredActiveTab = 'overview';
            setVmLoadingNotice(false);
            rawData = [];
            filteredData = [];
            chartData = [];
            recordMap = new Map();
            fileName = '';
            fileFormat = '';
            activeDataSource = 'upload';
            resetDatasetMetadata();
            Object.values(charts).forEach(c => c.destroy());
            charts = {};

            // Reset training state
            trainingState = {
                taskType: 'classification',
                categories: [],
                samples: [],
                currentSampleIndex: 0,
                labeledSamples: new Map(),
                method: 'tfidf_centroid',
                model: null,
                vocabulary: {},
                idf: {},
                categoryVectors: {},
                benchmark: null
            };
            setThresholdUI(0.50);
            setClassifierMethodUI('tfidf_centroid');
            updateModelStorageControls();

            document.getElementById('uploadSection').classList.remove('hidden');
            document.getElementById('dataInfo').classList.add('hidden');
            document.getElementById('sampleNotice').classList.add('hidden');
            updateDatasetMetadataUI();
            document.getElementById('filtersSection').classList.remove('active');
            document.getElementById('kpiSection').classList.add('hidden');
            { const _cc = document.getElementById('classifierCta'); if (_cc) { _cc.classList.add('hidden'); _cc.classList.remove('active'); } }
            // statsSection removed from DOM
            document.getElementById('tabsSection').classList.add('hidden');
            document.getElementById('emptyState').classList.add('hidden');
            document.querySelectorAll('.charts-section, .data-table-section').forEach(s => s.classList.remove('active'));
            document.getElementById('applyBtn').disabled = true;
            document.getElementById('applyCurrentBtn').disabled = true;
            // updateTaskTypeUI() call removed
            document.getElementById('trainingProgress').classList.add('hidden');
            document.getElementById('benchmarkBox').classList.add('hidden');
            // duplicate setThresholdUI/setClassifierMethodUI/updateModelStorageControls removed (already called above)
            const radarGrid = document.getElementById('themeRadarGrid');
            if (radarGrid) radarGrid.innerHTML = '';
            const radarMeta = document.getElementById('rightsMetaInfo');
            if (radarMeta) radarMeta.textContent = '';
            const scatterMeta = document.getElementById('rightsScatterInfo');
            if (scatterMeta) scatterMeta.textContent = '';
            const mapContainer = document.getElementById('overviewWorldMap');
            if (mapContainer && typeof Plotly !== 'undefined') {
                Plotly.purge(mapContainer);
                mapContainer.innerHTML = '';
            }
            Object.keys(customCharts).forEach(id => {
                if (customCharts[id]) {
                    customCharts[id].destroy();
                    delete customCharts[id];
                }
            });
            const customGrid = document.getElementById('customDashboardGrid');
            if (customGrid) {
                customGrid.innerHTML = '';
            }
            selectedRowIds.clear();
            currentSort = { column: null, direction: 'asc' };
            currentPage = 1;
        }

        // ========== FILTERS ==========
        function populateFilters() {
            if (serverBrowseMode && serverState.facets) {
                populateServerFacets();
                return;
            }
            const _cleanDash = s => s.replace(/^-+\s*/, '').trim();
            const countries = [...new Set(rawData.flatMap(r => r._countriesArray))].filter(Boolean).map(_cleanDash).filter(Boolean).sort();
            const bodies = [...new Set(rawData.map(r => r._body).filter(Boolean))].map(_cleanDash).filter(Boolean).sort();
            const regions = [...new Set(rawData.flatMap(r => r._regionsArray))].filter(Boolean).map(_cleanDash).filter(Boolean).sort();
            const types = [...new Set(rawData.map(r => r._type).filter(Boolean))]
                .map(t => t.replace(/^-+\s*/, '').trim())
                .filter(t => t && t.length > 2 && !/^[0-9a-f-]{20,}$/i.test(t) && !/^\W+$/.test(t))
                .sort();
            const years = rawData.map(r => r._year).filter(y => y && y > 1990 && y < 2100);

            const themes = [...new Set(rawData.flatMap(r => r._themesArray || []))].map(_cleanDash).filter(t => t && t.length > 2).sort();
            const affectedPersons = [...new Set(rawData.flatMap(r => r._affectedPersonsArray || []))].map(_cleanDash).filter(t => t && t.length > 2).sort();

            populateSelect('filterCountry', countries.slice(0, 250));
            populateSelect('filterBody', bodies);
            populateSelect('filterRegion', regions);
            populateSelect('filterTheme', themes);
            populateSelect('filterAffectedPersons', affectedPersons);
            const sdgs = [...new Set(rawData.flatMap(r => r._sdgsArray || []))].map(_cleanDash).filter(t => t && t.length > 1).sort();
            populateSelect('filterSdg', sdgs);
            populateSelect('filterType', ['All', ...types]);

            if (years.length) {
                document.getElementById('filterYearStart').value = Math.min(...years);
                document.getElementById('filterYearEnd').value = Math.max(...years);
            }
            _initChipSelects();
        }

        function populateSelect(id, options) {
            const sel = document.getElementById(id);
            sel.innerHTML = options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
            if (_chipSelects[id]) _chipSelects[id].sync();
        }

        function clearFilter(id) {
            const sel = document.getElementById(id);
            for (let opt of sel.options) opt.selected = false;
            if (_chipSelects[id]) _chipSelects[id].sync();
        }

        // ── Chip-Select Component ──
        const _chipSelects = {};

        function _initChipSelects() {
            document.querySelectorAll('.chip-select-wrap[data-select-id]').forEach(wrap => {
                const id = wrap.dataset.selectId;
                if (_chipSelects[id]) return; // already init
                _chipSelects[id] = new _ChipSelect(wrap, id, wrap.dataset.chipClass || 'chip-country');
            });
        }

        function _ChipSelect(wrap, selectId, chipClass) {
            this.wrap = wrap;
            this.sel = document.getElementById(selectId);
            this.chipClass = chipClass;
            this.input = wrap.querySelector('.chip-select-input');
            this.dropdown = wrap.querySelector('.chip-select-dropdown');
            this.activeIdx = -1;
            this._debounce = null;

            const self = this;

            // Insert chips container before input
            this.chipsArea = wrap;

            // Events
            this.input.addEventListener('input', () => {
                clearTimeout(self._debounce);
                self._debounce = setTimeout(() => self._filter(), 80);
            });
            this.input.addEventListener('focus', () => self._filter());
            this.input.addEventListener('keydown', (e) => self._onKey(e));

            // Close on outside click
            document.addEventListener('click', (e) => {
                if (!wrap.contains(e.target)) self._close();
            });

            this.sync();
        }

        _ChipSelect.prototype.sync = function() {
            // Re-render chips from hidden select state
            // Remove old chips
            this.wrap.querySelectorAll('.chip-select-chip').forEach(c => c.remove());
            const input = this.input;
            Array.from(this.sel.selectedOptions).forEach(opt => {
                const chip = document.createElement('span');
                chip.className = `chip-select-chip ${this.chipClass}`;
                const label = opt.textContent.length > 24 ? opt.textContent.slice(0,22) + '…' : opt.textContent;
                chip.innerHTML = `${escapeHtml(label)}<button class="chip-select-chip-x" title="Remove">&times;</button>`;
                chip.querySelector('.chip-select-chip-x').onclick = (e) => {
                    e.stopPropagation();
                    opt.selected = false;
                    this.sync();
                };
                this.wrap.insertBefore(chip, input);
            });
        };

        _ChipSelect.prototype._filter = function() {
            const q = this.input.value.toLowerCase().trim();
            const selected = new Set(Array.from(this.sel.selectedOptions).map(o => o.value));
            const matches = [];
            for (const opt of this.sel.options) {
                if (selected.has(opt.value)) continue;
                if (q && !opt.textContent.toLowerCase().includes(q)) continue;
                matches.push(opt);
            }
            // When no query, limit to 20 initial items + "show all" link (Hick's Law)
            const showLimit = q ? matches.length : Math.min(20, matches.length);
            const hasMore = !q && matches.length > 20;
            this.activeIdx = -1;
            if (matches.length === 0) {
                this.dropdown.innerHTML = `<div class="chip-select-empty">${q ? 'No matches' : 'All selected'}</div>`;
            } else {
                const self = this;
                let html = matches.slice(0, showLimit).map((opt, i) => {
                    const text = opt.textContent;
                    const hl = q ? text.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>') : escapeHtml(text);
                    return `<div class="chip-select-option" data-value="${escapeHtml(opt.value)}" data-idx="${i}">${hl}</div>`;
                }).join('');
                if (hasMore) {
                    html += `<div class="chip-select-option" data-action="expand" style="color:var(--accent); font-weight:500; text-align:center; border-top:1px solid #eef;">Browse all ${matches.length} options...</div>`;
                }
                this.dropdown.innerHTML = html;
                this.dropdown.querySelectorAll('.chip-select-option').forEach(el => {
                    el.onmousedown = (e) => {
                        e.preventDefault();
                        if (el.dataset.action === 'expand') {
                            self._openExpandedModal();
                        } else {
                            self._select(el.dataset.value);
                        }
                    };
                });
            }
            this.dropdown.classList.add('open');
        };

        _ChipSelect.prototype._select = function(value) {
            const opt = Array.from(this.sel.options).find(o => o.value === value);
            if (opt) opt.selected = true;
            this.input.value = '';
            this.sync();
            this._close();
            this.input.focus();
        };

        _ChipSelect.prototype._close = function() {
            this.dropdown.classList.remove('open');
            this.activeIdx = -1;
        };

        _ChipSelect.prototype._onKey = function(e) {
            const opts = this.dropdown.querySelectorAll('.chip-select-option');
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!this.dropdown.classList.contains('open')) { this._filter(); return; }
                this.activeIdx = Math.min(this.activeIdx + 1, opts.length - 1);
                this._highlightActive(opts);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.activeIdx = Math.max(this.activeIdx - 1, 0);
                this._highlightActive(opts);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (this.activeIdx >= 0 && opts[this.activeIdx]) {
                    this._select(opts[this.activeIdx].dataset.value);
                }
            } else if (e.key === 'Escape') {
                this._close();
            } else if (e.key === 'Backspace' && !this.input.value) {
                // Remove last chip
                const selected = Array.from(this.sel.selectedOptions);
                if (selected.length) {
                    selected[selected.length - 1].selected = false;
                    this.sync();
                }
            }
        };

        _ChipSelect.prototype._highlightActive = function(opts) {
            opts.forEach((o, i) => o.classList.toggle('active', i === this.activeIdx));
            if (opts[this.activeIdx]) opts[this.activeIdx].scrollIntoView({ block: 'nearest' });
        };

        _ChipSelect.prototype._openExpandedModal = function() {
            this._close();
            const self = this;
            const selectId = this.sel.id;
            const label = this.wrap.closest('.filter-group')?.querySelector('label')?.textContent || 'Select';

            // Build overlay
            const overlay = document.createElement('div');
            overlay.className = 'chip-modal-overlay';
            overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

            const selected = new Set(Array.from(this.sel.selectedOptions).map(o => o.value));
            const allOpts = Array.from(this.sel.options);

            function render(query) {
                const q = (query || '').toLowerCase().trim();
                const filtered = q ? allOpts.filter(o => o.textContent.toLowerCase().includes(q)) : allOpts;

                const listHtml = filtered.map(opt => {
                    const isSel = selected.has(opt.value);
                    const text = opt.textContent;
                    const hl = q ? text.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>') : escapeHtml(text);
                    return `<div class="chip-modal-item ${isSel ? 'selected' : ''}" data-value="${escapeHtml(opt.value)}">
                        <span class="chip-modal-item-check">${isSel ? '✓' : ''}</span>
                        <span>${hl}</span>
                    </div>`;
                }).join('');

                return `<div class="chip-modal">
                    <div class="chip-modal-header">
                        <h3>Select ${escapeHtml(label)}</h3>
                        <span style="font-size:12px; color:#667;">${selected.size} selected</span>
                        <button class="chip-modal-close" data-action="close">&times;</button>
                    </div>
                    <input type="text" class="chip-modal-search" placeholder="Filter..." value="${escapeHtml(query || '')}" autofocus>
                    <div class="chip-modal-count">${filtered.length} of ${allOpts.length} items</div>
                    <div class="chip-modal-list">${listHtml || '<div style="padding:20px; text-align:center; color:#8899aa;">No matches</div>'}</div>
                </div>`;
            }

            overlay.innerHTML = render('');

            // Wire events
            function wireEvents() {
                overlay.querySelector('.chip-modal-close').onclick = () => overlay.remove();
                const searchInput = overlay.querySelector('.chip-modal-search');
                let debounce = null;
                searchInput.addEventListener('input', () => {
                    clearTimeout(debounce);
                    debounce = setTimeout(() => {
                        const modal = overlay.querySelector('.chip-modal');
                        const q = searchInput.value;
                        // Re-render list only
                        const qLower = q.toLowerCase().trim();
                        const filtered = qLower ? allOpts.filter(o => o.textContent.toLowerCase().includes(qLower)) : allOpts;
                        const listEl = overlay.querySelector('.chip-modal-list');
                        const countEl = overlay.querySelector('.chip-modal-count');

                        listEl.innerHTML = filtered.map(opt => {
                            const isSel = selected.has(opt.value);
                            const text = opt.textContent;
                            const hl = qLower ? text.replace(new RegExp(`(${qLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>') : escapeHtml(text);
                            return `<div class="chip-modal-item ${isSel ? 'selected' : ''}" data-value="${escapeHtml(opt.value)}">
                                <span class="chip-modal-item-check">${isSel ? '✓' : ''}</span>
                                <span>${hl}</span>
                            </div>`;
                        }).join('') || '<div style="padding:20px; text-align:center; color:#8899aa;">No matches</div>';

                        countEl.textContent = `${filtered.length} of ${allOpts.length} items`;
                        wireListClicks();
                    }, 100);
                });
                wireListClicks();

                // Focus search
                setTimeout(() => searchInput.focus(), 50);
            }

            function wireListClicks() {
                overlay.querySelectorAll('.chip-modal-item').forEach(item => {
                    item.onclick = () => {
                        const val = item.dataset.value;
                        if (selected.has(val)) {
                            selected.delete(val);
                            item.classList.remove('selected');
                            item.querySelector('.chip-modal-item-check').textContent = '';
                        } else {
                            selected.add(val);
                            item.classList.add('selected');
                            item.querySelector('.chip-modal-item-check').textContent = '✓';
                        }
                        // Sync hidden select
                        for (const opt of self.sel.options) {
                            opt.selected = selected.has(opt.value);
                        }
                        self.sync();
                        // Update count
                        const countSpan = overlay.querySelector('.chip-modal-header span');
                        if (countSpan) countSpan.textContent = `${selected.size} selected`;
                    };
                });
            }

            document.body.appendChild(overlay);
            wireEvents();
        };

        // ========== RECENT FILTERS ==========
        const RECENT_FILTERS_KEY = 'un_hr_dashboard_recent_filters';
        const MAX_RECENT = 20;

        function _loadRecent() {
            try { return JSON.parse(localStorage.getItem(RECENT_FILTERS_KEY) || '[]'); }
            catch { return []; }
        }

        function _saveRecentList(list) {
            try { localStorage.setItem(RECENT_FILTERS_KEY, JSON.stringify(list)); } catch {}
        }

        function buildFilterLabel(st) {
            const parts = [];
            // Trim to first meaningful token so labels stay compact.
            const first = (s) => (s || '').replace(/^-+\s*/, '').split(/[:;(]/)[0].trim();
            const shortWord = (s, n) => first(s).split(/\s+/).slice(0, n).join(' ');
            if (st.textQuery) parts.push(st.textQuery.length > 20 ? st.textQuery.slice(0,18) + '…' : st.textQuery);
            if (st.countries?.length) parts.push(st.countries.length === 1 ? first(st.countries[0]) : `${st.countries.length} countries`);
            if (st.bodies?.length) parts.push(st.bodies.length === 1 ? shortWord(st.bodies[0], 2) : `${st.bodies.length} bodies`);
            // Previously themes / affected_persons / SDGs / regions weren't in labels —
            // so every filter of that kind fell through to "All records", producing
            // several indistinguishable "All records (N)" pills in the Recent row.
            if (st.regions?.length) parts.push(st.regions.length === 1 ? first(st.regions[0]) : `${st.regions.length} regions`);
            if (st.themes?.length) parts.push(st.themes.length === 1 ? shortWord(st.themes[0], 3) : `${st.themes.length} themes`);
            if (st.affectedPersons?.length) parts.push(st.affectedPersons.length === 1 ? shortWord(st.affectedPersons[0], 2) : `${st.affectedPersons.length} groups`);
            if (st.sdgs?.length) parts.push(st.sdgs.length === 1 ? shortWord(st.sdgs[0], 2) : `${st.sdgs.length} SDGs`);
            if (st.annotationType?.length && st.annotationType[0] !== 'All') parts.push(st.annotationType.length === 1 ? st.annotationType[0] : `${st.annotationType.length} types`);
            const label = parts.join(' + ') || 'All records';
            return label.length > 40 ? label.slice(0, 38) + '…' : label;
        }

        function _getHitCount() {
            if (serverBrowseMode) return serverState.totalRecords || 0;
            return filteredData.length || 0;
        }

        function saveRecentFilter() {
            const state = getServerFilterState();
            // Check if year range is the default (not a meaningful filter)
            const defMinYear = serverBrowseMode ? (serverState.facets?.min_year || null) : (rawData.length ? Math.min(...rawData.map(r => r._year).filter(y => y > 1990)) : null);
            const defMaxYear = serverBrowseMode ? (serverState.facets?.max_year || null) : (rawData.length ? Math.max(...rawData.map(r => r._year).filter(y => y > 1990)) : null);
            const yearIsDefault = (!state.yearStart || String(state.yearStart) === String(defMinYear)) && (!state.yearEnd || String(state.yearEnd) === String(defMaxYear));
            const hasFilter = state.textQuery || state.countries.length || state.bodies.length ||
                state.regions.length || (state.themes || []).length || (state.affectedPersons || []).length ||
                (state.sdgs || []).length || state.annotationType.length || !yearIsDefault;
            if (!hasFilter) return;
            const hits = _getHitCount();
            if (hits === 0) return; // don't save 0-hit searches
            const key = JSON.stringify(state);
            let list = _loadRecent().filter(r => JSON.stringify(r.state) !== key);
            list.unshift({ id: Date.now(), timestamp: Date.now(), label: buildFilterLabel(state), hits, state });
            if (list.length > MAX_RECENT) list = list.slice(0, MAX_RECENT);
            _saveRecentList(list);
            updateRecentUI();
        }

        function restoreFilter(state) {
            _restoreMultiSelect('filterCountry', state.countries || []);
            _restoreMultiSelect('filterBody', state.bodies || []);
            _restoreMultiSelect('filterRegion', state.regions || []);
            _restoreMultiSelect('filterTheme', state.themes || []);
            _restoreMultiSelect('filterAffectedPersons', state.affectedPersons || []);
            _restoreMultiSelect('filterSdg', state.sdgs || []);
            const typeEl = document.getElementById('filterType');
            if (typeEl) typeEl.value = state.annotationType?.[0] || 'All';
            const ys = document.getElementById('filterYearStart');
            const ye = document.getElementById('filterYearEnd');
            if (ys) ys.value = state.yearStart || '';
            if (ye) ye.value = state.yearEnd || '';
            const textEl = document.getElementById('filterText');
            if (textEl) textEl.value = state.textQuery || '';
            // Open facets if filters are set
            const details = document.getElementById('filterFacetsDetails');
            if (details && (state.countries?.length || state.bodies?.length || state.regions?.length)) details.open = true;
            applyFilters();
        }

        function formatTimeAgo(ts) {
            const diff = Date.now() - ts;
            if (diff < 60000) return 'just now';
            if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
            if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
            if (diff < 172800000) return 'yesterday';
            return new Date(ts).toLocaleDateString('en', { month: 'short', day: 'numeric' });
        }

        function toggleRecentFiltersPanel() {
            const panel = document.getElementById('recentFiltersPanel');
            panel.classList.toggle('open');
            if (panel.classList.contains('open')) renderRecentPanel();
        }

        function _recentHitsLabel(r) {
            return r.hits ? ` (${Number(r.hits).toLocaleString()})` : '';
        }

        function renderRecentPanel() {
            const panel = document.getElementById('recentFiltersPanel');
            const presets = _loadPresets();
            const list = _loadRecent();
            if (!list.length && !presets.length) {
                panel.innerHTML = '<h4>🕐 Recent <button class="recent-filters-clear" onclick="clearAllRecent()" style="visibility:hidden;">Clear all</button></h4><div class="recent-filters-empty">No recent searches yet.<br>Apply filters to save them automatically.</div>';
                return;
            }
            let html = '';
            // Saved presets section
            if (presets.length) {
                html += '<div style="margin-bottom:12px;"><h4 style="margin:0 0 8px; font-size:13px;">⭐ Saved Presets</h4>';
                html += presets.map((p, i) => `
                    <div class="recent-filter-item" data-preset-idx="${i}">
                        <span class="recent-filter-label" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}${p.hits ? `<span style="color:#8899aa; font-weight:400;"> (${Number(p.hits).toLocaleString()})</span>` : ''}</span>
                        <button class="recent-filter-del" data-preset-del="${p.id}" title="Remove">&times;</button>
                    </div>
                `).join('');
                html += '</div><hr style="border:none; border-top:1px solid #eef; margin:8px 0;">';
            }
            html += '<h4 style="margin:0 0 8px; font-size:13px;">🕐 Recent <button class="recent-filters-clear" onclick="clearAllRecent()">Clear all</button></h4>';
            html += list.map((r, i) => `
                <div class="recent-filter-item" data-recent-idx="${i}">
                    <span class="recent-filter-label" title="${escapeHtml(r.label)}">${escapeHtml(r.label)}<span style="color:#8899aa; font-weight:400;">${_recentHitsLabel(r)}</span></span>
                    <span class="recent-filter-time">${formatTimeAgo(r.timestamp)}</span>
                    <button class="recent-filter-del" data-del-id="${r.id}" title="Remove">&times;</button>
                </div>
            `).join('');
            panel.innerHTML = html;
            panel.querySelectorAll('.recent-filter-item').forEach(item => {
                item.onclick = () => {
                    const idx = parseInt(item.dataset.recentIdx);
                    const entry = list[idx];
                    if (entry) { restoreFilter(entry.state); panel.classList.remove('open'); }
                };
            });
            panel.querySelectorAll('.recent-filter-del').forEach(btn => {
                btn.onclick = (e) => { e.stopPropagation(); deleteRecent(parseInt(btn.dataset.delId)); };
            });
            // Wire preset clicks
            panel.querySelectorAll('[data-preset-idx]').forEach(item => {
                item.onclick = () => {
                    const idx = parseInt(item.dataset.presetIdx);
                    const preset = presets[idx];
                    if (preset) { restoreFilter(preset.state); panel.classList.remove('open'); }
                };
            });
            panel.querySelectorAll('[data-preset-del]').forEach(btn => {
                btn.onclick = (e) => { e.stopPropagation(); _deletePreset(parseInt(btn.dataset.presetDel)); };
            });
        }

        function renderRecentBar() {
            const bar = document.getElementById('recentFiltersBar');
            const items = document.getElementById('recentFiltersBarItems');
            if (!bar || !items) return;
            const list = _loadRecent().slice(0, 10);
            if (!list.length) { bar.style.display = 'none'; return; }
            bar.style.display = 'flex';
            items.innerHTML = list.map((r, i) => {
                const hitsStr = r.hits ? ` (${Number(r.hits).toLocaleString()})` : '';
                return `<button class="recent-filter-quick" data-recent-idx="${i}" title="${escapeHtml(r.label)}${hitsStr}">${escapeHtml(r.label)}${hitsStr}</button>`;
            }).join('');
            items.querySelectorAll('.recent-filter-quick').forEach(btn => {
                btn.onclick = () => {
                    const idx = parseInt(btn.dataset.recentIdx);
                    const entry = list[idx];
                    if (entry) restoreFilter(entry.state);
                };
            });
        }

        function updateRecentUI() { renderRecentPanel(); renderRecentBar(); }

        function deleteRecent(id) {
            let list = _loadRecent().filter(r => r.id !== id);
            _saveRecentList(list);
            updateRecentUI();
        }

        function clearAllRecent() {
            _saveRecentList([]);
            updateRecentUI();
        }

        // ========== ACTIVE FILTER CHIPS ==========
        function getActiveFilters() {
            const filters = [];
            const countries = getSelectedValues('filterCountry');
            countries.forEach(c => filters.push({ type: 'country', label: c, filterId: 'filterCountry', value: c }));
            const bodies = getSelectedValues('filterBody');
            bodies.forEach(b => filters.push({ type: 'body', label: b.replace(/^-+\s*/, ''), filterId: 'filterBody', value: b }));
            const regions = getSelectedValues('filterRegion');
            regions.forEach(r => filters.push({ type: 'region', label: r, filterId: 'filterRegion', value: r }));
            const themes = getSelectedValues('filterTheme');
            themes.forEach(t => filters.push({ type: 'theme', label: t.replace(/^-+\s*/, ''), filterId: 'filterTheme', value: t }));
            const affPers = getSelectedValues('filterAffectedPersons');
            affPers.forEach(a => filters.push({ type: 'affected', label: a.replace(/^-+\s*/, ''), filterId: 'filterAffectedPersons', value: a }));
            const sdgVals = getSelectedValues('filterSdg');
            sdgVals.forEach(s => filters.push({ type: 'sdg', label: s.replace(/^-+\s*/, ''), filterId: 'filterSdg', value: s }));
            const typeVal = document.getElementById('filterType').value;
            if (typeVal && typeVal !== 'All') {
                filters.push({ type: 'type', label: typeVal.replace(/^-+\s*/, ''), filterId: 'filterType', value: typeVal });
            }
            const ys = document.getElementById('filterYearStart').value;
            const ye = document.getElementById('filterYearEnd').value;
            // Only show year chip if user narrowed the range (not full dataset range)
            const facetMinYear = serverBrowseMode
                ? (serverState.facets?.min_year || '')
                : (rawData.length ? Math.min(...rawData.map(r => r._year).filter(y => y > 1990)) : '');
            const facetMaxYear = serverBrowseMode
                ? (serverState.facets?.max_year || '')
                : (rawData.length ? Math.max(...rawData.map(r => r._year).filter(y => y > 1990)) : '');
            if (ys && ye && (String(ys) !== String(facetMinYear) || String(ye) !== String(facetMaxYear))) {
                filters.push({ type: 'year', label: `${ys}–${ye}`, filterId: '_year', value: `${ys}-${ye}` });
            } else if (ys && !ye) {
                filters.push({ type: 'year', label: `From ${ys}`, filterId: '_year', value: ys });
            } else if (!ys && ye) {
                filters.push({ type: 'year', label: `Until ${ye}`, filterId: '_year', value: ye });
            }
            // Text query is shown in the filter count badge — no chip needed
            return filters;
        }

        function renderFilterChips() {
            const container = document.getElementById('filterChips');
            const clearBtn = document.getElementById('filterChipsClearAll');
            if (!container) return;
            const filters = getActiveFilters();
            if (!filters.length) {
                container.innerHTML = '';
                if (clearBtn) clearBtn.style.display = 'none';
                return;
            }
            container.innerHTML = filters.map((f, i) => {
                const cls = `chip-${f.type}`;
                const icon = { country: '🌍', body: '🏛️', region: '📍', theme: '🏷️', affected: '👥', sdg: '🎯', type: '📋', year: '📅', text: '🔎' }[f.type] || '';
                const shortLabel = f.label.length > 25 ? f.label.slice(0, 23) + '…' : f.label;
                return `<span class="filter-chip ${cls}" data-idx="${i}" title="${escapeHtml(f.label)}">${icon} ${escapeHtml(shortLabel)}<button class="chip-remove" data-idx="${i}" title="Remove this filter">×</button></span>`;
            }).join('');
            if (clearBtn) clearBtn.style.display = filters.length > 1 ? '' : 'none';
            _updateMoreFiltersBtn();
            _updateSavePresetBtn();
            // Wire up remove buttons
            container.querySelectorAll('.chip-remove').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.dataset.idx, 10);
                    const f = filters[idx];
                    if (!f) return;
                    removeFilterValue(f);
                    applyFilters();
                });
            });
        }

        function removeFilterValue(f) {
            if (f.filterId === '_year') {
                // Reset year range to dataset defaults
                if (serverBrowseMode && serverState.facets) {
                    document.getElementById('filterYearStart').value = serverState.facets.min_year || '';
                    document.getElementById('filterYearEnd').value = serverState.facets.max_year || '';
                } else {
                    const years = rawData.map(r => r._year).filter(y => y > 1990 && y < 2100);
                    if (years.length) {
                        document.getElementById('filterYearStart').value = Math.min(...years);
                        document.getElementById('filterYearEnd').value = Math.max(...years);
                    }
                }
                return;
            }
            if (f.filterId === 'filterText') {
                document.getElementById('filterText').value = '';
                return;
            }
            if (f.filterId === 'filterType') {
                document.getElementById('filterType').selectedIndex = 0;
                return;
            }
            // Multi-select: deselect this specific value
            const sel = document.getElementById(f.filterId);
            if (!sel) return;
            for (const opt of sel.options) {
                if (opt.value === f.value) opt.selected = false;
            }
            if (_chipSelects[f.filterId]) _chipSelects[f.filterId].sync();
        }

        // ========== CHART CONTEXT SUBTITLES ==========
        function getFilterContextText() {
            const parts = [];
            const countries = getSelectedValues('filterCountry');
            if (countries.length) {
                parts.push(countries.length <= 3
                    ? countries.join(', ')
                    : `${countries.length} countries`);
            }
            const bodies = getSelectedValues('filterBody');
            if (bodies.length) {
                const cleaned = bodies.map(b => b.replace(/^-+\s*/, ''));
                parts.push(cleaned.length <= 2
                    ? cleaned.join(', ')
                    : `${cleaned.length} bodies`);
            }
            const regions = getSelectedValues('filterRegion');
            if (regions.length) {
                parts.push(regions.length <= 2
                    ? regions.join(', ')
                    : `${regions.length} regions`);
            }
            const typeVal = document.getElementById('filterType').value;
            if (typeVal && typeVal !== 'All') parts.push(typeVal.replace(/^-+\s*/, ''));
            const ys = document.getElementById('filterYearStart').value;
            const ye = document.getElementById('filterYearEnd').value;
            const facetMinYear = serverBrowseMode ? (serverState.facets?.min_year || '') : '';
            const facetMaxYear = serverBrowseMode ? (serverState.facets?.max_year || '') : '';
            if (ys && ye && (String(ys) !== String(facetMinYear) || String(ye) !== String(facetMaxYear))) {
                parts.push(`${ys}–${ye}`);
            }
            const textVal = document.getElementById('filterText').value.trim();
            if (textVal) parts.push(`"${textVal.length > 20 ? textVal.slice(0, 18) + '…' : textVal}"`);
            return parts;
        }

        function updateChartContextSubtitles() {
            const parts = getFilterContextText();
            const totalRecords = serverBrowseMode
                ? (serverState.summary?.total_records || serverState.totalRecords || 0)
                : filteredData.length;
            let text = '';
            if (parts.length) {
                text = `${totalRecords.toLocaleString()} records · Filtered by: ${parts.join(' · ')}`;
            } else if (totalRecords) {
                text = `${totalRecords.toLocaleString()} records (no filters applied)`;
            }
            document.querySelectorAll('.chart-card').forEach(card => {
                let subtitle = card.querySelector('.chart-context');
                if (!subtitle) {
                    subtitle = document.createElement('div');
                    subtitle.className = 'chart-context';
                    // Insert after the <h3> title
                    const h3 = card.querySelector('h3');
                    if (h3) {
                        h3.insertAdjacentElement('afterend', subtitle);
                    } else {
                        card.prepend(subtitle);
                    }
                }
                subtitle.textContent = text;
            });
        }

        function _toggleMoreFilters() {
            const panel = document.getElementById('moreFiltersPanel');
            const btn = document.getElementById('moreFiltersBtn');
            panel.classList.toggle('hidden');
            _updateMoreFiltersBtn();
        }

        function _updateMoreFiltersBtn() {
            const panel = document.getElementById('moreFiltersPanel');
            const btn = document.getElementById('moreFiltersBtn');
            if (!btn) return;
            const isOpen = panel && !panel.classList.contains('hidden');
            // Count active "more" filters
            const moreIds = ['filterRegion', 'filterTheme', 'filterAffectedPersons', 'filterSdg'];
            let activeCount = moreIds.reduce((n, id) => n + getSelectedValues(id).length, 0);
            const typeVal = document.getElementById('filterType')?.value;
            if (typeVal && typeVal !== 'All') activeCount++;
            const ys = document.getElementById('filterYearStart')?.value;
            const ye = document.getElementById('filterYearEnd')?.value;
            // Don't count default year range
            const defMin = serverBrowseMode ? (serverState.facets?.min_year || '') : '';
            const defMax = serverBrowseMode ? (serverState.facets?.max_year || '') : '';
            if (ys && String(ys) !== String(defMin)) activeCount++;
            if (ye && String(ye) !== String(defMax)) activeCount++;

            if (isOpen) {
                btn.textContent = '− Less filters';
            } else if (activeCount > 0) {
                btn.textContent = `+ More filters (${activeCount})`;
                btn.style.background = '#e3edf8';
                btn.style.borderColor = 'var(--accent)';
                return;
            } else {
                btn.textContent = '+ More filters';
            }
            btn.style.background = '#eef2f7';
            btn.style.borderColor = 'var(--border)';
        }

        function applyFilters() {
            const btn = document.getElementById('applyFiltersBtn');

            // Bug #3 — Validate regex client-side BEFORE firing any request, so we avoid
            // the blocking alert() and the 4-error parallel-fetch cascade on invalid regex.
            const textSearchState = parseSearchQuery(document.getElementById('filterText').value);
            if (textSearchState.type === 'invalid') {
                showFilterTextError(`Invalid regex: ${textSearchState.error || 'bad pattern'}`);
                return;
            }
            clearFilterTextError();

            // Bug #4 — If an apply is already in flight, remember that the user wants to
            // re-apply with the current form state once the current request settles.
            if (btn.disabled) {
                _applyPendingReapply = true;
                return;
            }

            btn.disabled = true;
            btn.innerHTML = '<span class="spinner-small"></span> Applying...';
            _pushUrlState();

            if (serverBrowseMode) {
                currentPage = 1;
                // Optimistic UI: grey out charts + show skeleton rows immediately so the
                // user sees feedback while the VM processes the new filter.
                markSectionStale('all');
                _applyInFlightKey = buildServerFilterCacheKey();
                _applyPendingReapply = false;
                refreshServerBrowseData(1, true)
                    .then(() => { saveRecentFilter(); })
                    .finally(() => {
                        markSectionFresh('all');
                        btn.disabled = false;
                        btn.innerHTML = '<span>Apply Filters</span>';
                        // Bug #4 — If the form changed while we were running, re-apply now.
                        const currentKey = buildServerFilterCacheKey();
                        const divergent = currentKey !== _applyInFlightKey;
                        _applyInFlightKey = null;
                        if (_applyPendingReapply || divergent) {
                            _applyPendingReapply = false;
                            setTimeout(applyFilters, 0);
                        }
                    });
                return;
            }

            setTimeout(() => {
                const countries = getSelectedValues('filterCountry');
                const bodies = getSelectedValues('filterBody');
                const regions = getSelectedValues('filterRegion');
                const themes = getSelectedValues('filterTheme');
                const affectedPersons = getSelectedValues('filterAffectedPersons');
                const sdgs = getSelectedValues('filterSdg');
                const type = document.getElementById('filterType').value;
                const yearStart = parseInt(document.getElementById('filterYearStart').value) || 0;
                const yearEnd = parseInt(document.getElementById('filterYearEnd').value) || 9999;
                // textSearchState was validated above; re-use it
                if (textSearchState.type === 'invalid') {
                    btn.disabled = false;
                    btn.innerHTML = '<span>Apply Filters</span>';
                    return;
                }

                const _cleanDash = s => (s || '').replace(/^-+\s*/, '').trim().toLowerCase();

                filteredData = rawData.filter(r => {
                    if (countries.length && !countries.some(c => r._countriesArray.some(rc => _cleanDash(rc) === _cleanDash(c)))) return false;
                    if (bodies.length && !bodies.some(b => _cleanDash(r._body) === _cleanDash(b))) return false;
                    if (regions.length && !regions.some(reg => r._regionsArray.some(rr => _cleanDash(rr) === _cleanDash(reg)))) return false;
                    if (themes.length && !themes.some(t => (r._themesArray || []).some(rt => _cleanDash(rt) === _cleanDash(t) || rt.includes(t) || t.includes(rt)))) return false;
                    if (affectedPersons.length && !affectedPersons.some(ap => (r._affectedPersonsArray || []).some(ra => _cleanDash(ra) === _cleanDash(ap) || ra.includes(ap) || ap.includes(ra)))) return false;
                    if (sdgs.length && !sdgs.some(s => (r._sdgsArray || []).some(rs => _cleanDash(rs) === _cleanDash(s) || rs.includes(s)))) return false;
                    if (type && type !== 'All' && r._type !== type) return false;
                    if (r._year && (r._year < yearStart || r._year > yearEnd)) return false;
                    if (!recordMatchesSearch(r, ['_text'], textSearchState)) return false;
                    return true;
                });

                chartData = filteredData.length > MAX_CHART_RECORDS ? sampleData(filteredData, MAX_CHART_RECORDS) : filteredData;
                currentPage = 1;
                updateDashboard();
                saveRecentFilter();

                btn.disabled = false;
                btn.innerHTML = '<span>Apply Filters</span>';
            }, 50);
        }

        function resetFilters() {
            clearFilter('filterCountry');
            clearFilter('filterBody');
            clearFilter('filterRegion');
            clearFilter('filterTheme');
            clearFilter('filterAffectedPersons');
            clearFilter('filterSdg');
            document.getElementById('filterType').selectedIndex = 0;
            document.getElementById('filterText').value = '';
            clearFilterTextError();
            // Bug #2 — Clear the URL hash so a Reset is reflected in the shareable URL.
            // Without this, users bookmarking after reset would restore stale filters.
            // Runs in both server-browse and local modes.
            _pushUrlState();

            if (serverBrowseMode) {
                if (serverState.facets) {
                    if (Number.isFinite(serverState.facets.min_year)) {
                        document.getElementById('filterYearStart').value = serverState.facets.min_year;
                    }
                    if (Number.isFinite(serverState.facets.max_year)) {
                        document.getElementById('filterYearEnd').value = serverState.facets.max_year;
                    }
                }
                currentPage = 1;
                refreshServerBrowseData(1, true);
                return;
            }

            const years = rawData.map(r => r._year).filter(y => y && y > 1990 && y < 2100);
            if (years.length) {
                document.getElementById('filterYearStart').value = Math.min(...years);
                document.getElementById('filterYearEnd').value = Math.max(...years);
            }

            filteredData = [...rawData];
            chartData = rawData.length > MAX_CHART_RECORDS ? sampleData(rawData, MAX_CHART_RECORDS) : rawData;
            currentPage = 1;
            updateDashboard();
        }

        function getSelectedValues(id) {
            return Array.from(document.getElementById(id).selectedOptions).map(o => o.value);
        }

        // ========== DASHBOARD UPDATE ==========
        function updateDashboard() {
            renderFilterChips();
            syncHeroStatsVisibility();
            if (serverBrowseMode) {
                const hasData = serverState.totalRecords > 0;
                if (!hasData) {
                    document.getElementById('emptyState').classList.remove('hidden');
                } else {
                    document.getElementById('emptyState').classList.add('hidden');
                }
                chartData = serverState.records || [];
                updateServerSummaryUI(serverState.summary || {});
                updateOverviewWorldMap();
                if (hasData) updateAllCharts();
                buildDataTable();
                updateChartContextSubtitles();
                return;
            }
            const hasData = filteredData.length > 0;

            const filterCountEl = document.getElementById('filterCount');
            const searchTerm = (document.getElementById('filterText')?.value || '').trim();
            if (filteredData.length === rawData.length && !searchTerm) {
                filterCountEl.textContent = `${rawData.length.toLocaleString()} records`;
            } else if (filteredData.length === 0) {
                filterCountEl.innerHTML = searchTerm
                    ? `<span style="color:#c62828;">0 hits</span> for '${escapeHtml(searchTerm.length > 20 ? searchTerm.slice(0,18) + '…' : searchTerm)}'`
                    : `<span style="color:#c62828;">0 hits</span>`;
            } else {
                filterCountEl.innerHTML = searchTerm
                    ? `${filteredData.length.toLocaleString()} hits for <em>'${escapeHtml(searchTerm.length > 20 ? searchTerm.slice(0,18) + '…' : searchTerm)}'</em>`
                    : `${filteredData.length.toLocaleString()} hits`;
            }

            if (!hasData) {
                document.getElementById('emptyState').classList.remove('hidden');
                const emptyMsg = document.getElementById('emptyStateMsg');
                if (emptyMsg) {
                    emptyMsg.innerHTML = searchTerm
                        ? `No records match <strong>'${escapeHtml(searchTerm)}'</strong> with the current filters.`
                        : 'Your current filters don\'t match any records.';
                }
                document.querySelectorAll('.charts-section').forEach(s => s.classList.add('hidden'));
            } else {
                document.getElementById('emptyState').classList.add('hidden');
                document.querySelectorAll('.charts-section').forEach(s => s.classList.remove('hidden'));
            }

            updateOverviewWorldMap();
            updateKPIs();
            if (hasData) updateAllCharts();
            buildDataTable();
            updateChartContextSubtitles();
        }

        function updateKPIs() {
            if (serverBrowseMode) {
                updateServerSummaryUI(serverState.summary || {});
                return;
            }
            const total = filteredData.length;
            const countries = new Set(filteredData.flatMap(r => r._countriesArray).filter(Boolean)).size;
            const bodies = new Set(filteredData.map(r => r._body).filter(Boolean)).size;
            const themes = new Set(filteredData.flatMap(r => r._themesArray).filter(Boolean)).size;
            const years = filteredData.map(r => r._year).filter(y => y && y > 1990);
            const minY = years.length ? Math.min(...years) : '-';
            const maxY = years.length ? Math.max(...years) : '-';
            const span = years.length ? `${minY}-${maxY}` : '-';
            const avg = years.length ? Math.round(total / (maxY - minY + 1)) : 0;

            document.getElementById('kpiTotal').textContent = total.toLocaleString();
            document.getElementById('kpiCountries').textContent = countries.toLocaleString();
            document.getElementById('kpiBodies').textContent = bodies;
            document.getElementById('kpiThemes').textContent = themes.toLocaleString();
            document.getElementById('kpiYearSpan').textContent = span;
            document.getElementById('kpiAvgPerYear').textContent = avg.toLocaleString();
        }

        // updateStats() removed — populated hidden .stats-section that was never visible

        function normalizeCountryForMap(rawCountry) {
            let value = String(rawCountry || '')
                .replace(/^[\-\u2022•\s]+/, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (!value) return '';

            const lower = value.toLowerCase();
            if (invalidCountryTokens.has(lower) || lower.includes('multiple') || lower.includes('various')) return '';
            if (countryNameAliases[lower]) return countryNameAliases[lower];

            value = value.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
            const strippedLower = value.toLowerCase();
            if (!value || invalidCountryTokens.has(strippedLower)) return '';
            return countryNameAliases[strippedLower] || value;
        }

        function collectCountryFrequencyForMap(records = filteredData) {
            const counts = {};
            records.forEach(record => {
                (record._countriesArray || []).forEach(country => {
                    const normalized = normalizeCountryForMap(country);
                    if (!normalized) return;
                    counts[normalized] = (counts[normalized] || 0) + 1;
                });
            });
            return counts;
        }

        function buildCountryFrequencyFromCountRows(countRows = []) {
            const counts = {};
            countRows.forEach(row => {
                const normalized = normalizeCountryForMap(row?.country || row?.value || '');
                const count = Number(row?.count || 0);
                if (!normalized || !Number.isFinite(count) || count <= 0) return;
                counts[normalized] = (counts[normalized] || 0) + count;
            });
            return counts;
        }

        function getWorldMapFigure(source = filteredData, options = {}) {
            const looksLikeCountRows = Array.isArray(source)
                && source.length > 0
                && !('_countriesArray' in source[0])
                && (('country' in source[0]) || ('value' in source[0]) || ('count' in source[0]));
            const counts = looksLikeCountRows
                ? buildCountryFrequencyFromCountRows(source)
                : collectCountryFrequencyForMap(source);
            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            const locations = sorted.map(([country]) => country);
            const values = sorted.map(([, count]) => count);

            const trace = {
                type: 'choropleth',
                locationmode: 'country names',
                locations,
                z: values,
                colorscale: [
                    [0, '#dcecff'],
                    [0.25, '#9fc2f3'],
                    [0.5, '#5e94da'],
                    [0.75, '#2d6cb7'],
                    [1, '#0f3e77']
                ],
                marker: { line: { color: '#ffffff', width: 0.5 } },
                colorbar: window.innerWidth < 768
                    ? { orientation: 'h', thickness: 8, len: 0.6, y: -0.05, yanchor: 'top', title: '' }
                    : options.hideColorbarTitle
                        ? { thickness: 12 }
                        : { title: 'Frequency', thickness: 12 },
                hovertemplate: '%{location}<br>Frequency: %{z}<extra></extra>'
            };

            const layout = {
                margin: { l: 0, r: 0, t: 0, b: 0 },
                paper_bgcolor: 'rgba(0,0,0,0)',
                plot_bgcolor: 'rgba(0,0,0,0)',
                dragmode: 'pan',
                geo: {
                    scope: 'world',
                    projection: { type: 'natural earth' },
                    fitbounds: options.fitbounds || false,
                    showframe: false,
                    showcoastlines: true,
                    coastlinecolor: '#8ca0bb',
                    landcolor: '#f5f9ff',
                    bgcolor: 'rgba(0,0,0,0)'
                },
                annotations: sorted.length ? [] : [{
                    x: 0.5,
                    y: 0.5,
                    xref: 'paper',
                    yref: 'paper',
                    text: 'No country frequency data in current filter.',
                    showarrow: false,
                    font: { size: 14, color: '#5f738d' }
                }]
            };

            return { trace, layout };
        }

        function renderWorldMap(container, source = filteredData, options = {}) {
            if (!container) return;
            if (typeof Plotly === 'undefined') {
                container.innerHTML = '<div style="padding:16px;color:#6b7f98;">World map library is unavailable in this browser session.</div>';
                return;
            }

            const fig = getWorldMapFigure(source, options);
            const render = Plotly.react(container, [fig.trace], fig.layout, {
                responsive: true,
                scrollZoom: true,
                displayModeBar: true,
                displaylogo: false,
                modeBarButtonsToRemove: ['lasso2d', 'select2d', 'toImage']
            });
            if (render && typeof render.then === 'function') {
                render.then(() => {
                    if (container.isConnected && container.data) {
                        Plotly.Plots.resize(container);
                    }
                    // Wire up click-to-drilldown on map countries
                    container.removeAllListeners?.('plotly_click');
                    container.on('plotly_click', function(eventData) {
                        if (!eventData || !eventData.points || !eventData.points.length) return;
                        const pt = eventData.points[0];
                        const plotlyName = pt.location;
                        const count = pt.z;
                        if (!plotlyName) return;
                        // Resolve to DB country name for API query
                        const dbName = resolveCountryForApi(plotlyName);
                        const title = `Recommendations for ${plotlyName} (${(count || 0).toLocaleString()})`;
                        const filterFn = r => (r._countriesArray || []).some(c => {
                            const clean = c.replace(/^-+\s*/, '').trim();
                            return clean === plotlyName || clean === dbName;
                        });
                        _currentDrilldownChartKey = 'mapCountry';
                        openDrilldown(title, filterFn, dbName, '');
                    });
                }).catch(() => {});
            }
        }

        function resizeOverviewWorldMap() {
            const mapContainer = document.getElementById('overviewWorldMap');
            if (!mapContainer || typeof Plotly === 'undefined') return;
            if (mapContainer.data) {
                Plotly.Plots.resize(mapContainer);
            }
        }

        function updateOverviewWorldMap() {
            const mapContainer = document.getElementById('overviewWorldMap');
            if (serverBrowseMode || overviewBootstrapMode) {
                const source = Array.isArray(serverState.mapCountryCounts) && serverState.mapCountryCounts.length
                    ? serverState.mapCountryCounts
                    : serverState.records;
                renderWorldMap(mapContainer, source, { hideColorbarTitle: true, fitbounds: false });
                return;
            }
            renderWorldMap(mapContainer, filteredData, { hideColorbarTitle: true, fitbounds: false });
        }

        function populateCustomWidgetSelector() {
            const sel = document.getElementById('customWidgetSelect');
            if (!sel) return;
            sel.innerHTML = customWidgetCatalog
                .map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.title)}</option>`)
                .join('');
        }

        function getCustomWidgetById(id) {
            return customWidgetCatalog.find(w => w.id === id) || null;
        }

        function addCustomWidget() {
            const sel = document.getElementById('customWidgetSelect');
            if (!sel) return;
            const id = sel.value;
            if (!id) return;
            if (!customWidgetOrder.includes(id)) {
                customWidgetOrder.push(id);
                saveCustomWidgetsToStorage();
            }
            renderCustomDashboard();
            syncCustomDashboardCharts();
        }

        function removeCustomWidget(id) {
            customWidgetOrder = customWidgetOrder.filter(x => x !== id);
            if (customCharts[id]) {
                customCharts[id].destroy();
                delete customCharts[id];
            }
            saveCustomWidgetsToStorage();
            renderCustomDashboard();
            syncCustomDashboardCharts();
        }

        function clearCustomWidgets() {
            customWidgetOrder = [];
            Object.keys(customCharts).forEach(id => {
                if (customCharts[id]) {
                    customCharts[id].destroy();
                    delete customCharts[id];
                }
            });
            saveCustomWidgetsToStorage();
            renderCustomDashboard();
        }

        function onCustomDragStart(index, event) {
            customDragIndex = index;
            event.dataTransfer.effectAllowed = 'move';
            const card = event.currentTarget;
            if (card) card.classList.add('dragging');
        }

        function onCustomDragEnd(event) {
            customDragIndex = null;
            const card = event.currentTarget;
            if (card) card.classList.remove('dragging');
        }

        function onCustomDragOver(event) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
        }

        function onCustomDrop(targetIndex, event) {
            event.preventDefault();
            if (customDragIndex === null || customDragIndex === targetIndex) return;
            const moved = customWidgetOrder.splice(customDragIndex, 1)[0];
            customWidgetOrder.splice(targetIndex, 0, moved);
            saveCustomWidgetsToStorage();
            renderCustomDashboard();
            syncCustomDashboardCharts();
        }

        function renderCustomDashboard() {
            const grid = document.getElementById('customDashboardGrid');
            if (!grid) return;

            if (!customWidgetOrder.length) {
                grid.innerHTML = '<div class="custom-empty">No charts selected yet. Add charts from the dropdown above.</div>';
                return;
            }

            grid.innerHTML = customWidgetOrder.map((id, index) => {
                const widget = getCustomWidgetById(id);
                if (!widget) return '';
                const bodyClass = widget.sourceType === 'plotly' ? 'custom-widget-body tall' : 'custom-widget-body';
                return `
                    <div class="custom-widget-card" draggable="true"
                         ondragstart="onCustomDragStart(${index}, event)"
                         ondragend="onCustomDragEnd(event)"
                         ondragover="onCustomDragOver(event)"
                         ondrop="onCustomDrop(${index}, event)">
                        <div class="custom-widget-header">
                            <div class="custom-widget-title">${escapeHtml(widget.title)}</div>
                            <div class="custom-widget-actions">
                                <button type="button" onclick="removeCustomWidget('${escapeJs(id)}')">Remove</button>
                            </div>
                        </div>
                        <div class="${bodyClass}">
                            ${widget.sourceType === 'plotly'
                                ? `<div id="customPlotly_${escapeHtml(id)}" class="custom-widget-plotly"></div>`
                                : `<canvas id="customCanvas_${escapeHtml(id)}" class="custom-widget-canvas"></canvas>`
                            }
                        </div>
                    </div>
                `;
            }).join('');
        }

        function cloneForChart(value) {
            if (value === null || value === undefined) return value;
            if (typeof value === 'function') return value;
            if (Array.isArray(value)) return value.map(cloneForChart);
            if (typeof value === 'object') {
                const out = {};
                Object.keys(value).forEach(k => {
                    out[k] = cloneForChart(value[k]);
                });
                return out;
            }
            return value;
        }

        function syncCustomDashboardCharts() {
            const grid = document.getElementById('customDashboardGrid');
            if (!grid || !customWidgetOrder.length) return;

            customWidgetOrder.forEach(id => {
                const widget = getCustomWidgetById(id);
                if (!widget) return;

                if (widget.sourceType === 'plotly') {
                    const target = document.getElementById(`customPlotly_${id}`);
                    if (!target || typeof Plotly === 'undefined') return;
                    renderWorldMap(target, filteredData, { hideColorbarTitle: true, fitbounds: false });
                    return;
                }

                const sourceKey = widget.sourceChartKey;
                const sourceChart = charts[sourceKey];
                if (!sourceChart) return;
                const targetCanvas = document.getElementById(`customCanvas_${id}`);
                if (!targetCanvas) return;

                if (customCharts[id]) {
                    customCharts[id].destroy();
                    delete customCharts[id];
                }
                const cfg = cloneForChart(sourceChart.config);
                customCharts[id] = new Chart(targetCanvas, cfg);
            });
        }

        // ========== CHARTS (abbreviated - same as original) ==========
        function updateAllCharts() {
            updateYearlyTrendChart();
            updateTopCountriesChart();
            updateBodyDistributionChart();
            updateRegionDistributionChart();
            updateStackedChart();
            updateCumulativeChart();
            updateYoYChart();
            updateThemeRadarChart();
            updateTopThemesChart();
            updateThemeTrendsChart();
            updateBodyScatterChart();
            updateBodyHeatmapChart();
            updateRegionComparisonChart();
            updateAffectedPersonsChart();
            updateSDGsChart();
            updateBigramsChart();
            updateTextLengthChart();
            updateEscCcprTrendChart();
            updateRightsScatterChart();
            updateLabelCoverageChart();
            updateLabelDistributionChart();
            updateLabelTrendsChart();
            updateLabelPairsChart();
            updateLabelBigramsChart();
            updateLabelStatsGrid();
            updateLabelYearlyChart();
            updateLabelBodiesChart();
            updateLabelThemeTrendsChart();
            updateLabelEscCcprChart();
            updateLabelBodyScatterChart();
        }

        function destroyChart(id) {
            if (charts[id]) { charts[id].destroy(); delete charts[id]; }
        }

        const defaultTooltip = {
            backgroundColor: 'rgba(0,0,0,0.8)',
            titleFont: { size: 13 },
            bodyFont: { size: 12 },
            padding: 12,
            cornerRadius: 6
        };

        // ─── Chart Drill-Down System ────────────────────────────────
        // Maps chart key → function(clickedLabel) → filter predicate for records
        const chartDrilldownMap = {
            yearlyTrend:        label => r => String(r._year) === String(label),
            bodyDistribution:   label => r => (r._body || '').replace(/^-+\s*/, '').trim() === label.replace(/^-+\s*/, '').trim(),
            regionDistribution: label => r => (r._regions || '').replace(/^-+\s*/, '').trim() === label.replace(/^-+\s*/, '').trim() || (r._regionsArray || []).some(rg => rg.replace(/^-+\s*/, '').trim() === label.replace(/^-+\s*/, '').trim()),
            topThemes:          label => r => (r._themesArray || []).some(t => t.replace(/^-+\s*/, '').trim().startsWith(label.replace(/^-+\s*/, '').trim().substring(0, 30))),
            affectedPersons:    label => r => (r._affectedPersonsArray || []).some(p => p.replace(/^-+\s*/, '').trim() === label.replace(/^-+\s*/, '').trim()),
            sdgs:               label => r => (r._sdgsArray || []).some(s => s.replace(/^-+\s*/, '').trim().startsWith(label.replace(/^-+\s*/, '').trim().substring(0, 20))),
            stackedTrend:       (label, datasetLabel) => r => String(r._year) === String(label) && (r._body || '').replace(/^-+\s*/, '').trim() === datasetLabel.replace(/^-+\s*/, '').trim(),
            cumulative:         label => r => Number(r._year) <= Number(label),
            yoy:                label => r => String(r._year) === String(label),
            bodyScatter:        (label, datasetLabel) => r => {
                const body = (r._body || '').replace(/^-+\s*/, '').trim();
                const matchBody = datasetLabel ? body === datasetLabel.replace(/^-+\s*/, '').trim() : true;
                const matchYear = label ? String(r._year) === String(label) : true;
                return matchBody && matchYear;
            },
            regionComparison:   label => r => (r._regionsArray || []).some(rg => rg.replace(/^-+\s*/, '').trim() === label.replace(/^-+\s*/, '').trim()),
            topCountries:       label => r => (r._countriesArray || []).some(c => c.replace(/^-+\s*/, '').trim() === label.replace(/^-+\s*/, '').trim()),
            // Themes tab: Theme Trends line chart (click year+theme)
            themeTrends:        (label, datasetLabel) => r => String(r._year) === String(label) && (r._themesArray || []).some(t => t.replace(/^-+\s*/, '').trim().startsWith(datasetLabel.trim().substring(0, 20))),
            // Themes tab: ESC vs CCPR stacked bar (click a year+dataset)
            escCcprTrend:       (label, datasetLabel) => r => {
                if (String(r._year) !== String(label)) return false;
                const isEsc = datasetLabel.includes('ESC');
                return (r._rightThemeKeys || []).some(key => {
                    const meta = rightsThemeLookup[key];
                    return meta && (isEsc ? meta.family === 'ESCR' : meta.family === 'CCPR');
                });
            },
            // Themes tab: Rights scatter (click a point → year+rights category)
            rightsScatter:      (label, datasetLabel) => r => {
                if (String(r._year) !== String(label)) return false;
                const cleanDs = datasetLabel.replace(/^\d+\.\s*/, '');
                if (cleanDs.startsWith('Other ESCR')) return (r._rightThemeKeys || []).some(k => { const m = rightsThemeLookup[k]; return m && m.family === 'ESCR'; });
                if (cleanDs.startsWith('Other CCPR')) return (r._rightThemeKeys || []).some(k => { const m = rightsThemeLookup[k]; return m && m.family === 'CCPR'; });
                return (r._rightThemeKeys || []).some(key => { const m = rightsThemeLookup[key]; return m && m.label === cleanDs; });
            },
            // Themes tab: Body heatmap (year+body stacked bar)
            bodyHeatmap:        (label, datasetLabel) => r => String(r._year) === String(label) && (r._body || '').replace(/^-+\s*/, '').includes(datasetLabel),
            // Overview tab: Bigrams — drilldown disabled (text search too unreliable)
            // Overview tab: Text length by body (horizontal bar)
            textLength:         label => r => (r._body || '').replace(/^-+\s*/, '').trim() === label.trim(),
            // Labels tab charts
            labelDistribution:  label => r => normalizePredictedLabelsForStats(r._predictedLabels || []).includes(label),
            labelYearly:        label => r => String(r._year) === String(label) && (r._predictedLabels || []).length > 0,
            labelBodies:        label => r => (r._body || '').replace('- ', '').trim() === label.trim() && (r._predictedLabels || []).length > 0,
            labelTrends:        (label, datasetLabel) => r => String(r._year) === String(label) && (r._themesArray || []).some(t => t.replace('- ', '').slice(0, 30) === datasetLabel.slice(0, 30)) && (r._predictedLabels || []).length > 0,
            // Compare tab charts
            compareTotal:       label => r => (r._countriesArray || []).some(c => c.replace(/^-+\s*/, '').trim() === label.replace(/^-+\s*/, '').trim()),
            compareBody:        (label, datasetLabel) => r => { const b = (r._body || '').replace(/^-+\s*/, '').trim(); return (b === label.trim() || b.startsWith(label.trim())) && (r._countriesArray || []).some(c => c.replace(/^-+\s*/, '').trim() === datasetLabel.trim()); },
            compareTrend:       (label, datasetLabel) => r => String(r._year) === String(label) && (r._countriesArray || []).some(c => c.replace(/^-+\s*/, '').trim() === datasetLabel.trim()),
            compareThemes:      (label, datasetLabel) => r => (r._themesArray || []).some(t => t.replace(/^-+\s*/, '').trim() === label.trim()) && (r._countriesArray || []).some(c => c.replace(/^-+\s*/, '').trim() === datasetLabel.trim()),
            compareAffected:    (label, datasetLabel) => r => (r._affectedPersonsArray || []).some(a => a.replace(/^-+\s*/, '').trim() === label.trim()) && (r._countriesArray || []).some(c => c.replace(/^-+\s*/, '').trim() === datasetLabel.trim()),
            labelEscCcpr:       (label, datasetLabel) => r => {
                if (String(r._year) !== String(label) || !(r._predictedLabels || []).length) return false;
                const isEsc = datasetLabel.includes('ESC');
                return (r._rightThemeKeys || []).some(key => { const m = rightsThemeLookup[key]; return m && (isEsc ? m.family === 'ESCR' : m.family === 'CCPR'); });
            },
            labelBodyScatter:   (label, datasetLabel) => r => {
                const cleanDs = datasetLabel.replace('- ', '').trim();
                return String(r._year) === String(label) && (r._body || '').replace('- ', '').trim() === cleanDs && (r._predictedLabels || []).length > 0;
            },
            labelPairs:         label => r => {
                const labels = normalizePredictedLabelsForStats(r._predictedLabels || []);
                const pair = label.split(' + ');
                return pair.length === 2 && labels.includes(pair[0]) && labels.includes(pair[1]);
            },
            labelBigrams:       label => r => {
                if (!(r._predictedLabels || []).length) return false;
                return (r._text || '').toLowerCase().includes(label.toLowerCase());
            },
            labelCoverage:      label => r => {
                const hasL = (r._predictedLabels || []).length > 0;
                return label.includes('With') ? hasL : !hasL;
            },
            labelThemeTrends:   (label, datasetLabel) => r => String(r._year) === String(label) && (r._themesArray || []).some(t => t.replace('- ', '').slice(0, 30) === datasetLabel.slice(0, 30)) && (r._predictedLabels || []).length > 0,
        };

        // Drill-down descriptions for the panel title
        const chartDrilldownTitles = {
            yearlyTrend:        label => `Recommendations from ${label}`,
            bodyDistribution:   label => `Recommendations by ${label}`,
            regionDistribution: label => `Recommendations for ${label}`,
            topThemes:          label => `Recommendations: ${label}`,
            affectedPersons:    label => `Recommendations mentioning ${label}`,
            sdgs:               label => `Recommendations: ${label}`,
            stackedTrend:       (label, ds) => `${(ds||'').replace(/^-+\s*/,'')} recommendations from ${label}`,
            cumulative:         label => `Recommendations up to ${label}`,
            yoy:                label => `Recommendations from ${label}`,
            bodyScatter:        (label, ds) => `${ds || 'Body'} — ${label}`,
            regionComparison:   label => `Recommendations for ${label}`,
            topCountries:       label => `Recommendations for ${label}`,
            themeTrends:        (label, ds) => `${(ds||'').replace(/^-+\s*/,'')} recommendations from ${label}`,
            escCcprTrend:       (label, ds) => `${ds} in ${label}`,
            rightsScatter:      (label, ds) => `${ds.replace(/^\d+\.\s*/, '')} in ${label}`,
            bodyHeatmap:        (label, ds) => `${(ds||'').replace(/^-+\s*/,'')} recommendations from ${label}`,
            textLength:         label => `Recommendations by ${label}`,
            labelDistribution:  label => `Records labeled: ${label}`,
            labelYearly:        label => `Labeled records from ${label}`,
            labelBodies:        label => `Labeled records by ${label}`,
            labelTrends:        (label, ds) => `Labeled ${ds} records from ${label}`,
            labelEscCcpr:       (label, ds) => `Labeled ${ds} in ${label}`,
            labelBodyScatter:   (label, ds) => `Labeled ${ds} records from ${label}`,
            labelPairs:         label => `Records with labels: ${label}`,
            labelBigrams:       label => `Labeled records containing "${label}"`,
            // Compare tab
            compareTotal:       label => `Recommendations for ${label}`,
            compareBody:        (label, ds) => `${label} recommendations — ${ds}`,
            compareTrend:       (label, ds) => `${ds} — ${label}`,
            compareThemes:      (label, ds) => `${label} — ${ds}`,
            compareAffected:    (label, ds) => `${label} — ${ds}`,
            labelCoverage:      label => label.includes('With') ? 'Records with assigned labels' : 'Records without assigned labels',
            labelThemeTrends:   (label, ds) => `Labeled ${ds} records from ${label}`,
        };

        // Find which chart key a Chart.js instance belongs to
        function getChartKey(chartInstance) {
            for (const [key, inst] of Object.entries(charts)) {
                if (inst === chartInstance) return key;
            }
            return null;
        }

        // Global Chart.js onClick handler — added to all new charts
        function handleChartDrilldown(event, elements, chart) {
            if (!elements || elements.length === 0) return;
            const el = elements[0];
            const chartKey = getChartKey(chart);
            if (!chartKey || !chartDrilldownMap[chartKey]) return;

            let label = chart.data.labels?.[el.index];
            const dataset = chart.data.datasets?.[el.datasetIndex];
            const datasetLabel = dataset?._fullLabel || dataset?.label || '';

            // For scatter charts, labels array is empty — derive label from the clicked point or dataset
            if (!label && chart.config.type === 'scatter') {
                const pt = chart.data.datasets?.[el.datasetIndex]?.data?.[el.index];
                label = pt?.x != null ? String(Math.round(pt.x)) : datasetLabel;
            }
            if (!label) return;

            // Use full (untruncated) label for API params when available
            const fullLabel = chart._fullLabels?.[el.index] || label;

            const titleFn = chartDrilldownTitles[chartKey];
            const title = titleFn ? titleFn(fullLabel, datasetLabel) : `Recommendations: ${fullLabel}`;
            const filterFn = chartDrilldownMap[chartKey](fullLabel, datasetLabel);

            _currentDrilldownChartKey = chartKey;
            openDrilldown(title, filterFn, fullLabel, datasetLabel);
        }

        // Register the global onClick via Chart.js defaults
        Chart.defaults.onClick = handleChartDrilldown;

        const DRILLDOWN_PAGE_SIZE = 25;
        let _drilldownState = { filterFn: null, allResults: [], shown: 0, label: '', totalOnServer: 0 };
        let _drilldownTotalOnServer = 0;

        // Build extra API query params for server-mode drill-down based on chart + label
        const chartDrilldownApiParams = {
            yearlyTrend:        label => ({ year_start: label, year_end: label }),
            yoy:                label => ({ year_start: label, year_end: label }),
            bodyDistribution:   label => ({ bodies: '- ' + label }),
            topThemes:          label => ({ themes: label }),
            affectedPersons:    label => ({ affected_persons: label }),
            sdgs:               label => ({ sdgs: label }),
            stackedTrend:       (label, ds) => ({ year_start: label, year_end: label, bodies: '- ' + ds }),
            cumulative:         label => ({ year_end: label }),
            regionDistribution: label => ({ regions: label }),
            regionComparison:   label => ({ regions: label }),
            bodyScatter:        (label, ds) => ({ year_start: label, year_end: label, bodies: '- ' + ds }),
            topCountries:       label => ({ countries: resolveCountryForApi(label) }),
            mapCountry:         label => ({ countries: label }),
            themeTrends:        (label, ds) => ({ year_start: label, year_end: label, themes: ds }),
            escCcprTrend:       label => ({ year_start: label, year_end: label }),
            bodyHeatmap:        (label, ds) => ({ year_start: label, year_end: label, bodies: '- ' + ds }),
            textLength:         label => ({ bodies: '- ' + label }),
        };

        async function openDrilldown(title, filterFn, label, datasetLabel) {
            const overlay = document.getElementById('drilldownOverlay');
            const titleEl = document.getElementById('drilldownTitle');
            const bodyEl = document.getElementById('drilldownBody');
            overlay.classList.remove('hidden');
            titleEl.textContent = title;
            bodyEl.innerHTML = '<div class="drilldown-loading">Searching recommendations...</div>';

            let results = [];

            // Determine the records API URL — works in server browse mode and bootstrap mode
            const drilldownRecordsUrl = DATASET_RECORDS_URL || (overviewBootstrapMode && DEFAULT_VM_BASE_URL ? `${DEFAULT_VM_BASE_URL}/api/data/records` : '');
            if ((serverBrowseMode || overviewBootstrapMode) && drilldownRecordsUrl) {
                // Server mode: fetch matching records from the API with extra filters
                try {
                    const params = serverBrowseMode
                        ? buildServerQueryParams({ includePagination: false, includeSort: false })
                        : new URLSearchParams();
                    params.set('page_size', '100');
                    params.set('page', '1');
                    params.set('sort', '-year');

                    // Find the chart key from the drilldown state
                    const chartKey = _currentDrilldownChartKey;
                    const extraParamsFn = chartKey ? chartDrilldownApiParams[chartKey] : null;
                    if (extraParamsFn) {
                        const extra = extraParamsFn(label, datasetLabel);
                        for (const [k, v] of Object.entries(extra)) {
                            if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
                        }
                    }

                    const payload = await fetchServerJson(
                        `${drilldownRecordsUrl}?${params.toString()}`,
                        'Drill-down fetch',
                        20000
                    );
                    if (payload?.records) {
                        results = payload.records.map((row, idx) => normalizeRecord(row, 900000 + idx));
                    }
                    _drilldownTotalOnServer = payload?.total || payload?.total_count || results.length;
                } catch (err) {
                    console.warn('Drill-down API fetch failed:', err);
                    bodyEl.innerHTML = '<div class="drilldown-empty">Could not fetch recommendations from the server. Try again later.</div>';
                    return;
                }
            } else {
                // Local mode: filter in-memory data
                const sourceData = filteredData.length > 0 ? filteredData : chartData;
                const allMatches = sourceData.filter(filterFn);
                _drilldownTotalOnServer = allMatches.length;
                // Sort by year descending (most recent first), take max 100
                allMatches.sort((a, b) => (b._year || 0) - (a._year || 0));
                results = allMatches.slice(0, 100);
            }

            _drilldownState = { filterFn, allResults: results, shown: 0, label, totalOnServer: _drilldownTotalOnServer };

            if (results.length === 0) {
                bodyEl.innerHTML = '<div class="drilldown-empty">No matching recommendations found.</div>';
                return;
            }

            renderDrilldownPage();
        }

        let _currentDrilldownChartKey = null;

        function renderDrilldownPage() {
            const body = document.getElementById('drilldownBody');
            const titleEl = document.getElementById('drilldownTitle');
            const { allResults, shown, totalOnServer } = _drilldownState;
            const end = Math.min(shown + DRILLDOWN_PAGE_SIZE, allResults.length);
            const batch = allResults.slice(shown, end);

            let html = shown === 0 ? '' : body.innerHTML.replace(/<div class="drilldown-more">[\s\S]*?<\/div>$/, '');

            batch.forEach((rec, idx) => {
                const fullText = rec._text || '';
                const maxLen = 400;
                const truncated = fullText.length > maxLen;
                const shortText = truncated ? fullText.substring(0, maxLen) : fullText;
                const uid = `dd-${shown + idx}`;
                const body_ = (rec._body || '').replace(/^-+\s*/, '').trim();
                // Use _countryLabel so 2-letter ISO codes (e.g. "AU", "CZ", "SV") from the
                // dataset get resolved to full country names ("Australia", "Czechia", "El Salvador").
                const country = _countryLabel((rec._countries || '').split('\n')[0]);
                const year = rec._year || '';
                const symbol = (rec._symbol || '').replace(/^-+\s*/, '').trim();
                const uhri = getUhriUrl(rec);
                const undocs = getUnDocsUrl(rec);

                html += `<div class="drilldown-rec">`;
                html += `<div class="drilldown-text" id="${uid}-short">${escapeHtml(shortText)}${truncated ? `<span style="color:#999">... </span><a href="javascript:void(0)" id="${uid}-btn" onclick="toggleDrilldownText('${uid}')" class="drilldown-expand-link">more</a>` : ''}</div>`;
                if (truncated) {
                    html += `<div class="drilldown-text hidden" id="${uid}-full">${escapeHtml(fullText)} <a href="javascript:void(0)" id="${uid}-btn2" onclick="toggleDrilldownText('${uid}')" class="drilldown-expand-link">less</a></div>`;
                }
                html += `<div class="drilldown-meta">`;
                if (body_) html += `<span><strong>${escapeHtml(body_)}</strong></span>`;
                if (country) html += `<span>${escapeHtml(country)}</span>`;
                if (year) html += `<span>${year}</span>`;
                if (symbol) html += `<span style="color:#888">${escapeHtml(symbol)}</span>`;
                html += `</div>`;
                html += `<div class="drilldown-actions">`;
                if (uhri) html += `<a href="${uhri}" target="_blank" rel="noopener" class="source-link uhri-link">UHRI</a>`;
                if (undocs) html += `<a href="${undocs}" target="_blank" rel="noopener" class="source-link undocs-link">UN Doc</a>`;
                if (typeof rec._id !== 'undefined' && recordMap.has(String(rec._id))) {
                    html += `<button class="copy-btn" onclick="showDrilldownDetail(${rec._id})" style="font-size:11px">Details</button>`;
                    html += `<button class="copy-btn" onclick="copyFormattedCitation(${rec._id}, this)" style="font-size:11px">Cite</button>`;
                }
                html += `</div></div>`;
            });

            _drilldownState.shown = end;

            const DRILLDOWN_MAX = 100;
            const hasMore = end < allResults.length;
            const limitNote = totalOnServer && totalOnServer > DRILLDOWN_MAX
                ? `<div style="padding:8px 20px; text-align:center; color:#8899aa; font-size:11px;">Showing ${Math.min(allResults.length, DRILLDOWN_MAX)} most recent of ${Number(totalOnServer).toLocaleString()} total matches</div>`
                : `<div style="padding:8px 20px; text-align:center; color:#8899aa; font-size:11px;">${allResults.length} recommendation${allResults.length !== 1 ? 's' : ''}</div>`;

            if (hasMore) {
                const remaining = allResults.length - end;
                html += `<div class="drilldown-more"><button onclick="renderDrilldownPage()">Show more (${remaining} remaining)</button></div>`;
            } else {
                html += limitNote;
            }

            body.innerHTML = html;
        }

        function toggleDrilldownText(uid) {
            const short = document.getElementById(`${uid}-short`);
            const full = document.getElementById(`${uid}-full`);
            if (!short || !full) return;
            const isExpanded = !full.classList.contains('hidden');
            short.classList.toggle('hidden', !isExpanded);
            full.classList.toggle('hidden', isExpanded);
        }

        // Show record detail inside the drilldown overlay (replacing the list)
        function showDrilldownDetail(id) {
            const rec = recordMap.get(String(id));
            if (!rec) return;

            const titleEl = document.getElementById('drilldownTitle');
            const bodyEl = document.getElementById('drilldownBody');

            // Save current list state so we can restore it
            _drilldownState._savedListHTML = bodyEl.innerHTML;
            _drilldownState._savedTitle = titleEl.textContent;

            const body_ = (rec._body || '').replace(/^-+\s*/, '').trim();
            const country = (rec._countries || '').split('\n').map(s => s.replace(/^-+\s*/, '').trim()).filter(Boolean).join(', ');
            const type = (rec._type || '').replace(/^-+\s*/, '').trim();
            const year = rec._year ? String(rec._year) : '';
            const symbol = (rec._symbol || '').replace(/^-+\s*/, '').trim();
            const themes = (rec._themesArray || []).map(t => t.replace(/^-+\s*/, '').trim()).filter(Boolean);
            const affectedPersons = (rec._affectedPersonsArray || []).map(p => p.replace(/^-+\s*/, '').trim()).filter(Boolean);
            const sdgs = (rec._sdgsArray || []).map(s => s.replace(/^-+\s*/, '').trim()).filter(Boolean);
            const regions = (rec._regionsArray || []).map(r => r.replace(/^-+\s*/, '').trim()).filter(Boolean);
            const uhriUrl = getUhriUrl(rec);
            const unDocsUrl = getUnDocsUrl(rec);

            const field = (label, value) => value ? `<div class="record-detail-label">${label}</div><div class="record-detail-value">${escapeHtml(value)}</div>` : '';
            const fieldList = (label, arr) => arr.length ? `<div class="record-detail-label">${label}</div><div class="record-detail-value">${arr.map(v => escapeHtml(v)).join(', ')}</div>` : '';

            titleEl.textContent = `${body_ || 'Recommendation'}${country ? ' — ' + country : ''}${year ? ' (' + year + ')' : ''}`;

            let html = '';
            html += `<div style="margin-bottom:12px;"><button class="btn btn-secondary" onclick="restoreDrilldownList()" style="padding:6px 14px; font-size:12px;">← Back to list</button></div>`;
            html += `<div class="record-detail-text">${escapeHtml(rec._text || '')}</div>`;
            html += '<div class="record-detail-grid">';
            html += field('Body', body_);
            html += field('Country', country);
            html += field('Year', year);
            html += field('Type', type);
            html += field('Document', symbol);
            html += fieldList('Regions', regions);
            html += fieldList('Themes', themes);
            html += fieldList('Affected Persons', affectedPersons);
            html += fieldList('SDGs', sdgs);
            html += '</div>';
            html += '<div class="record-detail-actions">';
            if (uhriUrl) html += `<a href="${uhriUrl}" target="_blank" rel="noopener" class="detail-btn-uhri">View on UHRI</a>`;
            if (unDocsUrl) html += `<a href="${unDocsUrl}" target="_blank" rel="noopener" class="detail-btn-undocs">View UN Document</a>`;
            html += `<button class="detail-btn-cite" onclick="copyFormattedCitation(${id}, this)">Copy Citation</button>`;
            html += `<button class="detail-btn-copy" onclick="copyToClipboard(recordMap.get('${id}')?._text || ''); this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy Text',1500)">Copy Text</button>`;
            html += '</div>';
            const citation = buildFormattedCitation(rec);
            html += `<div style="margin-top:12px; padding:10px 14px; background:#f5f5f5; border-radius:6px; font-size:12px; color:#555; line-height:1.5;">`;
            html += `<strong>Citation:</strong> ${escapeHtml(citation)}`;
            html += '</div>';

            bodyEl.innerHTML = html;
            bodyEl.scrollTop = 0;
        }

        function restoreDrilldownList() {
            const titleEl = document.getElementById('drilldownTitle');
            const bodyEl = document.getElementById('drilldownBody');
            if (_drilldownState._savedListHTML) {
                bodyEl.innerHTML = _drilldownState._savedListHTML;
                titleEl.textContent = _drilldownState._savedTitle || '';
                _drilldownState._savedListHTML = null;
                _drilldownState._savedTitle = null;
            }
        }

        function closeDrilldown(e) {
            if (!e || e.target === document.getElementById('drilldownOverlay')) {
                document.getElementById('drilldownOverlay').classList.add('hidden');
                _drilldownState = { filterFn: null, allResults: [], shown: 0, label: '', totalOnServer: 0 };
                _drilldownTotalOnServer = 0;
            }
        }

        const rightsPointNumberPlugin = {
            id: 'rightsPointNumberPlugin',
            afterDatasetsDraw(chart, args, pluginOptions) {
                const enabled = pluginOptions?.enabled;
                if (!enabled) return;
                const { ctx } = chart;
                ctx.save();
                ctx.font = '10px sans-serif';
                ctx.fillStyle = '#1e3a5f';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';

                chart.data.datasets.forEach((dataset, datasetIndex) => {
                    const labelNumber = dataset._numberLabel || (datasetIndex + 1);
                    const meta = chart.getDatasetMeta(datasetIndex);
                    if (meta.hidden) return;
                    meta.data.forEach(point => {
                        if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return;
                        ctx.fillText(String(labelNumber), point.x + 6, point.y - 6);
                    });
                });
                ctx.restore();
            }
        };

        // ─── Copy chart to clipboard ────────────────────────────────
        function initChartCopyButtons() {
            document.querySelectorAll('.chart-card').forEach(card => {
                if (card.querySelector('.chart-copy-btn')) return; // already injected
                const btn = document.createElement('button');
                btn.className = 'chart-copy-btn';
                btn.title = 'Copy chart to clipboard';
                btn.innerHTML = '<span class="copy-icon"></span>';
                btn.addEventListener('click', () => copyChartToClipboard(card, btn));
                card.appendChild(btn);
            });
        }

        async function copyChartToClipboard(card, btn) {
            const canvas = card.querySelector('canvas');
            if (!canvas) return;

            // Get chart title from h3 (text content only, not select elements)
            const h3 = card.querySelector('h3');
            let title = '';
            if (h3) {
                // Clone, remove selects/buttons, then read text
                const clone = h3.cloneNode(true);
                clone.querySelectorAll('select, button, .chart-copy-btn').forEach(el => el.remove());
                title = clone.textContent.trim();
            }

            // Build composite image: white bg + title + chart
            const scale = 2; // hi-DPI for crisp output
            const padding = 32 * scale;
            const titleHeight = title ? 40 * scale : 0;
            const cw = canvas.width || canvas.offsetWidth;
            const ch = canvas.height || canvas.offsetHeight;
            const imgW = cw + padding * 2;
            const imgH = ch + padding * 2 + titleHeight;

            const offscreen = document.createElement('canvas');
            offscreen.width = imgW;
            offscreen.height = imgH;
            const ctx = offscreen.getContext('2d');

            // White background
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, imgW, imgH);

            // Title
            if (title) {
                ctx.fillStyle = '#1a365d';
                ctx.font = `bold ${16 * scale}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
                ctx.textBaseline = 'top';
                ctx.fillText(title, padding, padding);
            }

            // Chart image
            ctx.drawImage(canvas, padding, padding + titleHeight, cw, ch);

            // Subtle footer
            ctx.fillStyle = '#aaaaaa';
            ctx.font = `${9 * scale}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText('UN Human Rights Analytics Dashboard', imgW - padding, imgH - 8 * scale);

            try {
                const blob = await new Promise(resolve => offscreen.toBlob(resolve, 'image/png'));
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                btn.classList.add('copied');
                setTimeout(() => btn.classList.remove('copied'), 1500);
            } catch (err) {
                console.error('Copy chart failed:', err);
                // Fallback: download the image
                const url = offscreen.toDataURL('image/png');
                const a = document.createElement('a');
                a.href = url;
                a.download = (title || 'chart').replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '.png';
                a.click();
            }
        }

        // Inject copy buttons after initial render and after any dynamic chart creation
        document.addEventListener('DOMContentLoaded', () => {
            // Initial injection (may run before charts are built)
            setTimeout(initChartCopyButtons, 500);
        });
        // Also hook into renderTabContent completions
        function updateYearlyTrendChart() {
            destroyChart('yearlyTrend');
            if ((serverBrowseMode || overviewBootstrapMode) && Array.isArray(serverState.summary?.yearly_counts) && serverState.summary.yearly_counts.length) {
                const yearRows = serverState.summary.yearly_counts
                    .map(row => [String(row.year), Number(row.count || 0)])
                    .filter(([, count]) => Number.isFinite(count) && count > 0);
                const years = yearRows.map(([year]) => year);
                charts.yearlyTrend = new Chart(document.getElementById('chartYearlyTrend'), {
                    type: 'bar',
                    data: {
                        labels: years,
                        datasets: [{ label: 'Records', data: yearRows.map(([, count]) => count), backgroundColor: colors.primary[0], borderRadius: 4 }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: defaultTooltip }, scales: { y: { beginAtZero: true } } }
                });
                return;
            }
            const yc = {};
            chartData.forEach(r => { if (r._year) yc[r._year] = (yc[r._year]||0) + 1; });
            const yrs = Object.keys(yc).sort();
            charts.yearlyTrend = new Chart(document.getElementById('chartYearlyTrend'), {
                type: 'bar',
                data: { labels: yrs, datasets: [{ label: 'Records', data: yrs.map(y => yc[y]), backgroundColor: colors.primary[0], borderRadius: 4 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: defaultTooltip }, scales: { y: { beginAtZero: true } } }
            });
        }

        function updateTopCountriesChart() {
            destroyChart('topCountries');
            const el = document.getElementById('chartTopCountries');
            if (!el) return;
            const cc = {};
            chartData.forEach(r => r._countriesArray.forEach(c => { if (c) cc[c] = (cc[c]||0) + 1; }));
            const sorted = Object.entries(cc).sort((a,b) => b[1]-a[1]).slice(0, 10);
            charts.topCountries = new Chart(el, {
                type: 'bar',
                data: { labels: sorted.map(s => s[0].replace('- ','')), datasets: [{ data: sorted.map(s => s[1]), backgroundColor: colors.primary.slice(0,10), borderRadius: 4 }] },
                options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: defaultTooltip } }
            });
        }

        function updateBodyDistributionChart() {
            destroyChart('bodyDistribution');
            if ((serverBrowseMode || overviewBootstrapMode) && Array.isArray(serverState.summary?.body_counts) && serverState.summary.body_counts.length) {
                const sorted = serverState.summary.body_counts
                    .map(row => [String(row.body || ''), Number(row.count || 0)])
                    .filter(([body, count]) => body && Number.isFinite(count) && count > 0)
                    .slice(0, 12);
                charts.bodyDistribution = new Chart(document.getElementById('chartBodyDistribution'), {
                    type: 'doughnut',
                    data: { labels: sorted.map(s => s[0].replace('- ', '')), datasets: [{ data: sorted.map(s => s[1]), backgroundColor: colors.bodies }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } }, tooltip: defaultTooltip } }
                });
                return;
            }
            const bc = {};
            chartData.forEach(r => { if (r._body) bc[r._body] = (bc[r._body]||0) + 1; });
            const sorted = Object.entries(bc).sort((a,b) => b[1]-a[1]).slice(0, 12);
            charts.bodyDistribution = new Chart(document.getElementById('chartBodyDistribution'), {
                type: 'doughnut',
                data: { labels: sorted.map(s => s[0].replace('- ','')), datasets: [{ data: sorted.map(s => s[1]), backgroundColor: colors.bodies }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } }, tooltip: defaultTooltip } }
            });
        }

        function updateRegionDistributionChart() {
            destroyChart('regionDistribution');
            if ((serverBrowseMode || overviewBootstrapMode) && Array.isArray(serverState.summary?.region_counts) && serverState.summary.region_counts.length) {
                const sorted = serverState.summary.region_counts
                    .map(row => [String(row.region || ''), Number(row.count || 0)])
                    .filter(([region, count]) => region && Number.isFinite(count) && count > 0);
                charts.regionDistribution = new Chart(document.getElementById('chartRegionDistribution'), {
                    type: 'pie',
                    data: { labels: sorted.map(s => s[0].replace('- ', '')), datasets: [{ data: sorted.map(s => s[1]), backgroundColor: colors.regions }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } }, tooltip: defaultTooltip } }
                });
                return;
            }
            const rc = {};
            chartData.forEach(r => r._regionsArray.forEach(reg => { if (reg) rc[reg] = (rc[reg]||0) + 1; }));
            const sorted = Object.entries(rc).sort((a,b) => b[1]-a[1]);
            charts.regionDistribution = new Chart(document.getElementById('chartRegionDistribution'), {
                type: 'pie',
                data: { labels: sorted.map(s => s[0].replace('- ','')), datasets: [{ data: sorted.map(s => s[1]), backgroundColor: colors.regions }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } }, tooltip: defaultTooltip } }
            });
        }

        function updateStackedChart() {
            destroyChart('stackedTrend');
            const by = document.getElementById('stackBySelector')?.value || 'body';
            if (useServerAnalytics()) {
                const trends = serverState.analytics?.trends;
                if (!trends) return;
                const sourceRows = by === 'body'
                    ? (trends.yearly_body_counts || [])
                    : by === 'region'
                        ? (trends.yearly_region_counts || [])
                        : (trends.yearly_type_counts || []);
                const valueKey = by === 'body' ? 'body' : by === 'region' ? 'region' : 'annotation_type';
                const yd = {};
                const totals = {};
                sourceRows.forEach(row => {
                    const year = Number(row?.year);
                    const value = String(row?.[valueKey] || '').trim();
                    const count = Number(row?.count || 0);
                    if (!Number.isFinite(year) || !value || !Number.isFinite(count) || count <= 0) return;
                    const yearKey = String(year);
                    if (!yd[yearKey]) yd[yearKey] = {};
                    yd[yearKey][value] = count;
                    totals[value] = (totals[value] || 0) + count;
                });
                const yrs = Object.keys(yd).sort((a, b) => Number(a) - Number(b));
                const catArr = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([value]) => value);
                const datasets = catArr.map((value, i) => ({
                    label: value.replace(/^-+\s*/, '').slice(0, 25),
                    _fullLabel: value,
                    data: yrs.map(year => yd[year]?.[value] || 0),
                    backgroundColor: colors.bodies[i % colors.bodies.length]
                }));
                charts.stackedTrend = new Chart(document.getElementById('chartStackedTrend'), {
                    type: 'bar',
                    data: { labels: yrs, datasets },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } }, tooltip: defaultTooltip }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
                });
                return;
            }
            const yd = {};
            const cats = new Set();
            chartData.forEach(r => {
                if (r._year) {
                    let arr = by === 'body' ? [r._body] : by === 'region' ? r._regionsArray : [r._type];
                    arr.filter(Boolean).forEach(c => {
                        cats.add(c);
                        if (!yd[r._year]) yd[r._year] = {};
                        yd[r._year][c] = (yd[r._year][c]||0) + 1;
                    });
                }
            });
            const yrs = Object.keys(yd).sort();
            const catArr = [...cats].slice(0, 10);
            const datasets = catArr.map((c, i) => ({ label: c.replace(/^-+\s*/, '').slice(0,25), _fullLabel: c, data: yrs.map(y => yd[y]?.[c]||0), backgroundColor: colors.bodies[i % colors.bodies.length] }));
            charts.stackedTrend = new Chart(document.getElementById('chartStackedTrend'), {
                type: 'bar',
                data: { labels: yrs, datasets },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } }, tooltip: defaultTooltip }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
            });
        }

        function updateCumulativeChart() {
            destroyChart('cumulative');
            if (useServerAnalytics()) {
                const yearRows = serverState.analytics?.trends?.yearly_counts || serverState.summary?.yearly_counts || [];
                const rows = yearRows
                    .map(row => [String(row.year), Number(row.count || 0)])
                    .filter(([, count]) => Number.isFinite(count) && count > 0);
                let cum = 0;
                const data = rows.map(([, count]) => {
                    cum += count;
                    return cum;
                });
                charts.cumulative = new Chart(document.getElementById('chartCumulative'), {
                    type: 'line',
                    data: { labels: rows.map(([year]) => year), datasets: [{ label: 'Cumulative', data, borderColor: colors.primary[0], backgroundColor: colors.primary[0]+'33', fill: true, tension: 0.3 }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: defaultTooltip } }
                });
                return;
            }
            const yc = {};
            chartData.forEach(r => { if (r._year) yc[r._year] = (yc[r._year]||0) + 1; });
            const yrs = Object.keys(yc).sort();
            let cum = 0;
            const data = yrs.map(y => { cum += yc[y]; return cum; });
            charts.cumulative = new Chart(document.getElementById('chartCumulative'), {
                type: 'line',
                data: { labels: yrs, datasets: [{ label: 'Cumulative', data, borderColor: colors.primary[0], backgroundColor: colors.primary[0]+'33', fill: true, tension: 0.3 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: defaultTooltip } }
            });
        }

        function updateYoYChart() {
            destroyChart('yoy');
            const noteEl = document.getElementById('chartYoYNote');
            if (useServerAnalytics()) {
                const trends = serverState.analytics?.trends;
                if (!trends) {
                    if (noteEl) noteEl.textContent = 'Full-filter VM analytics are still loading for this chart.';
                    return;
                }
                const { labels, values, note } = buildYoYSeriesFromYearRows(
                    trends.yearly_counts || serverState.summary?.yearly_counts || [],
                    {
                        datasetFirstPublicationDate: trends.dataset_first_publication_date,
                        datasetLastPublicationDate: trends.dataset_last_publication_date
                    }
                );
                if (noteEl) noteEl.textContent = note;
                charts.yoy = new Chart(document.getElementById('chartYoY'), {
                    type: 'bar',
                    data: { labels, datasets: [{ label: 'YoY %', data: values, backgroundColor: values.map(v => v >= 0 ? colors.primary[1] : colors.primary[2]), borderRadius: 4 }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: defaultTooltip } }
                });
                return;
            }
            const { labels, values, note } = buildYoYSeries(chartData, Array.isArray(rawData) && rawData.length ? rawData : chartData);
            if (noteEl) noteEl.textContent = note;
            charts.yoy = new Chart(document.getElementById('chartYoY'), {
                type: 'bar',
                data: { labels, datasets: [{ label: 'YoY %', data: values, backgroundColor: values.map(v => v >= 0 ? colors.primary[1] : colors.primary[2]), borderRadius: 4 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: defaultTooltip } }
            });
        }

        function destroyChartsByPrefix(prefix) {
            Object.keys(charts).forEach(id => {
                if (id.startsWith(prefix)) {
                    charts[id].destroy();
                    delete charts[id];
                }
            });
        }

        function getRightsTopNFromUI() {
            const input = document.getElementById('rightsTopNInput');
            const raw = parseInt(input?.value ?? '10', 10);
            const n = Number.isFinite(raw) ? raw : 10;
            const clamped = Math.max(3, Math.min(20, n));
            if (input && String(clamped) !== input.value) input.value = String(clamped);
            return clamped;
        }

        function getRightsWindowFromUI() {
            const sel = document.getElementById('rightsWindowSelect');
            const raw = parseInt(sel?.value ?? '0', 10);
            if (!Number.isFinite(raw) || raw < 0) return 0;
            return raw;
        }

        function onRightsControlsChange() {
            updateThemeRadarChart();
            updateRightsScatterChart();
        }

        function getTopRightsConfiguration(records, topN) {
            const counts = {};
            records.forEach(r => {
                const keys = new Set(r._rightThemeKeys || []);
                keys.forEach(key => {
                    if (!rightsThemeLookup[key]) return;
                    counts[key] = (counts[key] || 0) + 1;
                });
            });

            const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
            const topKeys = sorted.slice(0, topN).map(([key]) => key);
            const dimensions = topKeys.map(key => ({
                key,
                label: rightsThemeLookup[key]?.label || key,
                family: rightsThemeLookup[key]?.family || 'CCPR',
                total: counts[key] || 0
            }));
            return {
                dimensions,
                topKeySet: new Set(topKeys),
                totalCounts: counts
            };
        }

        function aggregateRightsForRecords(records, topKeySet) {
            const topCounts = {};
            let otherEsc = 0;
            let otherCcpr = 0;

            records.forEach(r => {
                const keys = new Set(r._rightThemeKeys || []);
                keys.forEach(key => {
                    const meta = rightsThemeLookup[key];
                    if (!meta) return;
                    if (topKeySet.has(key)) {
                        topCounts[key] = (topCounts[key] || 0) + 1;
                    } else if (meta.family === 'ESCR') {
                        otherEsc += 1;
                    } else {
                        otherCcpr += 1;
                    }
                });
            });

            return { topCounts, otherEsc, otherCcpr };
        }

        function getRightsPeriodWindows(records, yearsPerWindow) {
            const years = [...new Set(records.map(r => r._year).filter(y => Number.isFinite(y)))].sort((a, b) => a - b);
            if (!years.length || yearsPerWindow <= 0) {
                return [{ label: 'All years', records }];
            }

            const minYear = years[0];
            const maxYear = years[years.length - 1];
            const windows = [];
            for (let start = minYear; start <= maxYear; start += yearsPerWindow) {
                const end = Math.min(start + yearsPerWindow - 1, maxYear);
                const subset = records.filter(r => Number.isFinite(r._year) && r._year >= start && r._year <= end);
                if (!subset.length) continue;
                windows.push({ label: `${start}-${end}`, records: subset });
            }
            return windows.length ? windows : [{ label: 'All years', records }];
        }

        function updateThemeRadarChart() {
            destroyChartsByPrefix('themeRadarWindow_');
            const container = document.getElementById('themeRadarGrid');
            const meta = document.getElementById('rightsMetaInfo');
            if (!container || !meta) return;

            if (useServerAnalytics()) {
                const themeAnalytics = serverState.analytics?.themes;
                if (!themeAnalytics) {
                    container.innerHTML = '<div style="font-size:12px;color:#6b7f98;">Loading full-filter rights analytics from the VM...</div>';
                    meta.textContent = 'VM analytics are loading for this chart.';
                    return;
                }

                const topN = getRightsTopNFromUI();
                const yearsPerWindow = getRightsWindowFromUI();
                const topConfig = getTopRightsConfigurationFromThemeCounts(themeAnalytics.theme_counts || [], topN);
                const topDimensions = topConfig.dimensions;

                if (!topDimensions.length) {
                    container.innerHTML = '<div style="font-size:12px;color:#6b7f98;">No rights-theme dimensions found in the current VM filter.</div>';
                    meta.textContent = 'Top rights categories could not be derived from the current VM filter.';
                    return;
                }

                const dimensions = [
                    ...topDimensions,
                    { key: '__other_escr__', label: 'Other ESCR rights', family: 'ESCR' },
                    { key: '__other_ccpr__', label: 'Other CCPR rights', family: 'CCPR' }
                ];
                const yearly = getRightsYearlyDataFromThemeRows(themeAnalytics.yearly_theme_counts || [], topConfig.topKeySet);
                const syntheticRecords = Object.keys(yearly).map(year => ({ _year: Number(year) }));
                const windows = getRightsPeriodWindows(syntheticRecords, yearsPerWindow);
                const topLabels = topDimensions.map(d => d.label).join(' • ');
                meta.textContent = `Top ${topDimensions.length} rights dimensions + grouped other ESCR/CCPR rights. Window mode: ${yearsPerWindow ? `${yearsPerWindow}-year` : 'Overall'}. Dimensions: ${topLabels}`;

                container.innerHTML = windows.map((win, idx) => `
                    <div class="mini-radar-card">
                        <div class="mini-radar-title">${escapeHtml(win.label)} (${win.records.length.toLocaleString()} years)</div>
                        <div class="mini-radar-wrap"><canvas id="chartThemeRadarWindow_${idx}"></canvas></div>
                    </div>
                `).join('');

                windows.forEach((win, idx) => {
                    const windowYears = new Set(win.records.map(record => Number(record._year)).filter(Number.isFinite));
                    const agg = { topCounts: {}, otherEsc: 0, otherCcpr: 0 };
                    Object.entries(yearly).forEach(([yearKey, bucket]) => {
                        const year = Number(yearKey);
                        if (!windowYears.has(year)) return;
                        Object.entries(bucket.top || {}).forEach(([key, count]) => {
                            agg.topCounts[key] = (agg.topCounts[key] || 0) + count;
                        });
                        agg.otherEsc += Number(bucket.otherEsc || 0);
                        agg.otherCcpr += Number(bucket.otherCcpr || 0);
                    });
                    const labels = dimensions.map(d => d.label.length > 30 ? `${d.label.slice(0, 30)}…` : d.label);
                    const values = dimensions.map(d => {
                        if (d.key === '__other_escr__') return agg.otherEsc;
                        if (d.key === '__other_ccpr__') return agg.otherCcpr;
                        return agg.topCounts[d.key] || 0;
                    });
                    const chartId = `themeRadarWindow_${idx}`;
                    const accent = colors.primary[idx % colors.primary.length];

                    charts[chartId] = new Chart(document.getElementById(`chartThemeRadarWindow_${idx}`), {
                        type: 'radar',
                        data: {
                            labels,
                            datasets: [{
                                label: `Theme mentions (${win.label})`,
                                data: values,
                                backgroundColor: accent + '2f',
                                borderColor: accent,
                                borderWidth: 2,
                                pointRadius: 2
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                                legend: { display: false },
                                tooltip: {
                                    ...defaultTooltip,
                                    callbacks: {
                                        title: (ctx) => dimensions[ctx[0].dataIndex]?.label || ctx[0].label
                                    }
                                }
                            },
                            scales: { r: { beginAtZero: true, pointLabels: { font: { size: 9 } } } }
                        }
                    });
                });
                return;
            }

            const rightsRecords = chartData.filter(r => (r._rightThemeKeys || []).length > 0);
            if (!rightsRecords.length) {
                container.innerHTML = '<div style="font-size:12px;color:#6b7f98;">No rights-theme matches in current filter.</div>';
                meta.textContent = 'No rights-theme dimensions available for radar plotting.';
                return;
            }

            const topN = getRightsTopNFromUI();
            const yearsPerWindow = getRightsWindowFromUI();
            const topConfig = getTopRightsConfiguration(rightsRecords, topN);
            const topDimensions = topConfig.dimensions;

            if (!topDimensions.length) {
                container.innerHTML = '<div style="font-size:12px;color:#6b7f98;">No rights-theme dimensions found.</div>';
                meta.textContent = 'Top rights categories could not be derived from the current filter.';
                return;
            }

            const dimensions = [
                ...topDimensions,
                { key: '__other_escr__', label: 'Other ESCR rights', family: 'ESCR' },
                { key: '__other_ccpr__', label: 'Other CCPR rights', family: 'CCPR' }
            ];
            const windows = getRightsPeriodWindows(rightsRecords, yearsPerWindow);
            const topLabels = topDimensions.map(d => d.label).join(' • ');
            meta.textContent = `Top ${topDimensions.length} rights dimensions + grouped other ESCR/CCPR rights. Window mode: ${yearsPerWindow ? `${yearsPerWindow}-year` : 'Overall'}. Dimensions: ${topLabels}`;

            container.innerHTML = windows.map((win, idx) => `
                <div class="mini-radar-card">
                    <div class="mini-radar-title">${escapeHtml(win.label)} (${win.records.length.toLocaleString()} records)</div>
                    <div class="mini-radar-wrap"><canvas id="chartThemeRadarWindow_${idx}"></canvas></div>
                </div>
            `).join('');

            windows.forEach((win, idx) => {
                const agg = aggregateRightsForRecords(win.records, topConfig.topKeySet);
                const labels = dimensions.map(d => d.label.length > 30 ? `${d.label.slice(0, 30)}…` : d.label);
                const values = dimensions.map(d => {
                    if (d.key === '__other_escr__') return agg.otherEsc;
                    if (d.key === '__other_ccpr__') return agg.otherCcpr;
                    return agg.topCounts[d.key] || 0;
                });
                const chartId = `themeRadarWindow_${idx}`;
                const accent = colors.primary[idx % colors.primary.length];

                charts[chartId] = new Chart(document.getElementById(`chartThemeRadarWindow_${idx}`), {
                    type: 'radar',
                    data: {
                        labels,
                        datasets: [{
                            label: `Theme mentions (${win.label})`,
                            data: values,
                            backgroundColor: accent + '2f',
                            borderColor: accent,
                            borderWidth: 2,
                            pointRadius: 2
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                ...defaultTooltip,
                                callbacks: {
                                    title: (ctx) => dimensions[ctx[0].dataIndex]?.label || ctx[0].label
                                }
                            }
                        },
                        scales: { r: { beginAtZero: true, pointLabels: { font: { size: 9 } } } }
                    }
                });
            });
        }

        function updateTopThemesChart() {
            destroyChart('topThemes');
            if (useServerAnalytics()) {
                const themeAnalytics = serverState.analytics?.themes;
                if (!themeAnalytics) return;
                const sorted = (themeAnalytics.theme_counts || [])
                    .map(row => [String(row.theme || ''), Number(row.count || 0)])
                    .filter(([theme, count]) => theme && Number.isFinite(count) && count > 0)
                    .slice(0, 15);
                const fullLabels = sorted.map(s => s[0].replace(/^-+\s*/, '').trim());
                charts.topThemes = new Chart(document.getElementById('chartTopThemes'), {
                    type: 'bar',
                    data: { labels: fullLabels.map(l => l.slice(0,40)), datasets: [{ data: sorted.map(s => s[1]), backgroundColor: colors.primary[4], borderRadius: 4 }] },
                    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: defaultTooltip } }
                });
                charts.topThemes._fullLabels = fullLabels;
                return;
            }
            const tc = {};
            chartData.forEach(r => r._themesArray.forEach(t => { if (t) tc[t] = (tc[t]||0) + 1; }));
            const sorted = Object.entries(tc).sort((a,b) => b[1]-a[1]).slice(0, 15);
            const fullLabels2 = sorted.map(s => s[0].replace(/^-+\s*/, '').trim());
            charts.topThemes = new Chart(document.getElementById('chartTopThemes'), {
                type: 'bar',
                data: { labels: fullLabels2.map(l => l.slice(0,40)), datasets: [{ data: sorted.map(s => s[1]), backgroundColor: colors.primary[4], borderRadius: 4 }] },
                options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: defaultTooltip } }
            });
            charts.topThemes._fullLabels = fullLabels2;
        }

        function updateThemeTrendsChart() {
            destroyChart('themeTrends');
            if (useServerAnalytics()) {
                const themeAnalytics = serverState.analytics?.themes;
                if (!themeAnalytics) return;
                const top5 = (themeAnalytics.theme_counts || [])
                    .map(row => [String(row.theme || ''), Number(row.count || 0)])
                    .filter(([theme, count]) => theme && Number.isFinite(count) && count > 0)
                    .slice(0, 10)
                    .map(([theme]) => theme);
                const ytd = {};
                (themeAnalytics.yearly_theme_counts || []).forEach(row => {
                    const year = Number(row?.year);
                    const theme = String(row?.theme || '');
                    const count = Number(row?.count || 0);
                    if (!Number.isFinite(year) || !top5.includes(theme) || !Number.isFinite(count) || count <= 0) return;
                    const yearKey = String(year);
                    if (!ytd[yearKey]) ytd[yearKey] = {};
                    ytd[yearKey][theme] = count;
                });
                const yrs = Object.keys(ytd).sort((a, b) => Number(a) - Number(b));
                const datasets = top5.map((t, i) => ({ label: t.replace('- ','').slice(0,30), _fullLabel: t, data: yrs.map(y => ytd[y]?.[t]||0), borderColor: colors.primary[i], backgroundColor: colors.primary[i], tension: 0.3, fill: false }));
                charts.themeTrends = new Chart(document.getElementById('chartThemeTrends'), {
                    type: 'line',
                    data: { labels: yrs, datasets },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } }, tooltip: defaultTooltip } }
                });
                return;
            }
            const tt = {};
            chartData.forEach(r => r._themesArray.forEach(t => { if (t) tt[t] = (tt[t]||0) + 1; }));
            const top5 = Object.entries(tt).sort((a,b) => b[1]-a[1]).slice(0, 5).map(t => t[0]);
            const ytd = {};
            chartData.forEach(r => {
                if (r._year) {
                    if (!ytd[r._year]) ytd[r._year] = {};
                    r._themesArray.forEach(t => { if (top5.includes(t)) ytd[r._year][t] = (ytd[r._year][t]||0) + 1; });
                }
            });
            const yrs = Object.keys(ytd).sort();
            const datasets = top5.map((t, i) => ({ label: t.replace('- ','').slice(0,30), _fullLabel: t, data: yrs.map(y => ytd[y]?.[t]||0), borderColor: colors.primary[i], backgroundColor: colors.primary[i], tension: 0.3, fill: false }));
            charts.themeTrends = new Chart(document.getElementById('chartThemeTrends'), {
                type: 'line',
                data: { labels: yrs, datasets },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } }, tooltip: defaultTooltip } }
            });
        }

        function getRightsYearlyData(records, topKeySet = null) {
            const yearly = {};
            records.forEach(r => {
                if (!r._year) return;
                if (!yearly[r._year]) {
                    yearly[r._year] = { esc: 0, ccpr: 0, top: {}, otherEsc: 0, otherCcpr: 0 };
                }

                const keys = new Set(r._rightThemeKeys || []);
                keys.forEach(key => {
                    const meta = rightsThemeLookup[key];
                    if (!meta) return;

                    if (meta.family === 'ESCR') yearly[r._year].esc += 1;
                    else yearly[r._year].ccpr += 1;

                    if (topKeySet) {
                        if (topKeySet.has(key)) {
                            yearly[r._year].top[key] = (yearly[r._year].top[key] || 0) + 1;
                        } else if (meta.family === 'ESCR') {
                            yearly[r._year].otherEsc += 1;
                        } else {
                            yearly[r._year].otherCcpr += 1;
                        }
                    }
                });
            });
            return yearly;
        }

        function updateEscCcprTrendChart() {
            destroyChart('escCcprTrend');
            if (useServerAnalytics()) {
                const themeAnalytics = serverState.analytics?.themes;
                if (!themeAnalytics) return;
                const yearly = getRightsYearlyDataFromThemeRows(themeAnalytics.yearly_theme_counts || []);
                const years = Object.keys(yearly).filter(y => ((yearly[y].esc || 0) + (yearly[y].ccpr || 0)) > 0).sort((a, b) => Number(a) - Number(b));
                const escValues = years.map(y => yearly[y].esc || 0);
                const ccprValues = years.map(y => yearly[y].ccpr || 0);
                const escPct = years.map((y, i) => {
                    const t = escValues[i] + ccprValues[i];
                    return t ? (escValues[i] * 100 / t).toFixed(1) : '0.0';
                });
                const ccprPct = years.map((y, i) => {
                    const t = escValues[i] + ccprValues[i];
                    return t ? (ccprValues[i] * 100 / t).toFixed(1) : '0.0';
                });

                charts.escCcprTrend = new Chart(document.getElementById('chartEscCcprTrend'), {
                    type: 'bar',
                    data: {
                        labels: years,
                        datasets: [
                            { label: 'ESC Rights', data: escValues, backgroundColor: '#d64545', stack: 'rights' },
                            { label: 'CCPR Rights', data: ccprValues, backgroundColor: '#2146db', stack: 'rights' }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'top' },
                            tooltip: {
                                ...defaultTooltip,
                                callbacks: {
                                    label: (ctx) => {
                                        const i = ctx.dataIndex;
                                        const isEsc = ctx.datasetIndex === 0;
                                        const pct = isEsc ? escPct[i] : ccprPct[i];
                                        return `${ctx.dataset.label}: ${ctx.raw} (${pct}%)`;
                                    }
                                }
                            }
                        },
                        scales: {
                            x: { stacked: true },
                            y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Theme mentions' } }
                        }
                    }
                });
                return;
            }
            const yearly = getRightsYearlyData(chartData);
            const years = Object.keys(yearly).filter(y => ((yearly[y].esc || 0) + (yearly[y].ccpr || 0)) > 0).sort();
            const escValues = years.map(y => yearly[y].esc || 0);
            const ccprValues = years.map(y => yearly[y].ccpr || 0);
            const escPct = years.map((y, i) => {
                const t = escValues[i] + ccprValues[i];
                return t ? (escValues[i] * 100 / t).toFixed(1) : '0.0';
            });
            const ccprPct = years.map((y, i) => {
                const t = escValues[i] + ccprValues[i];
                return t ? (ccprValues[i] * 100 / t).toFixed(1) : '0.0';
            });

            charts.escCcprTrend = new Chart(document.getElementById('chartEscCcprTrend'), {
                type: 'bar',
                data: {
                    labels: years,
                    datasets: [
                        { label: 'ESC Rights', data: escValues, backgroundColor: '#d64545', stack: 'rights' },
                        { label: 'CCPR Rights', data: ccprValues, backgroundColor: '#2146db', stack: 'rights' }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'top' },
                        tooltip: {
                            ...defaultTooltip,
                            callbacks: {
                                label: (ctx) => {
                                    const i = ctx.dataIndex;
                                    const isEsc = ctx.datasetIndex === 0;
                                    const pct = isEsc ? escPct[i] : ccprPct[i];
                                    return `${ctx.dataset.label}: ${ctx.raw} (${pct}%)`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: { stacked: true },
                        y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Theme mentions' } }
                    }
                }
            });
        }

        function updateRightsScatterChart() {
            destroyChart('rightsScatter');
            const info = document.getElementById('rightsScatterInfo');
            if (useServerAnalytics()) {
                const themeAnalytics = serverState.analytics?.themes;
                if (!themeAnalytics) {
                    if (info) info.textContent = 'VM analytics are loading for this chart.';
                    return;
                }
                const topConfig = getTopRightsConfigurationFromThemeCounts(themeAnalytics.theme_counts || [], getRightsTopNFromUI());
                const dimensions = [
                    ...topConfig.dimensions,
                    { key: '__other_escr__', label: 'Other ESCR rights', family: 'ESCR' },
                    { key: '__other_ccpr__', label: 'Other CCPR rights', family: 'CCPR' }
                ];
                const yearly = getRightsYearlyDataFromThemeRows(themeAnalytics.yearly_theme_counts || [], topConfig.topKeySet);
                const years = Object.keys(yearly).map(Number).sort((a, b) => a - b);

                if (info) {
                    info.textContent = `Uses top ${topConfig.dimensions.length} rights categories plus grouped Other ESCR/CCPR rights.`;
                }

                const datasets = dimensions.map((dim, idx) => {
                    const color = dim.family === 'ESCR' ? '#d64545' : '#2146db';
                    const points = years.flatMap(y => {
                        const bucket = yearly[y] || {};
                        const base = dim.key === '__other_escr__'
                            ? (bucket.otherEsc || 0)
                            : dim.key === '__other_ccpr__'
                                ? (bucket.otherCcpr || 0)
                                : (bucket.top?.[dim.key] || 0);
                        if (base <= 0) return [];
                        const jitter = (((idx * 37 + y * 13) % 100) / 100 - 0.5) * 0.36;
                        return [{ x: y + jitter, y: base }];
                    });
                    return {
                        label: `${idx + 1}. ${dim.label}`,
                        _numberLabel: idx + 1,
                        data: points,
                        showLine: false,
                        pointRadius: 4,
                        pointHoverRadius: 5,
                        borderColor: color,
                        backgroundColor: color + 'aa'
                    };
                });

                charts.rightsScatter = new Chart(document.getElementById('chartRightsScatter'), {
                    type: 'scatter',
                    plugins: [rightsPointNumberPlugin],
                    data: { datasets },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
                            tooltip: {
                                ...defaultTooltip,
                                callbacks: {
                                    title: (items) => {
                                        const ds = items?.[0]?.dataset;
                                        return ds?.label || 'Right';
                                    },
                                    label: (ctx) => {
                                        const x = Number(ctx.parsed?.x);
                                        const y = Number(ctx.parsed?.y);
                                        const year = Number.isFinite(x) ? Math.round(x) : '-';
                                        return `Year: ${year}, Mentions: ${Number.isFinite(y) ? y : 0}`;
                                    }
                                }
                            },
                            rightsPointNumberPlugin: { enabled: true }
                        },
                        scales: {
                            x: {
                                type: 'linear',
                                min: years.length ? years[0] - 0.6 : 2006,
                                max: years.length ? years[years.length - 1] + 0.6 : 2024,
                                ticks: {
                                    callback: (val) => Number.isInteger(Number(val)) ? val : ''
                                },
                                title: { display: true, text: 'Year' }
                            },
                            y: { beginAtZero: true, title: { display: true, text: 'Mentions' } }
                        }
                    }
                });
                return;
            }
            const rightsRecords = chartData.filter(r => (r._rightThemeKeys || []).length > 0);
            if (!rightsRecords.length) {
                if (info) info.textContent = 'No rights-theme matches in current filter.';
                charts.rightsScatter = new Chart(document.getElementById('chartRightsScatter'), {
                    type: 'scatter',
                    data: { datasets: [] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
                });
                return;
            }

            const topN = getRightsTopNFromUI();
            const topConfig = getTopRightsConfiguration(rightsRecords, topN);
            const dimensions = [
                ...topConfig.dimensions,
                { key: '__other_escr__', label: 'Other ESCR rights', family: 'ESCR' },
                { key: '__other_ccpr__', label: 'Other CCPR rights', family: 'CCPR' }
            ];
            const yearly = getRightsYearlyData(rightsRecords, topConfig.topKeySet);
            const years = Object.keys(yearly).map(Number).sort((a, b) => a - b);

            if (info) {
                info.textContent = `Uses top ${topConfig.dimensions.length} rights categories plus grouped Other ESCR/CCPR rights.`;
            }

            const datasets = dimensions.map((dim, idx) => {
                const color = dim.family === 'ESCR' ? '#d64545' : '#2146db';
                const points = years.flatMap(y => {
                    const bucket = yearly[y] || {};
                    const base = dim.key === '__other_escr__'
                        ? (bucket.otherEsc || 0)
                        : dim.key === '__other_ccpr__'
                            ? (bucket.otherCcpr || 0)
                            : (bucket.top?.[dim.key] || 0);
                    if (base <= 0) return [];
                    const jitter = (((idx * 37 + y * 13) % 100) / 100 - 0.5) * 0.36;
                    return [{ x: y + jitter, y: base }];
                });
                return {
                    label: `${idx + 1}. ${dim.label}`,
                    _numberLabel: idx + 1,
                    data: points,
                    showLine: false,
                    pointRadius: 4,
                    pointHoverRadius: 5,
                    borderColor: color,
                    backgroundColor: color + 'aa'
                };
            });

            charts.rightsScatter = new Chart(document.getElementById('chartRightsScatter'), {
                type: 'scatter',
                plugins: [rightsPointNumberPlugin],
                data: { datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
                        tooltip: {
                            ...defaultTooltip,
                            callbacks: {
                                title: (items) => {
                                    const ds = items?.[0]?.dataset;
                                    return ds?.label || 'Right';
                                },
                                label: (ctx) => {
                                    const x = Number(ctx.parsed?.x);
                                    const y = Number(ctx.parsed?.y);
                                    const year = Number.isFinite(x) ? Math.round(x) : '-';
                                    return `Year: ${year}, Mentions: ${Number.isFinite(y) ? y : 0}`;
                                }
                            }
                        },
                        rightsPointNumberPlugin: { enabled: true }
                    },
                    scales: {
                        x: {
                            type: 'linear',
                            min: years.length ? years[0] - 0.6 : 2006,
                            max: years.length ? years[years.length - 1] + 0.6 : 2024,
                            ticks: {
                                callback: (val) => Number.isInteger(Number(val)) ? val : ''
                            },
                            title: { display: true, text: 'Year' }
                        },
                        y: { beginAtZero: true, title: { display: true, text: 'Mentions' } }
                    }
                }
            });
        }

        function updateBodyScatterChart() {
            destroyChart('bodyScatter');
            if (useServerAnalytics()) {
                const trends = serverState.analytics?.trends;
                if (!trends) return;
                const rows = trends.yearly_body_counts || [];
                const totals = {};
                rows.forEach(row => {
                    const body = String(row?.body || '').trim();
                    const count = Number(row?.count || 0);
                    if (!body || !Number.isFinite(count) || count <= 0) return;
                    totals[body] = (totals[body] || 0) + count;
                });
                const bodies = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([body]) => body);
                const datasets = bodies.map((body, i) => ({
                    label: body.replace(/^-+\s*/, '').slice(0, 25),
                    _fullLabel: body,
                    data: rows
                        .filter(row => String(row?.body || '').trim() === body)
                        .map(row => ({ x: Number(row.year), y: Number(row.count || 0) }))
                        .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y) && point.y > 0),
                    backgroundColor: colors.bodies[i],
                    pointRadius: 5,
                    pointHoverRadius: 7
                }));
                charts.bodyScatter = new Chart(document.getElementById('chartBodyScatter'), {
                    type: 'scatter',
                    data: { datasets },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } }, tooltip: defaultTooltip }, scales: { x: { title: { display: true, text: 'Year' } }, y: { beginAtZero: true, title: { display: true, text: 'Records' } } } }
                });
                return;
            }
            const byd = {};
            chartData.forEach(r => {
                if (r._year && r._body) {
                    const key = r._body + '|' + r._year;
                    byd[key] = (byd[key]||0) + 1;
                }
            });
            const bodies = [...new Set(chartData.map(r => r._body).filter(Boolean))].slice(0, 10);
            const datasets = bodies.map((b, i) => {
                const pts = [];
                Object.entries(byd).forEach(([key, cnt]) => {
                    const [body, yr] = key.split('|');
                    if (body === b) pts.push({ x: parseInt(yr), y: cnt });
                });
                return { label: b.replace('- ',''), data: pts, backgroundColor: colors.bodies[i], pointRadius: 5, pointHoverRadius: 7 };
            });
            charts.bodyScatter = new Chart(document.getElementById('chartBodyScatter'), {
                type: 'scatter',
                data: { datasets },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } }, tooltip: defaultTooltip }, scales: { x: { title: { display: true, text: 'Year' } }, y: { beginAtZero: true, title: { display: true, text: 'Records' } } } }
            });
        }

        function updateBodyHeatmapChart() {
            destroyChart('bodyHeatmap');
            if (useServerAnalytics()) {
                const trends = serverState.analytics?.trends;
                if (!trends) return;
                const rows = trends.yearly_body_counts || [];
                const bodyTotals = {};
                const byc = {};
                rows.forEach(row => {
                    const year = Number(row?.year);
                    const body = String(row?.body || '').trim();
                    const count = Number(row?.count || 0);
                    if (!Number.isFinite(year) || !body || !Number.isFinite(count) || count <= 0) return;
                    const yearKey = String(year);
                    if (!byc[yearKey]) byc[yearKey] = {};
                    byc[yearKey][body] = count;
                    bodyTotals[body] = (bodyTotals[body] || 0) + count;
                });
                const yrs = Object.keys(byc).sort((a, b) => Number(a) - Number(b));
                const bArr = Object.entries(bodyTotals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([body]) => body);
                const datasets = bArr.map((body, i) => ({ label: body.replace('- ',''), data: yrs.map(y => byc[y]?.[body]||0), backgroundColor: colors.bodies[i] }));
                charts.bodyHeatmap = new Chart(document.getElementById('chartBodyHeatmap'), {
                    type: 'bar',
                    data: { labels: yrs, datasets },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } }, tooltip: defaultTooltip }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
                });
                return;
            }
            const byc = {};
            const bodies = new Set();
            chartData.forEach(r => {
                if (r._year && r._body) {
                    bodies.add(r._body);
                    if (!byc[r._year]) byc[r._year] = {};
                    byc[r._year][r._body] = (byc[r._year][r._body]||0) + 1;
                }
            });
            const yrs = Object.keys(byc).sort();
            const bArr = [...bodies].slice(0, 10);
            const datasets = bArr.map((b, i) => ({ label: b.replace('- ',''), data: yrs.map(y => byc[y]?.[b]||0), backgroundColor: colors.bodies[i] }));
            charts.bodyHeatmap = new Chart(document.getElementById('chartBodyHeatmap'), {
                type: 'bar',
                data: { labels: yrs, datasets },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } }, tooltip: defaultTooltip }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
            });
        }

        function updateRegionComparisonChart() {
            destroyChart('regionComparison');
            if (useServerAnalytics()) {
                const trends = serverState.analytics?.trends;
                if (!trends) return;
                const ryc = {};
                (trends.yearly_region_counts || []).forEach(row => {
                    const year = Number(row?.year);
                    const region = String(row?.region || '').trim();
                    const count = Number(row?.count || 0);
                    if (!Number.isFinite(year) || !region || !Number.isFinite(count) || count <= 0) return;
                    if (!ryc[region]) ryc[region] = {};
                    ryc[region][year] = count;
                });
                const regions = Object.keys(ryc);
                const yrs = [...new Set((trends.yearly_region_counts || []).map(row => Number(row?.year)).filter(Number.isFinite))].sort((a, b) => a - b);
                const datasets = regions.map((reg, i) => ({ label: reg.replace('- ',''), data: yrs.map(y => ryc[reg]?.[y]||0), borderColor: colors.regions[i % colors.regions.length], backgroundColor: colors.regions[i % colors.regions.length], tension: 0.3, fill: false }));
                charts.regionComparison = new Chart(document.getElementById('chartRegionComparison'), {
                    type: 'line',
                    data: { labels: yrs, datasets },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } }, tooltip: defaultTooltip } }
                });
                return;
            }
            const ryc = {};
            chartData.forEach(r => {
                if (r._year) {
                    r._regionsArray.forEach(reg => {
                        if (!ryc[reg]) ryc[reg] = {};
                        ryc[reg][r._year] = (ryc[reg][r._year]||0) + 1;
                    });
                }
            });
            const regions = Object.keys(ryc);
            const allYrs = new Set();
            chartData.forEach(r => { if (r._year) allYrs.add(r._year); });
            const yrs = [...allYrs].sort();
            const datasets = regions.map((reg, i) => ({ label: reg.replace('- ',''), data: yrs.map(y => ryc[reg]?.[y]||0), borderColor: colors.regions[i % colors.regions.length], backgroundColor: colors.regions[i % colors.regions.length], tension: 0.3, fill: false }));
            charts.regionComparison = new Chart(document.getElementById('chartRegionComparison'), {
                type: 'line',
                data: { labels: yrs, datasets },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } }, tooltip: defaultTooltip } }
            });
        }

        function updateAffectedPersonsChart() {
            destroyChart('affectedPersons');
            if (useServerAnalytics()) {
                const textAnalytics = serverState.analytics?.text;
                if (!textAnalytics) return;
                const sorted = (textAnalytics.affected_person_counts || [])
                    .map(row => [String(row.affected_person || ''), Number(row.count || 0)])
                    .filter(([value, count]) => value && Number.isFinite(count) && count > 0)
                    .slice(0, 12);
                const apFullLabels = sorted.map(s => s[0].replace(/^-+\s*/, '').trim());
                charts.affectedPersons = new Chart(document.getElementById('chartAffectedPersons'), {
                    type: 'bar',
                    data: { labels: apFullLabels.map(l => l.slice(0,35)), datasets: [{ data: sorted.map(s => s[1]), backgroundColor: colors.primary[5], borderRadius: 4 }] },
                    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: defaultTooltip } }
                });
                charts.affectedPersons._fullLabels = apFullLabels;
                return;
            }
            const pc = {};
            chartData.forEach(r => r._affectedPersonsArray.forEach(p => { if (p) pc[p] = (pc[p]||0) + 1; }));
            const sorted = Object.entries(pc).sort((a,b) => b[1]-a[1]).slice(0, 12);
            const apFullLabels2 = sorted.map(s => s[0].replace(/^-+\s*/, '').trim());
            charts.affectedPersons = new Chart(document.getElementById('chartAffectedPersons'), {
                type: 'bar',
                data: { labels: apFullLabels2.map(l => l.slice(0,35)), datasets: [{ data: sorted.map(s => s[1]), backgroundColor: colors.primary[5], borderRadius: 4 }] },
                options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: defaultTooltip } }
            });
            charts.affectedPersons._fullLabels = apFullLabels2;
        }

        function updateSDGsChart() {
            destroyChart('sdgs');
            if (useServerAnalytics()) {
                const textAnalytics = serverState.analytics?.text;
                if (!textAnalytics) return;
                const sorted = (textAnalytics.sdg_counts || [])
                    .map(row => [String(row.sdg || ''), Number(row.count || 0)])
                    .filter(([value, count]) => value && Number.isFinite(count) && count > 0)
                    .slice(0, 12);
                const sdgFullLabels = sorted.map(s => s[0].replace(/^-+\s*/, '').trim());
                charts.sdgs = new Chart(document.getElementById('chartSDGs'), {
                    type: 'bar',
                    data: { labels: sdgFullLabels.map(l => l.slice(0,40)), datasets: [{ data: sorted.map(s => s[1]), backgroundColor: colors.primary[3], borderRadius: 4 }] },
                    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: defaultTooltip } }
                });
                charts.sdgs._fullLabels = sdgFullLabels;
                return;
            }
            const sc = {};
            chartData.forEach(r => r._sdgsArray.forEach(s => { if (s) sc[s] = (sc[s]||0) + 1; }));
            const sorted = Object.entries(sc).sort((a,b) => b[1]-a[1]).slice(0, 12);
            const sdgFullLabels2 = sorted.map(s => s[0].replace(/^-+\s*/, '').trim());
            charts.sdgs = new Chart(document.getElementById('chartSDGs'), {
                type: 'bar',
                data: { labels: sdgFullLabels2.map(l => l.slice(0,40)), datasets: [{ data: sorted.map(s => s[1]), backgroundColor: colors.primary[3], borderRadius: 4 }] },
                options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: defaultTooltip } }
            });
            charts.sdgs._fullLabels = sdgFullLabels2;
        }

        function tokenizeForBigrams(text) {
            const tokens = String(text || '').toLowerCase().match(/[a-z]+/g) || [];
            return tokens.filter(t => t.length > 2 && !stopwordSet.has(t));
        }

        function updateBigramsChart() {
            destroyChart('bigrams');
            if (useServerAnalytics()) {
                const textAnalytics = serverState.analytics?.text;
                if (!textAnalytics) return;
                const sorted = (textAnalytics.bigram_counts || [])
                    .map(row => [String(row.bigram || ''), Number(row.count || 0)])
                    .filter(([value, count]) => value && Number.isFinite(count) && count > 0);
                charts.bigrams = new Chart(document.getElementById('chartBigrams'), {
                    type: 'bar',
                    data: {
                        labels: sorted.map(s => s[0]),
                        datasets: [{
                            data: sorted.map(s => s[1]),
                            backgroundColor: colors.primary.slice(0, Math.max(1, sorted.length)),
                            borderRadius: 4
                        }]
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        onClick: null,
                        plugins: {
                            legend: { display: false },
                            tooltip: defaultTooltip
                        }
                    }
                });
                return;
            }
            const bgCounts = {};
            const records = chartData.length > MAX_BIGRAM_RECORDS ? sampleData(chartData, MAX_BIGRAM_RECORDS) : chartData;

            records.forEach(r => {
                const tokens = tokenizeForBigrams(r._text);
                for (let i = 0; i < tokens.length - 1; i++) {
                    const bg = `${tokens[i]} ${tokens[i + 1]}`;
                    if (ignoredBigrams.has(bg)) continue;
                    bgCounts[bg] = (bgCounts[bg] || 0) + 1;
                }
            });

            const sorted = Object.entries(bgCounts)
                .filter(([, c]) => c >= 2)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20);

            charts.bigrams = new Chart(document.getElementById('chartBigrams'), {
                type: 'bar',
                data: {
                    labels: sorted.map(s => s[0]),
                    datasets: [{
                        data: sorted.map(s => s[1]),
                        backgroundColor: colors.primary.slice(0, sorted.length),
                        borderRadius: 4
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    onClick: null,
                    plugins: {
                        legend: { display: false },
                        tooltip: defaultTooltip
                    }
                }
            });
        }

        function updateTextLengthChart() {
            destroyChart('textLength');
            if (useServerAnalytics()) {
                const textAnalytics = serverState.analytics?.text;
                if (!textAnalytics) return;
                // Strip leading dashes/whitespace. Some records have body = "-" which
                // must be filtered out — otherwise it appears as the top row with the
                // longest average text. Same rule as server-side summary body filter.
                const avgL = (textAnalytics.body_avg_text_length || [])
                    .map(row => ({ body: String(row.body || '').replace(/^-+\s*/, '').trim(), avg: Number(row.avg_length || 0) }))
                    .filter(row => row.body && row.body !== '-' && Number.isFinite(row.avg) && row.avg > 0)
                    .slice(0, 10);
                charts.textLength = new Chart(document.getElementById('chartTextLength'), {
                    type: 'bar',
                    data: { labels: avgL.map(b => b.body), datasets: [{ data: avgL.map(b => b.avg), backgroundColor: colors.bodies.slice(0, 10), borderRadius: 4 }] },
                    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: defaultTooltip } }
                });
                return;
            }
            const bl = {};
            const bc = {};
            chartData.forEach(r => {
                if (r._body && (r._text || '').trim().length >= 40) {
                    bl[r._body] = (bl[r._body]||0) + r._text.length;
                    bc[r._body] = (bc[r._body]||0) + 1;
                }
            });
            const avgL = Object.entries(bl)
                .map(([b, t]) => ({ body: String(b || '').replace(/^-+\s*/, '').trim(), avg: Math.round(t / bc[b]) }))
                .filter(row => row.body && row.body !== '-')
                .sort((a,b) => b.avg - a.avg).slice(0, 10);
            charts.textLength = new Chart(document.getElementById('chartTextLength'), {
                type: 'bar',
                data: { labels: avgL.map(b => b.body), datasets: [{ data: avgL.map(b => b.avg), backgroundColor: colors.bodies.slice(0, 10), borderRadius: 4 }] },
                options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: defaultTooltip } }
            });
        }

        function collectPredictionStats(records) {
            const labelCounts = {};
            const yearly = {};
            const pairCounts = {};
            let predictedDocs = 0;

            records.forEach(r => {
                const labels = normalizePredictedLabelsForStats(r._predictedLabels || []);
                if (!labels.length) return;
                predictedDocs += 1;

                labels.forEach(l => {
                    labelCounts[l] = (labelCounts[l] || 0) + 1;
                    if (r._year) {
                        if (!yearly[r._year]) yearly[r._year] = {};
                        yearly[r._year][l] = (yearly[r._year][l] || 0) + 1;
                    }
                });

                for (let i = 0; i < labels.length; i++) {
                    for (let j = i + 1; j < labels.length; j++) {
                        const pair = [labels[i], labels[j]].sort().join(' + ');
                        pairCounts[pair] = (pairCounts[pair] || 0) + 1;
                    }
                }
            });

            return {
                labelCounts,
                yearly,
                pairCounts,
                predictedDocs,
                totalDocs: records.length
            };
        }

        function updateLabelCoverageChart() {
            destroyChart('labelCoverage');
            const stats = collectPredictionStats(chartData);
            const unlabeled = Math.max(0, stats.totalDocs - stats.predictedDocs);
            charts.labelCoverage = new Chart(document.getElementById('chartLabelCoverage'), {
                type: 'doughnut',
                data: {
                    labels: ['With Assigned Labels', 'Without Assigned Labels'],
                    datasets: [{
                        data: [stats.predictedDocs, unlabeled],
                        backgroundColor: ['#6c5ce7', '#d9e3f2']
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom' },
                        tooltip: defaultTooltip
                    }
                }
            });
        }

        function updateLabelDistributionChart() {
            destroyChart('labelDistribution');
            const stats = collectPredictionStats(chartData);
            const sorted = Object.entries(stats.labelCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
            const labels = sorted.length ? sorted.map(s => s[0]) : ['No assigned labels yet'];
            const values = sorted.length ? sorted.map(s => s[1]) : [0];

            charts.labelDistribution = new Chart(document.getElementById('chartLabelDistribution'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        data: values,
                        backgroundColor: sorted.length ? colors.primary.slice(0, labels.length) : ['#d9e3f2'],
                        borderRadius: 4
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: defaultTooltip
                    }
                }
            });
        }

        function updateLabelTrendsChart() {
            destroyChart('labelTrends');
            const stats = collectPredictionStats(chartData);
            const topLabels = Object.entries(stats.labelCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l]) => l);
            const years = Object.keys(stats.yearly).sort();

            const datasets = topLabels.map((label, i) => ({
                label,
                data: years.map(y => stats.yearly[y]?.[label] || 0),
                borderColor: colors.primary[i % colors.primary.length],
                backgroundColor: colors.primary[i % colors.primary.length],
                fill: false,
                tension: 0.3
            }));

            charts.labelTrends = new Chart(document.getElementById('chartLabelTrends'), {
                type: 'line',
                data: {
                    labels: years.length ? years : ['No assigned labels yet'],
                    datasets: datasets.length ? datasets : [{ label: 'No data', data: [0], borderColor: '#d9e3f2', backgroundColor: '#d9e3f2' }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } },
                        tooltip: defaultTooltip
                    }
                }
            });
        }

        function updateLabelPairsChart() {
            destroyChart('labelPairs');
            const stats = collectPredictionStats(chartData);
            const sorted = Object.entries(stats.pairCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
            const labels = sorted.length ? sorted.map(s => s[0]) : ['No co-occurring label pairs yet'];
            const values = sorted.length ? sorted.map(s => s[1]) : [0];

            charts.labelPairs = new Chart(document.getElementById('chartLabelPairs'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        data: values,
                        backgroundColor: sorted.length ? '#7c6ef0' : '#d9e3f2',
                        borderRadius: 4
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: defaultTooltip
                    }
                }
            });
        }

        function updateLabelBigramsChart() {
            destroyChart('labelBigrams');
            const records = getRecordsWithAssignedLabels(chartData);
            const bgCounts = {};
            const sample = records.length > MAX_BIGRAM_RECORDS ? sampleData(records, MAX_BIGRAM_RECORDS) : records;

            sample.forEach(r => {
                const tokens = tokenizeForBigrams(r._text);
                for (let i = 0; i < tokens.length - 1; i++) {
                    const bg = `${tokens[i]} ${tokens[i + 1]}`;
                    if (ignoredBigrams.has(bg)) continue;
                    bgCounts[bg] = (bgCounts[bg] || 0) + 1;
                }
            });

            const sorted = Object.entries(bgCounts)
                .filter(([, c]) => c >= 2)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20);
            const labels = sorted.length ? sorted.map(([bg]) => bg) : ['No repeated bigrams in assigned-label records'];
            const values = sorted.length ? sorted.map(([, c]) => c) : [0];

            charts.labelBigrams = new Chart(document.getElementById('chartLabelBigrams'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        data: values,
                        backgroundColor: sorted.length ? colors.primary.slice(0, labels.length) : ['#d9e3f2'],
                        borderRadius: 4
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: defaultTooltip
                    }
                }
            });
        }

        function getRecordsWithAssignedLabels(records = chartData) {
            return records.filter(r => normalizePredictedLabelsForStats(r._predictedLabels || []).length > 0);
        }

        function updateLabelStatsGrid() {
            const grid = document.getElementById('labelStatsGrid');
            if (!grid) return;

            const records = getRecordsWithAssignedLabels(chartData);
            if (!records.length) {
                grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:#666;">No assigned labels in the current filter.</p>';
                return;
            }

            const predictionStats = collectPredictionStats(records);
            const uniqueLabels = Object.keys(predictionStats.labelCounts).length;
            const uniqueBodies = new Set(records.map(r => r._body).filter(Boolean)).size;
            const uniqueThemes = new Set(records.flatMap(r => r._themesArray || []).filter(Boolean)).size;
            const validYears = records.map(r => r._year).filter(y => Number.isFinite(y) && y > 1990 && y < 2100);
            const yearCounts = {};
            validYears.forEach(y => {
                yearCounts[y] = (yearCounts[y] || 0) + 1;
            });
            const yearEntries = Object.entries(yearCounts);
            const yearlyValues = yearEntries.map(([, count]) => count).sort((a, b) => a - b);
            const meanPerYear = yearEntries.length ? (records.length / yearEntries.length) : 0;
            const medianPerYear = yearlyValues.length
                ? (yearlyValues.length % 2
                    ? yearlyValues[(yearlyValues.length - 1) / 2]
                    : (yearlyValues[yearlyValues.length / 2 - 1] + yearlyValues[yearlyValues.length / 2]) / 2)
                : 0;
            const peakYear = yearEntries.length
                ? yearEntries.reduce((best, cur) => (cur[1] > best[1] ? cur : best))
                : null;
            const textCoverage = (records.filter(r => (r._text || '').trim().length >= 40).length / records.length) * 100;
            const citationCoverage = (records.filter(r => String(r._citation || '').trim().length >= 5).length / records.length) * 100;

            const rightsTotals = records.reduce((acc, r) => {
                const keys = new Set(r._rightThemeKeys || []);
                keys.forEach(key => {
                    const meta = rightsThemeLookup[key];
                    if (!meta) return;
                    if (meta.family === 'ESCR') acc.esc += 1;
                    else acc.ccpr += 1;
                });
                return acc;
            }, { esc: 0, ccpr: 0 });
            const rightsTotal = rightsTotals.esc + rightsTotals.ccpr;
            const escShare = rightsTotal ? (rightsTotals.esc * 100 / rightsTotal) : 0;
            const ccprShare = rightsTotal ? (rightsTotals.ccpr * 100 / rightsTotal) : 0;

            grid.innerHTML = `
                <div class="stat-item"><div class="stat-value">${records.length.toLocaleString()}</div><div class="stat-label">Assigned Label Records</div></div>
                <div class="stat-item"><div class="stat-value">${uniqueLabels.toLocaleString()}</div><div class="stat-label">Unique Labels</div></div>
                <div class="stat-item"><div class="stat-value">${uniqueBodies.toLocaleString()}</div><div class="stat-label">Bodies Covered</div></div>
                <div class="stat-item"><div class="stat-value">${uniqueThemes.toLocaleString()}</div><div class="stat-label">Themes Covered</div></div>
                <div class="stat-item"><div class="stat-value">${meanPerYear.toFixed(1)}</div><div class="stat-label">Mean/Year</div></div>
                <div class="stat-item"><div class="stat-value">${medianPerYear.toFixed(1)}</div><div class="stat-label">Median/Year</div></div>
                <div class="stat-item"><div class="stat-value">${peakYear ? peakYear[0] : '-'}</div><div class="stat-label">Peak Year</div></div>
                <div class="stat-item"><div class="stat-value">${peakYear ? Number(peakYear[1]).toLocaleString() : '0'}</div><div class="stat-label">Peak Count</div></div>
                <div class="stat-item"><div class="stat-value">${textCoverage.toFixed(1)}%</div><div class="stat-label">Text Coverage</div></div>
                <div class="stat-item"><div class="stat-value">${citationCoverage.toFixed(1)}%</div><div class="stat-label">Citation Coverage</div></div>
                <div class="stat-item"><div class="stat-value">${escShare.toFixed(1)}%</div><div class="stat-label">ESC Rights Share</div></div>
                <div class="stat-item"><div class="stat-value">${ccprShare.toFixed(1)}%</div><div class="stat-label">CCPR Rights Share</div></div>
            `;
        }

        function updateLabelYearlyChart() {
            destroyChart('labelYearly');
            const records = getRecordsWithAssignedLabels(chartData);
            const yearlyCounts = {};
            records.forEach(r => {
                if (Number.isFinite(r._year)) {
                    yearlyCounts[r._year] = (yearlyCounts[r._year] || 0) + 1;
                }
            });
            const years = Object.keys(yearlyCounts).sort((a, b) => Number(a) - Number(b));
            const labels = years.length ? years : ['No assigned-label records with valid year'];
            const values = years.length ? years.map(y => yearlyCounts[y]) : [0];

            charts.labelYearly = new Chart(document.getElementById('chartLabelYearly'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Assigned-label records',
                        data: values,
                        backgroundColor: years.length ? colors.primary[0] : '#d9e3f2',
                        borderRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: defaultTooltip
                    },
                    scales: { y: { beginAtZero: true } }
                }
            });
        }

        function updateLabelBodiesChart() {
            destroyChart('labelBodies');
            const records = getRecordsWithAssignedLabels(chartData);
            const bodyCounts = {};
            records.forEach(r => {
                if (r._body) bodyCounts[r._body] = (bodyCounts[r._body] || 0) + 1;
            });
            const sorted = Object.entries(bodyCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);
            const labels = sorted.length ? sorted.map(([body]) => body.replace('- ', '')) : ['No body data'];
            const values = sorted.length ? sorted.map(([, count]) => count) : [0];

            charts.labelBodies = new Chart(document.getElementById('chartLabelBodies'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        data: values,
                        backgroundColor: sorted.length ? colors.bodies.slice(0, labels.length) : ['#d9e3f2'],
                        borderRadius: 4
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: defaultTooltip
                    }
                }
            });
        }

        function updateLabelThemeTrendsChart() {
            destroyChart('labelThemeTrends');
            const records = getRecordsWithAssignedLabels(chartData);
            const themeTotals = {};
            records.forEach(r => (r._themesArray || []).forEach(theme => {
                if (theme) themeTotals[theme] = (themeTotals[theme] || 0) + 1;
            }));
            const topThemes = Object.entries(themeTotals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([theme]) => theme);
            const yearly = {};
            records.forEach(r => {
                if (!Number.isFinite(r._year)) return;
                if (!yearly[r._year]) yearly[r._year] = {};
                (r._themesArray || []).forEach(theme => {
                    if (topThemes.includes(theme)) {
                        yearly[r._year][theme] = (yearly[r._year][theme] || 0) + 1;
                    }
                });
            });
            const years = Object.keys(yearly).sort((a, b) => Number(a) - Number(b));
            const datasets = topThemes.map((theme, idx) => ({
                label: theme.replace('- ', '').slice(0, 30),
                data: years.map(y => yearly[y]?.[theme] || 0),
                borderColor: colors.primary[idx % colors.primary.length],
                backgroundColor: colors.primary[idx % colors.primary.length],
                fill: false,
                tension: 0.3
            }));

            charts.labelThemeTrends = new Chart(document.getElementById('chartLabelThemeTrends'), {
                type: 'line',
                data: {
                    labels: years.length ? years : ['No assigned-label theme trends'],
                    datasets: datasets.length ? datasets : [{ label: 'No data', data: [0], borderColor: '#d9e3f2', backgroundColor: '#d9e3f2' }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } },
                        tooltip: defaultTooltip
                    }
                }
            });
        }

        function updateLabelEscCcprChart() {
            destroyChart('labelEscCcpr');
            const records = getRecordsWithAssignedLabels(chartData);
            const yearly = getRightsYearlyData(records);
            const years = Object.keys(yearly).filter(y => ((yearly[y].esc || 0) + (yearly[y].ccpr || 0)) > 0).sort((a, b) => Number(a) - Number(b));
            const labels = years.length ? years : ['No rights-theme matches'];
            const escValues = years.length ? years.map(y => yearly[y].esc || 0) : [0];
            const ccprValues = years.length ? years.map(y => yearly[y].ccpr || 0) : [0];

            charts.labelEscCcpr = new Chart(document.getElementById('chartLabelEscCcpr'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: 'ESC Rights', data: escValues, backgroundColor: '#d64545', stack: 'rights' },
                        { label: 'CCPR Rights', data: ccprValues, backgroundColor: '#2146db', stack: 'rights' }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'top' },
                        tooltip: defaultTooltip
                    },
                    scales: {
                        x: { stacked: true },
                        y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Theme mentions' } }
                    }
                }
            });
        }

        function updateLabelBodyScatterChart() {
            destroyChart('labelBodyScatter');
            const records = getRecordsWithAssignedLabels(chartData);
            const bodyYearCounts = {};
            const bodyTotals = {};
            records.forEach(r => {
                if (!Number.isFinite(r._year) || !r._body) return;
                bodyTotals[r._body] = (bodyTotals[r._body] || 0) + 1;
                const key = `${r._body}|${r._year}`;
                bodyYearCounts[key] = (bodyYearCounts[key] || 0) + 1;
            });
            const bodies = Object.entries(bodyTotals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([body]) => body);
            const datasets = bodies.map((body, idx) => {
                const points = [];
                Object.entries(bodyYearCounts).forEach(([key, count]) => {
                    const [b, yr] = key.split('|');
                    if (b === body) {
                        points.push({ x: Number(yr), y: count });
                    }
                });
                return {
                    label: body.replace('- ', ''),
                    data: points,
                    backgroundColor: colors.bodies[idx % colors.bodies.length],
                    pointRadius: 5,
                    pointHoverRadius: 7
                };
            });

            charts.labelBodyScatter = new Chart(document.getElementById('chartLabelBodyScatter'), {
                type: 'scatter',
                data: { datasets: datasets.length ? datasets : [] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } },
                        tooltip: defaultTooltip
                    },
                    scales: {
                        x: { title: { display: true, text: 'Year' } },
                        y: { beginAtZero: true, title: { display: true, text: 'Records' } }
                    }
                }
            });
        }

        // ========== DATA TABLE ==========
        function getTableColumns() {
            const hasPredictions = rawData.some(r => r._predictedLabels && r._predictedLabels.length > 0);
            const baseCols = [
                    { key: '_select', label: 'Select', sortable: false },
                    { key: '_countries', label: 'Country', sortable: true },
                    { key: '_year', label: 'Year', sortable: true },
                    { key: '_body', label: 'Body', sortable: true },
                    { key: '_type', label: 'Type', sortable: true },
                    { key: '_text', label: 'Text', sortable: true },
            ];
            if (hasPredictions) baseCols.push({ key: '_predictedLabels', label: 'Predicted', sortable: true });
            baseCols.push(
                    { key: '_themes', label: 'Themes', sortable: true },
                    { key: '_source', label: 'Source', sortable: false },
                    { key: '_actions', label: 'Actions', sortable: false }
            );
            return baseCols;
        }

        function stripDashPrefixes(value) {
            return String(value || '')
                .split(/\r?\n/)
                .map(line => line.replace(/^[\-\u2022•\s]+/, '').trim())
                .filter(Boolean)
                .join(' | ');
        }

        function getCellValue(record, key) {
            if (key === '_predictedLabels') return (record[key] || []).join(', ');
            if (key === '_countries') return stripDashPrefixes(record._countries);
            if (key === '_body') return stripDashPrefixes(record._body);
            if (key === '_type') return stripDashPrefixes(record._type);
            if (key === '_year') return Number.isFinite(record._year) ? String(record._year) : '';
            if (key === '_select') return '';
            if (key === '_actions') return '';
            if (key === '_source') return record._symbol || '';
            return String(record[key] || '');
        }

        function parseSearchQuery(rawInput) {
            const raw = String(rawInput || '').trim();
            if (!raw) return { type: 'none', raw: '' };

            // Regex modes: re:pattern or /pattern/flags
            if (raw.startsWith('re:')) {
                const pattern = raw.slice(3);
                try {
                    const testRegex = new RegExp(pattern, 'i');
                    const highlightRegex = new RegExp(pattern, 'gi');
                    return { type: 'regex', raw, testRegex, highlightRegex };
                } catch (err) {
                    return { type: 'invalid', raw, error: err.message };
                }
            }
            if (raw.startsWith('/') && raw.lastIndexOf('/') > 0) {
                const lastSlash = raw.lastIndexOf('/');
                const pattern = raw.slice(1, lastSlash);
                const flagsRaw = raw.slice(lastSlash + 1) || 'i';
                const testFlags = flagsRaw.replace(/g/g, '') || 'i';
                const highlightFlags = flagsRaw.includes('g') ? flagsRaw : flagsRaw + 'g';
                try {
                    const testRegex = new RegExp(pattern, testFlags);
                    const highlightRegex = new RegExp(pattern, highlightFlags);
                    return { type: 'regex', raw, testRegex, highlightRegex };
                } catch (err) {
                    return { type: 'invalid', raw, error: err.message };
                }
            }

            // Boolean mode: supports AND, OR, NOT, "quoted phrases"
            if (/\b(AND|OR|NOT)\b/.test(raw) || raw.includes('"')) {
                return parseBooleanQuery(raw);
            }

            return { type: 'plain', raw, lowered: raw.toLowerCase() };
        }

        function parseBooleanQuery(raw) {
            // Tokenize: extract quoted phrases, AND, OR, NOT, and bare words
            const tokens = [];
            const re = /"([^"]+)"|(\bAND\b|\bOR\b|\bNOT\b)|(\S+)/g;
            let m;
            while ((m = re.exec(raw)) !== null) {
                if (m[1] !== undefined) tokens.push({ type: 'phrase', value: m[1].toLowerCase() });
                else if (m[2]) tokens.push({ type: 'op', value: m[2] });
                else if (m[3]) tokens.push({ type: 'word', value: m[3].toLowerCase() });
            }
            if (!tokens.length) return { type: 'none', raw };

            // Build clause groups: split by OR, each group joined by implicit AND
            // Each clause is { term: string, negate: boolean }
            const orGroups = [[]];
            let negate = false;
            for (const tok of tokens) {
                if (tok.type === 'op') {
                    if (tok.value === 'OR') { orGroups.push([]); negate = false; }
                    else if (tok.value === 'NOT') { negate = true; }
                    // AND is implicit — just continue
                } else {
                    orGroups[orGroups.length - 1].push({ term: tok.value, negate });
                    negate = false;
                }
            }

            // Collect highlight terms (non-negated)
            const hlTerms = [];
            for (const g of orGroups) for (const c of g) if (!c.negate) hlTerms.push(c.term);
            let highlightRegex = null;
            if (hlTerms.length) {
                try {
                    highlightRegex = new RegExp('(' + hlTerms.map(t => escapeRegex(t)).join('|') + ')', 'gi');
                } catch { /* ignore */ }
            }

            return { type: 'boolean', raw, orGroups, highlightRegex };
        }

        // Normalize hyphens to spaces for search matching.
        // UN documents use "asylum-seekers" but users type "asylum seekers".
        function normalizeForSearch(text) {
            return text.replace(/-/g, ' ');
        }

        function recordMatchesSearch(record, cols, searchState) {
            if (!searchState || searchState.type === 'none') return true;
            if (searchState.type === 'invalid') return false;

            const getText = () => normalizeForSearch(cols.map(c => getCellValue(record, c)).join(' ').toLowerCase());

            if (searchState.type === 'boolean') {
                const text = getText();
                // Match if ANY orGroup matches; a group matches when ALL its clauses match
                return searchState.orGroups.some(group =>
                    group.every(clause => {
                        const normalizedTerm = normalizeForSearch(clause.term);
                        return clause.negate ? !text.includes(normalizedTerm) : text.includes(normalizedTerm);
                    })
                );
            }

            return cols.some(c => {
                const v = normalizeForSearch(getCellValue(record, c));
                if (searchState.type === 'regex') {
                    searchState.testRegex.lastIndex = 0;
                    return searchState.testRegex.test(v);
                }
                return v.toLowerCase().includes(normalizeForSearch(searchState.lowered));
            });
        }

        function escapeRegex(str) {
            return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        function highlightByRegex(text, regex) {
            const raw = String(text || '');
            const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
            const re = new RegExp(regex.source, flags);
            let out = '';
            let lastIndex = 0;
            let match;

            while ((match = re.exec(raw)) !== null) {
                if (!match[0]) {
                    re.lastIndex += 1;
                    continue;
                }
                out += escapeHtml(raw.slice(lastIndex, match.index));
                out += `<mark>${escapeHtml(match[0])}</mark>`;
                lastIndex = match.index + match[0].length;
            }
            out += escapeHtml(raw.slice(lastIndex));
            return out;
        }

        function highlightSearch(text, searchState) {
            if (!searchState || searchState.type === 'none' || searchState.type === 'invalid') {
                return escapeHtml(text);
            }
            if (searchState.type === 'plain') {
                const re = new RegExp(escapeRegex(searchState.raw), 'gi');
                return highlightByRegex(text, re);
            }
            if (searchState.type === 'boolean' && searchState.highlightRegex) {
                return highlightByRegex(text, searchState.highlightRegex);
            }
            if (searchState.highlightRegex) {
                return highlightByRegex(text, searchState.highlightRegex);
            }
            return escapeHtml(text);
        }

        function renderTextCell(value, searchState, rowId, key, maxLength = 260) {
            const full = String(value || '');
            const tooLong = full.length > maxLength;
            const shown = tooLong ? `${full.slice(0, maxLength)}…` : full;
            const highlighted = highlightSearch(shown, searchState);
            const more = tooLong ? ` <button class="inline-btn" onclick="showTextModalById(${rowId}, '${key}')">More</button>` : '';
            return `<td class="text-cell" title="${escapeHtml(full.slice(0, 400))}">${highlighted}${more}</td>`;
        }

        function buildDataTable() {
            const cols = getTableColumns();
            document.getElementById('tableHeader').innerHTML = cols.map(c =>
                c.key === '_select'
                    ? `<th data-col="${c.key}" title="Select visible rows"><input type="checkbox" id="selectAllVisible" onchange="toggleSelectAllVisible(this.checked)"></th>`
                    : c.sortable
                    ? `<th data-col="${c.key}" onclick="sortTable('${c.key}')">${c.label}</th>`
                    : `<th data-col="${c.key}">${c.label}</th>`
            ).join('');
            renderTableBody();
        }

        function renderTableBody() {
            const tbody = document.getElementById('tableBody');
            const searchState = parseSearchQuery(document.getElementById('tableSearch').value);
            const cols = ['_text'];

            if (searchState.type === 'invalid') {
                tbody.innerHTML = `<tr><td colspan="${getTableColumns().length}" style="color:#b02a37;">Invalid regex: ${escapeHtml(searchState.error || '')}</td></tr>`;
                document.getElementById('tableInfo').textContent = 'Invalid regex query';
                document.getElementById('pagination').innerHTML = '';
                updateSelectedCountInfo();
                return;
            }

            // In server mode, use accumulated infinite-scroll records
            const sourceData = serverBrowseMode ? _infScroll.records : filteredData;
            let data = sourceData;
            // In server mode, server already filtered — skip local filtering
            const serverSearchActive = serverBrowseMode && _serverSearchFilter;
            if (!serverBrowseMode && searchState.type !== 'none') {
                data = data.filter(r => recordMatchesSearch(r, cols, searchState));
            }

            if (!serverBrowseMode && currentSort.column) {
                data = [...data].sort((a, b) => {
                    const cmp = getCellValue(a, currentSort.column).localeCompare(
                        getCellValue(b, currentSort.column),
                        undefined,
                        { numeric: true }
                    );
                    return currentSort.direction === 'asc' ? cmp : -cmp;
                });
            }

            let totalPages, start, pageData;
            if (serverBrowseMode) {
                // Infinite scroll: show ALL accumulated records, no pagination
                totalPages = 1; // pagination not used
                start = 0;
                pageData = data;
            } else {
                totalPages = Math.ceil(data.length / ROWS_PER_PAGE);
                if (totalPages > 0 && currentPage > totalPages) currentPage = totalPages;
                start = (currentPage - 1) * ROWS_PER_PAGE;
                if (_prefetchCache.page === currentPage && _prefetchCache.searchKey === _getPrefetchSearchKey()) {
                    pageData = _prefetchCache.data;
                    _prefetchCache = { page: null, data: null, searchKey: null };
                } else {
                    pageData = data.slice(start, start + ROWS_PER_PAGE);
                }
            }
            lastRenderedPageData = pageData;

            tbody.innerHTML = pageData.map(r => {
                const rowCols = getTableColumns().map(c => {
                    const key = c.key;
                    if (key === '_select') {
                        const checked = selectedRowIds.has(String(r._id)) ? 'checked' : '';
                        return `<td><input type="checkbox" onchange="toggleRowSelection(${r._id}, this.checked)" ${checked}></td>`;
                    }
                    if (key === '_predictedLabels' && r._predictedLabels && r._predictedLabels.length) {
                        return `<td>${r._predictedLabels.map(l => `<span class="pred-badge">${highlightSearch(l, searchState)}</span>`).join('')}</td>`;
                    }
                    if (key === '_text') {
                        return renderTextCell(r._text, searchState, r._id, '_text', 1300);
                    }
                    if (key === '_themes') {
                        return renderTextCell(r._themes, searchState, r._id, '_themes', 260);
                    }
                    if (key === '_source') {
                        const uhri = getUhriUrl(r);
                        const undocs = getUnDocsUrl(r);
                        const symbol = (r._symbol || '').replace(/^-+\s*/, '').trim();
                        let html = '<td class="source-cell"><div class="source-links">';
                        if (uhri) html += `<a href="${uhri}" target="_blank" rel="noopener" class="source-link uhri-link" title="View on UHRI">UHRI</a>`;
                        if (undocs) html += `<a href="${undocs}" target="_blank" rel="noopener" class="source-link undocs-link" title="View UN document: ${escapeHtml(symbol)}">UN Doc</a>`;
                        if (!uhri && !undocs) html += '<span style="color:#aaa">—</span>';
                        html += '</div></td>';
                        return html;
                    }
                    if (key === '_actions') {
                        return `<td><div class="copy-actions">
                            <button class="copy-btn" onclick="showRecordDetail(${r._id})" title="View full details">Details</button>
                            <button class="copy-btn" onclick="copyFormattedCitation(${r._id}, this)" title="Copy formatted citation">Cite</button>
                        </div></td>`;
                    }
                    return `<td>${highlightSearch(getCellValue(r, key), searchState)}</td>`;
                });
                return `<tr>${rowCols.join('')}</tr>`;
            }).join('');

            if (data.length === 0) {
                const searchVal = document.getElementById('tableSearch').value.trim();
                const isTextFilter = searchState.type !== 'none';
                const hasFilters = filteredData.length < rawData.length;
                let hint = '';
                if (isTextFilter && hasFilters) {
                    hint = '<br><span style="font-size:12px;">Try broadening the text column filter, or clear some dashboard filters.</span>';
                } else if (isTextFilter) {
                    hint = '<br><span style="font-size:12px;">Try different text keywords, or clear the text column filter above.</span>';
                } else if (sourceData.length === 0 && !serverBrowseMode) {
                    hint = '<br><span style="font-size:12px;">No data loaded. Use <strong>Quick Demo</strong> or connect to a server to load recommendations.</span>';
                }
                tbody.innerHTML = `<tr><td colspan="${getTableColumns().length}" style="text-align:center; padding:32px 16px;">
                    <div style="color:#526783; font-size:14px; font-weight:500;">No matching records found</div>
                    <div style="color:#8899aa; margin-top:6px;">${isTextFilter ? 'Text filter: <code style="background:#f0f4f8; padding:2px 6px; border-radius:4px;">' + escapeHtml(searchVal) + '</code>' : 'No records match the current filters.'}${hint}</div>
                </td></tr>`;
            }

            const modeSuffix = searchState.type === 'regex' ? ' | regex mode' : '';
            const isSearchActive = searchState.type !== 'none' && searchState.type !== 'invalid';
            const infoEl = document.getElementById('tableInfo');
            if (serverBrowseMode) {
                // Infinite scroll info — use _updateInfScrollInfo for consistency
                _updateInfScrollInfo();
            } else {
                if (isSearchActive) {
                    const totalSource = (serverBrowseMode ? serverState.records : filteredData).length;
                    const pct = totalSource ? ((data.length / totalSource) * 100).toFixed(1) : '0.0';
                    infoEl.innerHTML = `<span style="background:#e8f0fe; color:#1a56db; padding:2px 8px; border-radius:4px; font-weight:600; font-size:inherit;">${data.length.toLocaleString()} hits</span> <span style="color:#667;">(${pct}% of ${totalSource.toLocaleString()}) — page ${currentPage}${modeSuffix}</span>`;
                } else {
                    infoEl.textContent = data.length
                        ? `Showing ${start + 1}-${Math.min(start + ROWS_PER_PAGE, data.length)} of ${data.length.toLocaleString()}${modeSuffix}`
                        : `Showing 0 records${modeSuffix}`;
                }
            }
            const selectAllVisible = document.getElementById('selectAllVisible');
            if (selectAllVisible) {
                const pageIds = pageData.map(r => String(r._id));
                const allSelected = pageIds.length > 0 && pageIds.every(id => selectedRowIds.has(id));
                selectAllVisible.checked = allSelected;
            }
            updateSelectedCountInfo();
            renderCardView(pageData, searchState);
            if (serverBrowseMode) {
                // Infinite scroll: hide pagination, set up observer
                document.getElementById('pagination').innerHTML = '';
                setTimeout(_setupInfScrollObserver, 100);
            } else {
                renderPagination(totalPages);
            }
            // Prefetch next page in background for smooth transitions (local mode)
            if (!serverBrowseMode) {
                setTimeout(prefetchNextPage, 100);
            }
        }

        let _currentTableView = 'card';

        function setTableView(mode) {
            _currentTableView = mode;
            document.getElementById('viewBtnCard')?.classList.toggle('active', mode === 'card');
            document.getElementById('viewBtnTable')?.classList.toggle('active', mode === 'table');
            document.getElementById('cardListView')?.classList.toggle('hidden', mode !== 'card');
            document.getElementById('classicTableView')?.classList.toggle('hidden', mode !== 'table');
            renderTableBody();
        }

        function toggleCardText(id) {
            const short = document.getElementById(`card-short-${id}`);
            const full = document.getElementById(`card-full-${id}`);
            const btn = document.getElementById(`card-toggle-${id}`);
            if (!short || !full || !btn) return;
            const isExpanded = !full.classList.contains('hidden');
            short.classList.toggle('hidden', !isExpanded);
            full.classList.toggle('hidden', isExpanded);
            btn.textContent = isExpanded ? 'Read full text' : 'Collapse';
        }

        function expandAllCards() {
            document.querySelectorAll('[id^="card-full-"]').forEach(el => {
                el.classList.remove('hidden');
                // Only hide the short version if the full version exists
                const id = el.id.replace('card-full-', '');
                const short = document.getElementById('card-short-' + id);
                if (short) short.classList.add('hidden');
            });
            document.querySelectorAll('[id^="card-toggle-"]').forEach(btn => btn.textContent = 'Collapse');
        }

        function collapseAllCards() {
            document.querySelectorAll('[id^="card-full-"]').forEach(el => el.classList.add('hidden'));
            document.querySelectorAll('[id^="card-short-"]').forEach(el => el.classList.remove('hidden'));
            document.querySelectorAll('[id^="card-toggle-"]').forEach(btn => btn.textContent = 'Read full text');
        }

        function renderCardView(pageData, searchState) {
            const container = document.getElementById('cardListView');
            if (!container || _currentTableView !== 'card') return;

            if (!pageData.length) {
                const searchVal = (document.getElementById('tableSearch')?.value || '').trim();
                const isSearching = searchVal.length > 0;
                let hint = isSearching
                    ? '<div style="margin-top:8px; font-size:12px; color:#8899aa;">Try different text keywords, or clear the text column filter above.</div>'
                    : '';
                container.innerHTML = `<div style="padding:32px 24px; text-align:center;">
                    <div style="color:#526783; font-size:14px; font-weight:500;">No matching records found</div>
                    ${isSearching ? '<div style="margin-top:6px; color:#8899aa;">Text filter: <code style="background:#f0f4f8; padding:2px 6px; border-radius:4px;">' + escapeHtml(searchVal) + '</code></div>' : ''}
                    ${hint}
                </div>`;
                return;
            }

            // Expand/collapse all toolbar
            const hasTruncated = pageData.some(r => (r._text || '').length > 600);
            let toolbarHtml = '';
            if (hasTruncated) {
                toolbarHtml = `<div style="display:flex; gap:8px; margin-bottom:10px; justify-content:flex-end;">
                    <button class="copy-btn" onclick="expandAllCards()" style="font-size:11px;">Expand all</button>
                    <button class="copy-btn" onclick="collapseAllCards()" style="font-size:11px;">Collapse all</button>
                </div>`;
            }

            const sentinelHtml = serverBrowseMode ? '<div id="infScrollSentinel"></div>' : '';
            container.innerHTML = toolbarHtml + pageData.map(r => _renderSingleCard(r, searchState)).join('') + sentinelHtml;
        }

        function _isGuidLike(s) { return /^[0-9a-f-]{20,}$/i.test(s); }

        // ISO country code → full name via browser Intl API
        const _countryNames = (() => {
            try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; }
        })();
        function _countryLabel(raw) {
            const s = (raw || '').replace(/^-+\s*/, '').trim();
            if (!s) return '';
            // If it's a 2-letter ISO code, resolve it
            if (s.length === 2 && /^[A-Z]{2}$/.test(s) && _countryNames) {
                try { return _countryNames.of(s) || s; } catch { return s; }
            }
            return s;
        }

        function _renderSingleCard(r, searchState) {
            const fullText = r._text || '';
            const maxLen = 600;
            const truncated = fullText.length > maxLen;
            const shortText = truncated ? fullText.substring(0, maxLen) : fullText;
            const highlightedShort = highlightSearch(shortText, searchState) + (truncated ? '<span style="color:#999">...</span>' : '');
            const highlightedFull = highlightSearch(fullText, searchState);

            const body_ = (r._body || '').replace(/^-+\s*/, '').trim();
            const country = _countryLabel((r._countries || '').split('\n')[0]);
            const year = r._year || '';
            const rawType = (r._type || '').replace(/^-+\s*/, '').trim();
            const type = (_isGuidLike(rawType) || rawType.length < 3) ? '' : rawType;
            const themes = (r._themesArray || []).slice(0, 5).map(t => t.replace(/^-+\s*/, '').trim()).filter(Boolean);
            const moreThemes = (r._themesArray || []).length > 5 ? `+${(r._themesArray || []).length - 5}` : '';
            const uhri = getUhriUrl(r);
            const undocs = getUnDocsUrl(r);
            const isSelected = selectedRowIds.has(String(r._id));
            const checked = isSelected ? 'checked' : '';

            // ── Header: checkbox + Body · Country · Year + links ──
            let html = `<div class="rec-card${isSelected ? ' selected' : ''}">`;
            html += `<div class="rec-card-header">`;
            html += `<input type="checkbox" class="rec-card-select" onchange="toggleRowSelection(${r._id}, this.checked); this.closest('.rec-card').classList.toggle('selected', this.checked)" ${checked}>`;
            if (body_) html += `<span class="rec-meta-tag body">${escapeHtml(body_)}</span>`;
            if (country) html += `<span class="rec-meta-tag country">${escapeHtml(country)}</span>`;
            if (year) html += `<span class="rec-meta-tag year">${year}</span>`;
            if (type) html += `<span class="rec-meta-tag type">${escapeHtml(type)}</span>`;
            html += `<span class="rec-card-header-links">`;
            if (uhri) html += `<a href="${uhri}" target="_blank" rel="noopener" class="source-link uhri-link">UHRI</a>`;
            if (undocs) html += `<a href="${undocs}" target="_blank" rel="noopener" class="source-link undocs-link">UN Doc</a>`;
            html += `</span></div>`;

            // ── Theme badges ──
            if (themes.length) {
                html += `<div class="rec-card-themes-bar">${themes.map(t => `<span class="rec-theme-badge">${escapeHtml(t)}</span>`).join('')}${moreThemes ? `<span class="rec-theme-badge" style="color:#8899aa;">${moreThemes}</span>` : ''}</div>`;
            }

            // ── Predicted labels with feedback ──
            if (r._predictedLabels && r._predictedLabels.length) {
                html += `<div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:6px; align-items:center;">`;
                html += `<span style="font-size:10px; color:#8899aa; margin-right:2px;">AI:</span>`;
                r._predictedLabels.forEach(label => {
                    html += `<span class="pred-badge-wrap"><span class="pred-badge">${escapeHtml(label)}</span><button class="pred-correct-btn" onclick="event.stopPropagation(); _openCorrectionPicker(${r._id}, this)" title="Wrong? Click to correct">✕</button></span>`;
                });
                html += `</div>`;
            }

            // ── Text ──
            html += `<div class="rec-card-text" id="card-short-${r._id}">${highlightedShort}</div>`;
            if (truncated) {
                html += `<div class="rec-card-text hidden" id="card-full-${r._id}">${highlightedFull}</div>`;
            }

            // ── Actions ──
            html += `<div class="rec-card-actions">`;
            if (truncated) html += `<button class="copy-btn" id="card-toggle-${r._id}" onclick="toggleCardText(${r._id})" style="font-size:11px;">Read full text</button>`;
            html += `<button class="copy-btn" onclick="showRecordDetail(${r._id})">Details</button>`;
            html += `<button class="copy-btn" onclick="copyFormattedCitation(${r._id}, this)">Cite</button>`;
            html += `</div></div>`;
            return html;
        }

        // ── Prediction correction (online learning feedback) ──
        let _activeCorrectionPicker = null;

        function _openCorrectionPicker(recordId, btnEl) {
            // Close any existing picker
            if (_activeCorrectionPicker) { _activeCorrectionPicker.remove(); _activeCorrectionPicker = null; }
            const cats = (trainingState.categories || []).filter(c => !isExcludedCategory(c));
            if (!cats.length) { alert('Define categories in the Trainer first.'); return; }

            const picker = document.createElement('div');
            picker.className = 'correction-picker';
            picker.innerHTML = `<div class="correction-picker-title">Correct label:</div>` +
                cats.map(c => `<button class="correction-opt" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');

            btnEl.closest('.pred-badge-wrap').appendChild(picker);
            _activeCorrectionPicker = picker;

            picker.querySelectorAll('.correction-opt').forEach(opt => {
                opt.onclick = (e) => {
                    e.stopPropagation();
                    _correctPrediction(recordId, opt.dataset.cat);
                    picker.remove();
                    _activeCorrectionPicker = null;
                };
            });

            // Close on outside click
            setTimeout(() => {
                const closer = (e) => {
                    if (!picker.contains(e.target)) { picker.remove(); _activeCorrectionPicker = null; document.removeEventListener('click', closer); }
                };
                document.addEventListener('click', closer);
            }, 10);
        }

        function _correctPrediction(recordId, correctLabel) {
            // Find record
            const record = recordMap.get(String(recordId))
                || (serverBrowseMode ? _infScroll.records : rawData).find(r => r._id === recordId);
            if (!record) return;

            const oldLabels = record._predictedLabels || [];
            const text = record._text || '';

            // Update NB model: untrain old labels, train correct one
            if (trainingState.nbModel) {
                oldLabels.forEach(old => { if (!isExcludedCategory(old)) trainingState.nbModel.untrain(text, old); });
                trainingState.nbModel.train(text, correctLabel);
            }

            // Store correction as manual label
            const sampleKey = getSampleKey(record);
            trainingState.labeledSamples.set(sampleKey, [correctLabel]);

            // Update record's visible predictions
            record._predictedLabels = [correctLabel];

            // Track corrections count
            if (!trainingState._correctionCount) trainingState._correctionCount = 0;
            trainingState._correctionCount++;

            // Re-render the card
            const cardEl = document.querySelector(`.rec-card:has(#card-short-${recordId})`);
            if (cardEl) {
                const searchState = parseSearchQuery(document.getElementById('tableSearch')?.value || '');
                cardEl.outerHTML = _renderSingleCard(record, searchState);
            }

            // Toast
            _showCorrectionToast(trainingState._correctionCount);
        }

        // ── Filter Presets (named saves) ──
        const PRESETS_KEY = 'un_hr_dashboard_filter_presets';
        const MAX_PRESETS = 10;

        function _loadPresets() { try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]'); } catch { return []; } }
        function _savePresetList(list) { try { localStorage.setItem(PRESETS_KEY, JSON.stringify(list)); } catch {} }

        function _saveFilterPreset() {
            const state = getServerFilterState();
            // Also check if search bar has text (even if not yet applied)
            const searchText = (document.getElementById('filterText')?.value || '').trim();
            if (searchText && !state.textQuery) state.textQuery = searchText;
            const hasFilter = state.textQuery || state.countries.length || state.bodies.length || state.regions.length || (state.themes || []).length || (state.affectedPersons || []).length || (state.sdgs || []).length || state.annotationType.length;
            if (!hasFilter) { _showToast('Type a query or select filters first.', 2000, '#c62828'); return; }
            const defaultName = buildFilterLabel(state);
            const name = prompt('Name this preset:', defaultName);
            if (!name) return;
            const hits = _getHitCount();
            let list = _loadPresets();
            list.unshift({ id: Date.now(), name: name.trim(), hits, state });
            if (list.length > MAX_PRESETS) list = list.slice(0, MAX_PRESETS);
            _savePresetList(list);
            _showToast('Preset saved: ' + name.trim(), 2000, '#2e7d32');
            updateRecentUI();
        }

        function _deletePreset(id) {
            let list = _loadPresets().filter(p => p.id !== id);
            _savePresetList(list);
            updateRecentUI();
        }

        function _updateSavePresetBtn() { /* button always visible now */ }

        function _showToast(message, duration = 4000, color = '#2d5a87') {
            const existing = document.querySelector('.correction-toast');
            if (existing) existing.remove();
            const toast = document.createElement('div');
            toast.className = 'correction-toast';
            toast.style.background = color;
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), duration);
        }

        function _showCorrectionToast(count) {
            const existing = document.querySelector('.correction-toast');
            if (existing) existing.remove();
            const hint = count >= 10 ? ` — consider retraining RF for best accuracy` : '';
            const toast = document.createElement('div');
            toast.className = 'correction-toast';
            toast.textContent = `Learned! Model updated (${count} correction${count > 1 ? 's' : ''})${hint}`;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }

        function _renderSingleRow(r, searchState) {
            const rowCols = getTableColumns().map(c => {
                const key = c.key;
                if (key === '_select') {
                    const checked = selectedRowIds.has(String(r._id)) ? 'checked' : '';
                    return `<td><input type="checkbox" onchange="toggleRowSelection(${r._id}, this.checked)" ${checked}></td>`;
                }
                if (key === '_predictedLabels' && r._predictedLabels && r._predictedLabels.length) {
                    return `<td>${r._predictedLabels.map(l => `<span class="pred-badge">${highlightSearch(l, searchState)}</span>`).join('')}</td>`;
                }
                if (key === '_text') return renderTextCell(r._text, searchState, r._id, '_text', 1300);
                if (key === '_themes') return renderTextCell(r._themes, searchState, r._id, '_themes', 260);
                if (key === '_source') {
                    const uhri = getUhriUrl(r);
                    const undocs = getUnDocsUrl(r);
                    let h = '<td class="source-cell"><div class="source-links">';
                    if (uhri) h += `<a href="${uhri}" target="_blank" rel="noopener" class="source-link uhri-link" title="UHRI">UHRI</a>`;
                    if (undocs) h += `<a href="${undocs}" target="_blank" rel="noopener" class="source-link undocs-link">UN Doc</a>`;
                    if (!uhri && !undocs) h += '<span style="color:#aaa">—</span>';
                    return h + '</div></td>';
                }
                if (key === '_actions') {
                    return `<td><div class="copy-actions"><button class="copy-btn" onclick="showRecordDetail(${r._id})">Details</button><button class="copy-btn" onclick="copyFormattedCitation(${r._id}, this)">Cite</button></div></td>`;
                }
                return `<td>${highlightSearch(getCellValue(r, key), searchState)}</td>`;
            });
            return `<tr>${rowCols.join('')}</tr>`;
        }

        function renderPagination(total) {
            const pg = document.getElementById('pagination');
            if (total <= 1) { pg.innerHTML = ''; return; }

            let html = `<button onclick="goToPage(1)" ${currentPage===1?'disabled':''}>«</button>`;
            html += `<button onclick="goToPage(${currentPage-1})" ${currentPage===1?'disabled':''}>‹</button>`;

            const range = 2;
            for (let i = Math.max(1, currentPage-range); i <= Math.min(total, currentPage+range); i++) {
                html += `<button onclick="goToPage(${i})" class="${i===currentPage?'active':''}">${i}</button>`;
            }

            html += `<button onclick="goToPage(${currentPage+1})" ${currentPage===total?'disabled':''}>›</button>`;
            html += `<button onclick="goToPage(${total})" ${currentPage===total?'disabled':''}>»</button>`;
            html += `<span>Page ${currentPage} of ${total}</span>`;

            pg.innerHTML = html;
        }

        // --- Prefetch cache for smooth page transitions ---
        let _prefetchCache = { page: null, data: null, searchKey: null };

        function _getPrefetchSearchKey() {
            return document.getElementById('tableSearch')?.value || '';
        }

        function prefetchNextPage() {
            if (serverBrowseMode) return; // server mode handled separately
            const searchState = parseSearchQuery(document.getElementById('tableSearch').value);
            const cols = ['_text'];
            let data = filteredData;
            if (searchState.type !== 'none' && searchState.type !== 'invalid') {
                data = data.filter(r => recordMatchesSearch(r, cols, searchState));
            }
            if (currentSort.column) {
                data = [...data].sort((a, b) => {
                    const cmp = getCellValue(a, currentSort.column).localeCompare(
                        getCellValue(b, currentSort.column), undefined, { numeric: true }
                    );
                    return currentSort.direction === 'asc' ? cmp : -cmp;
                });
            }
            const totalPages = Math.ceil(data.length / ROWS_PER_PAGE);
            const nextPage = currentPage + 1;
            if (nextPage > totalPages) { _prefetchCache = { page: null, data: null, searchKey: null }; return; }
            const start = (nextPage - 1) * ROWS_PER_PAGE;
            _prefetchCache = {
                page: nextPage,
                data: data.slice(start, start + ROWS_PER_PAGE),
                searchKey: _getPrefetchSearchKey()
            };
        }

        function goToPage(p) {
            if (p === currentPage) return;
            currentPage = p;

            // Fade transition
            const cardView = document.getElementById('cardListView');
            const tableView = document.getElementById('classicTableView');
            const target = _currentTableView === 'card' ? cardView : tableView;

            if (target) {
                target.style.transition = 'opacity 0.12s ease-out';
                target.style.opacity = '0.35';
            }

            if (serverBrowseMode) {
                // Server mode uses infinite scroll — goToPage not used
                if (target) { target.style.opacity = '1'; }
            } else {
                requestAnimationFrame(() => {
                    renderTableBody();
                    if (target) {
                        requestAnimationFrame(() => { target.style.opacity = '1'; });
                    }
                });
            }

            // Scroll pagination into view (not the whole section)
            const pg = document.getElementById('pagination');
            const tableControls = document.querySelector('.table-controls');
            if (tableControls) {
                const rect = tableControls.getBoundingClientRect();
                if (rect.top < 0) {
                    tableControls.scrollIntoView({ behavior: 'instant', block: 'start' });
                }
            }
        }

        function updateSelectedCountInfo() {
            const info = document.getElementById('selectedCountInfo');
            const controls = document.getElementById('selectionControls');
            if (info) info.textContent = `${selectedRowIds.size.toLocaleString()} selected`;
            if (controls) controls.style.display = selectedRowIds.size > 0 ? 'inline-flex' : 'none';
        }

        function toggleRowSelection(id, checked) {
            const key = String(id);
            if (checked) selectedRowIds.add(key);
            else selectedRowIds.delete(key);
            updateSelectedCountInfo();
        }

        function selectVisibleRows() {
            lastRenderedPageData.forEach(row => selectedRowIds.add(String(row._id)));
            renderTableBody();
        }

        function selectAllRecords() {
            // Select ALL filtered records, not just the visible page
            const pool = serverBrowseMode ? _infScroll.records : filteredData;
            pool.forEach(row => selectedRowIds.add(String(row._id)));
            renderTableBody();
        }

        function clearSelectedRows() {
            selectedRowIds.clear();
            renderTableBody();
        }

        function toggleSelectAllVisible(checked) {
            if (checked) {
                lastRenderedPageData.forEach(row => selectedRowIds.add(String(row._id)));
            } else {
                lastRenderedPageData.forEach(row => selectedRowIds.delete(String(row._id)));
            }
            renderTableBody();
        }

        function sortTable(col) {
            if (col === '_actions' || col === '_select') return;
            currentSort = currentSort.column === col
                ? { column: col, direction: currentSort.direction === 'asc' ? 'desc' : 'asc' }
                : { column: col, direction: 'asc' };

            document.querySelectorAll('#tableHeader th').forEach(th => {
                th.classList.remove('sorted-asc', 'sorted-desc');
                if (th.dataset.col === col) th.classList.add(currentSort.direction === 'asc' ? 'sorted-asc' : 'sorted-desc');
            });

            currentPage = 1;
            if (serverBrowseMode) {
                refreshServerBrowseData(1, true);
                return;
            }
            renderTableBody();
        }

        // ========== MODAL ==========
        function showTextModalById(id, key) {
            const rec = recordMap.get(String(id));
            if (!rec) return;
            const val = String(rec[key] || '');
            const titleMap = { _text: 'Full Text', _themes: 'Themes', _citation: 'Citation' };
            document.getElementById('modalTitle').textContent = titleMap[key] || 'Details';
            showTextModal(val);
        }

        function showTextModal(text) {
            modalTextCache = String(text || '');
            const searchState = parseSearchQuery(document.getElementById('tableSearch').value);
            document.getElementById('modalBody').innerHTML = highlightSearch(modalTextCache, searchState);
            document.getElementById('textModal').classList.remove('hidden');
        }

        function closeModal(e) {
            if (!e || e.target === document.getElementById('textModal')) {
                document.getElementById('textModal').classList.add('hidden');
            }
        }

        function copyModalText() {
            copyToClipboard(modalTextCache || '');
        }

        // ─── Record Detail Modal ────────────────────────────────
        function showRecordDetail(id) {
            const rec = recordMap.get(String(id));
            if (!rec) return;

            const body = (rec._body || '').replace(/^-+\s*/, '').trim();
            const country = (rec._countries || '').split('\n').map(s => s.replace(/^-+\s*/, '').trim()).filter(Boolean).join(', ');
            const type = (rec._type || '').replace(/^-+\s*/, '').trim();
            const year = rec._year ? String(rec._year) : '';
            const symbol = (rec._symbol || '').replace(/^-+\s*/, '').trim();
            const themes = (rec._themesArray || []).map(t => t.replace(/^-+\s*/, '').trim()).filter(Boolean);
            const affectedPersons = (rec._affectedPersonsArray || []).map(p => p.replace(/^-+\s*/, '').trim()).filter(Boolean);
            const sdgs = (rec._sdgsArray || []).map(s => s.replace(/^-+\s*/, '').trim()).filter(Boolean);
            const regions = (rec._regionsArray || []).map(r => r.replace(/^-+\s*/, '').trim()).filter(Boolean);
            const uhriUrl = getUhriUrl(rec);
            const unDocsUrl = getUnDocsUrl(rec);

            const field = (label, value) => value ? `<div class="record-detail-label">${label}</div><div class="record-detail-value">${escapeHtml(value)}</div>` : '';
            const fieldList = (label, arr) => arr.length ? `<div class="record-detail-label">${label}</div><div class="record-detail-value">${arr.map(v => escapeHtml(v)).join(', ')}</div>` : '';

            let html = '';
            // Full text
            html += `<div class="record-detail-text">${escapeHtml(rec._text || '')}</div>`;
            // Metadata grid
            html += '<div class="record-detail-grid">';
            html += field('Body', body);
            html += field('Country', country);
            html += field('Year', year);
            html += field('Type', type);
            html += field('Document', symbol);
            html += fieldList('Regions', regions);
            html += fieldList('Themes', themes);
            html += fieldList('Affected Persons', affectedPersons);
            html += fieldList('SDGs', sdgs);
            html += '</div>';
            // Actions
            html += '<div class="record-detail-actions">';
            if (uhriUrl) html += `<a href="${uhriUrl}" target="_blank" rel="noopener" class="detail-btn-uhri">View on UHRI</a>`;
            if (unDocsUrl) html += `<a href="${unDocsUrl}" target="_blank" rel="noopener" class="detail-btn-undocs">View UN Document</a>`;
            html += `<button class="detail-btn-cite" onclick="copyFormattedCitation(${id}, this)">Copy Citation</button>`;
            html += `<button class="detail-btn-copy" onclick="copyToClipboard(recordMap.get('${id}')?._text || ''); this.textContent='Copied!'; setTimeout(()=>this.textContent='Copy Text',1500)">Copy Text</button>`;
            html += '</div>';
            // Citation preview
            const citation = buildFormattedCitation(rec);
            html += `<div style="margin-top:12px; padding:10px 14px; background:#f5f5f5; border-radius:6px; font-size:12px; color:#555; line-height:1.5;">`;
            html += `<strong>Citation:</strong> ${escapeHtml(citation)}`;
            html += '</div>';

            document.getElementById('recordDetailTitle').textContent =
                `${body || 'Recommendation'}${country ? ' — ' + country : ''}${year ? ' (' + year + ')' : ''}`;
            document.getElementById('recordDetailBody').innerHTML = html;
            document.getElementById('recordDetailModal').classList.remove('hidden');
        }

        function closeRecordDetail(e) {
            if (!e || e.target === document.getElementById('recordDetailModal')) {
                document.getElementById('recordDetailModal').classList.add('hidden');
            }
        }

        function copyFormattedCitation(id, btn) {
            const rec = recordMap.get(String(id));
            if (!rec) return;
            const citation = buildFormattedCitation(rec);
            copyToClipboard(citation);
            if (btn) {
                const orig = btn.textContent;
                btn.textContent = 'Copied!';
                btn.classList.add('copied');
                setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
            }
        }

        async function copyToClipboard(text) {
            const val = String(text || '');
            if (!val) return;
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(val);
                return;
            }
            const ta = document.createElement('textarea');
            ta.value = val;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }

        function copyRecordField(id, key, btn) {
            const rec = recordMap.get(String(id));
            if (!rec) return;
            const value = String(rec[key] || '');
            if (!value.trim()) return;
            copyToClipboard(value)
                .then(() => flashCopyButton(btn, 'Copied'))
                .catch(() => flashCopyButton(btn, 'Error'));
        }

        function flashCopyButton(btn, text) {
            if (!btn) return;
            const old = btn.textContent;
            btn.textContent = text;
            setTimeout(() => { btn.textContent = old; }, 900);
        }

        // ========== EXPORTS ==========
        async function exportFilteredData() {
            if (serverBrowseMode) {
                try {
                    const params = buildServerQueryParams({
                        includePagination: false,
                        includeSort: false,
                        limit: serverState.analysisLimit || SERVER_ANALYSIS_EXPORT_LIMIT_DEFAULT
                    });
                    const payload = await fetchServerJson(
                        `${DATASET_EXPORT_URL}?${params.toString()}`,
                        'Unable to export the current server filter'
                    );
                    const rows = (payload.records || []).map((row, idx) => normalizeRecord(row, idx));
                    const exp = rows.map(r => ({
                        Countries: r._countries,
                        Body: r._body,
                        Year: r._year,
                        Type: r._type,
                        Themes: r._themes,
                        'Affected Persons': r._affectedPersons,
                        Regions: r._regions,
                        SDGs: r._sdgs,
                        'Predicted Labels': (r._predictedLabels || []).join(', '),
                        Symbol: r._symbol,
                        DocumentId: r._documentId,
                        Citation: r._citation,
                        Text: r._text
                    }));
                    const ws = XLSX.utils.json_to_sheet(exp);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, 'Filtered');
                    XLSX.writeFile(wb, 'filtered_server_subset.xlsx');
                } catch (err) {
                    alert(err?.message || String(err));
                }
                return;
            }

            const exp = filteredData.map(r => ({
                Countries: r._countries,
                Body: r._body,
                Year: r._year,
                Type: r._type,
                Themes: r._themes,
                'Affected Persons': r._affectedPersons,
                Regions: r._regions,
                SDGs: r._sdgs,
                'Predicted Labels': (r._predictedLabels || []).join(', '),
                Symbol: r._symbol,
                DocumentId: r._documentId,
                Citation: r._citation,
                Text: r._text
            }));
            const ws = XLSX.utils.json_to_sheet(exp);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Data');
            XLSX.writeFile(wb, 'filtered_data.xlsx');
        }

        // exportTableData() removed — was never called (dead code)

        function exportSelectedToExcel() {
            const selectedRecords = (serverBrowseMode ? serverState.records : filteredData)
                .filter(r => selectedRowIds.has(String(r._id)));
            if (!selectedRecords.length) {
                _showToast('No selected rows to export. Use "Select all" first.', 3000, '#c62828');
                return;
            }

            const hasAnyLabels = selectedRecords.some(r => r._predictedLabels && r._predictedLabels.length);
            const rows = selectedRecords.map(r => {
                const row = {
                    Country: getCellValue(r, '_countries'),
                    Year: getCellValue(r, '_year'),
                    Body: getCellValue(r, '_body'),
                    Type: getCellValue(r, '_type'),
                };
                if (hasAnyLabels) row['My Labels'] = (r._predictedLabels || []).join(', ');
                row.Themes = r._themes || '';
                row.Citation = r._citation || '';
                row.Text = r._text || '';
                row['UHRI Link'] = getUhriUrl(r);
                row['UN Doc Link'] = getUnDocsUrl(r);
                return row;
            });

            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Selected');
            _addFilterMetadataSheet(wb, rows.length);
            XLSX.writeFile(wb, 'selected_records.xlsx');
        }

        function getVisibleTableDataForExport() {
            const searchState = parseSearchQuery(document.getElementById('tableSearch').value);
            if (searchState.type === 'invalid') {
                throw new Error(`Invalid regex: ${searchState.error || ''}`);
            }
            if (serverBrowseMode) {
                return (_infScroll.records || []).slice(0, ROWS_PER_PAGE);
            }
            return Array.isArray(lastRenderedPageData) ? [...lastRenderedPageData] : [];
        }

        function exportAllToExcel() {
            let data;
            try {
                data = getVisibleTableDataForExport();
            } catch (err) {
                alert(err?.message || String(err));
                return;
            }
            if (!data.length) {
                _showToast('No visible rows to export.', 3000, '#c62828');
                return;
            }

            const hasAnyLabels = data.some(r => r._predictedLabels && r._predictedLabels.length);
            const rows = data.map(r => {
                const row = {
                    Country: getCellValue(r, '_countries'),
                    Year: getCellValue(r, '_year'),
                    Body: getCellValue(r, '_body'),
                    Type: getCellValue(r, '_type'),
                };
                if (hasAnyLabels) row['My Labels'] = (r._predictedLabels || []).join(', ');
                row.Themes = r._themes || '';
                row.Citation = r._citation || '';
                row.Text = r._text || '';
                row['UHRI Link'] = getUhriUrl(r);
                row['UN Doc Link'] = getUnDocsUrl(r);
                return row;
            });

            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'On-screen rows');
            _addFilterMetadataSheet(wb, rows.length);
            XLSX.writeFile(wb, 'visible_rows.xlsx');
        }

        // ========== UTILITIES ==========
        function escapeHtml(str) {
            return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        }

        function escapeJs(str) {
            return String(str).replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$/g,'\\$');
        }

        function _addFilterMetadataSheet(wb, recordCount) {
            const state = getServerFilterState();
            const totalDataset = serverBrowseMode ? (serverState.totalRecords || 0) : rawData.length;
            const meta = [
                ['Export Information'],
                ['Date', new Date().toISOString().slice(0, 16).replace('T', ' ')],
                ['Records exported', recordCount],
                ['Total in dataset', totalDataset],
                [''],
                ['Active Filters'],
                ['Text query', state.textQuery || '(none)'],
                ['Countries', (state.countries || []).join(', ') || '(all)'],
                ['Bodies', (state.bodies || []).join(', ') || '(all)'],
                ['Regions', (state.regions || []).join(', ') || '(all)'],
                ['Themes', (state.themes || []).join(', ') || '(all)'],
                ['Affected Persons', (state.affectedPersons || []).join(', ') || '(all)'],
                ['SDGs', (state.sdgs || []).join(', ') || '(all)'],
                ['Type', (state.annotationType || []).join(', ') || '(all)'],
                ['Year range', `${state.yearStart || '—'} to ${state.yearEnd || '—'}`],
                [''],
                ['Data source', 'OHCHR Universal Human Rights Index (uhri.ohchr.org)'],
                ['Dashboard', window.location.href],
            ];
            const ws = XLSX.utils.aoa_to_sheet(meta);
            ws['!cols'] = [{ wch: 20 }, { wch: 60 }];
            XLSX.utils.book_append_sheet(wb, ws, 'Filters');
        }

        // ========== WORKFLOW STEPPER & ACTIONS ==========
        function updateWorkflowStepper(activeStep) {
            for (let i = 1; i <= 3; i++) {
                const el = document.getElementById('wfStep' + i);
                if (!el) continue;
                el.classList.remove('wf-active', 'wf-done');
                if (i < activeStep) el.classList.add('wf-done');
                else if (i === activeStep) el.classList.add('wf-active');
            }
        }

        function isSyntheticRecord(record) {
            return record && (record._source === 'Rule of Law example' || (record._id >= 900000 && !record._countries && !record._year));
        }

        function _getLabelsForRecord(record) {
            // Check manual labels first, then auto-predicted
            const key = getSampleKey(record);
            const manual = trainingState.labeledSamples.get(key);
            if (manual) {
                const cleaned = sanitizeSampleLabels(manual).filter(l => !isExcludedCategory(l));
                if (cleaned.length) return { labels: cleaned.join(', '), source: 'manual' };
            }
            if (record._predictedLabels && record._predictedLabels.length) {
                return { labels: record._predictedLabels.join(', '), source: 'auto' };
            }
            return { labels: '', source: '' };
        }

        function _recordToRow(r) {
            const { labels, source } = _getLabelsForRecord(r);
            return {
                'My Labels': labels,
                Source: source,
                Country: r._countries || '',
                Year: r._year || '',
                Body: (r._body || '').replace(/^-\s*/, ''),
                Type: (r._type || '').replace(/^-\s*/, ''),
                Themes: r._themes || '',
                'Affected Persons': r._affectedPersons || '',
                Regions: r._regions || '',
                SDGs: r._sdgs || '',
                Citation: r._citation || '',
                Symbol: r._symbol || '',
                Text: r._text || '',
                'UHRI Link': typeof getUhriUrl === 'function' ? getUhriUrl(r) : '',
                'UN Doc Link': typeof getUnDocsUrl === 'function' ? getUnDocsUrl(r) : ''
            };
        }

        function exportClassifiedData() {
            // Export all filtered (or all) records with "My Labels" column.
            // Labeled records appear first so the user sees them at the top.
            const pool = filteredData.length ? filteredData : rawData;
            if (!pool.length) {
                _showToast('No records to export. Load a dataset first.', 3000, '#c62828');
                return;
            }

            const labeled = [];
            const unlabeled = [];

            pool.forEach(r => {
                if (isSyntheticRecord(r)) return;
                const row = _recordToRow(r);
                if (row['My Labels']) {
                    labeled.push(row);
                } else {
                    unlabeled.push(row);
                }
            });

            // Also include manually tagged samples that might not be in the current filtered pool
            const poolIds = new Set(pool.map(r => getSampleKey(r)));
            trainingState.labeledSamples.forEach((labels, sampleKey) => {
                if (poolIds.has(sampleKey)) return; // already included
                const cleaned = sanitizeSampleLabels(labels).filter(l => !isExcludedCategory(l));
                if (!cleaned.length) return;
                const record = recordMap.get(String(sampleKey))
                    || trainingState.samples.find(s => getSampleKey(s) === String(sampleKey));
                if (!record || isSyntheticRecord(record)) return;
                labeled.push(_recordToRow(record));
            });

            const rows = [...labeled, ...unlabeled];

            if (!rows.length) {
                _showToast('No records to export. Load a dataset first.', 3000, '#c62828');
                return;
            }

            const labeledCount = labeled.length;
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Records');
            const cats = (trainingState.categories || []).join('_').slice(0, 30).replace(/[^a-zA-Z0-9_]/g, '') || 'export';
            XLSX.writeFile(wb, `uhri_${cats}_${rows.length}records.xlsx`);

            if (labeledCount > 0) {
                alert(`Exported ${rows.length.toLocaleString()} records.\n\n${labeledCount} labeled records are at the top of the file.`);
            }
        }

        function goToMyLabelsTab() {
            closeTrainingPane();
            const labelsTab = document.querySelector('.tab[data-tab="labels"]');
            if (labelsTab) labelsTab.click();
        }

        // ========== TRAINING PANE ==========
        async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeoutMs);
            try {
                const resp = await fetch(url, { ...options, signal: ctrl.signal });
                return resp;
            } finally {
                clearTimeout(timer);
            }
        }

        function updateModelStorageControls() {
            const saveBtn = document.getElementById('modelSaveBtn');
            const storageHint = document.getElementById('modelStorageHint');
            if (!saveBtn || !storageHint) return;
            saveBtn.textContent = 'Save';
            storageHint.textContent = 'Trained TF-IDF and keyword models are saved in this browser\'s local storage.';
        }

        function setStepTitle(id, stepNum, text) {
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = `<span class="step-number">${stepNum}</span> ${escapeHtml(text)}`;
        }

        // updateTaskTypeUI() removed — empty dead code

        async function openTrainingPane() {
            document.getElementById('trainingPane').classList.add('open');
            ensureExcludedCategory();
            setClassifierMethodUI(trainingState.model?.method || trainingState.method || 'tfidf_centroid');
            setThresholdUI(trainingState.model?.threshold ?? getThresholdFromUI());
            renderCategories();
            updateLabelingUI();
            renderBenchmark(trainingState.benchmark);
            updateModelStorageControls();
            loadSavedModels();
            updateClassifyScopeInfo();
            // Set workflow step based on current state
            const hasLabels = (filteredData || rawData || []).some(r => r._predictedLabels && r._predictedLabels.length > 0);
            const hasCats = getStatisticsCategories(trainingState.categories).length > 0;
            updateWorkflowStepper(hasLabels ? 3 : hasCats ? 2 : 1);
            // Show the Offline & Private Mode notice when we don't have the full dataset
            // locally (rawData is small or empty) — labeling/training genuinely needs it.
            const offlineNotice = document.getElementById('labelingOfflineModeNotice');
            if (offlineNotice) {
                const fullDatasetLoaded = rawData && rawData.length >= 100000;
                offlineNotice.classList.toggle('hidden', fullDatasetLoaded);
            }
        }

        function closeTrainingPane() {
            document.getElementById('trainingPane').classList.remove('open');
        }

        function selectTaskType(type) {
            trainingState.taskType = type;
            // updateTaskTypeUI() call removed
        }

        function setClassifierMethodUI(method) {
            const sel = document.getElementById('classifierMethod');
            let normalized = classifierMethodMeta[method] ? method : 'tfidf_centroid';
            if (sel) sel.value = normalized;
            trainingState.method = normalized;
            const hint = document.getElementById('classifierMethodHint');
            if (hint) hint.textContent = classifierMethodMeta[normalized].hint;
            // Labeling section is always visible
            updateModelStorageControls();
        }

        function getClassifierMethodFromUI() {
            const sel = document.getElementById('classifierMethod');
            const value = sel?.value || trainingState.method || 'tfidf_centroid';
            return classifierMethodMeta[value] ? value : 'tfidf_centroid';
        }

        function onClassifierMethodChange() {
            const method = getClassifierMethodFromUI();
            setClassifierMethodUI(method);
            if (trainingState.model && trainingState.model.method !== method) {
                trainingState.model = null;
                trainingState.benchmark = null;
                renderBenchmark(null);
                document.getElementById('applyCurrentBtn').disabled = true;
                setThresholdUI(classifierMethodMeta[method]?.defaultThreshold || 0.50);
            } else if (!trainingState.model) {
                setThresholdUI(classifierMethodMeta[method]?.defaultThreshold || 0.50);
            }
            updateModelStorageControls();
        }

        function getSampleKey(sampleOrId) {
            if (sampleOrId && typeof sampleOrId === 'object') {
                return getRecordStableKey(sampleOrId) || String(sampleOrId._id);
            }
            return String(sampleOrId);
        }

        function getCurrentSample() {
            return trainingState.samples[trainingState.currentSampleIndex] || null;
        }

        function getCurrentSampleKey() {
            const sample = getCurrentSample();
            return sample ? getSampleKey(sample) : '';
        }

        function getSampleDisplayId(sample) {
            return sample?._sourceId || sample?._annotationId || sample?._documentId || sample?._id || '';
        }

        function isSampleExcluded(sampleOrId) {
            const key = getSampleKey(sampleOrId);
            const labels = trainingState.labeledSamples.get(key) || [];
            return labels.some(isExcludedCategory);
        }

        // Category Management
        function addCategory() {
            const input = document.getElementById('newCategoryInput');
            const name = input.value.trim();
            if (!name) return;
            if (isExcludedCategory(name)) {
                alert(`"${EXCLUDED_LABEL}" is managed automatically`);
                input.value = '';
                return;
            }
            if (getCategoryByNormalizedName(name)) {
                alert('Category already exists');
                return;
            }
            trainingState.categories.push(name);
            ensureExcludedCategory();
            input.value = '';
            renderCategories();
            updateLabelingUI();
            updateWorkflowStepper(2);
        }

        function removeCategory(name) {
            if (isExcludedCategory(name)) return;
            const normalized = normalizeLabelName(name);
            trainingState.categories = trainingState.categories.filter(c => normalizeLabelName(c) !== normalized);
            trainingState.labeledSamples.forEach((labels, sampleKey) => {
                const filtered = sanitizeSampleLabels(labels.filter(l => normalizeLabelName(l) !== normalized));
                trainingState.labeledSamples.set(sampleKey, filtered);
            });
            ensureExcludedCategory();
            renderCategories();
            updateLabelingUI();
        }

        function removeCategoryByIndex(idx) {
            const name = trainingState.categories[idx];
            if (!name) return;
            removeCategory(name);
        }

        function renderCategories() {
            ensureExcludedCategory();
            const list = document.getElementById('categoryList');
            if (trainingState.categories.length === 0) {
                list.innerHTML = '<p style="color: #666; font-size: 12px;">No categories added yet</p>';
                return;
            }
            list.innerHTML = trainingState.categories.map((c, idx) => `
                <div class="category-tag">
                    ${escapeHtml(c)}
                    ${isExcludedCategory(c)
                        ? '<span style="font-size:10px;color:#9e3b4a;font-weight:700;">SYSTEM</span>'
                        : `<button class="remove-cat" onclick="removeCategoryByIndex(${idx})">&times;</button>`
                    }
                </div>
            `).join('');
        }

        // Sample Management
        async function loadServerTrainingSamples(sampleSize = 20) {
            if (!DATASET_SAMPLE_URL) {
                throw new Error('VM training sample API is not configured.');
            }
            const params = buildServerQueryParams({ includePagination: false, includeSort: false });
            params.set('sample_size', String(sampleSize));
            const payload = await fetchServerJson(
                `${DATASET_SAMPLE_URL}?${params.toString()}`,
                'Unable to load records from the VM'
            );
            const sampleRecords = (payload.records || []).map((row, idx) => normalizeRecord(row, idx));
            registerRecords(sampleRecords);
            trainingState.samples = sampleRecords;
            trainingState.currentSampleIndex = 0;
            updateLabelingUI();
        }

        // ── Pre-loaded Rule of Law example ──
        const RULE_OF_LAW_EXAMPLE = {
            categories: ['Access to justice', 'Constitutional review', 'Equality and non-discrimination', 'Legal certainty', 'Legality', 'Prevention of abuse of power', 'Unrelated'],
            examples: [{"text":"44. The Committee urges the State party to repeal all legislation treating child victims as offenders rather than as victims and to ensure that sexual abuse against children, in particular child prostitution and child pornography, is criminalized and that perpetrators are duly prosecuted and punished with sanctions commensurate with the gravity of their crimes. To this end, the State party should also establish mechanisms, procedures and guidelines to ensure the mandatory reporting of cases of c","labels":["Access to justice","Equality and non-discrimination","Legality"]},{"text":"Human rights defenders, journalists and lawyers working on economic, social and cultural rights 11. The Committee recommends that the State party:  (a) Strengthen the protection of human rights defenders, journalists and lawyers working on economic,  social  and cultural human rights, as well as their family members, from any kind of threat, harassment, kidnapping, torture, enforced disappearance and killings;  (b) Ensure  that all violations, including by non-State actors, are promptly,  effect","labels":["Access to justice","Prevention of abuse of power"]},{"text":"Excessive use of force during the protests of spring 2021 and autumn 2022 8.The Committee notes with concern the recurrent allegations of excessive use of force against demonstrators during the period under review. It is concerned at the numerous allegations that, during the demonstrations that took place in the context of the presidential election and following the establishment of the transitional military council in April 2021, as well as in the context of the inclusive and sovereign national","labels":["Access to justice","Prevention of abuse of power"]},{"text":"State of emergency 13. The State party should take measures to:  (a) Ensure that any process of derogation from the Covenant complies with article 4 and, to that end, develop national guidelines on the implementation of a proclamation of state of emergency;   (b) Effectively investigate all allegations of human rights violations committed during the state of emergency of 2014 with a view to bringing perpetrators to justice and providing victims with effective remedies.","labels":["Access to justice","Legality"]},{"text":"Discrimination in employment  23.The Committee takes note of the 2015 annual report on discrimination, which refers to several specific measures for preventing discrimination and improving the conditions of access to employment of persons from minority groups. It is concerned, however, about the relatively high unemployment rate among ethnic minorities, particularly among young and female members of minority groups. The Committee notes with concern that highly educated young migrants have diffic","labels":["Equality and non-discrimination"]},{"text":"Access to justice for migrant workers   22.  Recalling its general recommendation No. 31, the Committee recommends that the State party:  (a) Eliminate all barriers in access to justice by ensuring that all foreign workers have access to independent and effective complaint mechanisms, without fear of acts of reprisal;  (b) Conduct awareness-raising activities regarding the respective rights and duties of workers and employers;  (c) Enforce existing protective policies and legislation for migrant","labels":["Access to justice","Equality and non-discrimination"]},{"text":"Torture, ill-treatment and prison conditions 34. The State party should: (a) Ensure that all allegations of torture and ill-treatment are investigated promptly, impartially and thoroughly, that the perpetrators are prosecuted and punished and that victims are provided with effective remedies;  (b) Review the Criminal Code to include torture as a criminal offence and conclude the ratification process for the Convention against Torture and Other Cruel, Inhuman or Degrading Treatment or Punishment ","labels":["Access to justice","Legality"]},{"text":"Forced sterilization 31.  The Committee reiterates its recommendation that the State party ensure that Roma women who were victims of sterilization without their informed consent have access to effective remedies and adequate compensation, and that perpetrators are brought to justice. It recommends that measures taken to address the issue of forced sterilization are developed in consultation with and with the participation of members of the Roma community. It also recommends that the State party","labels":["Access to justice","Equality and non-discrimination","Legality"]},{"text":"Prohibition of torture and other cruel, inhuman or degrading treatment or punishment 29. The State party should take all measures necessary to end the practice of torture and ill-treatment, in line with the Covenant and international standards. In particular, it should: (a) Urgently adopt anti-torture legislation and ensure that it contains a definition of torture compliant with international law;   (b) Conduct prompt, thorough, transparent and impartial investigations into all allegations of to","labels":["Access to justice","Legality"]},{"text":"Security crisis and state of siege 5. The Committee urges the State party to: (a)  Take all effective measures, without delay, to guarantee the enjoyment of the Covenant rights by persons living in the regions affected by armed conflict,  especially in the east of the country;  (b) Provide effective protection for the country \u2019 s internally displaced persons so as to ensure that they have access to adequate food, decent housing and basic services, including water supplies and sanitation, health ","labels":["Access to justice","Legality","Prevention of abuse of power"]},{"text":"Investigation and prosecution of acts of torture and ill-treatment 23. The State party should: (a) Carry out prompt, impartial and effective investigations into all allegations of torture and ill-treatment, including excessive use of force by law enforcement officials, and ensure that those suspected of having committed such acts  are immediately suspended from their duties throughout the period of investigation, while ensuring that the principle of presumption of innocence is observed;  (b) Pro","labels":["Access to justice","Prevention of abuse of power"]},{"text":"Non-discrimination 14.The Committee notes the information provided by the State party that it is reviewing the Prevention of Discrimination Act 1997. However, it remains concerned about the absence of comprehensive anti-discrimination legislation that extends beyond discrimination in employment, provides full and effective protection against all forms of discrimination prohibited under the Covenant, including direct, indirect and multiple discrimination, and contains a list of prohibited grounds","labels":["Equality and non-discrimination"]},{"text":"Sexual exploitation and abuse  34.The Committee welcomes the adoption in 2005 of the law on sexual aggression. It is seriously concerned, however, about the high number of cases of sexual exploitation and abuse of children, which has further increased following the 2010 earthquake with a significant number of cases affecting children in IDP camps. It also notes with concern that perpetrators frequently enjoy impunity or receive light sentences. Furthermore, the Committee is concerned about:  (a)","labels":["Access to justice","Equality and non-discrimination"]},{"text":"Women\u2019s access to justice 22. The Committee recommends that the State party: (a) Ensure that Legal Aid South Africa has adequate human, technical and financial resources to deliver on its mandate to provide adequate legal assistance free of charge to women without sufficient means;  (b) Ensure that all cases of gender-based violence against women, including sexual violence, are duly investigated, that perpetrators are prosecuted and adequately punished, and that victims have access to adequate r","labels":["Access to justice","Equality and non-discrimination"]},{"text":"41.The Committee is concerned about cases in which persons with disabilities, especially women, children, Afro-Hondurans and indigenous peoples, are victims of physical and/or psychological ill-treatment, sexual violence and/or exploitation and abuse, including exploitation for the purpose of begging, and that there are no measures for their protection, recovery or compensation. It is also concerned that such cases are not properly investigated and that the perpetrators therefore go unpunished.","labels":["Equality and non-discrimination"]},{"text":"Counter-terrorism measures \n 45. The State party should take all measures necessary to ensure that its counter \u2011 terrorism and national security legislation, policies and practices are fully in line with the Convention and that adequate and effective legal safeguards against torture and ill-treatment and arbitrary detention are in place. Furthermore, the State party should carry out prompt, impartial and effective investigations into all allegations of human rights violations, including acts of ","labels":["Access to justice","Legality","Prevention of abuse of power"]},{"text":"J.Special protection measures (arts. 22, 30, 32\u201333, 35\u201336, 37 (b)\u2013(d) and 38\u201340) 43. The Committee  welcomes the  national  action  plan to combat child labour  and the prohibition of  employment of children in domestic work, but  it  is deeply concerned a bou t the high number of children engaged in domestic work and hazardous work. Taking note of target 8.7 of the Sustainable Development Goals, the Committee recalls its previous recommendations and recommends that the State party: (a) Establis","labels":["Access to justice","Equality and non-discrimination","Legality"]},{"text":"Protection of persons who report or who participate in the investigation of enforced disappearance 39.The Committee notes the information provided during the dialogue that the Special Prosecutor\u2019s Office and the Special Tribunal for the Gambia will be responsible for making arrangements for the protection of victims and witnesses. However, it regrets the lack of existing mechanisms to protect complainants, witnesses, relatives of the disappeared person and their defence counsel, and all those pa","labels":["Access to justice"]},{"text":"Report on the visit of the Subcommittee on Prevention of Torture and Other Cruel, Inhuman or Degrading Treatment or Punishment to Kyrgyzstan*** 33.The SPT noted that the problem of impunity is further exacerbated in the south of the country, following the June 2010 events.","labels":["Access to justice","Prevention of abuse of power"]},{"text":"Prohibition of torture and other cruel, inhuman or degrading treatment or punishment 18.While noting that the Commission for Disciplinary Control of the Security Forces and Services conducts monitoring activities in places of detention and that detainees can bring their complaints to prison authorities, the Committee is concerned by the information provided by the delegation that there were no complaints of torture or ill-treatment of prisoners between 2011 and 2021. In this respect, it regrets ","labels":["Access to justice","Prevention of abuse of power"]},{"text":"Training 25.The Committee acknowledges the efforts made by the State party to develop and implement educational and training modules on human rights, including on the absolute prohibition of torture, for law enforcement officers, prison staff, judges, prosecutors, members of the armed forces and public defenders. However, it regrets the limited information on mandatory and in-service training on the Istanbul Protocol, as revised, and on mechanisms for evaluating the effectiveness of training pro","labels":["Access to justice","Legality","Prevention of abuse of power"]},{"text":"Economic exploitation, including child labour 41. The Committee reiterates its previous recommendations (CRC/C/MRT/CO/2, para. 76) and urges the State party to:  (a) Expeditiously adopt the draft legislation aimed at prohibiting the worst forms of child labour, ensuring that it is in line with the Convention, and allocate sufficient human, technical and financial resources for the implementation of laws and policies on child labour, including the National Action Plan for the Elimination of Child","labels":["Access to justice","Legality"]},{"text":"Elimination of slavery, servitude and trafficking in persons  33. The State party should further strengthen its efforts to effectively prevent and combat trafficking in persons, including children, by, inter alia:  (a) Ensuring effective identification of victims, including the screening of groups in vulnerable situations, such as migrants and asylum-seekers;  (b) Investigating all cases of trafficking promptly and thoroughly, and prosecuting suspected perpetrators under the applicable legislati","labels":["Access to justice","Equality and non-discrimination","Legality"]},{"text":"National human rights commission  33. The State party should take the necessary legislative and other measures to ensure, in law and in practice, the independence of the National Commission for Human Rights, so that it investigates promptly and impartially all allegations of torture and ill-treatment that it receives and reports on illegal detention and on complaints of torture in its annual reports.","labels":["Access to justice","Legality","Prevention of abuse of power"]},{"text":"Excessive use of force 22.While welcoming the information provided by the State party on human rights training for members of law enforcement and security forces, the Committee regrets the lack of information received on complaints filed, investigations and prosecutions undertaken, and convictions handed down for excessive use of force and unlawful killings by police and security forces, as well as the lack of information on compensation provided to victims or their families. The Committee is co","labels":["Access to justice","Legality","Prevention of abuse of power"]},{"text":"Gender-based violence against women and girls 29.The Committee welcomes the adoption of the national action plan to prevent violence against all women and girls for the period 2023\u20132028, the criminalization of marital rape, stricter sentencing policies and the establishment of a \u201cno-drop\u201d policy for prosecuting gender-based violence against women and girls. However, it notes with concern: (a)The high prevalence of gender-based violence against women and girls in the State Party, the continuing j","labels":["Equality and non-discrimination"]},{"text":"Elimination of slavery, servitude and trafficking in persons  25.The Committee welcomes the efforts taken by the State party to combat and prevent trafficking in persons, including the amendments in 2019 to the Prevention and Combating of Trafficking and Exploitation of Persons and Protection of Victims Law, which significantly raised the penalties for trafficking offences under the law, and the creation in 2016 of the National Referral Mechanism. However, it is concerned about the continued pre","labels":["Access to justice","Equality and non-discrimination"]},{"text":"Protection of persons who report an enforced disappearance and/or participate in the investigation 34.  The Committee recommends that the State party establish mechanisms, including a structured programme, to ensure that all the persons referred to in article 12 (1) of the Convention are effectively protected against all ill-treatment or intimidation as a consequence of the complaint or any evidence given.","labels":["Access to justice"]},{"text":"Violence against women 14.The Committee notes the measures taken by the State party to prevent and combat violence against women. It is nonetheless concerned by reports that violence against women and girls, including femicide and sexual violence, remains widespread in the country. Although it notes the progress, described during the dialogue, in investigating the 113 femicides committed since November 2020, the Committee is concerned at the low conviction rate in cases of violence against women","labels":["Equality and non-discrimination"]},{"text":"Gender-based violence against women 34. Recalling its general recommendation No.  35 (2017)  on gender-based violence against women, updating general recommendation No. 19, the Committee recommends that the State party: (a) Adopt legislation to ensure that all forms of gender-based violence against women, including domestic violence and online violence, are specifically criminalized, and take into account the special protection needs of disadvantaged and marginalized groups of women, including w","labels":["Access to justice","Equality and non-discrimination"]}]
        };

        // loadRuleOfLawExample() removed — was never called (dead code)

        function loadRuleOfLawCategories() {
            // Load categories
            trainingState.categories = [...RULE_OF_LAW_EXAMPLE.categories];
            ensureExcludedCategory();
            renderCategories();
            setClassifierMethodUI('tfidf_centroid');

            // Also load pre-labeled samples so users see how labeling works
            const samples = RULE_OF_LAW_EXAMPLE.examples.map((ex, i) => ({
                _id: 900000 + i,
                _text: ex.text,
                _countries: '',
                _body: '',
                _year: '',
                _type: '',
                _themes: '',
                _source: 'Rule of Law example'
            }));
            registerRecords(samples);
            trainingState.samples = samples;
            trainingState.currentSampleIndex = 0;

            for (let i = 0; i < RULE_OF_LAW_EXAMPLE.examples.length; i++) {
                const ex = RULE_OF_LAW_EXAMPLE.examples[i];
                const key = getSampleKey(samples[i]);
                trainingState.labeledSamples.set(key, [...ex.labels]);
            }

            updateLabelingUI();
            updateWorkflowStepper(2);
            updateLabeledExamplesInfo();

            alert('Rule of Law taxonomy loaded with ' + RULE_OF_LAW_EXAMPLE.examples.length + ' pre-labeled examples.\n\n' +
                'Browse the samples in Step 2 to see how labeling works, then go to Step 3 to classify or export.');
        }

        // ========== COMMUNITY TAXONOMY BROWSER ==========
        const TAXONOMY_REPO_BASE = 'https://raw.githubusercontent.com/lszoszk/uhri-taxonomies/main';
        const TAXONOMY_REPO_URL = 'https://github.com/lszoszk/uhri-taxonomies';
        let _communityTaxonomiesLoaded = false;

        async function loadCommunityTaxonomyList() {
            if (_communityTaxonomiesLoaded) return;
            const container = document.getElementById('communityTaxonomyList');
            try {
                const resp = await fetch(TAXONOMY_REPO_BASE + '/index.json');
                if (!resp.ok) throw new Error('Failed to fetch taxonomy index');
                const taxonomies = await resp.json();
                _communityTaxonomiesLoaded = true;

                if (!taxonomies.length) {
                    container.innerHTML = '<p style="color:#889; font-size:12px; text-align:center; padding:8px;">No community taxonomies available yet.</p>';
                    return;
                }

                container.innerHTML = taxonomies.map(t => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; margin-bottom:6px; background:#fff; border:1px solid #e0e3e8; border-radius:8px; cursor:pointer; transition:background 0.15s;" onmouseover="this.style.background='#f0f7ff'" onmouseout="this.style.background='#fff'" onclick="loadCommunityTaxonomy('${t.file}')">
                        <div>
                            <div style="font-weight:600; font-size:13px; color:#1a3a5c;">${t.name}</div>
                            <div style="font-size:11px; color:#667; margin-top:2px;">${t.description.slice(0, 100)}${t.description.length > 100 ? '...' : ''}</div>
                            <div style="font-size:10px; color:#99a; margin-top:3px;">by ${t.author} &middot; ${t.categories} categories &middot; ${t.examples} tagged examples</div>
                        </div>
                        <div style="color:#4a90d9; font-size:18px; flex-shrink:0; margin-left:12px;">&#8594;</div>
                    </div>
                `).join('');
            } catch (err) {
                console.error('Failed to load taxonomy list:', err);
                container.innerHTML = `
                    <div style="padding:10px; font-size:12px; color:#556;">
                        <p>Could not load community taxonomies from GitHub.</p>
                        <button class="btn btn-secondary" onclick="loadRuleOfLawCategories()" style="padding:6px 14px; font-size:11px; margin-top:4px;">
                            Load built-in "Rule of Law" taxonomy instead
                        </button>
                    </div>`;
            }
        }

        async function loadCommunityTaxonomy(file) {
            try {
                const resp = await fetch(TAXONOMY_REPO_BASE + '/' + file);
                if (!resp.ok) throw new Error('Failed to fetch taxonomy');
                const taxonomy = await resp.json();

                // Load categories
                trainingState.categories = [...taxonomy.categories];
                ensureExcludedCategory();
                renderCategories();
                setClassifierMethodUI('tfidf_centroid');

                // Load tagged examples as samples
                if (taxonomy.examples && taxonomy.examples.length > 0) {
                    const samples = taxonomy.examples.map((ex, i) => ({
                        _id: 800000 + i,
                        _text: ex.text,
                        _countries: '',
                        _body: '',
                        _year: '',
                        _type: '',
                        _themes: '',
                        _source: taxonomy.name
                    }));
                    registerRecords(samples);
                    trainingState.samples = samples;
                    trainingState.currentSampleIndex = 0;

                    for (let i = 0; i < taxonomy.examples.length; i++) {
                        const ex = taxonomy.examples[i];
                        const key = getSampleKey(samples[i]);
                        trainingState.labeledSamples.set(key, [...ex.labels]);
                    }
                }

                updateLabelingUI();
                updateWorkflowStepper(taxonomy.examples?.length ? 2 : 1);
                updateLabeledExamplesInfo();

                // Close the details
                document.getElementById('communityTaxonomyDetails').removeAttribute('open');

                alert(`"${taxonomy.name}" loaded with ${taxonomy.categories.length} categories` +
                    (taxonomy.examples?.length ? ` and ${taxonomy.examples.length} tagged examples.` : '.') +
                    '\n\nBrowse the samples in Step 2, then go to Step 3 to export or auto-tag.');
            } catch (err) {
                alert('Failed to load taxonomy: ' + err.message);
            }
        }

        function exportTaxonomyJSON() {
            const categories = getStatisticsCategories(trainingState.categories);
            if (categories.length < 1) {
                alert('Add at least one category first.');
                return;
            }

            const examples = collectLabeledExamples();
            const taxonomy = {
                id: categories.join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50),
                name: prompt('Name for this taxonomy:', categories.slice(0, 3).join(', ') + (categories.length > 3 ? '...' : '')) || 'My Taxonomy',
                author: prompt('Your name or organization:', '') || 'Anonymous',
                description: prompt('Brief description (what topics does this cover?):', '') || '',
                license: 'CC BY 4.0',
                categories: categories,
                examples: examples.map(ex => ({ text: ex.text, labels: ex.labels }))
            };

            const blob = new Blob([JSON.stringify(taxonomy, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `taxonomy-${taxonomy.id}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }

        function openTaxonomySubmission() {
            window.open(TAXONOMY_REPO_URL + '/issues/new?template=new-taxonomy.md&title=' +
                encodeURIComponent('[Taxonomy] ' + (trainingState.categories.slice(0, 3).join(', '))),
                '_blank');
        }

        function getSampleCountFromUI() {
            const input = document.getElementById('sampleCountInput');
            const val = parseInt(input?.value, 10);
            if (!val || val < 1) return 20;
            return Math.max(5, Math.min(200, val));
        }

        function getCategoryCounts() {
            const counts = {};
            trainingState.categories.forEach(c => counts[c] = 0);
            trainingState.labeledSamples.forEach((labels) => {
                labels.forEach(l => {
                    if (counts[l] !== undefined) counts[l]++;
                });
            });
            return counts;
        }

        function getCategorySaturationColor(count) {
            // 0 = not started, 1-4 = low, 5-9 = medium, 10+ = good
            if (count === 0) return '';
            if (count < 5) return 'rgba(255, 152, 0, 0.12)';  // orange tint
            if (count < 10) return 'rgba(33, 150, 243, 0.12)'; // blue tint
            return 'rgba(76, 175, 80, 0.12)';                   // green tint
        }

        function getCategorySaturationBorder(count) {
            if (count === 0) return '';
            if (count < 5) return '#ff9800';
            if (count < 10) return '#2196f3';
            return '#4caf50';
        }

        function resetAllSamples() {
            if (trainingState.labeledSamples.size > 0 &&
                !confirm('This will remove all ' + trainingState.samples.length + ' samples and ' + trainingState.labeledSamples.size + ' tags. Continue?')) {
                return;
            }
            trainingState.samples = [];
            trainingState.labeledSamples.clear();
            trainingState.currentSampleIndex = 0;
            updateLabelingUI();
            updateLabeledExamplesInfo();
            updateWorkflowStepper(1);
        }

        // Smart sample loader: uses active learning if model exists, random otherwise
        function _loadSamples() {
            if (trainingState.nbModel) {
                getUncertainSamples();
                document.getElementById('getRecordsMainBtn').innerHTML = '🎯 Get Records';
            } else {
                getRandomSamples();
            }
        }

        function _updateTagCountHint() {
            const el = document.getElementById('tagCountHint');
            if (!el) return;
            const labeled = trainingState.labeledSamples.size;
            const excluded = [...trainingState.labeledSamples.values()].filter(l => l.some(isExcludedCategory)).length;
            if (labeled === 0) { el.textContent = ''; return; }
            el.textContent = `${labeled} tagged${excluded ? ` · ${excluded} excluded` : ''}`;
        }

        function getUncertainSamples() {
            if (!trainingState.nbModel) {
                alert('Train a model first (Step 3 → Train Model), then come back here to get smart suggestions.');
                return;
            }
            const requestedCount = getSampleCountFromUI();
            const pool = (filteredData.length ? filteredData : rawData).filter(r => r._text);
            const labeledKeys = new Set(trainingState.labeledSamples.keys());

            // Score all unlabeled records by uncertainty
            const scored = [];
            for (const r of pool) {
                const key = getSampleKey(r);
                if (labeledKeys.has(key)) continue;
                const uncertainty = trainingState.nbModel.getUncertainty(r._text);
                scored.push({ record: r, uncertainty });
            }
            scored.sort((a, b) => b.uncertainty - a.uncertainty);

            const samples = scored.slice(0, requestedCount).map(s => s.record);
            if (!samples.length) {
                alert('No unlabeled records found. All records have been labeled or no data is loaded.');
                return;
            }

            trainingState.samples = samples;
            trainingState.currentSampleIndex = 0;
            trainingState._uncertaintyScores = scored.slice(0, requestedCount).map(s => s.uncertainty);
            updateLabelingUI();
            updateLabeledInfo();
        }

        async function getRandomSamples() {
            const requestedCount = getSampleCountFromUI();

            if (serverBrowseMode && !rawData.length) {
                try {
                    await loadServerTrainingSamples(requestedCount);
                    return;
                } catch (err) {
                    console.error('Server training sample load failed:', err);
                    alert('Failed to load a random training sample from the VM.\n\n' + (err?.message || err));
                    return;
                }
            }

            const pool = rawData.length ? rawData : serverState.records;
            if (!pool.length) {
                trainingState.samples = [];
                trainingState.currentSampleIndex = 0;
                updateLabelingUI();
                return;
            }
            // Collect IDs of already-loaded samples to avoid duplicates
            const existingIds = new Set(trainingState.samples.map(s => s._id));
            const sampleSize = Math.min(requestedCount, pool.length);
            const candidates = [];
            const maxAttempts = sampleSize * 10;
            let attempts = 0;
            while (candidates.length < sampleSize && attempts < maxAttempts) {
                const idx = Math.floor(Math.random() * pool.length);
                const record = pool[idx];
                if (!existingIds.has(record._id)) {
                    candidates.push(record);
                    existingIds.add(record._id);
                }
                attempts++;
            }
            // Append new samples to existing ones
            trainingState.samples = trainingState.samples.concat(candidates);
            trainingState.currentSampleIndex = trainingState.samples.length - candidates.length;
            registerRecords(candidates);
            updateLabelingUI();
            updateWorkflowStepper(2);
        }

        function prevSample() {
            if (trainingState.currentSampleIndex > 0) {
                trainingState.currentSampleIndex--;
                updateLabelingUI();
            }
        }

        function nextSample() {
            if (trainingState.currentSampleIndex < trainingState.samples.length - 1) {
                trainingState.currentSampleIndex++;
                updateLabelingUI();
            }
        }

        function toggleLabel(sampleId, label) {
            const key = getSampleKey(sampleId);
            const labels = sanitizeSampleLabels(trainingState.labeledSamples.get(key) || []);
            const isExcluded = isExcludedCategory(label);
            const idx = labels.indexOf(label);
            if (idx >= 0) {
                labels.splice(idx, 1);
            } else if (isExcluded) {
                labels.splice(0, labels.length, EXCLUDED_LABEL);
            } else {
                const nonExcluded = labels.filter(l => !isExcludedCategory(l));
                nonExcluded.push(label);
                labels.splice(0, labels.length, ...nonExcluded);
            }
            trainingState.labeledSamples.set(key, sanitizeSampleLabels(labels));
            refreshBenchmarkForCurrentModel().catch(err => {
                console.error('Benchmark refresh error:', err);
            });
            updateLabelingUI();
            updateLabeledExamplesInfo();
        }

        function toggleSampleTextExpand(link) {
            const box = document.getElementById('sampleTextBox');
            if (!box) return;
            box.classList.toggle('expanded');
            link.textContent = box.classList.contains('expanded') ? 'Collapse' : 'Show full text';
        }

        function toggleCurrentSampleLabel(categoryIndex) {
            const sample = getCurrentSample();
            const label = trainingState.categories[categoryIndex];
            if (!sample || !label) return;
            toggleLabel(sample, label);
        }

        function clearCurrentSampleLabels() {
            const key = getCurrentSampleKey();
            if (!key) return;
            trainingState.labeledSamples.set(key, []);
            updateLabelingUI();
            updateLabeledExamplesInfo();
        }

        function toggleExcludeCurrentSample() {
            const key = getCurrentSampleKey();
            if (!key) return;
            const labels = sanitizeSampleLabels(trainingState.labeledSamples.get(key) || []);
            if (labels.some(isExcludedCategory)) {
                trainingState.labeledSamples.set(key, labels.filter(l => !isExcludedCategory(l)));
            } else {
                trainingState.labeledSamples.set(key, [EXCLUDED_LABEL]);
            }
            refreshBenchmarkForCurrentModel().catch(err => {
                console.error('Benchmark refresh error:', err);
            });
            updateLabelingUI();
            updateLabeledExamplesInfo();
        }

        function updateLabelingUI() {
            const container = document.getElementById('sampleContainer');
            const sample = getCurrentSample();

            if (!sample) {
                container.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">Click "Get Random Records" above to start tagging</p>';
                document.getElementById('labeledCount').textContent = '0';
                document.getElementById('totalSamples').textContent = '0';
                document.getElementById('excludedCount').textContent = '0';
                return;
            }

            const sampleKey = getSampleKey(sample);
            const sampleLabels = sanitizeSampleLabels(trainingState.labeledSamples.get(sampleKey) || []);
            const predictedLabels = sample._predictedLabels || [];
            const isExcluded = isSampleExcluded(sample);
            const activeLabels = sampleLabels.filter(l => !isExcludedCategory(l));
            const isLabeled = activeLabels.length > 0;
            const displayId = getSampleDisplayId(sample);
            const sampleStatusText = isExcluded
                ? 'Marked as excluded (used for training, ignored in stats)'
                : `${isLabeled ? '✓ Labeled' : 'Not labeled'} • Selected for this sample: ${activeLabels.length}`;
            const sampleStatusColor = isExcluded ? '#a1293d' : (isLabeled ? 'var(--success)' : '#5c6775');
            const cardClass = `sample-card${isLabeled ? ' labeled' : ''}${isExcluded ? ' excluded' : ''}`;

            container.innerHTML = `
                <div class="${cardClass}">
                    <div class="sample-header">
                        <span class="sample-id">Sample #${trainingState.currentSampleIndex + 1} (ID: ${escapeHtml(String(displayId))})</span>
                        <span class="sample-status" style="color: ${sampleStatusColor};">${sampleStatusText}</span>
                        ${trainingState._uncertaintyScores && trainingState._uncertaintyScores[trainingState.currentSampleIndex] !== undefined
                            ? `<span style="font-size:11px; color:#c77800; background:#fff8e1; padding:2px 8px; border-radius:10px;">🎯 Model confidence: ${((1 - trainingState._uncertaintyScores[trainingState.currentSampleIndex]) * 100).toFixed(0)}% — your label helps the most here</span>`
                            : ''}
                    </div>
                    <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
                        <button type="button" class="sample-exclude-btn ${isExcluded ? 'active' : ''}" onclick="toggleExcludeCurrentSample()">
                            ${isExcluded ? '↩ Remove excluded label' : '🚫 Mark as excluded'}
                        </button>
                    </div>
                    <div class="sample-text" id="sampleTextBox">${escapeHtml(sample._text || '')}</div>
                    <a href="javascript:void(0)" id="sampleTextExpandLink" onclick="toggleSampleTextExpand(this)" style="font-size:11px;color:var(--primary);margin-bottom:8px;display:none;">Show full text</a>
                    ${predictedLabels.length
                        ? `<div style="font-size: 11px; color: #415067; margin-bottom: 10px;">Model suggestion: ${predictedLabels.map(l => `<span class=\"pred-badge\">${escapeHtml(l)}</span>`).join(' ')}</div>`
                        : ''
                    }
                    ${isExcluded ? '<div style="font-size:11px;color:#9e3b4a;margin-bottom:10px;">This item is used to train the special <code>excluded</code> category and ignored in statistics.</div>' : ''}
                    <div class="sample-labels">
                        ${(() => {
                            if (!trainingState.categories.length) return '<p style="color: #666; font-size: 12px;">Add categories first (Step 1)</p>';
                            const counts = getCategoryCounts();
                            return trainingState.categories.map((cat, idx) => {
                                const count = counts[cat] || 0;
                                const isChecked = sampleLabels.includes(cat);
                                const isExcl = isExcludedCategory(cat);
                                const satBg = !isChecked && !isExcl ? getCategorySaturationColor(count) : '';
                                const satBorder = !isChecked && !isExcl ? getCategorySaturationBorder(count) : '';
                                const badge = !isExcl && count > 0 ? `<span style="font-size:9px;opacity:0.7;margin-left:3px;">(${count})</span>` : '';
                                const style = satBg ? `background:${satBg};${satBorder ? 'border-color:' + satBorder + ';' : ''}` : '';
                                return `<button type="button"
                                    class="label-checkbox ${isChecked ? 'checked' : ''}"
                                    onclick="toggleCurrentSampleLabel(${idx})"
                                    ${style ? 'style="' + style + '"' : ''}
                                    aria-pressed="${isChecked ? 'true' : 'false'}">
                                    ${escapeHtml(cat)}${badge}
                                </button>`;
                            }).join('');
                        })()}
                    </div>
                </div>
            `;

            document.getElementById('prevSampleBtn').disabled = trainingState.currentSampleIndex === 0;
            document.getElementById('nextSampleBtn').disabled = trainingState.currentSampleIndex >= trainingState.samples.length - 1;

            const totalSamples = trainingState.samples.length;
            const labeledCount = trainingState.samples.filter(s => {
                const labels = sanitizeSampleLabels(trainingState.labeledSamples.get(getSampleKey(s)) || []);
                return labels.some(l => !isExcludedCategory(l));
            }).length;
            const excludedCount = trainingState.samples.filter(s => isSampleExcluded(s)).length;

            document.getElementById('labeledCount').textContent = labeledCount;
            document.getElementById('totalSamples').textContent = totalSamples;
            document.getElementById('excludedCount').textContent = excludedCount;
            _updateTagCountHint();

            // Show expand link only if text actually overflows
            const textBox = document.getElementById('sampleTextBox');
            const expandLink = document.getElementById('sampleTextExpandLink');
            if (textBox && expandLink) {
                if (textBox.scrollHeight > textBox.clientHeight + 2) {
                    expandLink.style.display = 'inline-block';
                } else {
                    expandLink.style.display = 'none';
                }
            }
        }

        // ========== CLASSIFIER METHODS ==========
        function normalizeClassifierText(text) {
            return String(text || '').toLowerCase();
        }

        function tokenizeWords(text) {
            const tokens = normalizeClassifierText(text).match(/[a-z0-9]+/g) || [];
            return tokens.filter(w => w.length > 2 && w.length < 30 && !stopwordSet.has(w));
        }

        function tokenizeCharNgrams(text, minN = 3, maxN = 5) {
            const clean = normalizeClassifierText(text)
                .replace(/[^a-z0-9\s]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (!clean) return [];
            const padded = ` ${clean} `;
            const grams = [];
            for (let n = minN; n <= maxN; n++) {
                for (let i = 0; i <= padded.length - n; i++) {
                    const gram = padded.slice(i, i + n);
                    if (gram.trim().length >= Math.max(2, n - 1)) grams.push(gram);
                }
            }
            return grams;
        }

        function getTokenizerForMethod(method) {
            if (method === 'char_ngram_centroid') {
                return (txt) => tokenizeCharNgrams(txt, 3, 5);
            }
            return tokenizeWords;
        }

        function computeTfIdf(documents, tokenizer = tokenizeWords) {
            const df = {};
            const tfs = [];

            documents.forEach(doc => {
                const tokens = tokenizer(doc);
                const tf = {};
                const seen = new Set();

                tokens.forEach(t => {
                    tf[t] = (tf[t] || 0) + 1;
                    if (!seen.has(t)) {
                        df[t] = (df[t] || 0) + 1;
                        seen.add(t);
                    }
                });

                const total = tokens.length || 1;
                Object.keys(tf).forEach(t => tf[t] /= total);
                tfs.push(tf);
            });

            const n = documents.length;
            const idf = {};
            Object.keys(df).forEach(t => {
                idf[t] = Math.log((n + 1) / (df[t] + 1)) + 1;
            });

            const vectors = tfs.map(tf => {
                const vec = {};
                Object.keys(tf).forEach(t => {
                    vec[t] = tf[t] * (idf[t] || 1);
                });
                return vec;
            });

            return { vectors, idf, vocabulary: Object.keys(idf) };
        }

        function buildCategoryCentroids(vectors, labelsByDoc, categories) {
            const categoryVectors = {};
            categories.forEach(cat => {
                const catVecs = vectors.filter((v, i) => labelsByDoc[i].includes(cat));
                if (!catVecs.length) return;
                const centroid = {};
                const keys = new Set(catVecs.flatMap(v => Object.keys(v)));
                keys.forEach(k => {
                    centroid[k] = catVecs.reduce((sum, v) => sum + (v[k] || 0), 0) / catVecs.length;
                });
                categoryVectors[cat] = centroid;
            });
            return categoryVectors;
        }

        function buildKeywordProfiles(documents, labelsByDoc, categories) {
            const tokenized = documents.map(d => tokenizeWords(d));
            const df = {};
            tokenized.forEach(tokens => {
                const unique = new Set(tokens);
                unique.forEach(t => { df[t] = (df[t] || 0) + 1; });
            });
            const nDocs = documents.length || 1;

            const catTokenCounts = {};
            const catTokenTotals = {};
            categories.forEach(cat => {
                catTokenCounts[cat] = {};
                catTokenTotals[cat] = 0;
            });

            tokenized.forEach((tokens, i) => {
                const tf = {};
                tokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
                labelsByDoc[i].forEach(cat => {
                    if (!catTokenCounts[cat]) return;
                    Object.entries(tf).forEach(([tok, cnt]) => {
                        catTokenCounts[cat][tok] = (catTokenCounts[cat][tok] || 0) + cnt;
                        catTokenTotals[cat] += cnt;
                    });
                });
            });

            const profiles = {};
            categories.forEach(cat => {
                const counts = catTokenCounts[cat] || {};
                const total = catTokenTotals[cat] || 1;
                const weighted = Object.entries(counts).map(([tok, cnt]) => {
                    const idf = Math.log((nDocs + 1) / ((df[tok] || 0) + 1)) + 1;
                    return [tok, (cnt / total) * idf];
                }).sort((a, b) => b[1] - a[1]).slice(0, 120);
                const weights = {};
                let totalWeight = 0;
                weighted.forEach(([tok, w]) => {
                    weights[tok] = w;
                    totalWeight += w;
                });
                profiles[cat] = { weights, totalWeight };
            });

            return profiles;
        }

        function cosineSimilarity(vec1, vec2) {
            const keys = new Set([...Object.keys(vec1), ...Object.keys(vec2)]);
            let dot = 0, norm1 = 0, norm2 = 0;

            keys.forEach(k => {
                const v1 = vec1[k] || 0;
                const v2 = vec2[k] || 0;
                dot += v1 * v2;
                norm1 += v1 * v1;
                norm2 += v2 * v2;
            });

            const denom = Math.sqrt(norm1) * Math.sqrt(norm2);
            return denom > 0 ? dot / denom : 0;
        }

        function textToVector(text, idf, tokenizer = tokenizeWords) {
            const tokens = tokenizer(text);
            const tf = {};
            tokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
            const total = tokens.length || 1;

            const vec = {};
            Object.keys(tf).forEach(t => {
                vec[t] = (tf[t] / total) * (idf[t] || 1);
            });
            return vec;
        }

        function predictWithCentroids(text, model) {
            const tokenizer = getTokenizerForMethod(model.method);
            const vec = textToVector(text, model.idf || {}, tokenizer);
            const predictions = [];

            Object.entries(model.categoryVectors || {}).forEach(([cat, catVec]) => {
                const sim = cosineSimilarity(vec, catVec);
                if (sim >= model.threshold) predictions.push({ cat, score: sim });
            });

            predictions.sort((a, b) => b.score - a.score);
            return predictions.slice(0, 3).map(p => p.cat);
        }

        function predictWithKeywordOverlap(text, model) {
            const tokenSet = new Set(tokenizeWords(text));
            const predictions = [];

            Object.entries(model.keywordProfiles || {}).forEach(([cat, profile]) => {
                const weights = profile?.weights || {};
                const totalWeight = profile?.totalWeight || 1;
                let overlap = 0;
                Object.entries(weights).forEach(([tok, weight]) => {
                    if (tokenSet.has(tok)) overlap += weight;
                });
                const score = overlap / totalWeight;
                if (score >= model.threshold) predictions.push({ cat, score });
            });

            predictions.sort((a, b) => b.score - a.score);
            return predictions.slice(0, 3).map(p => p.cat);
        }

        // ========== RANDOM FOREST CLASSIFIER ==========
        // Pure JS implementation: one-vs-rest binary forests over TF-IDF features.

        function rfBootstrapIndices(n) {
            const idx = new Array(n);
            for (let i = 0; i < n; i++) idx[i] = Math.floor(Math.random() * n);
            return idx;
        }

        function rfGini(y, indices) {
            if (!indices.length) return 0;
            let pos = 0;
            for (let i = 0; i < indices.length; i++) if (y[indices[i]] === 1) pos++;
            const p = pos / indices.length;
            return 1 - p * p - (1 - p) * (1 - p);
        }

        function rfBuildTree(X, y, indices, nFeatures, maxDepth, minLeaf, depth) {
            if (depth >= maxDepth || indices.length <= minLeaf) {
                let pos = 0;
                for (let i = 0; i < indices.length; i++) if (y[indices[i]] === 1) pos++;
                return { p: indices.length ? pos / indices.length : 0 };
            }
            const giniParent = rfGini(y, indices);
            if (giniParent === 0) {
                return { p: y[indices[0]] };
            }

            // Random feature subset: sqrt(nFeatures)
            const m = Math.max(1, Math.floor(Math.sqrt(nFeatures)));
            const pool = [];
            for (let i = 0; i < nFeatures; i++) pool.push(i);
            const subset = [];
            for (let i = 0; i < m && pool.length; i++) {
                const r = Math.floor(Math.random() * pool.length);
                subset.push(pool[r]);
                pool[r] = pool[pool.length - 1];
                pool.pop();
            }

            let bestF = -1, bestT = 0, bestGain = 0, bestL = null, bestR = null;

            for (const f of subset) {
                // Collect unique sorted values for this feature
                const vals = new Set();
                for (const i of indices) vals.add(X[i][f]);
                const sorted = [...vals].sort((a, b) => a - b);

                for (let v = 0; v < sorted.length - 1; v++) {
                    const thresh = (sorted[v] + sorted[v + 1]) / 2;
                    const left = [], right = [];
                    for (const i of indices) {
                        if (X[i][f] <= thresh) left.push(i); else right.push(i);
                    }
                    if (left.length < minLeaf || right.length < minLeaf) continue;
                    const gain = giniParent
                        - (left.length / indices.length) * rfGini(y, left)
                        - (right.length / indices.length) * rfGini(y, right);
                    if (gain > bestGain) {
                        bestGain = gain; bestF = f; bestT = thresh;
                        bestL = left; bestR = right;
                    }
                }
            }

            if (bestF === -1) {
                let pos = 0;
                for (const i of indices) if (y[i] === 1) pos++;
                return { p: pos / indices.length };
            }

            return {
                f: bestF, t: bestT,
                l: rfBuildTree(X, y, bestL, nFeatures, maxDepth, minLeaf, depth + 1),
                r: rfBuildTree(X, y, bestR, nFeatures, maxDepth, minLeaf, depth + 1)
            };
        }

        function rfPredictTree(tree, x) {
            if ('p' in tree && !('f' in tree)) return tree.p;
            return x[tree.f] <= tree.t ? rfPredictTree(tree.l, x) : rfPredictTree(tree.r, x);
        }

        function buildRandomForest(vectors, labelsByDoc, categories, idf) {
            const nTrees = 80;
            const maxDepth = 10;
            const minLeaf = 1;

            // Collect all feature terms, rank by variance, keep top 500
            const allKeys = new Set();
            vectors.forEach(v => Object.keys(v).forEach(k => allKeys.add(k)));
            const featureList = [...allKeys];
            const maxF = Math.min(featureList.length, 500);
            const variances = featureList.map(f => {
                let sum = 0, sum2 = 0;
                for (const v of vectors) { const val = v[f] || 0; sum += val; sum2 += val * val; }
                const mean = sum / vectors.length;
                return { f, v: sum2 / vectors.length - mean * mean };
            });
            variances.sort((a, b) => b.v - a.v);
            const features = variances.slice(0, maxF).map(x => x.f);

            // Dense matrix
            const X = vectors.map(v => features.map(f => v[f] || 0));
            const n = X.length;

            const forests = {};
            const statsCategories = getStatisticsCategories(categories);
            statsCategories.forEach(cat => {
                const y = labelsByDoc.map(labels => labels.includes(cat) ? 1 : 0);
                if (!y.some(v => v === 1)) return;
                const trees = [];
                for (let t = 0; t < nTrees; t++) {
                    const idx = rfBootstrapIndices(n);
                    trees.push(rfBuildTree(X, y, idx, features.length, maxDepth, minLeaf, 0));
                }
                forests[cat] = trees;
            });

            return { forests, features };
        }

        function predictWithRandomForest(text, model) {
            const tokenizer = getTokenizerForMethod(model.method);
            const tokens = tokenizer(text);
            const tf = {};
            tokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
            const total = tokens.length || 1;
            Object.keys(tf).forEach(t => { tf[t] /= total; });

            const features = model.rfFeatures || [];
            const idf = model.idf || {};
            const x = features.map(f => (tf[f] || 0) * (idf[f] || 1));

            const predictions = [];
            Object.entries(model.rfForests || {}).forEach(([cat, trees]) => {
                let sum = 0;
                for (const tree of trees) sum += rfPredictTree(tree, x);
                const prob = sum / trees.length;
                if (prob >= model.threshold) predictions.push({ cat, score: prob });
            });

            predictions.sort((a, b) => b.score - a.score);
            return predictions.slice(0, 3).map(p => p.cat);
        }

        // ── Online Naive Bayes Classifier ──
        // Learns incrementally from each correction — no retrain needed.
        // Multinomial NB with Laplace smoothing over word counts.
        function NaiveBayesOnline(categories) {
            this.cats = categories.filter(c => !isExcludedCategory(c));
            this.wordCounts = {};   // { cat: { word: count } }
            this.catCounts = {};    // { cat: totalWords }
            this.docCounts = {};    // { cat: numDocs }
            this.vocab = new Set();
            this.totalDocs = 0;
            this.cats.forEach(c => { this.wordCounts[c] = {}; this.catCounts[c] = 0; this.docCounts[c] = 0; });
        }

        NaiveBayesOnline.prototype._tokenize = function(text) {
            return String(text || '').toLowerCase().replace(/[^a-z0-9\u00C0-\u024F]+/g, ' ').trim().split(/\s+/).filter(w => w.length > 2);
        };

        NaiveBayesOnline.prototype.train = function(text, category) {
            if (!this.wordCounts[category]) { this.wordCounts[category] = {}; this.catCounts[category] = 0; this.docCounts[category] = 0; }
            const words = this._tokenize(text);
            words.forEach(w => {
                this.vocab.add(w);
                this.wordCounts[category][w] = (this.wordCounts[category][w] || 0) + 1;
                this.catCounts[category]++;
            });
            this.docCounts[category]++;
            this.totalDocs++;
        };

        NaiveBayesOnline.prototype.untrain = function(text, category) {
            if (!this.wordCounts[category]) return;
            const words = this._tokenize(text);
            words.forEach(w => {
                if (this.wordCounts[category][w]) {
                    this.wordCounts[category][w]--;
                    this.catCounts[category]--;
                    if (this.wordCounts[category][w] <= 0) delete this.wordCounts[category][w];
                }
            });
            if (this.docCounts[category] > 0) this.docCounts[category]--;
            if (this.totalDocs > 0) this.totalDocs--;
        };

        NaiveBayesOnline.prototype.predict = function(text) {
            const words = this._tokenize(text);
            const V = Math.max(this.vocab.size, 1);
            const results = [];
            for (const cat of this.cats) {
                const totalW = this.catCounts[cat] || 0;
                // log prior: P(cat) with smoothing
                let logP = Math.log((this.docCounts[cat] + 1) / (this.totalDocs + this.cats.length));
                // log likelihood: P(word|cat) with Laplace smoothing
                for (const w of words) {
                    const wc = (this.wordCounts[cat] && this.wordCounts[cat][w]) || 0;
                    logP += Math.log((wc + 1) / (totalW + V));
                }
                results.push({ cat, logP });
            }
            // Convert log-probs to probabilities via softmax
            const maxLogP = Math.max(...results.map(r => r.logP));
            let sumExp = 0;
            results.forEach(r => { r.exp = Math.exp(r.logP - maxLogP); sumExp += r.exp; });
            results.forEach(r => { r.prob = r.exp / sumExp; });
            results.sort((a, b) => b.prob - a.prob);
            return results;
        };

        NaiveBayesOnline.prototype.batchTrain = function(examples) {
            for (const ex of examples) {
                const labels = (ex.labels || []).filter(l => !isExcludedCategory(l));
                for (const label of labels) {
                    this.train(ex.text, label);
                }
            }
        };

        NaiveBayesOnline.prototype.getUncertainty = function(text) {
            const preds = this.predict(text);
            if (!preds.length) return 1;
            return 1 - preds[0].prob;
        };

        NaiveBayesOnline.prototype.toJSON = function() {
            return { cats: this.cats, wordCounts: this.wordCounts, catCounts: this.catCounts, docCounts: this.docCounts, vocab: [...this.vocab], totalDocs: this.totalDocs };
        };

        NaiveBayesOnline.fromJSON = function(data) {
            const nb = new NaiveBayesOnline(data.cats || []);
            nb.wordCounts = data.wordCounts || {};
            nb.catCounts = data.catCounts || {};
            nb.docCounts = data.docCounts || {};
            nb.vocab = new Set(data.vocab || []);
            nb.totalDocs = data.totalDocs || 0;
            return nb;
        };

        function predictLabelsForText(text, model) {
            const method = model?.method || 'tfidf_centroid';
            if (method === 'keyword_overlap') {
                return predictWithKeywordOverlap(text, model);
            }
            if (method === 'random_forest') {
                return predictWithRandomForest(text, model);
            }
            return predictWithCentroids(text, model);
        }

        function predictLabelsForRecord(record) {
            return predictLabelsForText(getClassificationText(record), trainingState.model);
        }

        function getThresholdFromUI() {
            const input = document.getElementById('thresholdSlider');
            const value = parseFloat(input?.value ?? '0.15');
            if (!Number.isFinite(value)) return 0.15;
            return Math.max(0.01, Math.min(0.95, value));
        }

        function setThresholdUI(value) {
            const v = Math.max(0.01, Math.min(0.95, Number(value) || 0.15));
            const input = document.getElementById('thresholdSlider');
            const label = document.getElementById('thresholdValue');
            if (input) input.value = v.toFixed(2);
            if (label) label.textContent = v.toFixed(2);
        }

        function onThresholdInput() {
            const v = getThresholdFromUI();
            setThresholdUI(v);
            if (trainingState.model) {
                trainingState.model.threshold = v;
                refreshBenchmarkForCurrentModel().catch(err => {
                    console.error('Benchmark refresh error:', err);
                });
            }
        }

        function stableHash(value) {
            const s = String(value || '');
            let h = 0;
            for (let i = 0; i < s.length; i++) {
                h = ((h << 5) - h + s.charCodeAt(i)) | 0;
            }
            return Math.abs(h);
        }

        function splitLabeledExamples(examples, testRatio = 0.25) {
            if (examples.length <= 1) return { train: examples.slice(), test: [] };
            const shuffled = examples.slice().sort((a, b) => stableHash(`${a.id}|${a.text.length}`) - stableHash(`${b.id}|${b.text.length}`));
            let testSize = Math.max(1, Math.round(shuffled.length * testRatio));
            if (testSize >= shuffled.length) testSize = shuffled.length - 1;
            let test = shuffled.slice(0, testSize);
            let train = shuffled.slice(testSize);

            // Ensure each category has at least one train example when possible.
            const hasCategoryInTrain = (cat) => train.some(ex => ex.labels.includes(cat));
            trainingState.categories.forEach(cat => {
                if (!hasCategoryInTrain(cat)) {
                    const idx = test.findIndex(ex => ex.labels.includes(cat));
                    if (idx >= 0 && test.length > 1) {
                        train.push(test[idx]);
                        test.splice(idx, 1);
                    }
                }
            });

            if (!train.length) {
                train = shuffled.slice(0, shuffled.length - 1);
                test = shuffled.slice(shuffled.length - 1);
            }

            return { train, test };
        }

        function collectLabeledExamples() {
            ensureExcludedCategory();
            const examples = [];
            trainingState.labeledSamples.forEach((labels, sampleId) => {
                const cleaned = sanitizeSampleLabels(labels);
                if (!cleaned.length) return;
                const sample = recordMap.get(String(sampleId))
                    || trainingState.samples.find(candidate => getSampleKey(candidate) === String(sampleId));
                if (!sample) return;
                examples.push({
                    id: sampleId,
                    text: getClassificationText(sample),
                    labels: cleaned
                });
            });
            return examples;
        }

        function evaluateMetricsFromExamplesWithLabelMap(testExamples, categories, predictionMap) {
            const statsCategories = getStatisticsCategories(categories);
            if (!testExamples.length || !statsCategories.length) return null;

            let tp = 0, fp = 0, fn = 0, exact = 0, jaccardSum = 0;
            const perCategory = {};
            statsCategories.forEach(c => perCategory[c] = { tp: 0, fp: 0, fn: 0 });
            let evaluated = 0;

            testExamples.forEach(ex => {
                const truth = new Set(normalizePredictedLabelsForStats(ex.labels || []));
                const pred = new Set(normalizePredictedLabelsForStats(predictionMap.get(String(ex.id)) || []));
                if (!truth.size && !pred.size) return;
                evaluated += 1;

                let inter = 0;
                pred.forEach(p => {
                    if (truth.has(p)) {
                        tp++;
                        inter++;
                    } else {
                        fp++;
                    }
                });
                truth.forEach(t => {
                    if (!pred.has(t)) fn++;
                });

                statsCategories.forEach(cat => {
                    const inTruth = truth.has(cat);
                    const inPred = pred.has(cat);
                    if (inTruth && inPred) perCategory[cat].tp++;
                    else if (!inTruth && inPred) perCategory[cat].fp++;
                    else if (inTruth && !inPred) perCategory[cat].fn++;
                });

                const union = new Set([...truth, ...pred]).size;
                jaccardSum += union ? (inter / union) : 1;
                if (pred.size === truth.size && [...truth].every(t => pred.has(t))) exact++;
            });
            if (!evaluated) return null;

            const microPrecision = tp + fp ? tp / (tp + fp) : 0;
            const microRecall = tp + fn ? tp / (tp + fn) : 0;
            const microF1 = microPrecision + microRecall ? (2 * microPrecision * microRecall) / (microPrecision + microRecall) : 0;

            const macroF1Vals = statsCategories.map(cat => {
                const ctp = perCategory[cat].tp;
                const cfp = perCategory[cat].fp;
                const cfn = perCategory[cat].fn;
                const p = ctp + cfp ? ctp / (ctp + cfp) : 0;
                const r = ctp + cfn ? ctp / (ctp + cfn) : 0;
                return p + r ? (2 * p * r) / (p + r) : 0;
            });
            const macroF1 = macroF1Vals.length ? macroF1Vals.reduce((a, b) => a + b, 0) / macroF1Vals.length : 0;

            return {
                testSize: evaluated,
                exactMatch: exact / evaluated,
                microPrecision,
                microRecall,
                microF1,
                macroF1,
                avgJaccard: jaccardSum / evaluated
            };
        }

        function evaluateModelOnExamples(model, testExamples, categories) {
            const predictionMap = new Map();
            testExamples.forEach(ex => {
                predictionMap.set(String(ex.id), predictLabelsForText(ex.text, model));
            });
            return evaluateMetricsFromExamplesWithLabelMap(testExamples, categories, predictionMap);
        }

        function renderBenchmark(benchmark) {
            const box = document.getElementById('benchmarkBox');
            const grid = document.getElementById('benchmarkGrid');
            const note = document.getElementById('benchmarkNote');

            if (!benchmark) {
                box.classList.add('hidden');
                grid.innerHTML = '';
                note.textContent = '';
                return;
            }

            box.classList.remove('hidden');

            // Compute an overall quality score (average of micro F1 and exact match)
            const overallPct = ((benchmark.microF1 + benchmark.exactMatch) / 2 * 100).toFixed(0);
            const qualityWord = overallPct >= 70 ? 'Good' : overallPct >= 50 ? 'Fair' : 'Low';
            const qualityColor = overallPct >= 70 ? '#2e7d32' : overallPct >= 50 ? '#e65100' : '#c62828';

            grid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align:center; margin-bottom:6px;">
                    <div style="font-size:22px; font-weight:700; color:${qualityColor};">${overallPct}% — ${qualityWord}</div>
                    <div style="font-size:11px; color:#667;">Overall quality (higher = better). Tag more records to improve.</div>
                </div>
                <div class="benchmark-item" title="How many of the auto-assigned tags were correct?">
                    <div class="benchmark-value">${(benchmark.microPrecision * 100).toFixed(1)}%</div>
                    <div class="benchmark-label">Precision</div>
                    <div style="font-size:9px; color:#889; margin-top:2px;">Tags that were correct</div>
                </div>
                <div class="benchmark-item" title="How many tags that should have been assigned were actually found?">
                    <div class="benchmark-value">${(benchmark.microRecall * 100).toFixed(1)}%</div>
                    <div class="benchmark-label">Recall</div>
                    <div style="font-size:9px; color:#889; margin-top:2px;">Tags that were found</div>
                </div>
                <div class="benchmark-item" title="Balance between precision and recall — the main quality measure">
                    <div class="benchmark-value">${(benchmark.microF1 * 100).toFixed(1)}%</div>
                    <div class="benchmark-label">F1 Score</div>
                    <div style="font-size:9px; color:#889; margin-top:2px;">Overall balance</div>
                </div>
                <div class="benchmark-item" title="How often did the tool get ALL tags exactly right for a record?">
                    <div class="benchmark-value">${(benchmark.exactMatch * 100).toFixed(1)}%</div>
                    <div class="benchmark-label">Exact Match</div>
                    <div style="font-size:9px; color:#889; margin-top:2px;">All tags correct</div>
                </div>
                <div style="grid-column: 1 / -1; font-size:11px; color:#778; margin-top:4px; line-height:1.5;">
                    Tested on <strong>${benchmark.testSize}</strong> records (held out from your ${benchmark.trainSize + benchmark.testSize} tagged examples).
                    <strong>Precision</strong> = "of tags assigned, how many were right?"
                    <strong>Recall</strong> = "of tags that should exist, how many were found?"
                </div>
            `;
            const threshold = trainingState.model?.threshold;
            const thresholdNote = Number.isFinite(threshold) ? ` Sensitivity: ${threshold.toFixed(2)}.` : '';
            note.textContent = `${thresholdNote}`;
        }

        async function refreshBenchmarkForCurrentModel() {
            if (!trainingState.model || trainingState.model.method === 'tfidf_centroid') {
                renderBenchmark(null);
                return;
            }

            const examples = collectLabeledExamples();
            if (examples.length < 2) {
                renderBenchmark(null);
                return;
            }
            const split = splitLabeledExamples(examples, 0.25);
            const evalMetrics = evaluateModelOnExamples(trainingState.model, split.test, trainingState.categories);
            const trainSize = split.train.length;
            const testSize = Number(evalMetrics?.testSize ?? split.test.length) || 0;

            trainingState.benchmark = evalMetrics
                ? { ...evalMetrics, trainSize, testSize }
                : null;
            renderBenchmark(trainingState.benchmark);
        }

        async function trainModel() {
            const labeledExamples = collectLabeledExamples();
            const labeledCount = labeledExamples.length;
            const method = getClassifierMethodFromUI();
            trainingState.method = method;
            ensureExcludedCategory();

            if (getStatisticsCategories(trainingState.categories).length < 1) {
                alert('Please add at least 1 category besides "excluded"');
                return;
            }

            if (labeledCount < 5) {
                alert('Please label at least 5 samples before training');
                return;
            }

            const trainBtn = document.getElementById('applyCurrentBtn');
            document.getElementById('trainingProgress').classList.remove('hidden');
            document.getElementById('benchmarkBox').classList.add('hidden');

            try {
                const split = splitLabeledExamples(labeledExamples, 0.25);
                const trainExamples = split.train;
                const testExamples = split.test;
                const trainingDocs = trainExamples.map(ex => ex.text);
                const trainingLabels = trainExamples.map(ex => ex.labels);

                if (!trainingDocs.length) {
                    throw new Error('Unable to build a training split from labeled samples.');
                }

                setTrainingProgress(18, 'Preparing training features...');
                await delay(100);

                const threshold = getThresholdFromUI();
                const model = {
                    method,
                    categories: [...trainingState.categories],
                    threshold,
                    engine: 'local'
                };

                if (method === 'keyword_overlap') {
                    setTrainingProgress(48, 'Building keyword profiles...');
                    await delay(80);
                    const keywordProfiles = buildKeywordProfiles(trainingDocs, trainingLabels, trainingState.categories);
                    const nonEmptyProfiles = Object.values(keywordProfiles).filter(p => Object.keys(p?.weights || {}).length > 0);
                    if (!nonEmptyProfiles.length) {
                        throw new Error('No keyword profiles could be built. Label more diverse samples.');
                    }
                    model.keywordProfiles = keywordProfiles;
                } else if (method === 'random_forest') {
                    setTrainingProgress(30, 'Computing TF-IDF features...');
                    await delay(80);
                    const { vectors, idf, vocabulary } = computeTfIdf(trainingDocs);
                    model.idf = idf;
                    trainingState.idf = idf;
                    trainingState.vocabulary = vocabulary;

                    setTrainingProgress(55, 'Training Random Forest (80 trees)...');
                    await delay(80);
                    const rf = buildRandomForest(vectors, trainingLabels, trainingState.categories, idf);
                    if (!Object.keys(rf.forests).length) {
                        throw new Error('No forest could be built. Label more samples for your categories.');
                    }
                    model.rfForests = rf.forests;
                    model.rfFeatures = rf.features;
                } else {
                    const tokenizer = getTokenizerForMethod(method);
                    setTrainingProgress(42, method === 'char_ngram_centroid' ? 'Computing character n-gram TF-IDF...' : 'Computing TF-IDF...');
                    await delay(80);
                    const { vectors, idf, vocabulary } = computeTfIdf(trainingDocs, tokenizer);
                    const categoryVectors = buildCategoryCentroids(vectors, trainingLabels, trainingState.categories);
                    if (!Object.keys(categoryVectors).length) {
                        throw new Error('No category vectors could be built. Label more samples for your categories.');
                    }
                    model.idf = idf;
                    model.categoryVectors = categoryVectors;
                    trainingState.idf = idf;
                    trainingState.vocabulary = vocabulary;
                    trainingState.categoryVectors = categoryVectors;
                }

                setTrainingProgress(80, 'Finalizing model...');
                await delay(100);

                trainingState.model = model;
                setThresholdUI(trainingState.model.threshold);
                setClassifierMethodUI(trainingState.model.method);

                const evalMetrics = evaluateModelOnExamples(trainingState.model, testExamples, trainingState.categories);
                trainingState.benchmark = evalMetrics
                    ? { ...evalMetrics, trainSize: trainExamples.length, testSize: evalMetrics.testSize ?? testExamples.length }
                    : null;
                renderBenchmark(trainingState.benchmark);

                // Auto-initialize Online Naive Bayes alongside the main model
                try {
                    const nbCats = getStatisticsCategories(trainingState.categories);
                    trainingState.nbModel = new NaiveBayesOnline(nbCats);
                    trainingState.nbModel.batchTrain(trainExamples);
                    trainingState._correctionCount = 0;
                    console.log('NaiveBayes online model initialized with', trainExamples.length, 'examples');
                } catch (e) { console.warn('NB init failed:', e); }

                setTrainingProgress(100, 'Training complete!');
                document.getElementById('applyCurrentBtn').disabled = false;
                loadSavedModels();
                updateModelStorageControls();

                setTimeout(() => {
                    document.getElementById('trainingProgress').classList.add('hidden');
                }, 1500);

            } catch (err) {
                console.error('Training error:', err);
                alert('Training failed: ' + err.message);
            } finally {
                // updateTaskTypeUI() call removed
            }
        }

        // ========== CLASSIFICATION ==========

        function updateClassifyScopeInfo() {
            const el = document.getElementById('classifyScopeInfo');
            if (!el) return;
            const totalVm = serverBrowseMode ? Number(serverState.totalRecords || 0) : 0;
            const totalLocal = rawData.length || filteredData.length;
            const total = totalVm || totalLocal;
            if (serverBrowseMode && totalVm) {
                el.innerHTML = `Will classify <strong>all ${totalVm.toLocaleString()} matching records</strong> from the server using your labeled examples.`;
            } else {
                el.innerHTML = `Will classify <strong>all ${total.toLocaleString()} records</strong> using your labeled examples.`;
            }
        }

        function updateLabeledExamplesInfo() {
            const el = document.getElementById('labeledExamplesCount');
            if (!el) return;
            const examples = collectLabeledExamples();
            el.textContent = examples.length;

            // Show per-category breakdown with saturation indicators
            const scopeEl = document.getElementById('classifyScopeText');
            if (scopeEl && examples.length > 0) {
                const counts = getCategoryCounts();
                const cats = getStatisticsCategories(trainingState.categories);
                const parts = cats.map(c => {
                    const n = counts[c] || 0;
                    const color = n >= 10 ? '#4caf50' : n >= 5 ? '#2196f3' : n > 0 ? '#ff9800' : '#ccc';
                    const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:3px;vertical-align:middle;"></span>`;
                    return `${dot}${c}: ${n}`;
                });
                scopeEl.innerHTML = '<br><span style="font-size:11px;">' + parts.join(' &middot; ') + '</span>' +
                    '<br><span style="font-size:10px;color:#889;">10+ = good coverage</span>';
            }
        }

        async function trainAndApplyTfidf() {
            const examples = collectLabeledExamples();
            if (examples.length < 3) {
                alert('Label at least 3 records in Step 2 before classifying. Go to Step 2, click "Load Samples", and assign labels.');
                return;
            }
            setClassifierMethodUI(getClassifierMethodFromUI() || 'tfidf_centroid');
            trainingState.method = getClassifierMethodFromUI();
            await trainModel();
            if (trainingState.model) {
                await applyPredictions();
                // Show results
                const data = filteredData.length ? filteredData : rawData;
                const classified = data.filter(r => r._predictedLabels && r._predictedLabels.length > 0).length;
                const categories = getStatisticsCategories(trainingState.categories);
                const threshold = getThresholdFromUI();
                const resultsBox = document.getElementById('classifyResultsBox');
                if (resultsBox) {
                    const pct = data.length > 0 ? Math.round((classified / data.length) * 100) : 0;
                    document.getElementById('classifyResultsSummary').innerHTML =
                        `<strong>${classified.toLocaleString()}</strong> of ${data.length.toLocaleString()} records labeled (${pct}% coverage).`;
                    resultsBox.classList.remove('hidden');
                }
                updateWorkflowStepper(3);
                updateLabeledExamplesInfo();
            }
        }

        function _showPostClassificationSuggestions() {
            const data = filteredData.length ? filteredData : rawData;
            const classified = data.filter(r => r._predictedLabels && r._predictedLabels.length > 0).length;
            const total = data.length;
            const pct = total > 0 ? Math.round((classified / total) * 100) : 0;

            // Assess model quality from benchmark
            const bm = trainingState.benchmark;
            const f1 = bm?.macroF1 ?? bm?.f1 ?? 0;
            const accuracy = bm?.accuracy ?? 0;
            const needsMoreLabels = f1 < 0.5 || accuracy < 0.6;

            // Build suggestion UI
            const resultsBox = document.getElementById('classifyResultsBox');
            if (!resultsBox) return;

            let html = `<div style="background:#e8f5e9; border:1px solid #a5d6a7; border-radius:10px; padding:16px 20px; margin-top:12px;">`;
            html += `<div style="font-size:15px; font-weight:600; color:#2e7d32; margin-bottom:8px;">✅ Classification complete!</div>`;
            html += `<div style="font-size:13px; color:#334; margin-bottom:12px;"><strong>${classified.toLocaleString()}</strong> of ${total.toLocaleString()} records classified (${pct}% coverage)`;
            if (bm) html += ` · F1: ${(f1 * 100).toFixed(0)}% · Accuracy: ${(accuracy * 100).toFixed(0)}%`;
            html += `</div>`;

            html += `<div style="font-size:13px; font-weight:600; color:#1e3a5f; margin-bottom:8px;">What next?</div>`;
            html += `<div style="display:flex; flex-direction:column; gap:8px;">`;

            if (needsMoreLabels) {
                // Model quality is low — suggest more labeling
                html += `<button class="btn btn-primary" onclick="updateWorkflowStepper(2); getUncertainSamples();" style="text-align:left; padding:10px 14px;">
                    <strong>🎯 Label more records to improve accuracy</strong><br>
                    <span style="font-weight:400; font-size:12px; opacity:0.85;">F1 is ${(f1 * 100).toFixed(0)}% — the model will suggest the most useful records to label</span>
                </button>`;
                html += `<button class="btn btn-secondary" onclick="closeTrainingPane(); activateTab('labels');" style="text-align:left; padding:10px 14px;">
                    📊 Browse results in My Labels tab
                </button>`;
            } else {
                // Model quality is decent — suggest exploring results
                html += `<button class="btn btn-primary" onclick="closeTrainingPane(); activateTab('labels');" style="text-align:left; padding:10px 14px;">
                    <strong>📊 Explore results in My Labels tab</strong><br>
                    <span style="font-weight:400; font-size:12px; opacity:0.85;">See distribution charts and browse classified records</span>
                </button>`;
                html += `<button class="btn btn-secondary" onclick="updateWorkflowStepper(2); getUncertainSamples();" style="text-align:left; padding:10px 14px;">
                    🎯 Improve accuracy — label uncertain records and retrain
                </button>`;
            }

            html += `<button class="btn btn-secondary" onclick="exportClassifiedData();" style="text-align:left; padding:10px 14px;">
                ⬇️ Export classified data as XLSX
            </button>`;
            html += `</div></div>`;

            resultsBox.innerHTML = html;
            resultsBox.classList.remove('hidden');
            // Scroll to show the results
            resultsBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        function setTrainingProgress(pct, text) {
            document.getElementById('trainingProgressFill').style.width = pct + '%';
            document.getElementById('trainingProgressPct').textContent = pct + '%';
            document.getElementById('trainingStatusText').textContent = text;
        }

        async function hybridRetrainTfidf() {
            // Collect all labeled examples (from manual labeling)
            const labeledExamples = collectLabeledExamples();
            if (labeledExamples.length < 5) {
                alert(
                    'Not enough labeled examples to retrain.\n\n' +
                    'Go to Step 2 "Label Samples", click "Load Samples", ' +
                    'label at least 5 records, then try again.'
                );
                return;
            }

            // Switch to TF-IDF and train
            setClassifierMethodUI('tfidf_centroid');
            trainingState.method = 'tfidf_centroid';
            await trainModel();

            // After training, offer to re-apply
            if (trainingState.model && trainingState.model.engine === 'local') {
                const hint = document.getElementById('hybridRetrainHint');
                if (hint) hint.textContent = `TF-IDF model trained on ${labeledExamples.length} examples. Use "Auto-Classify" to re-classify with the improved model.`;
            }
        }

        async function applyPredictionsToServerDataset() {
            const total = Number(serverState.summary?.total_records || serverState.totalRecords || 0);
            if (!total) {
                throw new Error('No records match the current VM filter.');
            }

            const fetchPageSize = 1000;
            const totalPages = Math.max(1, Math.ceil(total / fetchPageSize));
            const sourceRows = [];
            let normalizedOffset = 0;

            for (let page = 1; page <= totalPages; page++) {
                const fetchPct = Math.max(5, Math.round(((page - 1) / totalPages) * 80));
                setTrainingProgress(fetchPct, `Loading records from VM... page ${page.toLocaleString()} / ${totalPages.toLocaleString()}`);

                const params = buildServerQueryParams({
                    page,
                    pageSize: fetchPageSize,
                    includePagination: true,
                    includeSort: true
                });
                const payload = await fetchServerJson(
                    `${DATASET_RECORDS_URL}?${params.toString()}`,
                    'Unable to load records for full-dataset classification'
                );
                const pageSourceRows = Array.isArray(payload.records) ? payload.records : [];
                const batchRecords = pageSourceRows.map((row, idx) => normalizeRecord(row, normalizedOffset + idx));

                batchRecords.forEach((record, idx) => {
                    pageSourceRows[idx]._predictedLabels = predictLabelsForRecord(record);
                });

                sourceRows.push(...pageSourceRows);
                normalizedOffset += batchRecords.length;

                const pct = Math.round((sourceRows.length / total) * 100);
                setTrainingProgress(
                    Math.min(98, Math.max(fetchPct, pct)),
                    `Predicting over full dataset... ${Math.min(sourceRows.length, total).toLocaleString()} / ${total.toLocaleString()}`
                );
                await delay(5);
            }

            setTrainingProgress(99, 'Building full in-browser dataset with predictions...');
            await applyLoadedRecords(sourceRows, {
                fileName: 'UHRI full classified dataset (VM API)',
                fileFormat: 'API JSON',
                source: 'vm_api',
                datasetMetadata: datasetMetadata
            });
        }

        async function applyPredictions() {
            // For trained models (TF-IDF, keyword, n-gram) — apply to all loaded data
            // In server mode: fetch ALL matching records from VM first
            if (!trainingState.model) {
                alert('Please train a model first');
                return;
            }

            const applyBtn = document.getElementById('applyBtn');
            const applyCurrentBtn = document.getElementById('applyCurrentBtn');
            applyBtn.disabled = true;
            applyCurrentBtn.disabled = true;
            applyBtn.innerHTML = '<span class="spinner-small"></span> Applying...';

            document.getElementById('trainingProgress').classList.remove('hidden');

            try {
                // In server mode, fetch ALL filtered records from VM first
                if (serverBrowseMode && DATASET_RECORDS_URL && (!rawData.length || rawData.length < (serverState.totalRecords || 0))) {
                    setTrainingProgress(5, 'Loading all filtered records from VM...');
                    await applyPredictionsToServerDataset();
                    _showPostClassificationSuggestions();
                    return;
                }

                const data = rawData.length ? rawData : filteredData;
                const total = data.length;
                const batchSize = 500;

                for (let i = 0; i < total; i += batchSize) {
                    const batch = data.slice(i, i + batchSize);
                    batch.forEach(record => {
                        record._predictedLabels = predictLabelsForRecord(record);
                    });

                    const pct = Math.round((i + batchSize) / total * 100);
                    setTrainingProgress(Math.min(pct, 100), `Predicting... ${Math.min(i + batchSize, total).toLocaleString()} / ${total.toLocaleString()}`);
                    await delay(10);
                }

                setTrainingProgress(100, 'Predictions complete!');

                filteredData = filteredData.map(fd => {
                    const original = recordMap.get(String(fd._id)) || recordMap.get(getSampleKey(fd));
                    return original ? { ...fd, _predictedLabels: original._predictedLabels } : fd;
                });

                updateAllCharts();
                buildDataTable();

                setTimeout(() => {
                    document.getElementById('trainingProgress').classList.add('hidden');
                    _showPostClassificationSuggestions();
                }, 800);

            } catch (err) {
                console.error('Prediction error:', err);
                alert('Prediction failed: ' + err.message);
            } finally {
                applyBtn.disabled = false;
                applyCurrentBtn.disabled = false;
                applyBtn.innerHTML = '🏷️ Auto-Classify Current Filter';
                // updateTaskTypeUI() call removed
            }
        }

        function applyPredictionToCurrentSample() {
            return applyPredictionToCurrentSampleAsync();
        }

        async function applyPredictionToCurrentSampleAsync() {
            try {
                const categories = getStatisticsCategories(trainingState.categories);
                if (categories.length < 1) {
                    alert('Please add at least 1 category first');
                    return;
                }

                // Pick a random record from filtered data if no training samples
                let record;
                if (trainingState.samples.length > 0) {
                    const sample = trainingState.samples[trainingState.currentSampleIndex];
                    if (!sample) { alert('No current sample'); return; }
                    record = recordMap.get(getSampleKey(sample)) || sample;
                } else {
                    const pool = filteredData.length ? filteredData : rawData;
                    if (!pool.length) { alert('No data loaded'); return; }
                    record = pool[Math.floor(Math.random() * pool.length)];
                }

                const method = getClassifierMethodFromUI();
                const threshold = getThresholdFromUI();

                if (!trainingState.model) {
                    alert('Train a model first. Go to Step 3, click "Train & classify all".');
                    return;
                }
                record._predictedLabels = predictLabelsForRecord(record);

                // Show result in alert
                const labels = record._predictedLabels;
                alert(`Classified: "${(record._text || '').slice(0, 120)}..."\n\nLabels: ${labels.length ? labels.join(', ') : '(none above threshold)'}`);

                filteredData = filteredData.map(fd => getSampleKey(fd) === getSampleKey(record) ? { ...fd, _predictedLabels: record._predictedLabels } : fd);
                if (trainingState.samples.length > 0) {
                    trainingState.samples = trainingState.samples.map(existing => (
                        getSampleKey(existing) === getSampleKey(record)
                            ? { ...existing, _predictedLabels: record._predictedLabels }
                            : existing
                    ));
                    updateLabelingUI();
                }
                updateAllCharts();
                buildDataTable();
            } catch (err) {
                console.error('Current-sample prediction error:', err);
                alert('Prediction failed: ' + (err?.message || err));
            }
        }

        // ========== MODEL PERSISTENCE ==========
        async function saveCurrentModel() {
            if (!trainingState.model) {
                alert('No trained model to save');
                return;
            }

            if (!trainingState.model.engine || trainingState.model.engine !== 'local') {
                alert('This model type cannot be saved. Only TF-IDF models trained on labeled examples can be saved.');
                return;
            }

            const nameInput = document.getElementById('modelNameInput');
            const preferredName = nameInput.value.trim() || trainingState.model.displayName || trainingState.model.name || `Model ${Date.now()}`;

            const savedModels = JSON.parse(localStorage.getItem('trainedModels') || '[]');
            savedModels.push({
                id: Date.now(),
                name: preferredName,
                engine: 'local',
                categories: trainingState.model.categories,
                method: trainingState.model.method || trainingState.method || 'tfidf_centroid',
                idf: trainingState.model.idf,
                categoryVectors: trainingState.model.categoryVectors,
                keywordProfiles: trainingState.model.keywordProfiles || null,
                threshold: trainingState.model.threshold,
                createdAt: new Date().toISOString(),
                sampleCount: collectLabeledExamples().length,
                benchmark: trainingState.benchmark,
                nbModel: trainingState.nbModel ? trainingState.nbModel.toJSON() : null
            });

            localStorage.setItem('trainedModels', JSON.stringify(savedModels));
            nameInput.value = '';
            loadSavedModels();
            updateModelStorageControls();
            _showToast('Model saved!', 2000, '#2e7d32');
        }

        function loadSavedModels() {
            const savedModels = JSON.parse(localStorage.getItem('trainedModels') || '[]')
                .map(m => ({ ...m, engine: m.engine || 'local' }));
            const list = document.getElementById('modelList');

            if (savedModels.length === 0) {
                list.innerHTML = '<p style="color: #666; font-size: 13px; text-align: center; padding: 20px;">No saved models yet. Train a TF-IDF or keyword model and save it here.</p>';
                updateModelStorageControls();
                return;
            }

            list.innerHTML = savedModels.map(m => {
                const createdAt = m.createdAt ? new Date(m.createdAt) : null;
                const createdLabel = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleDateString('en-GB') : 'n/a';
                const methodLabel = classifierMethodMeta[m.method || 'tfidf_centroid']?.label || (m.method || 'tfidf_centroid');
                return `
                    <div class="model-item">
                        <div class="model-info">
                            <div class="model-name">${escapeHtml(m.name)}</div>
                            <div class="model-meta">${(m.categories || []).length} categories • ${escapeHtml(methodLabel)} • ${createdLabel}</div>
                        </div>
                        <div class="model-actions">
                            <button class="apply-model" onclick="applyStoredModel(${m.id})">Apply</button>
                            <button class="delete-model" onclick="deleteModel(${m.id})">Delete</button>
                        </div>
                    </div>
                `;
            }).join('');
            updateModelStorageControls();
        }

        function applyStoredModel(modelId) {
            const savedModels = JSON.parse(localStorage.getItem('trainedModels') || '[]');
            const model = savedModels.find(m => m.id === modelId);

            if (!model) {
                _showToast('Model not found', 3000, '#c62828');
                return;
            }

            trainingState.model = model;
            trainingState.categories = Array.isArray(model.categories) ? model.categories : [];
            ensureExcludedCategory();
            trainingState.model.categories = trainingState.categories;
            trainingState.idf = model.idf || {};
            trainingState.categoryVectors = model.categoryVectors || {};
            trainingState.benchmark = model.benchmark || null;
            trainingState.method = classifierMethodMeta[model.method] ? model.method : 'tfidf_centroid';
            trainingState.model.method = trainingState.method;
            trainingState.model.engine = model.engine || 'local';
            trainingState.model.keywordProfiles = model.keywordProfiles || trainingState.model.keywordProfiles || null;
            trainingState.model.threshold = Number.isFinite(Number(trainingState.model.threshold))
                ? Number(trainingState.model.threshold)
                : 0.15;

            // Restore NB model if saved
            if (model.nbModel) {
                try { trainingState.nbModel = NaiveBayesOnline.fromJSON(model.nbModel); trainingState._correctionCount = 0; }
                catch (e) { console.warn('Failed to restore NB model:', e); }
            }

            setClassifierMethodUI(trainingState.method);
            setThresholdUI(trainingState.model.threshold);
            renderCategories();
            renderBenchmark(trainingState.benchmark);
            document.getElementById('applyCurrentBtn').disabled = false;
            updateModelStorageControls();
            _showToast('Model loaded! Go to Step 3 to auto-classify.', 3000, '#2e7d32');
        }

        function deleteModel(modelId) {
            if (!confirm('Delete this model?')) return;

            let savedModels = JSON.parse(localStorage.getItem('trainedModels') || '[]');
            savedModels = savedModels.filter(m => m.id !== modelId);
            localStorage.setItem('trainedModels', JSON.stringify(savedModels));
            loadSavedModels();
            updateModelStorageControls();
        }
        function toggleAboutModal() {
            const overlay = document.getElementById('aboutOverlay');
            if (overlay) overlay.classList.toggle('visible');
        }

        // ── Offline & Private Mode: triggers a full dataset download (loadRemoteDataset),
        // which switches the app into local mode. Used when the user wants privacy,
        // offline capability, or to enable classifier training in the Labels tab. ──
        function openOfflineModeModal() {
            const overlay = document.getElementById('offlineModeOverlay');
            if (overlay) overlay.classList.add('visible');
        }
        function closeOfflineModeModal() {
            const overlay = document.getElementById('offlineModeOverlay');
            if (overlay) overlay.classList.remove('visible');
        }
        function closeAboutModalAndOpenOfflineMode() {
            document.getElementById('aboutOverlay')?.classList.remove('visible');
            openOfflineModeModal();
        }
        function activateOfflineMode() {
            closeOfflineModeModal();
            // Hide the Labels-tab CTA eagerly so the user sees immediate feedback.
            document.getElementById('labelsOfflineModeCta')?.classList.add('hidden');
            // loadRemoteDataset() pulls the full JSON from the VM and switches to local mode.
            // It already manages the loading indicator, progress bar, and error states.
            if (typeof loadRemoteDataset === 'function') {
                loadRemoteDataset(true);
            } else {
                alert('Download path is not available in this build.');
            }
        }

        // ========== COMPARE TAB ==========
        const COMPARE_COLORS = ['#2d5a87', '#e65100', '#2e7d32', '#6a1b9a', '#c62828'];
        let _compareInited = false;

        function _initCompareSelects() {
            // In server-browse mode, always populate from the full facets list so users
            // can compare any country / body in the dataset — not just the subset visible
            // in the currently-open drill-down or filter (which was the earlier bug).
            // Local mode still derives options from loaded data.
            const _c = s => _countryLabel(s.replace(/^-+\s*/, '').trim());
            if (serverBrowseMode && serverState.facets) {
                const countries = [...new Set((serverState.facets.countries || []).map(c => _countryLabel(c)))].filter(Boolean).sort();
                const bodies = [...new Set((serverState.facets.bodies || []).map(_standardizeBody).filter(Boolean))].sort();
                populateSelect('compareCountry', countries);
                populateSelect('compareBody', bodies);
            } else {
                const pool = filteredData.length ? filteredData : rawData;
                if (pool.length) {
                    const countries = [...new Set(pool.flatMap(r => (r._countriesArray || []).map(_c)))].filter(Boolean).sort();
                    const bodies = [...new Set(pool.map(r => _standardizeBody(r._body)).filter(Boolean))].sort();
                    populateSelect('compareCountry', countries);
                    populateSelect('compareBody', bodies);
                }
            }
            _initChipSelects();

            if (!_compareInited) {
                // Wire live updates: patch ChipSelect instances to call updateCompareCharts on any change
                const _patchChipSelect = (id) => {
                    const cs = _chipSelects[id];
                    if (!cs) return;
                    const origSelect = cs._select.bind(cs);
                    const origSync = cs.sync.bind(cs);
                    cs._select = function(val) { origSelect(val); _debounceCompareUpdate(); };
                    cs.sync = function() { origSync(); _debounceCompareUpdate(); };
                };
                _patchChipSelect('compareCountry');
                _patchChipSelect('compareBody');
                _compareInited = true;
            }
        }

        let _compareDebounce = null;
        function _debounceCompareUpdate() {
            clearTimeout(_compareDebounce);
            _compareDebounce = setTimeout(updateCompareCharts, 200);
        }

        function updateCompareCharts() {
            const countries = getSelectedValues('compareCountry');
            const bodies = getSelectedValues('compareBody');

            const chartsDiv = document.getElementById('compareCharts');
            const emptyDiv = document.getElementById('compareEmpty');

            if (countries.length < 2) {
                if (chartsDiv) chartsDiv.style.display = 'none';
                if (emptyDiv) emptyDiv.style.display = '';
                return;
            }
            if (chartsDiv) { chartsDiv.style.display = ''; chartsDiv.style.opacity = '0.4'; }
            if (emptyDiv) emptyDiv.style.display = 'none';

            // Use filtered data (respects main filter), not raw
            const data = filteredData.length ? filteredData : (rawData.length ? rawData : []);
            const _clean = s => (s || '').replace(/^-+\s*/, '').trim();

            // Per-country aggregation
            const perCountry = {};
            countries.forEach(c => {
                perCountry[c] = { total: 0, yearly: {}, themes: {}, bodies: {}, affected: {} };
            });

            data.forEach(r => {
                const rCountries = (r._countriesArray || []).map(c => _countryLabel(_clean(c)));
                const rBody = _clean(r._body);
                if (bodies.length && !bodies.some(b => _clean(b) === rBody)) return;

                countries.forEach(c => {
                    if (!rCountries.includes(c)) return;
                    const p = perCountry[c];
                    p.total++;
                    const yr = r._year;
                    if (yr) p.yearly[yr] = (p.yearly[yr] || 0) + 1;
                    if (rBody) p.bodies[rBody] = (p.bodies[rBody] || 0) + 1;
                    (r._themesArray || []).forEach(t => {
                        const ct = _clean(t);
                        if (ct) p.themes[ct] = (p.themes[ct] || 0) + 1;
                    });
                    (r._affectedPersonsArray || []).forEach(a => {
                        const ca = _clean(a);
                        if (ca) p.affected[ca] = (p.affected[ca] || 0) + 1;
                    });
                });
            });

            const countryLabel = c => _countryLabel(c);
            const cLabels = countries.map(countryLabel);

            // Chart 1: Total recommendations (bar)
            destroyChart('compareTotal');
            charts.compareTotal = new Chart(document.getElementById('chartCompareTotal'), {
                type: 'bar',
                data: {
                    labels: cLabels,
                    datasets: [{
                        data: countries.map(c => perCountry[c].total),
                        backgroundColor: countries.map((_, i) => COMPARE_COLORS[i % COMPARE_COLORS.length]),
                        borderRadius: 4
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
            });

            // Chart 2: By Body (grouped horizontal bar)
            destroyChart('compareBody');
            const allBodies = [...new Set(countries.flatMap(c => Object.keys(perCountry[c].bodies)))];
            const topBodies = allBodies.sort((a, b) => {
                const sumA = countries.reduce((s, c) => s + (perCountry[c].bodies[a] || 0), 0);
                const sumB = countries.reduce((s, c) => s + (perCountry[c].bodies[b] || 0), 0);
                return sumB - sumA;
            }).slice(0, 8);
            charts.compareBody = new Chart(document.getElementById('chartCompareBody'), {
                type: 'bar',
                data: {
                    labels: topBodies.map(b => b.length > 25 ? b.slice(0, 23) + '…' : b),
                    datasets: countries.map((c, i) => ({
                        label: countryLabel(c),
                        data: topBodies.map(b => perCountry[c].bodies[b] || 0),
                        backgroundColor: COMPARE_COLORS[i % COMPARE_COLORS.length],
                        borderRadius: 3
                    }))
                },
                options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { x: { beginAtZero: true } } }
            });

            // Chart 3: Trends over time (line)
            destroyChart('compareTrend');
            const allYears = [...new Set(countries.flatMap(c => Object.keys(perCountry[c].yearly)))].sort();
            charts.compareTrend = new Chart(document.getElementById('chartCompareTrend'), {
                type: 'line',
                data: {
                    labels: allYears,
                    datasets: countries.map((c, i) => ({
                        label: countryLabel(c),
                        data: allYears.map(y => perCountry[c].yearly[y] || 0),
                        borderColor: COMPARE_COLORS[i % COMPARE_COLORS.length],
                        backgroundColor: COMPARE_COLORS[i % COMPARE_COLORS.length] + '22',
                        fill: false,
                        tension: 0.3,
                        pointRadius: 3
                    }))
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { y: { beginAtZero: true } } }
            });

            // Chart 4: Top Themes (grouped horizontal bar)
            destroyChart('compareThemes');
            const allThemes = [...new Set(countries.flatMap(c => Object.keys(perCountry[c].themes)))];
            const topThemes = allThemes.sort((a, b) => {
                const sumA = countries.reduce((s, c) => s + (perCountry[c].themes[a] || 0), 0);
                const sumB = countries.reduce((s, c) => s + (perCountry[c].themes[b] || 0), 0);
                return sumB - sumA;
            }).slice(0, 8);
            charts.compareThemes = new Chart(document.getElementById('chartCompareThemes'), {
                type: 'bar',
                data: {
                    labels: topThemes.map(t => t.length > 30 ? t.slice(0, 28) + '…' : t),
                    datasets: countries.map((c, i) => ({
                        label: countryLabel(c),
                        data: topThemes.map(t => perCountry[c].themes[t] || 0),
                        backgroundColor: COMPARE_COLORS[i % COMPARE_COLORS.length],
                        borderRadius: 3
                    }))
                },
                options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { x: { beginAtZero: true } } }
            });

            // Chart 5: Top Affected Groups (grouped horizontal bar)
            destroyChart('compareAffected');
            const allAffected = [...new Set(countries.flatMap(c => Object.keys(perCountry[c].affected)))];
            const topAffected = allAffected.sort((a, b) => {
                const sumA = countries.reduce((s, c) => s + (perCountry[c].affected[a] || 0), 0);
                const sumB = countries.reduce((s, c) => s + (perCountry[c].affected[b] || 0), 0);
                return sumB - sumA;
            }).slice(0, 6);
            charts.compareAffected = new Chart(document.getElementById('chartCompareAffected'), {
                type: 'bar',
                data: {
                    labels: topAffected.map(a => a.length > 30 ? a.slice(0, 28) + '…' : a),
                    datasets: countries.map((c, i) => ({
                        label: countryLabel(c),
                        data: topAffected.map(a => perCountry[c].affected[a] || 0),
                        backgroundColor: COMPARE_COLORS[i % COMPARE_COLORS.length],
                        borderRadius: 3
                    }))
                },
                options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { title: (items) => topAffected[items[0]?.dataIndex] || '' } } }, scales: { x: { beginAtZero: true } } }
            });

            // Add full-label tooltips to theme chart too
            if (charts.compareThemes) {
                charts.compareThemes._fullLabels = topThemes;
                charts.compareThemes.options.plugins.tooltip = { callbacks: { title: (items) => topThemes[items[0]?.dataIndex] || '' } };
                charts.compareThemes.update('none');
            }
            if (charts.compareBody) {
                charts.compareBody._fullLabels = topBodies;
                charts.compareBody.options.plugins.tooltip = { callbacks: { title: (items) => topBodies[items[0]?.dataIndex] || '' } };
                charts.compareBody.update('none');
            }
            if (charts.compareAffected) {
                charts.compareAffected._fullLabels = topAffected;
            }

            // Restore opacity
            if (chartsDiv) chartsDiv.style.opacity = '1';

            // Build data table at bottom — same card view as Data tab
            const compareTableEl = document.getElementById('compareDataTable');
            if (compareTableEl) {
                const allRecs = [];
                data.forEach(r => {
                    const rCountries = (r._countriesArray || []).map(c => _countryLabel(_clean(c)));
                    const rBody = _clean(r._body);
                    if (bodies.length && !bodies.some(b => _clean(b) === rBody)) return;
                    if (!countries.some(c => rCountries.includes(c))) return;
                    allRecs.push(r);
                });
                window._compareTableRecords = allRecs;
                window._compareTableShown = 50;
                const totalLabel = `${allRecs.length.toLocaleString()} recommendations across ${countries.length} countries`;
                compareTableEl.innerHTML = `
                    <h3 style="margin:24px 0 10px; font-size:15px; color:var(--primary);">📋 Data View <span style="font-weight:400; font-size:12px; color:#667;">(${totalLabel})</span></h3>
                    <div style="display:flex; gap:10px; align-items:center; margin-bottom:12px; flex-wrap:wrap;">
                        <input type="text" id="compareTableSearch" placeholder="Search within comparison data..." style="flex:1; min-width:200px; padding:8px 12px; border:1px solid var(--border); border-radius:6px; font-size:13px;" oninput="_filterCompareTable()">
                        <button class="btn btn-secondary" style="padding:6px 12px; font-size:11px;" onclick="_exportCompareData()">⬇ Export XLSX</button>
                    </div>
                    <div id="compareTableBody"></div>
                `;
                _filterCompareTable();
            }
        }

        function _filterCompareTable() {
            const recs = window._compareTableRecords || [];
            const query = (document.getElementById('compareTableSearch')?.value || '').toLowerCase().trim();
            const container = document.getElementById('compareTableBody');
            if (!container) return;

            const filtered = query
                ? recs.filter(r => {
                    const all = [(r._text || ''), (r._body || ''), (r._countries || ''), (r._themes || '')].join(' ').toLowerCase();
                    return all.includes(query);
                })
                : recs;

            const limit = window._compareTableShown || 50;
            const shown = filtered.slice(0, limit);
            const searchState = query ? parseSearchQuery(query) : { type: 'none' };

            // Use the same _renderSingleCard as the Data tab
            const cardsHtml = shown.map(r => _renderSingleCard(r, searchState)).join('');
            const moreHtml = filtered.length > limit
                ? `<div style="text-align:center; padding:16px;">
                    <button class="btn btn-secondary" style="padding:8px 20px;" onclick="window._compareTableShown = (window._compareTableShown||50) + 50; _filterCompareTable();">Show more (${Math.min(filtered.length - limit, 50)} of ${(filtered.length - limit).toLocaleString()} remaining)</button>
                   </div>`
                : '';
            const countHtml = `<div style="font-size:12px; color:#667; margin-bottom:8px;">${filtered.length.toLocaleString()} records${query ? ' matching "' + escapeHtml(query) + '"' : ''}</div>`;

            container.innerHTML = countHtml + cardsHtml + moreHtml;
        }

        function _exportCompareData() {
            const recs = window._compareTableRecords || [];
            if (!recs.length) { _showToast('No records to export.', 3000, '#c62828'); return; }
            const hasLabels = recs.some(r => r._predictedLabels && r._predictedLabels.length);
            const rows = recs.map(r => {
                const row = {
                    Country: getCellValue(r, '_countries'),
                    Year: getCellValue(r, '_year'),
                    Body: getCellValue(r, '_body'),
                    Type: getCellValue(r, '_type'),
                };
                if (hasLabels) row['My Labels'] = (r._predictedLabels || []).join(', ');
                row.Themes = r._themes || '';
                row.Text = r._text || '';
                row['UHRI Link'] = getUhriUrl(r);
                row['UN Doc Link'] = getUnDocsUrl(r);
                return row;
            });
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Comparison');
            XLSX.writeFile(wb, 'comparison_export.xlsx');
        }
