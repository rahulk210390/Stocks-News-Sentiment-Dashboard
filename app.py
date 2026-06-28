import os
import json
import time
import asyncio
import uvicorn
import yfinance as yf
import finnhub
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from typing import Dict, List, Optional
import logging
from datetime import datetime, timedelta
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
from textblob import TextBlob
from afinn import Afinn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Sentiment analyzer singletons — built once so lexicons aren't reloaded per call
vader_analyzer = SentimentIntensityAnalyzer()
afinn_analyzer = Afinn()

app = FastAPI(title="Stock News Sentiment Dashboard")
app.mount("/css", StaticFiles(directory="css"), name="css")
app.mount("/js", StaticFiles(directory="js"), name="js")
templates = Jinja2Templates(directory="templates")
load_dotenv()

DEFAULT_SYMBOL = "BCS"
FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY", "")
STOCK_REFRESH_INTERVAL = 60   # seconds between background price refreshes
NEWS_REFRESH_INTERVAL = 300   # 5 minutes


# ---------------------------------------------------------------------------
# TTL cache — serves stale data on upstream failure so UI stays populated
# ---------------------------------------------------------------------------
class TTLCache:
    def __init__(self, ttl: int):
        self.ttl = ttl
        self._store: Dict[str, tuple] = {}

    def get(self, key: str):
        """Return (data, is_fresh). data=None if never cached."""
        entry = self._store.get(key)
        if not entry:
            return None, False
        ts, data = entry
        return data, (time.time() - ts) < self.ttl

    def set(self, key: str, data):
        self._store[key] = (time.time(), data)


stock_cache   = TTLCache(ttl=60)    # 60 s quote cache
history_cache = TTLCache(ttl=300)   # 5 min history cache
news_cache    = TTLCache(ttl=300)   # 5 min news cache


# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, symbol: str):
        await websocket.accept()
        self.active_connections.setdefault(symbol, []).append(websocket)
        logger.info(f"WS connected: {symbol} ({len(self.active_connections[symbol])} clients)")

    def disconnect(self, websocket: WebSocket, symbol: str):
        conns = self.active_connections.get(symbol, [])
        if websocket in conns:
            conns.remove(websocket)
        if not conns:
            self.active_connections.pop(symbol, None)

    async def broadcast_to_symbol(self, symbol: str, message: dict):
        dead = []
        for ws in list(self.active_connections.get(symbol, [])):
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws, symbol)

    def get_active_symbols(self):
        return list(self.active_connections.keys())


manager = ConnectionManager()


