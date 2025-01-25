const { queueUpdate } = require('./db');
const { getAllUrls, extractContractAddress } = require('./utils'); // Adjust the path as necessary

function extractLiquidityDetails(message) {
    const text = message.text || '';
    const details = {
        tokenName: 'N/A',
        ticker: 'N/A',
        contractAddress: 'N/A',
        description: 'N/A',
        securityScore: 'N/A'
    };

    try {
        // Extract token name and ticker
        const nameTickerRegex = /\*\*(.*?)\s*—\s*(.*?)\*\*/;
        const ntMatch = text.match(nameTickerRegex);
        if (ntMatch) {
            details.tokenName = ntMatch[1].trim();
            details.ticker = ntMatch[2].trim();
        }

        // Extract contract address
        const caRegex = /`([A-Za-z0-9]{32,}(?:pump|[A-Za-z0-9]{11}))`/;
        const caMatch = text.match(caRegex);
        if (caMatch) {
            details.contractAddress = caMatch[1].trim();
        }

        // Extract security score using the new function
        const securityScore = extractSecurityScore(text);
        if (securityScore) {
            details.securityScore = securityScore;
        }

        // Extract description
        const descriptionMatch = text.match(/\*\*💵 Price:.*?\n\n(.*?)\n\n\*\*⚙️ Security/s);
        if (descriptionMatch) {
            details.description = descriptionMatch[1].trim();
        }
    } catch (error) {
        console.error('Error extracting liquidity details:', error);
    }

    return details;
}

function extractSecurityScore(text) {
    const scoreMatch = text.match(/🧠\s*\*\*Score:\s*(Good|Bad|Neutral)(?:\s*\([0-9]+\))?\s*[🟢🔴🟡]+\*\*/);
    if (scoreMatch) {
        return scoreMatch[1];
    }
    return null;
}

async function processLiquidityTrackerMessage(message) {
    const tokenDetails = extractLiquidityDetails(message);
  
    if (tokenDetails.contractAddress && tokenDetails.contractAddress !== 'N/A') {
        const query = `
            INSERT INTO tokens (
                contractAddress, 
                tokenName, 
                ticker, 
                description, 
                securityScore
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(contractAddress) DO UPDATE SET
            tokenName = COALESCE(?, tokenName),
            ticker = COALESCE(?, ticker),
            description = COALESCE(?, description),
            securityScore = COALESCE(?, securityScore)
        `;
        
        const params = [
            tokenDetails.contractAddress,
            tokenDetails.tokenName,
            tokenDetails.ticker,
            tokenDetails.description,
            tokenDetails.securityScore,
            tokenDetails.tokenName,
            tokenDetails.ticker,
            tokenDetails.description,
            tokenDetails.securityScore
        ];
        
        await queueUpdate(query, params);
    }
}

module.exports = {
    processMessage: processLiquidityTrackerMessage
};