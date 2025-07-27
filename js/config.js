/**
 * Configuration settings for the Stock news Sentiment app
 */
const config = {
    // Default stock symbol to display
    DEFAULT_STOCK_SYMBOL: 'BCS',
    
    // Maximum number of news articles to display
    MAX_NEWS_ARTICLES: 20,
    
    // Chart colors for sentiment analysis (updated to more professional tones)
    CHART_COLORS: {
        POSITIVE: '#28A745',  // Softer green
        NEUTRAL: '#9e9e9e',   // Medium grey
        NEGATIVE: '#DC3545'   // Softer red
    },
    
    // WebSocket reconnection settings
    WEBSOCKET: {
        RECONNECT_DELAY: 5000,  // 5 seconds
        MAX_RECONNECT_ATTEMPTS: 5
    }
};