# ---------------------------------------------------------------------------
# API client
# ---------------------------------------------------------------------------
class APIClient:

    # ── Stock data ──────────────────────────────────────────────────────────

    @staticmethod
    async def get_stock_data(symbol: str) -> Optional[dict]:
        cached, is_fresh = stock_cache.get(symbol)
        if is_fresh:
            return cached
        try:
            loop = asyncio.get_event_loop()
            data = await loop.run_in_executor(None, APIClient._fetch_yfinance_data, symbol)
            if data:
                stock_cache.set(symbol, data)
                return data
            if cached:
                logger.warning(f"Serving stale quote for {symbol}")
                return cached
            return None
        except Exception as e:
            logger.error(f"get_stock_data error: {e}")
            return cached  # stale > nothing

    @staticmethod
    def _fetch_yfinance_data(symbol: str) -> Optional[dict]:
        """
        Uses fast_info (chart endpoint, rarely throttled) for live price fields.
        Falls back gracefully if .info is rate-limited (429).
        """
        try:
            stock = yf.Ticker(symbol)
            fi = stock.fast_info

            def _fi(attr, default=None):
                try:
                    v = getattr(fi, attr, None)
                    return v if v is not None else default
                except Exception:
                    return default

            current_price  = _fi('last_price')
            previous_close = _fi('previous_close')
            open_price     = _fi('open')
            day_high       = _fi('day_high')
            day_low        = _fi('day_low')
            year_high      = _fi('year_high')
            year_low       = _fi('year_low')
            volume         = _fi('last_volume')
            market_cap     = _fi('market_cap')
            avg_volume     = _fi('three_month_average_volume')

            # Fundamentals from .info — best-effort, skip on rate-limit
            info: dict = {}
            try:
                info = stock.info or {}
            except Exception as e:
                logger.warning(f".info unavailable for {symbol}: {e}")

            company_name = (
                info.get('shortName') or
                info.get('longName') or
                APIClient.get_company_name_from_symbol(symbol)
            )
            avg_volume = avg_volume or info.get('averageVolume')

            price_change = (
                (current_price - previous_close)
                if current_price and previous_close else 0
            )
            price_change_pct = (
                (price_change / previous_close * 100)
                if previous_close else 0
            )

            return {
                "symbol":               symbol,
                "company_name":         company_name,
                "current_price":        current_price,
                "price_change":         round(price_change, 4),
                "price_change_pct":     round(price_change_pct, 4),
                "previous_close":       previous_close,
                "open":                 open_price,
                "day_high":             day_high,
                "day_low":              day_low,
                "fifty_two_week_high":  year_high or info.get('fiftyTwoWeekHigh'),
                "fifty_two_week_low":   year_low  or info.get('fiftyTwoWeekLow'),
                "volume":               volume,
                "avg_volume":           avg_volume,
                "market_cap":           market_cap,
                "pe_ratio":             info.get('trailingPE'),
                "beta":                 info.get('beta'),
                "eps":                  info.get('trailingEps'),
                "dividend_yield":       info.get('dividendYield'),
                "dividend_rate":        info.get('dividendRate'),
            }
        except Exception as e:
            logger.error(f"_fetch_yfinance_data error for {symbol}: {e}")
            return None

    # ── Price history ────────────────────────────────────────────────────────

    @staticmethod
    async def get_price_history(symbol: str, period: str = '1mo') -> dict:
        cache_key = f"{symbol}:{period}"
        cached, is_fresh = history_cache.get(cache_key)
        if is_fresh:
            return cached
        try:
            loop = asyncio.get_event_loop()
            data = await loop.run_in_executor(
                None, APIClient._fetch_price_history, symbol, period
            )
            if data and data.get('timestamps'):
                history_cache.set(cache_key, data)
                return data
            return cached or {"timestamps": [], "prices": [], "volumes": []}
        except Exception as e:
            logger.error(f"get_price_history error: {e}")
            return cached or {"timestamps": [], "prices": [], "volumes": []}

    @staticmethod
    def _fetch_price_history(symbol: str, period: str) -> dict:
        period_map = {
            '1d':  ('1d',  '5m'),
            '5d':  ('5d',  '30m'),
            '1mo': ('1mo', '1d'),
            '6mo': ('6mo', '1d'),
            '1y':  ('1y',  '1wk'),
        }
        yf_period, interval = period_map.get(period, ('1mo', '1d'))
        hist = yf.Ticker(symbol).history(period=yf_period, interval=interval)
        if hist.empty:
            return {"timestamps": [], "prices": [], "volumes": []}
        return {
            "timestamps": [int(ts.timestamp() * 1000) for ts in hist.index],
            "prices":     [round(float(p), 2) for p in hist["Close"].tolist()],
            "volumes":    [int(v) for v in hist["Volume"].tolist()],
        }

    # ── News ─────────────────────────────────────────────────────────────────

    @staticmethod
    async def get_news_data(symbol: str = None) -> List[dict]:
        cache_key = f"news:{symbol}"
        cached, is_fresh = news_cache.get(cache_key)
        if is_fresh:
            return cached

        try:
            from_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
            to_date   = (datetime.now() - timedelta(days=23)).strftime("%Y-%m-%d")

            with ThreadPoolExecutor() as executor:
                loop = asyncio.get_event_loop()
                if symbol:
                    news = await loop.run_in_executor(
                        executor,
                        lambda: APIClient._fetch_company_news(symbol, from_date, to_date)
                    )
                else:
                    news = await loop.run_in_executor(
                        executor, APIClient._fetch_general_news
                    )

            if not news:
                return APIClient.get_mock_news_data(symbol)

            processed = []
            for article in news:
                url   = article.get('url', '').strip().strip('`')
                image = article.get('image', '').strip().strip('`')
                item  = {
                    'category': article.get('category', 'general'),
                    'datetime': article.get('datetime', int(datetime.now().timestamp())),
                    'headline': article.get('headline', 'No headline'),
                    'id':       article.get('id', 0),
                    'image':    image,
                    'related':  article.get('related', symbol or ''),
                    'source':   article.get('source', 'Unknown'),
                    'summary':  article.get('summary', 'No summary available.'),
                    'url':      url,
                }
                item['sentiment'] = SentimentAnalysis.analyze_sentiment(
                    f"{item['headline']} {item['summary']}"
                )
                processed.append(item)

            news_cache.set(cache_key, processed)
            return processed
        except Exception as e:
            logger.error(f"get_news_data error: {e}")
            return cached or APIClient.get_mock_news_data(symbol)

    @staticmethod
    def _fetch_company_news(symbol, from_date, to_date):
        try:
            return finnhub.Client(api_key=FINNHUB_API_KEY).company_news(
                symbol, _from=from_date, to=to_date
            )
        except Exception as e:
            logger.error(f"company_news error: {e}")
            return []

    @staticmethod
    def _fetch_general_news():
        try:
            return finnhub.Client(api_key=FINNHUB_API_KEY).general_news('general', min_id=0)
        except Exception as e:
            logger.error(f"general_news error: {e}")
            return []

    @staticmethod
    def _symbol_lookup(query: str) -> List[dict]:
        try:
            r = finnhub.Client(api_key=FINNHUB_API_KEY).symbol_lookup(query)
            return r.get('result', []) if r else []
        except Exception as e:
            logger.error(f"symbol_lookup error: {e}")
            return []

    @staticmethod
    def _company_peers(symbol: str) -> List[str]:
        try:
            return finnhub.Client(api_key=FINNHUB_API_KEY).company_peers(symbol) or []
        except Exception as e:
            logger.error(f"company_peers error: {e}")
            return []

    # ── Helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def format_large_number(num) -> str:
        if num is None:
            return "N/A"
        try:
            num = float(num)
        except (TypeError, ValueError):
            return "N/A"
        if num >= 1e12:
            return f"${num/1e12:.2f}T"
        if num >= 1e9:
            return f"${num/1e9:.2f}B"
        if num >= 1e6:
            return f"${num/1e6:.2f}M"
        if num >= 1e3:
            return f"${num/1e3:.2f}K"
        return f"${num:.2f}"

    @staticmethod
    def get_company_name_from_symbol(symbol: str) -> str:
        NAMES = {
            "BCS": "Barclays PLC", "AAPL": "Apple Inc.",
            "MSFT": "Microsoft Corporation", "GOOGL": "Alphabet Inc.",
            "AMZN": "Amazon.com, Inc.", "META": "Meta Platforms, Inc.",
            "TSLA": "Tesla, Inc.", "NVDA": "NVIDIA Corporation",
            "JPM": "JPMorgan Chase & Co.", "BAC": "Bank of America Corporation",
        }
        return NAMES.get(symbol, f"{symbol} Stock")

    @staticmethod
    def get_mock_news_data(symbol: str = None) -> List[dict]:
        company = APIClient.get_company_name_from_symbol(symbol) if symbol else "Market"
        now = int(time.time())
        articles = [
            (f"{company} Reports Strong Quarterly Earnings",
             f"{company} exceeded analyst expectations with 15% YoY revenue growth."),
            (f"Analysts Upgrade {company} Stock Rating",
             f"Multiple analysts raised outlook on {company}, citing strong growth."),
            (f"{company} Announces New Product Launch",
             f"{company} unveils innovative product driving expected revenue growth."),
            (f"Market Concerns Impact {company} Stock",
             f"Broader volatility weighs on {company} despite solid fundamentals."),
            (f"{company} Expands International Operations",
             f"{company} targets emerging market growth with new international plans."),
        ]
        result = []
        for i, (headline, summary) in enumerate(articles):
            item = {
                "category": "general",
                "datetime": now - (i + 1) * 3600,
                "headline": headline, "id": i + 1,
                "image": "", "related": symbol or "",
                "source": ["Financial Times", "Bloomberg", "Reuters", "CNBC", "WSJ"][i],
                "summary": summary, "url": f"https://example.com/news/{i+1}",
            }
            item['sentiment'] = SentimentAnalysis.analyze_sentiment(
                f"{headline} {summary}"
            )
            result.append(item)
        return result


