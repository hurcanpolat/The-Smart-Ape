const { queueUpdate } = require('./db');
const { getAllUrls, extractContractAddress } = require('./utils');

function extractEarlyTrendingDetails(message) {
    try {
        const text = message.text || '';
        
        if (!text.includes('New') || !text.includes('Trending')) {
            return null;
        }

        const urls = getAllUrls(message);
        for (const url of urls) {
            const address = extractContractAddress(url);
            if (address) {
                return address;
            }
        }

        return null;
    } catch (error) {
        console.error('Error extracting early trending details:', error);
        return null;
    }
}

async function processEarlyTrendingMessage(message) {
    const contractAddress = extractEarlyTrendingDetails(message);
    
    if (contractAddress) {
        const query = `
            INSERT INTO tokens (contractAddress, earlyTrending)
            VALUES (?, 'YES')
            ON CONFLICT(contractAddress) DO UPDATE SET
            earlyTrending = 'YES'
        `;
        await queueUpdate(query, [contractAddress]);
        console.log(`Updated trending status for ${contractAddress}: YES`);
    }
}

module.exports = {
    processMessage: processEarlyTrendingMessage
};