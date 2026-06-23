# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Run the app:**
```bash
python app.py
# or with hot reload via uvicorn directly:
uvicorn app:app --host 0.0.0.0 --port 3000 --reload
```

**Install dependencies:**
```bash
pip install -r requirements.txt
```

**Environment setup:**
Create a `.env` file with:
```
FINNHUB_API_KEY=your_key_here
```
Without a key, the app falls back to mock news data automatically.

## Architecture

This is a single-page real-time stock dashboard. The server is `app.py` (FastAPI + uvicorn), and the frontend is a single Jinja2-rendered template (`templates/index.html`) with three JS modules loaded as static files.

### Data flow

1. On page load, the frontend (`js/app.js`) opens a WebSocket to `/ws/{symbol}`.
2. The server's `ConnectionManager` tracks all active WebSocket connections keyed by stock symbol.
3. A background asyncio task (`stock_data_task`) loops every second, broadcasting stock data every `STOCK_REFRESH_INTERVAL` (10s) and news data every `NEWS_REFRESH_INTERVAL` (300s) to all connected clients for each active symbol.
4. On initial WebSocket connect, the server immediately pushes both stock and news payloads without waiting for the background loop.

### Sentiment analysis (dual layer)

Sentiment is computed **server-side** in `app.py:SentimentAnalysis.analyze_sentiment()` using a weighted ensemble of three libraries: VADER (40%), TextBlob (30%), Afinn (30%). The `custom_score` field on each article drives the UI badge and pie chart.

`js/sentiment.js` contains a separate client-side lexicon-based `SentimentAnalyzer` class — it is **not currently used** by `app.js`. The active frontend reads sentiment scores from the server-computed `article.sentiment` object.

### Key REST endpoints

| Endpoint | Purpose |
|---|---|
| `GET /` | Renders the dashboard (Jinja2) |
| `WS /ws/{symbol}` | Real-time stock + news stream |
| `GET /api/symbol-lookup/{query}` | Autocomplete via Finnhub |
| `GET /api/company-peers/{symbol}` | Peer company list via Finnhub |

### Frontend JS modules

- `js/config.js` — constants (default symbol `BCS`, chart colors, WebSocket reconnect settings, max articles)
- `js/sentiment.js` — unused client-side sentiment class (kept for reference)
- `js/app.js` — `TradingApp` class: manages WebSocket lifecycle, DOM updates, Chart.js pie chart, symbol search with 300ms debounce

### Threading model

`yfinance` and the `finnhub` client are synchronous libraries. All calls to them are wrapped in `loop.run_in_executor(None, ...)` or `ThreadPoolExecutor` to avoid blocking the async event loop.

### Default symbol

Both backend (`app.py:DEFAULT_SYMBOL`) and frontend (`js/config.js:DEFAULT_STOCK_SYMBOL`) default to `"BCS"` (Barclays PLC). Change both if switching the default.
