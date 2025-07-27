/**
 * Sentiment Analysis Module for Trading Analytics Dashboard
 * 
 * This module provides sentiment analysis functionality for news articles
 * using a simple lexicon-based approach with predefined positive and negative word lists.
 */

class SentimentAnalyzer {
    // Positive and negative word lists for simple sentiment analysis
    static positiveWords = [
        'gain', 'gains', 'gained', 'rise', 'rises', 'rising', 'rose', 'up', 'upward', 'climb', 'climbs', 'climbing',
        'increase', 'increases', 'increasing', 'increased', 'higher', 'improve', 'improves', 'improving', 'improved',
        'improvement', 'improvements', 'positive', 'strong', 'stronger', 'strength', 'opportunity', 'opportunities',
        'optimistic', 'optimism', 'upbeat', 'confident', 'confidence', 'support', 'supports', 'supporting', 'supported',
        'buy', 'buying', 'growth', 'growing', 'grew', 'expand', 'expands', 'expanding', 'expanded', 'expansion',
        'beat', 'beats', 'beating', 'exceeded', 'exceed', 'exceeds', 'exceeding', 'outperform', 'outperforms',
        'outperforming', 'outperformed', 'success', 'successful', 'successfully', 'bullish', 'rally', 'rallies',
        'rallying', 'rallied', 'recover', 'recovers', 'recovering', 'recovered', 'recovery', 'profit', 'profits',
        'profitable', 'profitability', 'advantage', 'advantages', 'advantageous', 'promising', 'prospect', 'prospects'
    ];
    
    static negativeWords = [
        'loss', 'losses', 'lost', 'fall', 'falls', 'falling', 'fell', 'down', 'downward', 'drop', 'drops', 'dropping',
        'dropped', 'decrease', 'decreases', 'decreasing', 'decreased', 'lower', 'decline', 'declines', 'declining',
        'declined', 'weaker', 'weak', 'weakness', 'negative', 'risk', 'risks', 'risky', 'danger', 'dangerous',
        'pessimistic', 'pessimism', 'downturn', 'downbeat', 'worried', 'worry', 'worries', 'worrying', 'concern',
        'concerns', 'concerning', 'concerned', 'sell', 'selling', 'sold', 'shrink', 'shrinks', 'shrinking', 'shrank',
        'shrinkage', 'contract', 'contracts', 'contracting', 'contracted', 'contraction', 'miss', 'misses', 'missing',
        'missed', 'disappoint', 'disappoints', 'disappointing', 'disappointed', 'disappointment', 'underperform',
        'underperforms', 'underperforming', 'underperformed', 'fail', 'fails', 'failing', 'failed', 'failure',
        'bearish', 'slump', 'slumps', 'slumping', 'slumped', 'plunge', 'plunges', 'plunging', 'plunged',
        'struggle', 'struggles', 'struggling', 'struggled', 'recession', 'crisis', 'problem', 'problems',
        'problematic', 'challenge', 'challenges', 'challenging', 'challenged', 'threat', 'threats', 'threatening',
        'threatened', 'warning', 'warn', 'warns', 'warned', 'cut', 'cuts', 'cutting', 'layoff', 'layoffs'
    ];
    
    /**
     * Analyze the sentiment of a news article
     * @param {Object} article - News article object
     * @returns {Object} - Article with sentiment analysis added
     */
    static analyzeArticleSentiment(article) {
        const text = `${article.headline || ''} ${article.summary || ''}`;
        const textLower = text.toLowerCase();
        
        let positiveScore = 0;
        let negativeScore = 0;
        
        // Count positive and negative words
        this.positiveWords.forEach(word => {
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            const matches = textLower.match(regex);
            if (matches) {
                positiveScore += matches.length;
            }
        });
        
        this.negativeWords.forEach(word => {
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            const matches = textLower.match(regex);
            if (matches) {
                negativeScore += matches.length;
            }
        });
        
        // Determine sentiment based on scores
        let sentiment;
        if (positiveScore > negativeScore) {
            sentiment = 'positive';
        } else if (negativeScore > positiveScore) {
            sentiment = 'negative';
        } else {
            sentiment = 'neutral';
        }
        
        // Add sentiment data to article
        return {
            ...article,
            sentiment,
            sentimentScores: {
                positive: positiveScore,
                negative: negativeScore,
                net: positiveScore - negativeScore
            }
        };
    }
    
    /**
     * Analyze sentiment for a list of news articles
     * @param {Array} articles - List of news articles
     * @returns {Object} - Articles with sentiment and summary stats
     */
    static analyzeNewsSentiment(articles) {
        // Analyze each article
        const analyzedArticles = articles.map(article => this.analyzeArticleSentiment(article));
        
        // Count sentiment distribution
        const sentimentCounts = {
            positive: 0,
            neutral: 0,
            negative: 0
        };
        
        analyzedArticles.forEach(article => {
            sentimentCounts[article.sentiment]++;
        });
        
        // Calculate overall sentiment
        let overallSentiment;
        if (sentimentCounts.positive > sentimentCounts.negative && sentimentCounts.positive > sentimentCounts.neutral) {
            overallSentiment = 'positive';
        } else if (sentimentCounts.negative > sentimentCounts.positive && sentimentCounts.negative > sentimentCounts.neutral) {
            overallSentiment = 'negative';
        } else {
            overallSentiment = 'neutral';
        }
        
        return {
            articles: analyzedArticles,
            sentimentCounts,
            overallSentiment
        };
    }
    
    /**
     * Analyze sentiment for a list of news articles and return sentiment counts and article sentiments
     * @param {Array} articles - List of news articles
     * @returns {Object} - Object containing sentiment counts and article sentiments
     */
    static analyzeSentimentForArticles(articles) {
        // Initialize sentiment counts
        const sentimentCounts = {
            positive: 0,
            neutral: 0,
            negative: 0
        };
        
        // Array to store sentiment for each article
        const articleSentiments = [];
        
        // Analyze each article
        articles.forEach(article => {
            const text = `${article.headline || ''} ${article.summary || ''}`;
            const textLower = text.toLowerCase();
            
            let positiveScore = 0;
            let negativeScore = 0;
            
            // Count positive and negative words
            this.positiveWords.forEach(word => {
                const regex = new RegExp(`\\b${word}\\b`, 'gi');
                const matches = textLower.match(regex);
                if (matches) {
                    positiveScore += matches.length;
                }
            });
            
            this.negativeWords.forEach(word => {
                const regex = new RegExp(`\\b${word}\\b`, 'gi');
                const matches = textLower.match(regex);
                if (matches) {
                    negativeScore += matches.length;
                }
            });
            
            // Determine sentiment based on scores
            let sentiment;
            if (positiveScore > negativeScore) {
                sentiment = 'Positive';
                sentimentCounts.positive++;
            } else if (negativeScore > positiveScore) {
                sentiment = 'Negative';
                sentimentCounts.negative++;
            } else {
                sentiment = 'Neutral';
                sentimentCounts.neutral++;
            }
            
            // Add sentiment to array
            articleSentiments.push(sentiment);
        });
        
        return {
            sentimentCounts,
            articleSentiments
        };
    }
}