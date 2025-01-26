const { queueUpdate } = require('./db');
const { db } = require('./db');

function extractCallDetails(message) {
    const text = message.text || '';
    const details = {
        contractAddress: null,
        ticker: null,
        totalCalls: null
    };

    try {
        // Extract ticker - matches $Name format
        const tickerMatch = text.match(/\$([A-Za-z0-9]+)/);
        if (tickerMatch) {
            details.ticker = tickerMatch[1];
        }

        // Extract total calls
        const callsMatch = text.match(/Total calls:\s*(\d+)/);
        if (callsMatch) {
            details.totalCalls = parseInt(callsMatch[1]);
        }

        // Extract contract address - it's usually on its own line
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmedLine = line.trim();
            // Updated regex to handle backticks and hidden characters
            const caMatch = trimmedLine.match(/[`‎]*([A-Za-z0-9]{32,}(?:pump|[A-Za-z0-9]{11}))[`‎]*/);
            if (caMatch) {
                details.contractAddress = caMatch[1];
                break;
            }
        }

        return details;
    } catch (error) {
        console.error('Error extracting call details:', error);
        return details;
    }
}

async function processCallAnalyserMessage(message) {
    const details = extractCallDetails(message);
    
    if (!details.contractAddress || details.totalCalls === null) {
        return;
    }

    // Check current totalCalls in database
    try {
        const result = await new Promise((resolve, reject) => {
            db.get(
                'SELECT totalCalls FROM tokens WHERE contractAddress = ?',
                [details.contractAddress],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        // If current totalCalls matches new totalCalls, skip update
        if (result && result.totalCalls === details.totalCalls) {
            console.log(`No new calls for ${details.ticker} (${details.contractAddress}), still at ${details.totalCalls} calls`);
            return;
        }

        const query = `
            INSERT INTO tokens (contractAddress, ticker, totalCalls)
            VALUES (?, ?, ?)
            ON CONFLICT(contractAddress) DO UPDATE SET
            ticker = COALESCE(?, ticker),
            totalCalls = ?
        `;
        
        await queueUpdate(query, [
            details.contractAddress,
            details.ticker,
            details.totalCalls,
            details.ticker,
            details.totalCalls
        ]);
        console.log(`Updated call details for ${details.ticker} (${details.contractAddress}): ${details.totalCalls} calls`);

        // Calculate score: 
        // - Each call is worth 10 points
        const score = details.totalCalls * 10;

        // Update the token in the database
        db.run(`
            UPDATE tokens SET score = ? WHERE contractAddress = ?
        `, [score, details.contractAddress]);
    } catch (error) {
        console.error('Error processing call details:', error);
    }
}

module.exports = {
    processMessage: processCallAnalyserMessage
}; 