# ---------------------------------------------------------------------------
# Background broadcast task
# ---------------------------------------------------------------------------
async def stock_data_task():
    stock_counter = 0
    news_counter  = 0
    while True:
        try:
            symbols = manager.get_active_symbols() or [DEFAULT_SYMBOL]
            if stock_counter <= 0:
                for sym in symbols:
                    data = await APIClient.get_stock_data(sym)
                    if data:
                        await manager.broadcast_to_symbol(sym, {"type": "stock_data", "data": data})
                stock_counter = STOCK_REFRESH_INTERVAL
            if news_counter <= 0:
                for sym in symbols:
                    data = await APIClient.get_news_data(sym)
                    if data:
                        await manager.broadcast_to_symbol(sym, {"type": "news_data", "data": data})
                news_counter = NEWS_REFRESH_INTERVAL
            stock_counter -= 1
            news_counter  -= 1
            await asyncio.sleep(1)
        except Exception as e:
            logger.error(f"stock_data_task error: {e}")
            await asyncio.sleep(5)


# ---------------------------------------------------------------------------
# Sentiment analysis
# ---------------------------------------------------------------------------
class SentimentAnalysis:
    @staticmethod
    def analyze_sentiment(text: str) -> dict:
        if not text:
            return {
                "category": "neutral",
                "vader":     {"compound": 0, "pos": 0, "neu": 0, "neg": 0},
                "textblob":  {"polarity": 0, "subjectivity": 0},
                "afinn":     {"score": 0},
                "custom_score": 0,
            }
        vader_scores  = vader_analyzer.polarity_scores(text)
        blob          = TextBlob(text)
        afinn_score   = afinn_analyzer.score(text)
        norm_afinn    = max(min(afinn_score / 5, 1), -1)
        custom_score  = (
            vader_scores["compound"] * 0.4 +
            blob.sentiment.polarity  * 0.3 +
            norm_afinn               * 0.3
        )
        category = (
            "positive" if custom_score >  0.05 else
            "negative" if custom_score < -0.05 else
            "neutral"
        )
        return {
            "category":   category,
            "vader":      {"compound": vader_scores["compound"], "pos": vader_scores["pos"],
                           "neu": vader_scores["neu"], "neg": vader_scores["neg"]},
            "textblob":   {"polarity": blob.sentiment.polarity,
                           "subjectivity": blob.sentiment.subjectivity},
            "afinn":      {"score": afinn_score},
            "custom_score": round(custom_score, 6),
        }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse)
