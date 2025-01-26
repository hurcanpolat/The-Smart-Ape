const { db } = require('./db');

const contractAddressRegex = /\[(.*?)\]/;

async function processMessage(message) {
    try {
        const match = message.text.match(contractAddressRegex);
        if (match) {
            const contractAddress = match[1];
            
            // First, check if this token exists and has any calls recorded
            db.get('SELECT totalCalls FROM tokens WHERE contractAddress = ?', [contractAddress], (err, row) => {
                if (err) {
                    console.error('Error checking token:', err);
                    return;
                }

                // If message contains "First Call" or token doesn't exist, initialize/update with 1 call
                if (message.text.toLowerCase().includes('first call') || !row) {
                    console.log(`Initializing first call for token: ${contractAddress}`);
                    db.run(`
                        INSERT OR REPLACE INTO tokens (
                            contractAddress, totalCalls, score
                        ) VALUES (?, 1, 20)
                    `, [contractAddress]);
                } 
                // Only update existing tokens that were properly initialized with a first call
                else if (row && row.totalCalls > 0) {
                    const newCallCount = row.totalCalls + 1;
                    console.log(`Updating calls for token ${contractAddress}: ${newCallCount} calls`);
                    db.run(`
                        UPDATE tokens 
                        SET totalCalls = ?, score = score + 20
                        WHERE contractAddress = ?
                    `, [newCallCount, contractAddress]);
                } else {
                    console.log(`Ignoring call for uninitialized token: ${contractAddress}`);
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