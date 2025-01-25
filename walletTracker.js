const { queueUpdate } = require('./db');
const { getAllUrls, extractContractAddress } = require('./utils');

const processedAddresses = new Set();

function extractTokenDetails(message) {
    const text = message.text || '';
    const tokenDetails = [];
    const urls = getAllUrls(message);

    // First find lines with 🌱 emoji
    const lines = text.split('\n');
    lines.forEach(line => {
        const transferMatch = line.match(/sent ([\d,]+(?:\.\d+)?)\s+🌱\s+([A-Z0-9]+)\s+\(\$([0-9,.]+)\)\s+to\s+🤓\s+([^\n]+)$/);
        
        if (transferMatch) {
            // Find token address only in token-god-mode URLs
            let tokenAddress = null;
            for (const url of urls) {
                if (url.includes('token-god-mode')) {
                    const match = url.match(/tokenAddress=([A-Za-z0-9]{32,}(?:pump|[A-Za-z0-9]{11}))/i);
                    if (match) {
                        tokenAddress = match[1];
                        break;
                    }
                }
            }

            if (tokenAddress) {
                tokenDetails.push({
                    tokenAddress,
                    amount: transferMatch[1].replace(/,/g, ''),
                    symbol: transferMatch[2],
                    usdValue: transferMatch[3].replace(/,/g, ''),
                    recipient: transferMatch[4].trim()
                });
            }
        }
    });

    return tokenDetails;
}

async function processWalletTrackerMessage(message) {
    const tokenDetails = extractTokenDetails(message);
  
    if (tokenDetails.length === 0) return;

    for (const { tokenAddress, symbol } of tokenDetails) {
        if (!tokenAddress) continue;

        if (processedAddresses.has(tokenAddress)) continue;

        processedAddresses.add(tokenAddress);
  
        const query = `
            INSERT INTO tokens (contractAddress, smartMoneyBuys)
            VALUES (?, 1)
            ON CONFLICT(contractAddress) DO UPDATE SET
            smartMoneyBuys = smartMoneyBuys + 1
        `;
        try {
            await queueUpdate(query, [tokenAddress]);
            console.log(`Updated smartMoneyBuys for token ${symbol} (${tokenAddress})`);
        } catch (error) {
            console.error('Error processing wallet tracker:', error);
        }
    }
}

module.exports = {
    processMessage: processWalletTrackerMessage
};