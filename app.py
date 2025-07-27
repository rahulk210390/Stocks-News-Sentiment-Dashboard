import os
import json
import asyncio
import aiohttp
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
import re
from dotenv import load_dotenv
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from concurrent.futures import ThreadPoolExecutor
# Import sentiment analysis libraries
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
from textblob import TextBlob
from afinn import Afinn

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="Stock News Sentiment Dashboard")

# Mount static files
app.mount("/css", StaticFiles(directory="css"), name="css")
app.mount("/js", StaticFiles(directory="js"), name="js")

# Setup Jinja2 templates
templates = Jinja2Templates(directory="templates")
load_dotenv()
# Configuration
DEFAULT_SYMBOL = "BCS"
YAHOO_FINANCE_API = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
FINNHUB_NEWS_API = "https://finnhub.io/api/v1/news"
FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY", "")


# Stock data refresh interval in seconds
STOCK_REFRESH_INTERVAL = 10
# News data refresh interval in seconds (5 minutes)
NEWS_REFRESH_INTERVAL = 300

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}
        
    async def connect(self, websocket: WebSocket, symbol: str):
        await websocket.accept()
        if symbol not in self.active_connections:
            self.active_connections[symbol] = []
        self.active_connections[symbol].append(websocket)
        logger.info(f"Client connected for symbol {symbol}. Total connections: {len(self.active_connections[symbol])}")
        
    def disconnect(self, websocket: WebSocket, symbol: str):
        if symbol in self.active_connections:
            if websocket in self.active_connections[symbol]:
                self.active_connections[symbol].remove(websocket)
                logger.info(f"Client disconnected from symbol {symbol}. Remaining connections: {len(self.active_connections[symbol])}")
            # Clean up empty lists
            if not self.active_connections[symbol]:
                del self.active_connections[symbol]
            
    async def broadcast_to_symbol(self, symbol: str, message: dict):
        if symbol in self.active_connections:
            disconnected_websockets = []
            for websocket in self.active_connections[symbol]:
                try:
                    await websocket.send_text(json.dumps(message))
                except Exception as e:
                    logger.error(f"Error sending message: {e}")
                    disconnected_websockets.append(websocket)
            
            # Clean up disconnected websockets
            for websocket in disconnected_websockets:
                self.disconnect(websocket, symbol)
                
    async def broadcast_to_all(self, message: dict):
        for symbol in list(self.active_connections.keys()):
            await self.broadcast_to_symbol(symbol, message)
    
    def get_active_symbols(self):
        return list(self.active_connections.keys())

manager = ConnectionManager()

