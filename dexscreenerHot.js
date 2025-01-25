const { queueUpdate } = require('./db');

function extractDexscreenerDetails(message) {
    const text = message.text || '';
    
    // Only process messages about entering hot pairs
    if (!text.includes('has just entered Solana Dexscreener hot pairs')) {
        return null;
    }

    const details = {
        contractAddress: null,
        tokenName: null,
        ticker: null
    };

    try {
        // Extract name and ticker - matches format "Name [TICKER]"
        const nameMatch = text.match(/🐤\s*(.*?)\s*\[(.*?)\]/);
        if (nameMatch) {
            details.tokenName = nameMatch[1].trim();
            details.ticker = nameMatch[2].trim();
        }

        // Extract contract address - now handles backticks
        const caMatch = text.match(/CA:\s*`?([A-Za-z0-9]{32,}(?:pump|[A-Za-z0-9]{11}))`?/);
        if (caMatch) {
            details.contractAddress = caMatch[1];
        }

        if (details.contractAddress && details.tokenName && details.ticker) {
            return details;
        }

        return null;
    } catch (error) {
        console.error('Error extracting dexscreener details:', error);
        return null;
    }
}

async function processDexscreenerHotMessage(message) {
    const details = extractDexscreenerDetails(message);
    
    if (!details) return;

    try {
        const query = `
            INSERT INTO tokens (contractAddress, tokenName, ticker, dexscreenerHot)
            VALUES (?, ?, ?, 'YES')
            ON CONFLICT(contractAddress) DO UPDATE SET
            tokenName = COALESCE(?, tokenName),
            ticker = COALESCE(?, ticker),
            dexscreenerHot = 'YES'
        `;
        
        await queueUpdate(query, [
            details.contractAddress,
            details.tokenName,
            details.ticker,
            details.tokenName,
            details.ticker
        ]);
        
        console.log(`Updated dexscreener hot status for ${details.tokenName} [${details.ticker}] (${details.contractAddress})`);
    } catch (error) {
        console.error('Error processing dexscreener hot message:', error);
    }
}

module.exports = {
    processMessage: processDexscreenerHotMessage
}; 