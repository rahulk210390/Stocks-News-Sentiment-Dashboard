/* =====================================================================
   StockSentiment — TradingApp
   Enhancements:
     #1 fast_info + TTL cache (server-side, app.py)
     #2 Interactive price-history Chart.js line chart
     #3 News events as coloured markers on price chart
     #4 Watchlist (localStorage, chip strip)
     #5 Dark mode + sentiment filter tabs + keyboard shortcut
   ===================================================================== */

class TradingApp {
    constructor() {
        /* ── DOM refs ── */
        this.symbolSearch       = document.getElementById('symbolSearch');
        this.searchBtn          = document.getElementById('searchBtn');
        this.symbolSuggestions  = document.getElementById('symbolSuggestions');
        this.stockSymbolEl      = document.getElementById('stockSymbol');
        this.stockNameEl        = document.getElementById('stockName');
        this.currentPriceEl     = document.getElementById('currentPrice');
        this.priceChangeEl      = document.getElementById('priceChange');
        this.marketCapEl        = document.getElementById('marketCap');
        this.peRatioEl          = document.getElementById('peRatio');
        this.epsEl              = document.getElementById('eps');
        this.betaEl             = document.getElementById('beta');
        this.volumeEl           = document.getElementById('volume');
        this.avgVolumeEl        = document.getElementById('avgVolume');
        this.prevCloseEl        = document.getElementById('prevClose');
        this.openEl             = document.getElementById('open');
        this.daysRangeEl        = document.getElementById('daysRange');
        this.fiftyTwoWeekRangeEl= document.getElementById('fiftyTwoWeekRange');
        this.dividendYieldEl    = document.getElementById('dividendYield');
        this.dividendRateEl     = document.getElementById('dividendRate');
        this.newsListEl         = document.getElementById('newsList');
        this.peerCompaniesListEl= document.getElementById('peerCompaniesList');
        this.peerSectionEl      = document.getElementById('peerCompaniesSection');
        this.marketStatusEl     = document.getElementById('marketStatus');
        this.lastUpdatedEl      = document.getElementById('lastUpdated');
        this.overallSentimentEl = document.getElementById('overallSentiment');
        this.sentimentBadgeEl   = document.getElementById('overallSentimentBadge');
        this.articleCountEl     = document.getElementById('articleCount');
        this.darkModeToggle     = document.getElementById('darkModeToggle');
        this.addToWatchlistBtn  = document.getElementById('addToWatchlistBtn');
        this.watchlistStrip     = document.getElementById('watchlistStrip');
        this.watchlistItemsEl   = document.getElementById('watchlistItems');
        this.chartLoadingEl     = document.getElementById('chartLoading');
        this.chartDataNote      = document.getElementById('chartDataNote');

        /* ── State ── */
        this.currentSymbol      = DEFAULT_STOCK_SYMBOL;
        this.ws                 = null;
        this.reconnectAttempts  = 0;
        this.reconnectTimer     = null;
        this.debounceTimer      = null;
        this.sentimentChart     = null;
        this.priceChart         = null;
        this.currentPeriod      = '1mo';
        this.currentNewsData    = [];
        this.currentHistoryData = null;
        this.watchlist          = JSON.parse(localStorage.getItem('watchlist') || '[]');
        this.watchlistPrices    = JSON.parse(localStorage.getItem('watchlistPrices') || '{}');
        this.activeFilter       = 'all';
        this._lastSentimentCounts = null;

        this.init();
    }

    /* =================================================================
       INIT
       ================================================================= */
    init() {
        this.initDarkMode();
        this.initSentimentChart();
        this.initPriceChart();
        this.initPeriodSelector();
        this.initWatchlist();
        this.initSentimentFilter();
        this.initSearch();
        this.initKeyboardShortcuts();
        this.updateMarketStatus();
        setInterval(() => this.updateMarketStatus(), 60000);
        this.connectWebSocket();
        this.loadPeers(this.currentSymbol);
        this.fetchPriceHistory(this.currentPeriod);
    }

