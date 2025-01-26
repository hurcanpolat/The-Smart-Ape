const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const { calculateScore } = require('./scoring');

dotenv.config();

// Queue management
const updateQueue = [];
let isProcessing = false;

// Ensure the directory exists
const dbPath = process.env.DB_PATH || 'tokens.db';
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
    console.log(`Creating database directory: ${dbDir}`);
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Database connection error:', err);
        process.exit(1);
    }
    console.log(`Connected to the database at ${dbPath}`);

    // Initialize database structure
    db.serialize(() => {
        // Set pragmas for better performance
        db.run('PRAGMA journal_mode=WAL');
        db.run('PRAGMA synchronous=NORMAL');
        db.run('PRAGMA busy_timeout=5000');
        
        // Create table
        db.run(`CREATE TABLE IF NOT EXISTS tokens (
            contractAddress TEXT PRIMARY KEY,
            tokenName TEXT,
            ticker TEXT,
            description TEXT,
            securityScore TEXT,
            smartMoneyBuys INTEGER DEFAULT 0,
            earlyTrending TEXT DEFAULT 'NO',
            hype TEXT DEFAULT 'None',
            totalCalls INTEGER DEFAULT 0,
            dexscreenerHot TEXT DEFAULT 'NO',
            highVolume TEXT DEFAULT 'NO',
            score INTEGER DEFAULT 0
        )`);

        // Create trigger for score calculation
        db.run(`CREATE TRIGGER IF NOT EXISTS update_score 
            AFTER UPDATE ON tokens
            FOR EACH ROW
            BEGIN
                UPDATE tokens SET score = (
                    CASE 
                        WHEN NEW.securityScore = 'Bad' THEN -30
                        WHEN NEW.securityScore = 'Good' THEN 10
                        ELSE 0
                    END +
                    COALESCE(NEW.smartMoneyBuys * 20, 0) +
                    CASE 
                        WHEN NEW.earlyTrending = 'YES' THEN 30
                        ELSE 0
                    END +
                    CASE 
                        WHEN NEW.hype = 'High' THEN 30
                        WHEN NEW.hype = 'Medium' THEN 20
                        WHEN NEW.hype = 'Small' THEN 10
                        ELSE 0
                    END +
                    COALESCE(NEW.totalCalls * 10, 0) +
                    CASE 
                        WHEN NEW.dexscreenerHot = 'YES' THEN 20
                        ELSE 0
                    END +
                    CASE 
                        WHEN NEW.highVolume = 'YES' THEN 10
                        ELSE 0
                    END
                ) WHERE contractAddress = NEW.contractAddress;
            END;
        `);

        // Create trigger for initial score calculation
        db.run(`CREATE TRIGGER IF NOT EXISTS initial_score 
            AFTER INSERT ON tokens
            FOR EACH ROW
            BEGIN
                UPDATE tokens SET score = (
                    CASE 
                        WHEN NEW.securityScore = 'Bad' THEN -30
                        WHEN NEW.securityScore = 'Good' THEN 10
                        ELSE 0
                    END +
                    COALESCE(NEW.smartMoneyBuys * 20, 0) +
                    CASE 
                        WHEN NEW.earlyTrending = 'YES' THEN 30
                        ELSE 0
                    END +
                    CASE 
                        WHEN NEW.hype = 'High' THEN 30
                        WHEN NEW.hype = 'Medium' THEN 20
                        WHEN NEW.hype = 'Small' THEN 10
                        ELSE 0
                    END +
                    COALESCE(NEW.totalCalls * 20, 0) +
                    CASE 
                        WHEN NEW.dexscreenerHot = 'YES' THEN 20
                        ELSE 0
                    END +
                    CASE 
                        WHEN NEW.highVolume = 'YES' THEN 10
                        ELSE 0
                    END
                ) WHERE contractAddress = NEW.contractAddress;
            END;
        `);
    });
});

async function processQueue() {
    if (isProcessing || updateQueue.length === 0) return;
    isProcessing = true;

    try {
        while (updateQueue.length > 0) {
            const { query, params } = updateQueue.shift();
            await new Promise((resolve, reject) => {
                db.run(query, params, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
    } catch (error) {
        console.error('Database error:', error);
    } finally {
        isProcessing = false;
    }
}

function queueUpdate(query, params) {
    updateQueue.push({ query, params });
    if (!isProcessing) {
        processQueue();
    }
}

// Update the token's score whenever any metric changes
function updateTokenScore(contractAddress) {
    db.get(
        'SELECT * FROM tokens WHERE contractAddress = ?',
        [contractAddress],
        (err, token) => {
            if (err) {
                console.error('Error fetching token for score update:', err);
                return;
            }
            if (token) {
                const score = calculateScore(token);
                queueUpdate(
                    'UPDATE tokens SET score = ? WHERE contractAddress = ?',
                    [score, contractAddress]
                );
            }
        }
    );
}

module.exports = {
    db,
    queueUpdate,
    updateTokenScore
}; 