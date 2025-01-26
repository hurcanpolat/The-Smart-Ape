const { db } = require('./db');

// Updated regex to match both [Name] (Address) format and plain addresses
const messageRegex = /\[([^\]]+)\]\s*\(([A-Za-z0-9]{32,}(?:pump|[A-Za-z0-9]{11}))\)/;

async function processMessage(message) {
    try {
        const match = message.text.match(messageRegex);
        if (match) {
            const tokenName = match[1];
            const contractAddress = match[2];
            
            // First, check if this token exists and has any calls recorded
            db.get('SELECT totalCalls FROM tokens WHERE contractAddress = ?', [contractAddress], (err, row) => {
                if (err) {
                    console.error('Error checking token:', err);
                    return;
                }

                // If message contains "First Call" or token doesn't exist, initialize/update with 1 call
                if (message.text.toLowerCase().includes('first call') || !row) {
                    console.log(`Initializing first call for ${tokenName} (${contractAddress})`);
                    db.run(`
                        INSERT OR REPLACE INTO tokens (
                            contractAddress, tokenName, totalCalls, score
                        ) VALUES (?, ?, 1, 20)
                    `, [contractAddress, tokenName]);
                } 
                // Only update existing tokens that were properly initialized with a first call
                else if (row && row.totalCalls > 0) {
                    const newCallCount = row.totalCalls + 1;
                    console.log(`Updating calls for ${tokenName} (${contractAddress}): ${newCallCount} calls`);
                    db.run(`
                        UPDATE tokens 
                        SET totalCalls = ?, score = score + 20
                        WHERE contractAddress = ?
                    `, [newCallCount, contractAddress]);
                } else {
                    console.log(`Ignoring call for uninitialized token: ${tokenName} (${contractAddress})`);
                }
            });
        }
    } catch (error) {
        console.error('Error in callAnalyser:', error);
    }
}

module.exports = {
    processMessage
}; 