    /* =================================================================
       DARK MODE  (#5)
       ================================================================= */
    initDarkMode() {
        const saved = localStorage.getItem('theme') || 'light';
        this._applyTheme(saved);
        this.updateDarkModeIcon();
        this.darkModeToggle?.addEventListener('click', () => this.toggleDarkMode());
    }

    _applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        document.documentElement.setAttribute('data-bs-theme', theme);
    }

    toggleDarkMode() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const next   = isDark ? 'light' : 'dark';
        this._applyTheme(next);
        localStorage.setItem('theme', next);
        this.updateDarkModeIcon();
        /* rebuild charts so colours update */
        if (this.currentHistoryData) this.renderPriceChart(this.currentHistoryData);
        if (this.sentimentChart && this._lastSentimentCounts) {
            const { pos, neg, neu } = this._lastSentimentCounts;
            this.updateSentimentChart(pos, neg, neu);
        }
    }

    updateDarkModeIcon() {
        if (!this.darkModeToggle) return;
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const icon   = this.darkModeToggle.querySelector('i');
        if (icon) icon.className = isDark ? 'fas fa-sun' : 'fas fa-moon';
    }

    /* =================================================================
       MARKET STATUS
       ================================================================= */
    updateMarketStatus() {
        if (!this.marketStatusEl) return;
        const now  = new Date();
        const et   = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const day  = et.getDay();
        const mins = et.getHours() * 60 + et.getMinutes();
        const isOpen = day >= 1 && day <= 5 && mins >= 570 && mins < 960;
        this.marketStatusEl.textContent = isOpen ? 'OPEN' : 'CLOSED';
        this.marketStatusEl.className   = `market-status ${isOpen ? 'open' : 'closed'}`;
    }

    /* =================================================================
       SEARCH & AUTOCOMPLETE
       ================================================================= */
    initSearch() {
        this.searchBtn.addEventListener('click', () => this.loadSymbol(this.symbolSearch.value.trim().toUpperCase()));
        this.symbolSearch.addEventListener('keydown', e => {
            if (e.key === 'Enter') this.loadSymbol(this.symbolSearch.value.trim().toUpperCase());
        });
        this.symbolSearch.addEventListener('input', () => {
            clearTimeout(this.debounceTimer);
            const q = this.symbolSearch.value.trim();
            if (q.length < 1) { this.hideSuggestions(); return; }
            this.debounceTimer = setTimeout(() => this.fetchSuggestions(q), 300);
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('.symbol-search-wrapper')) this.hideSuggestions();
        });
    }

    async fetchSuggestions(q) {
        try {
            const r = await fetch(`/api/symbol-lookup/${encodeURIComponent(q)}`);
            const data = await r.json();
            this.showSuggestions(data.result || []);
        } catch { /* silent */ }
    }

    showSuggestions(items) {
        if (!items.length) { this.hideSuggestions(); return; }
        this.symbolSuggestions.innerHTML = items.slice(0, 8).map(it =>
            `<div class="suggestion-item" data-symbol="${it.symbol}">
               <span class="symbol">${it.symbol}</span>
               <span class="description">${it.description || ''}</span>
             </div>`
        ).join('');
        this.symbolSuggestions.style.display = 'block';
        this.symbolSuggestions.querySelectorAll('.suggestion-item').forEach(el =>
            el.addEventListener('click', () => {
                this.symbolSearch.value = el.dataset.symbol;
                this.hideSuggestions();
                this.loadSymbol(el.dataset.symbol);
            })
        );
    }

    hideSuggestions() { this.symbolSuggestions.style.display = 'none'; }

    loadSymbol(sym) {
        if (!sym) return;
        this.currentSymbol = sym;
        this.stockSymbolEl.textContent = sym;
        this.clearStockData();
        this.activeFilter = 'all';
        this.resetFilterTabs();
        this.connectWebSocket();
        this.loadPeers(sym);
        this.fetchPriceHistory(this.currentPeriod);
        this.updateWatchlistHighlight();
    }

    /* =================================================================
       WEBSOCKET
       ================================================================= */
    connectWebSocket() {
        if (this.ws) { this.ws.onclose = null; this.ws.close(); }
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        this.ws = new WebSocket(`${proto}://${location.host}/ws/${this.currentSymbol}`);
        this.ws.onopen    = () => { this.reconnectAttempts = 0; };
        this.ws.onmessage = e => this.handleMessage(JSON.parse(e.data));
        this.ws.onerror   = () => {};
        this.ws.onclose   = () => this.scheduleReconnect();
    }

    scheduleReconnect() {
        if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
        const delay = Math.min(RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connectWebSocket(), delay);
    }

    handleMessage(msg) {
        if (msg.type === 'stock_data') this.updateStockUI(msg.data);
        if (msg.type === 'news_data')  this.updateNewsUI(msg.data);
    }

    /* =================================================================
       STOCK UI
       ================================================================= */
    updateStockUI(data) {
        if (!data) return;

        /* cache price for watchlist chips */
        if (data.current_price != null) {
            this.watchlistPrices[this.currentSymbol] = {
                price : data.current_price,
                change: data.price_change_pct || 0,
            };
            localStorage.setItem('watchlistPrices', JSON.stringify(this.watchlistPrices));
            this.renderWatchlist();
        }

        const fmt = (v, prefix='', suffix='') =>
            v != null ? `${prefix}${Number(v).toFixed(2)}${suffix}` : '--';

        this.stockSymbolEl.textContent = data.symbol || this.currentSymbol;
        this.stockNameEl.textContent   = data.company_name || '';

        const price = data.current_price;
        this.currentPriceEl.textContent = price != null ? `$${Number(price).toFixed(2)}` : '--';

        const chg    = data.price_change    != null ? Number(data.price_change).toFixed(2)    : null;
        const chgPct = data.price_change_pct != null ? Number(data.price_change_pct).toFixed(2) : null;
        if (chg !== null) {
            const sign = chg >= 0 ? '+' : '';
            this.priceChangeEl.textContent = `${sign}${chg} (${sign}${chgPct}%)`;
            this.priceChangeEl.className   = `price-change ${Number(chg) >= 0 ? 'positive' : 'negative'}`;
        } else {
            this.priceChangeEl.textContent = '--';
            this.priceChangeEl.className   = 'price-change';
        }

        const mc = data.market_cap;
        this.marketCapEl.textContent         = mc ? this.formatLargeNum(mc) : '--';
        this.peRatioEl.textContent           = fmt(data.pe_ratio);
        this.epsEl.textContent               = fmt(data.eps, '$');
        this.betaEl.textContent              = fmt(data.beta);
        this.volumeEl.textContent            = data.volume    ? this.formatLargeNum(data.volume, 0)    : '--';
        this.avgVolumeEl.textContent         = data.avg_volume ? this.formatLargeNum(data.avg_volume, 0) : '--';
        this.prevCloseEl.textContent         = fmt(data.previous_close, '$');
        this.openEl.textContent              = fmt(data.open, '$');

        const lo = data.day_low, hi = data.day_high;
        this.daysRangeEl.textContent         = (lo && hi) ? `$${Number(lo).toFixed(2)} – $${Number(hi).toFixed(2)}` : '--';

        const lo52 = data.fifty_two_week_low, hi52 = data.fifty_two_week_high;
        this.fiftyTwoWeekRangeEl.textContent = (lo52 && hi52) ? `$${Number(lo52).toFixed(2)} – $${Number(hi52).toFixed(2)}` : '--';

        const yld = data.dividend_yield;
        this.dividendYieldEl.textContent     = yld ? `${(yld * 100).toFixed(2)}%` : '--';
        this.dividendRateEl.textContent      = fmt(data.dividend_rate, '$');

        if (this.lastUpdatedEl) {
            this.lastUpdatedEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
        }
    }

    clearStockData() {
        ['currentPrice','priceChange','marketCap','peRatio','eps','beta',
         'volume','avgVolume','prevClose','open','daysRange',
         'fiftyTwoWeekRange','dividendYield','dividendRate'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '--';
        });
        this.priceChangeEl.className = 'price-change';
    }

    formatLargeNum(n, dec=2) {
        const v = Number(n);
        if (v >= 1e12) return `$${(v/1e12).toFixed(dec)}T`;
        if (v >= 1e9)  return `$${(v/1e9 ).toFixed(dec)}B`;
        if (v >= 1e6)  return `$${(v/1e6 ).toFixed(dec)}M`;
        return v.toLocaleString();
    }

    /* =================================================================
       NEWS UI  (#5 filter, #3 chart markers)
       ================================================================= */
    updateNewsUI(articles) {
        if (!Array.isArray(articles) || !articles.length) {
            this.newsListEl.innerHTML = '<div class="loading-message">No recent news found.</div>';
            return;
        }
        this.currentNewsData = articles;

        let pos = 0, neg = 0, neu = 0, scoreSum = 0;
        articles.forEach(a => {
            const s = (a.sentiment?.label || 'Neutral').toLowerCase();
            if (s === 'positive') pos++;
            else if (s === 'negative') neg++;
            else neu++;
            scoreSum += (a.sentiment?.custom_score ?? 0);
        });
        this._lastSentimentCounts = { pos, neg, neu };
        this.updateSentimentChart(pos, neg, neu);

        const avg = articles.length ? scoreSum / articles.length : 0;
        let overallLabel = 'Neutral', overallCls = 'neutral';
        if (avg > 0.05)  { overallLabel = 'Bullish'; overallCls = 'positive'; }
        if (avg < -0.05) { overallLabel = 'Bearish'; overallCls = 'negative'; }
        if (this.sentimentBadgeEl) {
            this.sentimentBadgeEl.textContent = overallLabel;
            this.sentimentBadgeEl.className   = `badge ${overallCls}`;
        }
        if (this.articleCountEl)     this.articleCountEl.textContent = `${articles.length} articles`;
        if (this.overallSentimentEl) this.overallSentimentEl.style.display = 'flex';

        this.renderNewsList(articles);

        if (this.currentHistoryData) this.overlayNewsOnChart(articles);
    }

    renderNewsList(articles) {
        const filtered = this.activeFilter === 'all'
            ? articles
            : articles.filter(a => (a.sentiment?.label || 'Neutral').toLowerCase() === this.activeFilter);

        if (!filtered.length) {
            this.newsListEl.innerHTML = `<div class="loading-message">No ${this.activeFilter} articles found.</div>`;
            return;
        }

        this.newsListEl.innerHTML = filtered.map(a => {
            const sentiment = a.sentiment?.label || 'Neutral';
            const score     = (a.sentiment?.custom_score ?? 0).toFixed(3);
            const scoreV    = a.sentiment?.vader_score ?? 0;
            const scoreT    = a.sentiment?.textblob_score ?? 0;
            const scoreA    = a.sentiment?.afinn_score ?? 0;
            const cls       = sentiment.toLowerCase();
            const date      = a.datetime
                ? new Date(a.datetime * 1000).toLocaleDateString('en-US',
                    { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
                : '';
            const imgHtml   = a.image
                ? `<img class="news-image" src="${a.image}" alt="" loading="lazy" onerror="this.style.display='none'">`
                : '';

            return `
            <div class="news-item sentiment-${cls}">
                ${imgHtml}
                <div class="news-content">
                    <div class="news-header">
                        <span class="news-date">${date}</span>
                        <span class="tooltip">
                            <span class="news-sentiment ${sentiment}">${sentiment} ${score}</span>
                            <span class="tooltiptext">
                                <div class="sentiment-details">
                                    <div>VADER: ${scoreV.toFixed(3)}</div>
                                    <div>TextBlob: ${scoreT.toFixed(3)}</div>
                                    <div>Afinn: ${scoreA.toFixed(3)}</div>
                                    <div><strong>Weighted: ${score}</strong></div>
                                </div>
                            </span>
                        </span>
                    </div>
                    <div class="news-title">
                        <a href="${a.url || '#'}" target="_blank" rel="noopener">${a.headline || a.summary || 'No title'}</a>
                    </div>
                    <div class="news-summary">${a.summary || ''}</div>
                    <div class="news-source">${a.source || ''}</div>
                </div>
            </div>`;
        }).join('');
    }

    /* =================================================================
       SENTIMENT PIE CHART
       ================================================================= */
    initSentimentChart() {
        const ctx = document.getElementById('sentimentChart');
        if (!ctx) return;
        this.sentimentChart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: ['Positive', 'Negative', 'Neutral'],
                datasets: [{
                    data: [0, 0, 0],
                    backgroundColor: ['#28a745', '#dc3545', '#6c757d'],
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: true,
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 12, font: { size: 12 } } }
                }
            }
        });
    }

    updateSentimentChart(pos, neg, neu) {
        if (!this.sentimentChart) return;
        this.sentimentChart.data.datasets[0].data = [pos, neg, neu];
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        this.sentimentChart.options.plugins.legend.labels.color = isDark ? '#e6edf3' : '#212529';
        this.sentimentChart.update('none');
    }

    /* =================================================================
       PRICE HISTORY CHART  (#2)
       ================================================================= */
    initPriceChart() {
        const ctx = document.getElementById('priceChart');
        if (!ctx) return;
        const isDark    = document.documentElement.getAttribute('data-theme') === 'dark';
        const gridColor = isDark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.06)';
        const textColor = isDark ? '#8b949e' : '#6c757d';

        this.priceChart = new Chart(ctx, {
            type: 'line',
            data: { labels: [], datasets: [] },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                animation: { duration: 400 },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: items => items[0]?.label || '',
                            label: item => {
                                if (item.datasetIndex === 0) return ` $${Number(item.raw).toFixed(2)}`;
                                return ` ${item.raw?.headline?.slice(0, 60) || ''}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: textColor, maxTicksLimit: 8, maxRotation: 0 },
                        grid:  { color: gridColor }
                    },
                    y: {
                        ticks: { color: textColor, callback: v => `$${Number(v).toFixed(2)}` },
                        grid:  { color: gridColor }
                    }
                }
            }
        });
    }

    async fetchPriceHistory(period) {
        this.currentPeriod = period;
        if (this.chartLoadingEl) this.chartLoadingEl.classList.remove('hidden');
        try {
            const r = await fetch(`/api/price-history/${this.currentSymbol}?period=${period}`);
            const data = await r.json();
            if (data?.error) throw new Error(data.error);
            this.currentHistoryData = data;
            this.renderPriceChart(data);
            if (this.currentNewsData.length) this.overlayNewsOnChart(this.currentNewsData);
        } catch (e) {
            console.error('fetchPriceHistory:', e);
            if (this.chartDataNote) this.chartDataNote.textContent = '(data unavailable)';
        } finally {
            if (this.chartLoadingEl) this.chartLoadingEl.classList.add('hidden');
        }
    }

    renderPriceChart(data) {
        if (!this.priceChart || !data?.timestamps?.length) return;
        const { timestamps, prices } = data;
        const isDark    = document.documentElement.getAttribute('data-theme') === 'dark';
        const lineColor = isDark ? '#58a6ff' : '#0d6efd';
        const fillColor = isDark ? 'rgba(88,166,255,.08)' : 'rgba(13,110,253,.07)';

        const labels = timestamps.map(ts => {
            const d = new Date(ts);
            if (this.currentPeriod === '1d') {
                return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
            }
            if (this.currentPeriod === '5d') {
                return d.toLocaleDateString([], { month:'short', day:'numeric' }) + ' ' +
                       d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
            }
            return d.toLocaleDateString([], { month:'short', day:'numeric' });
        });

        const priceDataset = {
            label: 'Price',
            data: prices,
            borderColor: lineColor,
            backgroundColor: fillColor,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: true,
            tension: 0.3,
        };

        this.priceChart.data.labels   = labels;
        this.priceChart.data.datasets = [priceDataset];

        const gridColor = isDark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.06)';
        const textColor = isDark ? '#8b949e' : '#6c757d';
        this.priceChart.options.scales.x.ticks.color = textColor;
        this.priceChart.options.scales.x.grid.color  = gridColor;
        this.priceChart.options.scales.y.ticks.color = textColor;
        this.priceChart.options.scales.y.grid.color  = gridColor;

        if (this.chartDataNote && prices.length) {
            const mn = Math.min(...prices).toFixed(2);
            const mx = Math.max(...prices).toFixed(2);
            this.chartDataNote.textContent = `$${mn} – $${mx}`;
        }

        this.priceChart.update();
    }

    /* ── News markers on price chart (#3) ── */
    overlayNewsOnChart(articles) {
        if (!this.priceChart || !this.currentHistoryData?.timestamps?.length) return;
        const { timestamps, prices } = this.currentHistoryData;

        const groups = { positive: [], negative: [], neutral: [] };
        const avgInterval = timestamps.length > 1
            ? (timestamps[timestamps.length - 1] - timestamps[0]) / timestamps.length
            : Infinity;

        articles.forEach(a => {
            if (!a.datetime) return;
            const targetMs = a.datetime * 1000;
            let closest = 0, minDiff = Infinity;
            timestamps.forEach((ts, i) => {
                const d = Math.abs(ts - targetMs);
                if (d < minDiff) { minDiff = d; closest = i; }
            });
            if (minDiff > avgInterval * 3) return;  /* too far from any data point */

            const label = (a.sentiment?.label || 'Neutral').toLowerCase();
            const key   = label === 'positive' ? 'positive' : label === 'negative' ? 'negative' : 'neutral';
            groups[key].push({ x: closest, y: prices[closest], headline: a.headline || a.summary || '' });
        });

        const colors = { positive: '#28a745', negative: '#dc3545', neutral: '#6c757d' };
        const priceLine  = this.priceChart.data.datasets[0];

        const scatterDatasets = Object.entries(groups)
            .filter(([, pts]) => pts.length > 0)
            .map(([label, pts]) => ({
                type: 'scatter',
                label: `${label} news`,
                data: pts.map(p => ({ x: p.x, y: p.y, headline: p.headline })),
                backgroundColor: colors[label],
                borderColor: '#fff',
                borderWidth: 1.5,
                pointRadius: 7,
                pointHoverRadius: 9,
                parsing: { xAxisKey: 'x', yAxisKey: 'y' },
            }));

        this.priceChart.data.datasets = [priceLine, ...scatterDatasets];
        this.priceChart.update('none');
    }

    /* =================================================================
       PERIOD SELECTOR
       ================================================================= */
    initPeriodSelector() {
        document.querySelectorAll('.period-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.fetchPriceHistory(btn.dataset.period);
            });
        });
    }

    /* =================================================================
       SENTIMENT FILTER TABS  (#5)
       ================================================================= */
    initSentimentFilter() {
        document.querySelectorAll('.filter-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.activeFilter = tab.dataset.filter;
                document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                if (this.currentNewsData.length) this.renderNewsList(this.currentNewsData);
            });
        });
    }

    resetFilterTabs() {
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.filter-tab[data-filter="all"]')?.classList.add('active');
    }

    /* =================================================================
       WATCHLIST  (#4)
       ================================================================= */
    initWatchlist() {
        this.addToWatchlistBtn?.addEventListener('click', () => this.toggleWatchlist(this.currentSymbol));
        this.renderWatchlist();
        this.updateWatchlistHighlight();
    }

    toggleWatchlist(sym) {
        const idx = this.watchlist.indexOf(sym);
        if (idx === -1) this.watchlist.push(sym);
        else            this.watchlist.splice(idx, 1);
        localStorage.setItem('watchlist', JSON.stringify(this.watchlist));
        this.renderWatchlist();
        this.updateWatchlistHighlight();
    }

    removeFromWatchlist(sym) {
        this.watchlist = this.watchlist.filter(s => s !== sym);
        localStorage.setItem('watchlist', JSON.stringify(this.watchlist));
        this.renderWatchlist();
        this.updateWatchlistHighlight();
    }

    renderWatchlist() {
        if (!this.watchlistItemsEl) return;
        if (!this.watchlist.length) {
            if (this.watchlistStrip) this.watchlistStrip.style.display = 'none';
            return;
        }
        if (this.watchlistStrip) this.watchlistStrip.style.display = 'block';

        this.watchlistItemsEl.innerHTML = this.watchlist.map(sym => {
            const cached   = this.watchlistPrices[sym] || {};
            const price    = cached.price  != null ? `$${Number(cached.price).toFixed(2)}`  : '';
            const chg      = cached.change ?? null;
            const chgClass = chg === null ? '' : (Number(chg) >= 0 ? 'up' : 'down');
            const chgStr   = chg !== null ? `${Number(chg) >= 0 ? '+' : ''}${Number(chg).toFixed(2)}%` : '';
            const active   = sym === this.currentSymbol ? 'active' : '';
            return `
            <div class="watchlist-chip ${active}" data-sym="${sym}">
                <span class="wl-symbol">${sym}</span>
                ${price  ? `<span class="wl-price">${price}</span>` : ''}
                ${chgStr ? `<span class="wl-change ${chgClass}">${chgStr}</span>` : ''}
                <span class="wl-remove" data-rem="${sym}" title="Remove">&times;</span>
            </div>`;
        }).join('');

        this.watchlistItemsEl.querySelectorAll('.watchlist-chip').forEach(chip => {
            chip.addEventListener('click', e => {
                const rem = e.target.closest('.wl-remove');
                if (rem) { this.removeFromWatchlist(rem.dataset.rem); return; }
                this.symbolSearch.value = chip.dataset.sym;
                this.loadSymbol(chip.dataset.sym);
            });
        });
    }

    updateWatchlistHighlight() {
        const inList = this.watchlist.includes(this.currentSymbol);
        if (this.addToWatchlistBtn) {
            const icon = this.addToWatchlistBtn.querySelector('i');
            if (icon) icon.className = inList ? 'fas fa-star' : 'far fa-star';
            this.addToWatchlistBtn.style.color = inList ? '#f5a623' : '';
        }
        document.querySelectorAll('.watchlist-chip').forEach(c =>
            c.classList.toggle('active', c.dataset.sym === this.currentSymbol)
        );
    }

    /* =================================================================
       PEER COMPANIES
       ================================================================= */
    async loadPeers(sym) {
        if (!this.peerSectionEl || !this.peerCompaniesListEl) return;
        this.peerCompaniesListEl.innerHTML = '<div class="loading-message">Loading…</div>';
        try {
            const r = await fetch(`/api/company-peers/${sym}`);
            const data = await r.json();
            const peers = (data.peers || []).filter(p => p !== sym).slice(0, 12);
            if (!peers.length) { this.peerSectionEl.style.display = 'none'; return; }
            this.peerSectionEl.style.display = 'block';
            this.peerCompaniesListEl.innerHTML = peers.map(p =>
                `<div class="peer-company-item" data-sym="${p}">
                   <div class="peer-company-symbol">${p}</div>
                 </div>`
            ).join('');
            this.peerCompaniesListEl.querySelectorAll('.peer-company-item').forEach(el =>
                el.addEventListener('click', () => {
                    this.symbolSearch.value = el.dataset.sym;
                    this.loadSymbol(el.dataset.sym);
                })
            );
        } catch {
            this.peerSectionEl.style.display = 'none';
        }
    }

    /* =================================================================
       KEYBOARD SHORTCUTS  (#5)
       ================================================================= */
    initKeyboardShortcuts() {
        document.addEventListener('keydown', e => {
            if (document.activeElement === this.symbolSearch) return;
            if (e.key === '/') {
                e.preventDefault();
                this.symbolSearch.focus();
                this.symbolSearch.select();
            }
            if (e.key === 'd') this.toggleDarkMode();
            if (e.key === 'Escape') {
                this.symbolSearch.blur();
                this.hideSuggestions();
            }
        });
    }
}

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', () => { window.app = new TradingApp(); });