# API client for fetching stock and news data
class APIClient:
    @staticmethod
    async def get_stock_data(symbol: str) -> Optional[dict]:
        """Fetch stock data using yfinance"""
        try:
            # Run yfinance operations in a separate thread to avoid blocking the event loop
            loop = asyncio.get_event_loop()
            stock_data = await loop.run_in_executor(None, APIClient._fetch_yfinance_data, symbol)
            return stock_data
        except Exception as e:
            logger.error(f"Exception fetching stock data: {e}")
            return None
            
    @staticmethod
    def _fetch_yfinance_data(symbol: str) -> dict:
        """Fetch stock data from yfinance (runs in a separate thread)"""
        try:
            # Get the stock data
            stock = yf.Ticker(symbol)
            info = stock.info
            
            # Extract required data
            current_price = info.get("regularMarketPrice")
            previous_close = info.get("previousClose")
            open_price = info.get("open")
            day_low = info.get("dayLow")
            day_high = info.get("dayHigh")
            fifty_two_week_low = info.get("fiftyTwoWeekLow")
            fifty_two_week_high = info.get("fiftyTwoWeekHigh")
            volume = info.get("volume")
            avg_volume = info.get("averageVolume")
            market_cap = info.get("marketCap")
            pe_ratio = info.get("trailingPE")
            
            # Calculate price change
            price_change = current_price - previous_close if current_price and previous_close else 0
            price_change_percent = (price_change / previous_close) * 100 if previous_close else 0
            
            # Format large numbers
            formatted_volume = APIClient.format_large_number(volume)
            formatted_avg_volume = APIClient.format_large_number(avg_volume)
            formatted_market_cap = APIClient.format_large_number(market_cap)
            
            # Get company name
            company_name = info.get("shortName") or APIClient.get_company_name_from_symbol(symbol)
            
            return {
                "symbol": symbol,
                "name": company_name,
                "price": current_price,
                "change": price_change,
                "changePercent": price_change_percent,
                "prevClose": previous_close,
                "open": open_price,
                "dayHigh": day_high,
                "dayLow": day_low,
                "fiftyTwoWeekHigh": fifty_two_week_high,
                "fiftyTwoWeekLow": fifty_two_week_low,
                "volume": formatted_volume,
                "avgVolume": formatted_avg_volume,
                "marketCap": formatted_market_cap,
                "peRatio": pe_ratio,
                "beta": info.get("beta"),
                "eps": info.get("trailingEps"),
                "dividendYield": info.get("dividendYield"),
                "dividendRate": info.get("dividendRate"),
                "exDividendDate": info.get("exDividendDate"),
                "earningsDate": info.get("earningsDate")
            }
        except Exception as e:
            logger.error(f"Error fetching yfinance data: {e}")
            return None
    

    
    @staticmethod
    def format_large_number(num: float) -> str:
        """Format large numbers with K, M, B suffixes"""
        if num is None:
            return "N/A"
        
        if num >= 1_000_000_000_000:  # Trillion
            return f"${num / 1_000_000_000_000:.2f}T"
        elif num >= 1_000_000_000:  # Billion
            return f"${num / 1_000_000_000:.2f}B"
        elif num >= 1_000_000:  # Million
            return f"${num / 1_000_000:.2f}M"
        elif num >= 1_000:  # Thousand
            return f"${num / 1_000:.2f}K"
        else:
            return f"${num:.2f}"
    
    @staticmethod
    def get_company_name_from_symbol(symbol: str) -> str:
        """Get company name from symbol (using Yahoo Finance API with fallback to local mapping)"""
        try:
            # First try to get the company name from Yahoo Finance API
            import urllib.request
            response = urllib.request.urlopen(f'https://query2.finance.yahoo.com/v1/finance/search?q={symbol}')
            content = response.read()
            data = json.loads(content.decode('utf8'))
            if data.get('quotes') and len(data['quotes']) > 0:
                return data['quotes'][0]['shortname']
        except Exception as e:
            logger.error(f"Error fetching company name from Yahoo Finance: {e}")
            
        # Fallback to local mapping if API call fails
        symbol_to_name = {
            "BCS": "Barclays PLC",
            "AAPL": "Apple Inc.",
            "MSFT": "Microsoft Corporation",
            "GOOGL": "Alphabet Inc.",
            "AMZN": "Amazon.com, Inc.",
            "META": "Meta Platforms, Inc.",
            "TSLA": "Tesla, Inc.",
            "NVDA": "NVIDIA Corporation",
            "JPM": "JPMorgan Chase & Co.",
            "BAC": "Bank of America Corporation"
        }
        return symbol_to_name.get(symbol, f"{symbol} Stock")
    
    @staticmethod
    async def get_news_data(symbol: str = None) -> List[dict]:
        """Fetch news data from Finnhub API"""
        try:
            # Set date range for news (last 7 days)
            #current_date = datetime.now().strftime("%Y-%m-%d")
            from_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
            to_date = (datetime.now() - timedelta(days=23)).strftime("%Y-%m-%d")
            
            # Use ThreadPoolExecutor to run Finnhub client in a separate thread
            with ThreadPoolExecutor() as executor:
                loop = asyncio.get_event_loop()
                
                if symbol and symbol != "":
                    # Fetch company-specific news
                    news = await loop.run_in_executor(
                        executor, 
                        lambda: APIClient._fetch_company_news(symbol, from_date, to_date)
                    )
                else:
                    # Fetch general market news
                    news = await loop.run_in_executor(
                        executor,
                        lambda: APIClient._fetch_general_news()
                    )
                
                # If no news found, return mock data
                if not news:
                    return APIClient.get_mock_news_data(symbol)
                
                # Process news data to ensure it has the required fields
                processed_news = []
                for article in news:
                    # Extract the actual URL from the Finnhub redirect URL
                    url = article.get('url', '').strip()
                    # Remove any surrounding backticks if present
                    if url.startswith('`') and url.endswith('`'):
                        url = url[1:-1].strip()
                    
                    # Clean image URL if present
                    image = article.get('image', '').strip()
                    if image.startswith('`') and image.endswith('`'):
                        image = image[1:-1].strip()
                    
                    # Create processed article with required fields
                    processed_article = {
                        'category': article.get('category', 'general'),
                        'datetime': article.get('datetime', int(datetime.now().timestamp())),
                        'headline': article.get('headline', 'No headline'),
                        'id': article.get('id', 0),
                        'image': image,
                        'related': article.get('related', symbol if symbol else ''),
                        'source': article.get('source', 'Unknown'),
                        'summary': article.get('summary', 'No summary available.'),
                        'url': url
                    }
                    processed_news.append(processed_article)
                
                return processed_news
        except Exception as e:
            logger.error(f"Exception fetching news data: {e}")
            return APIClient.get_mock_news_data(symbol)
    
    @staticmethod
    def _fetch_company_news(symbol: str, from_date: str, to_date: str) -> List[dict]:
        """Fetch company-specific news using Finnhub client (runs in a separate thread)"""
        try:
            finnhub_client = finnhub.Client(api_key=FINNHUB_API_KEY)
            print(f"Fetching news for {symbol} from {from_date} to {to_date}")
            news = finnhub_client.company_news(symbol, _from=from_date, to=to_date)
            return news
        except Exception as e:
            logger.error(f"Error fetching company news: {e}")
            return []
    
    @staticmethod
    def _fetch_general_news(category: str = "general") -> List[dict]:
        """Fetch general market news using Finnhub client (runs in a separate thread)"""
        try:
            finnhub_client = finnhub.Client(api_key=FINNHUB_API_KEY)
            news = finnhub_client.general_news(category, min_id=0)
            return news
        except Exception as e:
            logger.error(f"Error fetching general news: {e}")
            return []

    @staticmethod
    def _symbol_lookup(query: str) -> List[dict]:
        """Look up stock symbols using Finnhub client (runs in a separate thread)"""
        try:
            finnhub_client = finnhub.Client(api_key=FINNHUB_API_KEY)
            results = finnhub_client.symbol_lookup(query)
            if results and 'result' in results:
                return results['result']
            return []
        except Exception as e:
            logger.error(f"Error in symbol lookup: {e}")
            return []
    
    @staticmethod
    def _company_peers(symbol: str) -> List[str]:
        """Get company peers using Finnhub client (runs in a separate thread)"""
        try:
            finnhub_client = finnhub.Client(api_key=FINNHUB_API_KEY)
            peers = finnhub_client.company_peers(symbol)
            return peers if peers else []
        except Exception as e:
            logger.error(f"Error fetching company peers: {e}")
            return []
    
    @staticmethod
    def get_mock_news_data(symbol: str = None) -> List[dict]:
        """Generate mock news data for testing"""
        company_name = APIClient.get_company_name_from_symbol(symbol) if symbol else "Market"
        current_time = int(asyncio.get_event_loop().time())
        
        # Generate 5 mock news articles
        mock_news = [
            {
                "category": "general",
                "datetime": current_time - 3600,  # 1 hour ago
                "headline": f"{company_name} Reports Strong Quarterly Earnings",
                "id": 1,
                "image": "",
                "related": symbol if symbol else "",
                "source": "Financial Times",
                "summary": f"{company_name} exceeded analyst expectations with quarterly revenue growth of 15% year-over-year.",
                "url": "https://example.com/news/1"
            },
            {
                "category": "general",
                "datetime": current_time - 7200,  # 2 hours ago
                "headline": f"Analysts Upgrade {company_name} Stock Rating",
                "id": 2,
                "image": "",
                "related": symbol if symbol else "",
                "source": "Bloomberg",
                "summary": f"Several major analysts have upgraded their outlook on {company_name}, citing strong growth potential.",
                "url": "https://example.com/news/2"
            },
            {
                "category": "general",
                "datetime": current_time - 10800,  # 3 hours ago
                "headline": f"{company_name} Announces New Product Launch",
                "id": 3,
                "image": "",
                "related": symbol if symbol else "",
                "source": "Reuters",
                "summary": f"{company_name} is set to launch a new innovative product next month, which could drive significant revenue growth.",
                "url": "https://example.com/news/3"
            },
            {
                "category": "general",
                "datetime": current_time - 14400,  # 4 hours ago
                "headline": f"Market Concerns Impact {company_name} Stock",
                "id": 4,
                "image": "",
                "related": symbol if symbol else "",
                "source": "CNBC",
                "summary": f"Broader market concerns have led to volatility in {company_name}'s stock price despite strong fundamentals.",
                "url": "https://example.com/news/4"
            },
            {
                "category": "general",
                "datetime": current_time - 18000,  # 5 hours ago
                "headline": f"{company_name} Expands International Operations",
                "id": 5,
                "image": "",
                "related": symbol if symbol else "",
                "source": "Wall Street Journal",
                "summary": f"{company_name} has announced plans to expand its operations in emerging markets, targeting new growth opportunities.",
                "url": "https://example.com/news/5"
            }
        ]
        
        # Add sentiment analysis to mock news
        for article in mock_news:
            text = f"{article['headline']} {article['summary']}"
            article['sentiment'] = SentimentAnalysis.analyze_sentiment(text)
        
        return mock_news

