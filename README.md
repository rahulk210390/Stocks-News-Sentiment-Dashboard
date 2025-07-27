# Trading Analytics Dashboard

A responsive web application that displays detailed stock information and analytics for selected stock symbols, with a default view of Barclays (BCS). This application uses Python FastAPI with WebSockets for real-time data updates.

## Features

- **Symbol Selector**: Search for and select different stock symbols to view their data
- **Dashboard Panel**: Displays current price, price change, market cap, P/E ratio, volume, and other key statistics
- **Sentiment Analysis**: Analyzes news articles to determine positive, neutral, or negative sentiment
- **Responsive Design**: Optimized for both desktop and mobile viewing
- **Real-time Updates**: Uses WebSockets for instant data updates without page refresh

## Getting Started

### Prerequisites

- Python 3.8+ installed
- A Finnhub API key (get one for free at [finnhub.io](https://finnhub.io/))

### Setup

1. Clone this repository to your local machine
2. Install Python dependencies:
   ```
   pip install -r requirements.txt
   ```
3. Create a `.env` file in the root directory and set your Finnhub API key:

   ```
   FINNHUB_API_KEY=your_actual_finnhub_api_key
   ```
   
   > Note: If you don't have a Finnhub API key, the application will use mock data for news articles.
   
4. Start the server:
   ```
   python app.py
   ```
5. Open your browser and navigate to `http://localhost:3000`

## Project Structure

```
├── app.py                # Python FastAPI server with WebSocket support
├── templates/
│   └── index.html        # Main HTML template for FastAPI
├── css/
│   └── styles.css        # CSS styles for the application
├── js/
│   ├── app.js            # Main application logic with WebSocket client
│   ├── sentiment.js      # Sentiment analysis functions
│   └── config.js         # Configuration settings
├── requirements.txt      # Python dependencies
└── README.md            # Project documentation
```

Note: The project has been migrated from a Node.js Express server to a Python FastAPI backend with WebSocket support. The `server.js` and `api.js` files are no longer used but are kept for reference.

## How It Works

### WebSocket Communication

The application uses WebSockets to establish a persistent connection between the client and server, enabling real-time data updates:

1. The server fetches stock data every 10 seconds and news data every 5 minutes
2. When new data is available, it's immediately pushed to all connected clients
3. The client receives the updates and refreshes the UI without reloading the page

### Stock Data

The application fetches stock data from the Yahoo Finance API, which provides real-time or delayed stock information including:

- Current price and price changes
- Previous close, open, high, low
- Volume and market capitalization
- P/E ratio and 52-week range

### News Sentiment Analysis

The application fetches news articles from the Finnhub General News API (or uses mock data if no API key is provided) and performs sentiment analysis by:

1. Analyzing each article's headline and summary for positive and negative keywords
2. Classifying each article as positive, neutral, or negative
3. Displaying a pie chart showing the distribution of sentiment across all articles
4. Listing the articles with their sentiment classification

## Customization

You can customize various aspects of the application by modifying the `config.js` file:

- Default stock symbol
- Maximum number of news articles to display
- Chart colors for sentiment analysis
- WebSocket reconnection settings

## Browser Compatibility

The application is compatible with modern browsers including:

- Google Chrome
- Mozilla Firefox
- Microsoft Edge
- Safari

## License

This project is licensed under the MIT License - see the LICENSE file for details.