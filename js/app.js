/**
 * Trading Analytics Dashboard - Main Application
 * 
 * This file contains the main TradingApp class that initializes and manages the application.
 * It handles WebSocket connections, UI updates, and user interactions.
 */

class TradingApp {
    // Add these properties to the TradingApp constructor
    constructor() {
        // UI elements
        this.symbolSearchInput = document.getElementById('symbolSearch');
        this.searchBtn = document.getElementById('searchBtn');
        this.stockSymbolElement = document.getElementById('stockSymbol');
        this.stockNameElement = document.getElementById('stockName');
        this.currentPriceElement = document.getElementById('currentPrice');
        this.priceChangeElement = document.getElementById('priceChange');
        this.marketCapElement = document.getElementById('marketCap');
        this.peRatioElement = document.getElementById('peRatio');
        this.epsElement = document.getElementById('eps');
        this.betaElement = document.getElementById('beta');
        this.volumeElement = document.getElementById('volume');
        this.prevCloseElement = document.getElementById('prevClose');
        this.openElement = document.getElementById('open');
        this.daysRangeElement = document.getElementById('daysRange');
        this.fiftyTwoWeekRangeElement = document.getElementById('fiftyTwoWeekRange');
        this.avgVolumeElement = document.getElementById('avgVolume');
        this.dividendYieldElement = document.getElementById('dividendYield');
        this.dividendRateElement = document.getElementById('dividendRate');
        this.newsListElement = document.getElementById('newsList');
        this.sentimentChartElement = document.getElementById('sentimentChart');
        this.symbolSuggestionsElement = document.getElementById('symbolSuggestions');
        this.peerCompaniesSectionElement = document.getElementById('peerCompaniesSection');
        this.peerCompaniesListElement = document.getElementById('peerCompaniesList');
        
        // Debounce timer for symbol lookup
        this.symbolLookupTimer = null;
        
        // Current stock symbol
        this.currentSymbol = config.DEFAULT_STOCK_SYMBOL;
        
        // WebSocket connection
        this.socket = null;
        
        // Sentiment chart instance
        this.sentimentChart = null;
        
        // Initialize the application
        this.init();
    }
    
    // Add these methods to the TradingApp class
    
