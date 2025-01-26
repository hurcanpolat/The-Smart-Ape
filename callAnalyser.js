const { db } = require('./db');

const contractAddressRegex = /\[(.*?)\]/;

async function processMessage(message) {
    try {
        const match = message.text.match(contractAddressRegex);
        if (match) {
            const contractAddress = match[1];
            
            db.get('SELECT totalCalls FROM tokens WHERE contractAddress = ?', [contractAddress], (err, row) => {
                if (err) {
                    console.error('Error checking token:', err);
                    return;
                }

                if (!row) {
                    // First time seeing this token
                    db.run(`
                        INSERT INTO tokens (
                            contractAddress, totalCalls, score
                        ) VALUES (?, 1, 10)
                    `, [contractAddress]);
                    console.log(`New token ${contractAddress}: 1 call`);
                } else {
                    // Update existing token
                    const newCallCount = row.totalCalls + 1;
                    db.run(`
                        UPDATE tokens 
                        SET totalCalls = ?, score = score + 10
                        WHERE contractAddress = ?
                    `, [newCallCount, contractAddress]);
                    console.log(`Updated token ${contractAddress}: ${newCallCount} calls`);
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