# Background task to fetch and broadcast stock and news data
async def stock_data_task():
    """Background task to fetch and broadcast stock and news data"""
    stock_counter = 0
    news_counter = 0
    
    while True:
        try:
            active_symbols = manager.get_active_symbols()
            if not active_symbols:
                active_symbols = [DEFAULT_SYMBOL]  # Default to BCS if no active connections
            
            # Fetch and broadcast stock data every STOCK_REFRESH_INTERVAL
            if stock_counter <= 0:
                for symbol in active_symbols:
                    stock_data = await APIClient.get_stock_data(symbol)
                    if stock_data:
                        await manager.broadcast_to_symbol(
                            symbol,
                            {"type": "stock_data", "data": stock_data}
                        )
                stock_counter = STOCK_REFRESH_INTERVAL
            
            # Fetch and broadcast news data every NEWS_REFRESH_INTERVAL
            if news_counter <= 0:
                for symbol in active_symbols:
                    news_data = await APIClient.get_news_data(symbol)
                    if news_data:
                        await manager.broadcast_to_symbol(
                            symbol,
                            {"type": "news_data", "data": news_data}
                        )
                news_counter = NEWS_REFRESH_INTERVAL
            
            # Decrement counters
            stock_counter -= 1
            news_counter -= 1
            
            # Sleep for 1 second
            await asyncio.sleep(1)
        except Exception as e:
            logger.error(f"Error in stock data task: {e}")
            await asyncio.sleep(5)  # Wait a bit longer on error

