const { queueUpdate } = require('./db');

function extractVolumeDetails(message) {
    const text = message.text || '';
    
    // Only process messages that start with 🔔
    if (!text.startsWith('🔔')) {
        return null;
    }

    const details = {
        contractAddress: null,
        tokenName: null,
        ticker: null
    };

    try {
        // Updated name and ticker pattern - now handles format without parentheses
        const nameMatch = text.match(/🔔(.*?)\|\s*(\S+)/);
        if (nameMatch) {
            details.tokenName = nameMatch[1].trim();
            details.ticker = nameMatch[2].trim();
        }

        // Updated CA pattern - now handles markdown formatting
        const caMatch = text.match(/\*\*CA:\*\*\s*`?([A-Za-z0-9]{32,}(?:pump|[A-Za-z0-9]{11}))`?/) ||
                       text.match(/CA:\s*`?([A-Za-z0-9]{32,}(?:pump|[A-Za-z0-9]{11}))`?/) ||
                       text.match(/token\/([A-Za-z0-9]{32,}(?:pump|[A-Za-z0-9]{11}))/);
        if (caMatch) {
            details.contractAddress = caMatch[1];
        }

        if (details.contractAddress && details.tokenName && details.ticker) {
            return details;
        }

        return null;
    } catch (error) {
        console.error('Error extracting volume details:', error);
        return null;
    }
}

async function processVolumeTrackerMessage(message) {
    const details = extractVolumeDetails(message);
    
    if (!details) return;

    try {
        const query = `
            INSERT INTO tokens (contractAddress, tokenName, ticker, highVolume)
            VALUES (?, ?, ?, 'YES')
            ON CONFLICT(contractAddress) DO UPDATE SET
            tokenName = COALESCE(?, tokenName),
            ticker = COALESCE(?, ticker),
            highVolume = 'YES'
        `;
        
        await queueUpdate(query, [
            details.contractAddress,
            details.tokenName,
            details.ticker,
            details.tokenName,
            details.ticker
        ]);
        
        console.log(`Updated high volume status for ${details.tokenName} [${details.ticker}] (${details.contractAddress})`);
    } catch (error) {
        console.error('Error processing volume tracker message:', error);
    }
}

module.exports = {
    processMessage: processVolumeTrackerMessage
}; 