    /**
     * Initialize the application
     */
    // Add this at the top of your init() method
    init() {
        // Check if Chart.js is loaded
        if (typeof Chart === 'undefined') {
            console.error('Chart.js is not loaded!');
        } else {
            console.log('Chart.js is loaded successfully');
        }
        
        // Set up event listeners
        this.searchBtn.addEventListener('click', () => this.handleSymbolSearch());
        this.symbolSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleSymbolSearch();
            }
        });
        // Add input event for symbol search suggestions
        this.symbolSearchInput.addEventListener('input', () => this.handleSymbolInput());

        // Add click event outside suggestions to close them
        document.addEventListener('click', (e) => {
            if (!this.symbolSearchInput.contains(e.target) && !this.symbolSuggestionsElement.contains(e.target)) {
                this.symbolSuggestionsElement.style.display = 'none';
            
            }
        });
        
        // Set initial stock symbol
        this.stockSymbolElement.textContent = this.currentSymbol;
        
        // Connect to WebSocket for the default symbol
        this.connectWebSocket(this.currentSymbol);
        
        // Initialize sentiment chart with empty data
        this.initSentimentChart();
    }
    
    /**
     * Connect to WebSocket for real-time data updates
     * @param {string} symbol - Stock symbol to subscribe to
     */
    connectWebSocket(symbol) {
        // Close existing socket if any
        if (this.socket) {
            this.socket.close();
        }
        
        // Create new WebSocket connection
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/${symbol}`;
        
        this.socket = new WebSocket(wsUrl);
        
        // WebSocket event handlers
        this.socket.onopen = () => {
            console.log(`WebSocket connected for symbol: ${symbol}`);
            // Subscribe to the symbol
            this.socket.send(JSON.stringify({
                action: 'subscribe',
                symbol: symbol
            }));
        };
        
        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === 'stock_data') {
                this.updateStockUI(data.data);
            } else if (data.type === 'news_data') {
                this.updateNewsUI(data.data);
            }
        };
        
        this.socket.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
        
        this.socket.onclose = () => {
            console.log('WebSocket connection closed');
            // Try to reconnect after a delay
            setTimeout(() => {
                if (this.socket.readyState === WebSocket.CLOSED) {
                    this.connectWebSocket(this.currentSymbol);
                }
            }, 5000);
        };
    }
    /**
    * Handle symbol input for suggestions
    */
    handleSymbolInput() {
        const query = this.symbolSearchInput.value.trim();
    
        // Clear previous timer
        if (this.symbolLookupTimer) {
            clearTimeout(this.symbolLookupTimer);
        }
    
        // Clear suggestions if query is empty
        if (!query) {
            this.symbolSuggestionsElement.style.display = 'none';
            return;
        }
    
        // Set a timer to avoid too many requests
        this.symbolLookupTimer = setTimeout(() => {
        this.fetchSymbolSuggestions(query);
        }, 300); // 300ms debounce
    }

    /**
    * Fetch symbol suggestions from API
    * @param {string} query - Search query
    */
    async fetchSymbolSuggestions(query) {
        try {
            const response = await fetch(`/api/symbol-lookup/${encodeURIComponent(query)}`);
            const data = await response.json();
        
            this.displaySymbolSuggestions(data.results);
        } catch (error) {
            console.error('Error fetching symbol suggestions:', error);
        }
    }

    /**
    * Display symbol suggestions
    * @param {Array} suggestions - Symbol suggestions
    */
    displaySymbolSuggestions(suggestions) {
        // Clear previous suggestions
        this.symbolSuggestionsElement.innerHTML = '';
    
        if (!suggestions || suggestions.length === 0) {
            this.symbolSuggestionsElement.style.display = 'none';
            return;
        }
    
        // Create suggestion items
        suggestions.forEach(item => {
            const suggestionItem = document.createElement('div');
            suggestionItem.className = 'suggestion-item';
            suggestionItem.innerHTML = `
                <span class="symbol">${item.symbol}</span>
                <span class="description">${item.description || ''}</span>
            `;
        
            // Add click event to select suggestion
            suggestionItem.addEventListener('click', () => {
                this.symbolSearchInput.value = item.symbol;
                this.symbolSuggestionsElement.style.display = 'none';
                this.handleSymbolSearch();
            });
        
            this.symbolSuggestionsElement.appendChild(suggestionItem);
        });
    
        // Show suggestions
        this.symbolSuggestionsElement.style.display = 'block';
    }
   
    /**
     * Handle symbol search from user input
     */
    handleSymbolSearch() {
        const newSymbol = this.symbolSearchInput.value.trim().toUpperCase();
        
        if (newSymbol && newSymbol !== this.currentSymbol) {
            // Update current symbol
            this.currentSymbol = newSymbol;
            this.stockSymbolElement.textContent = this.currentSymbol;
            
            // Clear existing data
            this.clearStockData();
            this.clearNewsData();
            
            // Connect to WebSocket for the new symbol
            this.connectWebSocket(this.currentSymbol);
            // Fetch peer companies
            this.fetchPeerCompanies(this.currentSymbol);
        }
    }
    
    /**
    * Fetch peer companies from API
    * @param {string} symbol - Stock symbol
    */
    async fetchPeerCompanies(symbol) {
        try {
            // Show loading
            this.peerCompaniesSectionElement.style.display = 'block';
            this.peerCompaniesListElement.innerHTML = '<div class="loading-message">Loading peer companies...</div>';
        
            const response = await fetch(`/api/company-peers/${encodeURIComponent(symbol)}`);
            const data = await response.json();
        
            this.displayPeerCompanies(data.peers);
        } catch (error) {
            console.error('Error fetching peer companies:', error);
            this.peerCompaniesListElement.innerHTML = '<div class="error-message">Failed to load peer companies.</div>';
        }
    }

    /**
     * Update the UI with stock data
     * @param {Object} stockData - Stock data received from WebSocket
     */
    updateStockUI(stockData) {
        if (!stockData) return;
        
        // Update stock name
        if (stockData.name) {
            this.stockNameElement.textContent = stockData.name;
        }
        
        // Update price and price change
        if (stockData.price) {
            this.currentPriceElement.textContent = `$${stockData.price.toFixed(2)}`;
        }
        
        if (stockData.change && stockData.changePercent) {
            const changeText = `$${stockData.change.toFixed(2)} (${stockData.changePercent.toFixed(2)}%)`;
            this.priceChangeElement.textContent = changeText;
            
            // Update class based on price change
            this.priceChangeElement.className = 'price-change';
            if (stockData.change > 0) {
                this.priceChangeElement.classList.add('positive');
            } else if (stockData.change < 0) {
                this.priceChangeElement.classList.add('negative');
            }
        }
        
        // Update market data
        if (stockData.marketCap) {
            this.marketCapElement.textContent = stockData.marketCap;
        }
        
        if (stockData.peRatio) {
            this.peRatioElement.textContent = stockData.peRatio;
        }
        
        // Update additional financial metrics
        if (stockData.eps !== undefined) {
            this.epsElement.textContent = stockData.eps !== null ? stockData.eps.toFixed(2) : 'N/A';
        }
        
        if (stockData.beta !== undefined) {
            this.betaElement.textContent = stockData.beta !== null ? stockData.beta.toFixed(2) : 'N/A';
        }
        
        if (stockData.dividendYield !== undefined) {
            this.dividendYieldElement.textContent = stockData.dividendYield !== null ? 
                `${(stockData.dividendYield * 100).toFixed(2)}%` : 'N/A';
        }
        
        if (stockData.dividendRate !== undefined) {
            this.dividendRateElement.textContent = stockData.dividendRate !== null ? 
                `$${stockData.dividendRate.toFixed(2)}` : 'N/A';
        }
        
        if (stockData.volume) {
            this.volumeElement.textContent = stockData.volume;
        }
        
        if (stockData.prevClose) {
            this.prevCloseElement.textContent = `$${stockData.prevClose.toFixed(2)}`;
        }
        
        if (stockData.open) {
            this.openElement.textContent = `$${stockData.open.toFixed(2)}`;
        }
        
        if (stockData.dayLow && stockData.dayHigh) {
            this.daysRangeElement.textContent = `$${stockData.dayLow.toFixed(2)} - $${stockData.dayHigh.toFixed(2)}`;
        }
        
        if (stockData.fiftyTwoWeekLow && stockData.fiftyTwoWeekHigh) {
            this.fiftyTwoWeekRangeElement.textContent = `$${stockData.fiftyTwoWeekLow.toFixed(2)} - $${stockData.fiftyTwoWeekHigh.toFixed(2)}`;
        }
        
        if (stockData.avgVolume) {
            this.avgVolumeElement.textContent = stockData.avgVolume;
        }
    }
    
    /**
    * Display peer companies
    * @param {Object} peers - Peer companies object with symbol as key and name as value
    */
    displayPeerCompanies(peers) {
        // Clear previous peer companies
        this.peerCompaniesListElement.innerHTML = '';
    
        if (!peers || Object.keys(peers).length === 0) {
            this.peerCompaniesSectionElement.style.display = 'none';
            return;
        }
    
        // Create peer company items
        Object.entries(peers).forEach(([symbol, name]) => {
            const peerItem = document.createElement('div');
            peerItem.className = 'peer-company-item';
            peerItem.innerHTML = `
               <div class="peer-company-symbol">${symbol}</div>
               <div class="peer-company-name">${name}</div>
            `;
        
            // Add click event to select peer company
            peerItem.addEventListener('click', () => {
                this.symbolSearchInput.value = symbol;
                this.handleSymbolSearch();
            });
        
            this.peerCompaniesListElement.appendChild(peerItem);
        });
    
        // Show peer companies section
        this.peerCompaniesSectionElement.style.display = 'block';
    }
    /**
    * Clear peer companies
    */
    clearPeerCompanies() {
        this.peerCompaniesListElement.innerHTML = '';
        this.peerCompaniesSectionElement.style.display = 'none';
    }

    /**
     * Update the UI with news data and sentiment analysis
     * @param {Array} newsData - News data received from WebSocket
     */
    updateNewsUI(newsData) {
        if (!newsData || !Array.isArray(newsData) || newsData.length === 0) {
            this.newsListElement.innerHTML = '<div class="no-news">No news articles available.</div>';
            return;
        }
        
        // Initialize sentiment counts
        const sentimentCounts = {
            positive: 0,
            neutral: 0,
            negative: 0
        };
        
        // Count sentiments from backend analysis
        newsData.forEach(article => {
            if (article.sentiment && article.sentiment.category) {
                sentimentCounts[article.sentiment.category]++;
            }
        });
        
        // Update sentiment chart
        this.updateSentimentChart(sentimentCounts);
        
        // Clear news list
        this.newsListElement.innerHTML = '';
        
        // Free stock image URLs (no copyright issues)
        const defaultImages = [
            'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3',
            'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3',
            'https://images.unsplash.com/photo-1535320903710-d993d3d77d29?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3',
            'https://images.unsplash.com/photo-1535320485706-44d43b919500?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3',
            'https://images.unsplash.com/photo-1560221328-12fe60f83ab8?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3'
        ];
        
        // Add news articles to the list
        newsData.forEach((article, index) => {
            if (index >= config.MAX_NEWS_ARTICLES) return;
            
            const sentiment = article.sentiment ? article.sentiment.category : 'neutral';
            const sentimentClass = sentiment.charAt(0).toUpperCase() + sentiment.slice(1);
            const customScore = article.sentiment ? article.sentiment.custom_score.toFixed(2) : '0.00';
            
            // Get image URL from article or use a default image
            let imageUrl = article.image && article.image.trim() !== '' ? 
                article.image : defaultImages[index % defaultImages.length];
            
            const articleElement = document.createElement('div');
            articleElement.className = `news-item`;
            
            const date = new Date(article.datetime * 1000);
            const formattedDate = date.toLocaleDateString();
            
            // Create tooltip content with detailed sentiment scores
            const tooltipContent = article.sentiment ? `
                <div class="sentiment-details">
                    <div><strong>VADER:</strong> ${article.sentiment.vader.compound.toFixed(2)}</div>
                    <div><strong>TextBlob:</strong> ${article.sentiment.textblob.polarity.toFixed(2)}</div>
                    <div><strong>Afinn:</strong> ${article.sentiment.afinn.score.toFixed(2)}</div>
                </div>
            ` : '';
            
            articleElement.innerHTML = `
                <img class="news-image" src="${imageUrl}" alt="${article.headline}" onerror="this.src='${defaultImages[index % defaultImages.length]}'">
                <div class="news-content">
                    <div class="news-header">
                        <span class="news-date">${formattedDate}</span>
                        <span class="news-sentiment ${sentimentClass} tooltip">
                            ${sentimentClass} (${customScore})
                            <span class="tooltiptext">${tooltipContent}</span>
                        </span>
                    </div>
                    <h3 class="news-title">
                        <a href="${article.url}" target="_blank">${article.headline}</a>
                    </h3>
                    <p class="news-summary">${article.summary || 'No summary available.'}</p>
                    <div class="news-source">Source: ${article.source}</div>
                </div>
            `;
            
            this.newsListElement.appendChild(articleElement);
        });
    }
    
    /**
     * Initialize the sentiment chart with empty data
     */
    /**
     * Initialize the sentiment chart with empty data
     */
    initSentimentChart() {
        try {
            const ctx = this.sentimentChartElement.getContext('2d');
            
            if (!ctx) {
                console.error('Could not get 2D context for sentiment chart');
                return;
            }
            
            this.sentimentChart = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: ['Positive', 'Neutral', 'Negative'],
                    datasets: [{
                        data: [0, 0, 0],
                        backgroundColor: [
                            config.CHART_COLORS.POSITIVE,
                            config.CHART_COLORS.NEUTRAL,
                            config.CHART_COLORS.NEGATIVE
                        ],
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom'
                        },
                        title: {
                            display: true,
                            text: 'News Sentiment Distribution'
                        }
                    }
                }
            });
            console.log('Sentiment chart initialized successfully');
        } catch (error) {
            console.error('Error initializing sentiment chart:', error);
        }
    }
    
    /**
     * Update the sentiment chart with new data
     * @param {Object} sentimentCounts - Counts of positive, neutral, and negative sentiments
     */
    updateSentimentChart(sentimentCounts) {
        if (!this.sentimentChart) return;
        
        this.sentimentChart.data.datasets[0].data = [
            sentimentCounts.positive,
            sentimentCounts.neutral,
            sentimentCounts.negative
        ];
        
        this.sentimentChart.update();
    }
    
    /**
     * Clear stock data from the UI
     */
    clearStockData() {
        this.currentPriceElement.textContent = '$0.00';
        this.priceChangeElement.textContent = '$0.00 (0.00%)';
        this.priceChangeElement.className = 'price-change';
        this.marketCapElement.textContent = '$0.00B';
        this.peRatioElement.textContent = '0.00';
        this.epsElement.textContent = 'N/A';
        this.betaElement.textContent = 'N/A';
        this.dividendYieldElement.textContent = 'N/A';
        this.dividendRateElement.textContent = 'N/A';
        this.volumeElement.textContent = '0';
        this.prevCloseElement.textContent = '$0.00';
        this.openElement.textContent = '$0.00';
        this.daysRangeElement.textContent = '$0.00 - $0.00';
        this.fiftyTwoWeekRangeElement.textContent = '$0.00 - $0.00';
        this.avgVolumeElement.textContent = '0';
    }
    
    /**
     * Clear news data from the UI
     */
    clearNewsData() {
        this.newsListElement.innerHTML = '<div class="loading-message">Loading news articles...</div>';
        
        if (this.sentimentChart) {
            this.sentimentChart.data.datasets[0].data = [0, 0, 0];
            this.sentimentChart.update();
        }
    }
}

// Add these methods to the TradingApp class

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new TradingApp();
});