# Serve index.html
@app.get("/", response_class=HTMLResponse)
async def get_index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

# Serve favicon.ico
@app.get("/favicon.ico")
async def get_favicon():
    return FileResponse("favicon.ico") if os.path.exists("favicon.ico") else None

# WebSocket endpoint
@app.websocket("/ws/{symbol}")
async def websocket_endpoint(websocket: WebSocket, symbol: str):
    symbol = symbol.upper()
    await manager.connect(websocket, symbol)
    
    try:
        # Send initial stock data
        stock_data = await APIClient.get_stock_data(symbol)
        if stock_data:
            await websocket.send_text(json.dumps({"type": "stock_data", "data": stock_data}))
        
        # Send initial news data
        news_data = await APIClient.get_news_data(symbol)
        if news_data:
            await websocket.send_text(json.dumps({"type": "news_data", "data": news_data}))
        
        # Keep the connection open and handle messages
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                action = message.get("action")
                
                if action == "subscribe":
                    new_symbol = message.get("symbol", "").upper()
                    if new_symbol and new_symbol != symbol:
                        # Disconnect from current symbol
                        manager.disconnect(websocket, symbol)
                        # Connect to new symbol
                        symbol = new_symbol
                        await manager.connect(websocket, symbol)
                        
                        # Send initial data for new symbol
                        stock_data = await APIClient.get_stock_data(symbol)
                        if stock_data:
                            await websocket.send_text(json.dumps({"type": "stock_data", "data": stock_data}))
                        
                        news_data = await APIClient.get_news_data(symbol)
                        if news_data:
                            await websocket.send_text(json.dumps({"type": "news_data", "data": news_data}))
            except json.JSONDecodeError:
                pass  # Ignore invalid JSON
    except WebSocketDisconnect:
        manager.disconnect(websocket, symbol)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket, symbol)

