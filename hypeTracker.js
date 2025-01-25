const { queueUpdate } = require('./db');
const { getAllUrls, extractContractAddress } = require('./utils'); // Adjust the path as necessary

function extractHypeDetails(message) {
    const text = message.text || '';
    const details = {
        contractAddress: null,
        hypeLevel: null
    };

    try {
        // Only process messages with "Hype Detected"
        if (!text.includes('Hype Detected')) {
            return details;
        }

        // Extract hype level
        if (text.includes('Small Hype')) {
            details.hypeLevel = 'Small';
        } else if (text.includes('Medium Hype')) {
            details.hypeLevel = 'Medium';
        } else if (text.includes('High Hype')) {
            details.hypeLevel = 'High';
        }

        // Extract contract address - now handles multiple formats
        const contractMatch = text.match(/Contract:.*?`([A-Za-z0-9]{32,}(?:pump|[A-Za-z0-9]{11}))`/) ||   // Format with backticks
                             text.match(/Contract:\s*([A-Za-z0-9]{32,}(?:pump|[A-Za-z0-9]{11}))/) ||      // Format without backticks
                             text.match(/📋.*?Contract:.*?`([A-Za-z0-9]{32,}(?:pump|[A-Za-z0-9]{11}))`/);  // Format with emoji
        
        if (contractMatch) {
            details.contractAddress = contractMatch[1];
        }

        return details;
    } catch (error) {
        console.error('Error extracting hype details:', error);
        return details;
    }
}

async function processHypeTrackerMessage(message) {
    const details = extractHypeDetails(message);
  
    if (details.contractAddress && details.hypeLevel) {
        const query = `
            INSERT INTO tokens (contractAddress, hype)
            VALUES (?, ?)
            ON CONFLICT(contractAddress) DO UPDATE SET
            hype = ?
        `;
        await queueUpdate(query, [details.contractAddress, details.hypeLevel, details.hypeLevel]);
    }
}

module.exports = {
    processMessage: processHypeTrackerMessage
};