async def get_index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/favicon.ico")
async def get_favicon():
    return FileResponse("favicon.ico") if os.path.exists("favicon.ico") else None

@app.websocket("/ws/{symbol}")
async def websocket_endpoint(websocket: WebSocket, symbol: str):
    symbol = symbol.upper()
    await manager.connect(websocket, symbol)
    try:
        stock_data = await APIClient.get_stock_data(symbol)
        if stock_data:
            await websocket.send_text(json.dumps({"type": "stock_data", "data": stock_data}))
        news_data = await APIClient.get_news_data(symbol)
        if news_data:
            await websocket.send_text(json.dumps({"type": "news_data", "data": news_data}))

        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
                if msg.get("action") == "subscribe":
                    new_sym = msg.get("symbol", "").upper()
                    if new_sym and new_sym != symbol:
                        manager.disconnect(websocket, symbol)
                        symbol = new_sym
                        await manager.connect(websocket, symbol)
                        sd = await APIClient.get_stock_data(symbol)
                        if sd:
                            await websocket.send_text(json.dumps({"type": "stock_data", "data": sd}))
                        nd = await APIClient.get_news_data(symbol)
                        if nd:
                            await websocket.send_text(json.dumps({"type": "news_data", "data": nd}))
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket, symbol)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket, symbol)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(stock_data_task())

@app.get("/api/symbol-lookup/{query}")
async def symbol_lookup(query: str):
    try:
        with ThreadPoolExecutor() as ex:
            results = await asyncio.get_event_loop().run_in_executor(
                ex, lambda: APIClient._symbol_lookup(query)
            )
        return {"results": results[:5]}
    except Exception as e:
        logger.error(f"symbol-lookup error: {e}")
        return {"results": []}

@app.get("/api/company-peers/{symbol}")
async def company_peers(symbol: str):
    try:
        with ThreadPoolExecutor() as ex:
            peers = await asyncio.get_event_loop().run_in_executor(
                ex, lambda: APIClient._company_peers(symbol)
            )
        return {"peers": {p: APIClient.get_company_name_from_symbol(p) for p in peers}}
    except Exception as e:
        logger.error(f"company-peers error: {e}")
        return {"peers": {}}

@app.get("/api/price-history/{symbol}")
async def price_history(symbol: str, period: str = "1mo"):
    """Return OHLCV history. period: 1d | 5d | 1mo | 6mo | 1y"""
    valid = {"1d", "5d", "1mo", "6mo", "1y"}
    if period not in valid:
        period = "1mo"
    data = await APIClient.get_price_history(symbol.upper(), period)
    return data


if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=3000, reload=True)