@app.on_event("startup")
async def startup_event():
    # Start background task for fetching and broadcasting stock data
    asyncio.create_task(stock_data_task())

# Symbol lookup endpoint
@app.get("/api/symbol-lookup/{query}")
async def symbol_lookup(query: str):
    """API endpoint for symbol lookup suggestions"""
    try:
        # Run Finnhub client in a separate thread
        with ThreadPoolExecutor() as executor:
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                executor,
                lambda: APIClient._symbol_lookup(query)
            )
        
        # Return top 5 results
        return {"results": results[:5]}
    except Exception as e:
        logger.error(f"Error in symbol lookup API: {e}")
        return {"results": []}

# Company peers endpoint
@app.get("/api/company-peers/{symbol}")
async def company_peers(symbol: str):
    """API endpoint for company peers"""
    try:
        # Run Finnhub client in a separate thread
        with ThreadPoolExecutor() as executor:
            loop = asyncio.get_event_loop()
            peers = await loop.run_in_executor(
                executor,
                lambda: APIClient._company_peers(symbol)
            )
        
        # Get company names for each peer symbol
        peer_companies = {}
        for peer in peers:
            name = APIClient.get_company_name_from_symbol(peer)
            peer_companies[peer] = name
        
        return {"peers": peer_companies}
    except Exception as e:
        logger.error(f"Error in company peers API: {e}")
        return {"peers": {}}

# Sentiment Analysis class
class SentimentAnalysis:
    @staticmethod
    def analyze_sentiment(text):
        """
        Analyze sentiment using multiple methods (VADER, TextBlob, Afinn)
        and return combined results with detailed scores
        """
        if not text:
            return {
                "category": "neutral",
                "vader": {"compound": 0, "pos": 0, "neu": 0, "neg": 0},
                "textblob": {"polarity": 0, "subjectivity": 0},
                "afinn": {"score": 0},
                "custom_score": 0
            }
        
        # VADER analysis (good for social media and casual text)
        vader = SentimentIntensityAnalyzer()
        vader_scores = vader.polarity_scores(text)
        
        # TextBlob analysis (good for more formal text)
        blob = TextBlob(text)
        textblob_polarity = blob.sentiment.polarity
        textblob_subjectivity = blob.sentiment.subjectivity
        
        # Afinn analysis (simple lexicon-based approach with custom scoring)
        afinn = Afinn()
        afinn_score = afinn.score(text)
        
        # Calculate custom score (weighted average)
        # VADER compound score ranges from -1 to 1
        # TextBlob polarity ranges from -1 to 1
        # Afinn score is unbounded, so we normalize it to a range of -1 to 1
        normalized_afinn = max(min(afinn_score / 5, 1), -1)  # Normalize to -1 to 1 range
        
        # Custom weighted score (adjust weights as needed)
        custom_score = (
            vader_scores["compound"] * 0.4 +  # 40% weight to VADER
            textblob_polarity * 0.3 +        # 30% weight to TextBlob
            normalized_afinn * 0.3           # 30% weight to Afinn
        )
        
        # Determine sentiment category
        if custom_score > 0.05:
            category = "positive"
        elif custom_score < -0.05:
            category = "negative"
        else:
            category = "neutral"
        
        return {
            "category": category,
            "vader": {
                "compound": vader_scores["compound"],
                "pos": vader_scores["pos"],
                "neu": vader_scores["neu"],
                "neg": vader_scores["neg"]
            },
            "textblob": {
                "polarity": textblob_polarity,
                "subjectivity": textblob_subjectivity
            },
            "afinn": {
                "score": afinn_score
            },
            "custom_score": custom_score
        }

if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=3000, reload=True)