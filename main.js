const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const dotenv = require('dotenv');
const path = require('path');
const processedMessageIdsFile = 'processedMessageIds.json';
const { db } = require('./db');
const http = require('http');

dotenv.config();

// Load chat configuration
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

// Load channel modules
const channelModules = {};
for (const [channelName, channelConfig] of Object.entries(config.channels)) {
    const modulePath = path.join(__dirname, `${channelConfig.extractMethod}.js`);
    if (fs.existsSync(modulePath)) {
        channelModules[channelName] = require(modulePath);
    } else {
        console.warn(`Module for ${channelName} not found at ${modulePath}`);
    }
}

// Telegram client setup
const apiId = parseInt(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const stringSession = new StringSession(process.env.TELEGRAM_STRING_SESSION || '');

// Add this function for better error logging
function logError(context, error) {
    console.error('=== ERROR ===');
    console.error('Context:', context);
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    console.error('============');
}

async function processMessage(chatName, message) {
    if (!message || !message.text) return;
  
    const chatConfig = config.channels[chatName];
    if (!chatConfig) return;

    try {
        const channelProcessor = channelModules[chatName]?.processMessage;
        if (channelProcessor) {
            await channelProcessor(message);
        } else {
            console.warn(`No processor found for ${chatName}`);
        }
    } catch (error) {
        console.error(`Error processing message for ${chatName}:`, error);
    }
}

async function pollChannel(channel) {
    try {
        const messages = await fetchMessages(channel.id, 5);
        console.log(`Processing ${channel.type} updates...`);
        
        // Process messages without the extra logging
        for (const message of messages) {
            await processMessage(channel.name, message);
        }
    } catch (error) {
        console.error(`Error polling ${channel.type}:`, error);
    }
}

// Modify the Telegram client setup
(async () => {
    console.log('=== Starting Application ===');
    console.log('API ID:', apiId ? 'Set' : 'Not set');
    console.log('API Hash:', apiHash ? 'Set' : 'Not set');
    console.log('Session:', stringSession ? 'Set' : 'Not set');
    
    try {
        const client = new TelegramClient(stringSession, apiId, apiHash, {
            connectionRetries: 5,
            retryDelay: 2000,
            useWSS: true,
            logger: console
        });

        await client.connect();
        console.log('Initial connection successful');

        const isAuthorized = await client.isUserAuthorized();
        console.log('User authorization status:', isAuthorized);

        if (!isAuthorized) {
            console.error('User not authorized - need to generate new session string');
            process.exit(1);
        }

        // Test channel access
        for (const [chatName, chatConfig] of Object.entries(config.channels)) {
            try {
                console.log(`Testing access to ${chatName} (${chatConfig.id})`);
                const entity = await client.getEntity(chatConfig.id);
                console.log(`Successfully accessed ${chatName}:`, entity.id);
            } catch (error) {
                logError(`Failed to access channel ${chatName}`, error);
            }
        }

        // Modified polling setup
        Object.entries(config.channels).forEach(([chatName, chatConfig], index) => {
            const pollInterval = 30000;
            const staggerDelay = index * 2000;

            setInterval(async () => {
                try {
                    console.log(`\n=== Polling ${chatName} ===`);
                    const messages = await client.getMessages(chatConfig.id, { 
                        limit: 5,
                        offsetId: 0
                    });
                    
                    if (!messages || messages.length === 0) {
                        console.log(`No messages found for ${chatName}`);
                        return;
                    }

                    console.log(`Found ${messages.length} messages from ${chatName}`);
                    
                    for (const msg of messages) {
                        if (!msg || !msg.text) continue;
                        
                        console.log(`\nProcessing message from ${chatName}:`);
                        console.log('Text preview:', msg.text.substring(0, 100));
                        
                        try {
                            await processMessage(chatName, msg);
                            console.log('Message processed successfully');
                        } catch (error) {
                            logError(`Error processing message from ${chatName}`, error);
                        }
                    }
                } catch (error) {
                    logError(`Error polling ${chatName}`, error);
                }
            }, pollInterval + staggerDelay);
        });

    } catch (error) {
        logError('Fatal error in main process', error);
        process.exit(1);
    }
})();

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('Closing database connection...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
            process.exit(1);
        }
        console.log('Database connection closed.');
        process.exit(0);
    });
});

// Add a simple web server
const server = http.createServer((req, res) => {
    console.log('Incoming request to:', req.url);
    
    try {
        if (req.url === '/api/tokens') {
            console.log('Handling /api/tokens request');
            db.all('SELECT * FROM tokens ORDER BY score DESC', [], (err, rows) => {
                if (err) {
                    console.error('Database error:', err);
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: err.message }));
                    return;
                }
                console.log('Sending tokens data, count:', rows.length);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(rows));
            });
        } else if (req.url === '/api/import' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                try {
                    const tokens = JSON.parse(body);
                    const stmt = db.prepare(`
                        INSERT OR REPLACE INTO tokens (
                            contractAddress, tokenName, ticker, description,
                            securityScore, smartMoneyBuys, earlyTrending,
                            hype, totalCalls, dexscreenerHot, highVolume
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `);
                    
                    tokens.forEach(token => {
                        stmt.run([
                            token.contractAddress,
                            token.tokenName,
                            token.ticker,
                            token.description,
                            token.securityScore,
                            token.smartMoneyBuys,
                            token.earlyTrending,
                            token.hype,
                            token.totalCalls,
                            token.dexscreenerHot,
                            token.highVolume
                        ]);
                    });
                    
                    stmt.finalize();
                    res.writeHead(200);
                    res.end('Data imported successfully');
                } catch (error) {
                    console.error('Import error:', error);
                    res.writeHead(500);
                    res.end('Import failed');
                }
            });
        } else if (req.url === '/' || req.url === '') {
            console.log('Serving HTML dashboard');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Token Tracker</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            margin: 20px;
                            background: #f0f2f5;
                        }
                        .container {
                            max-width: 1200px;
                            margin: 0 auto;
                        }
                        table {
                            width: 100%;
                            border-collapse: collapse;
                            background: white;
                            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                            border-radius: 8px;
                            overflow: hidden;
                        }
                        th, td {
                            padding: 12px;
                            text-align: left;
                            border-bottom: 1px solid #ddd;
                        }
                        th {
                            background: #1a1a1a;
                            color: white;
                        }
                        tr:hover {
                            background: #f5f5f5;
                        }
                        .score {
                            font-weight: bold;
                        }
                        .positive { color: green; }
                        .negative { color: red; }
                        .refresh-btn {
                            padding: 10px 20px;
                            margin-bottom: 20px;
                            background: #4CAF50;
                            color: white;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                        }
                        .refresh-btn:hover {
                            background: #45a049;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>Token Tracker Dashboard</h1>
                        <button class="refresh-btn" onclick="refreshData()">Refresh Data</button>
                        <table id="tokenTable">
                            <thead>
                                <tr>
                                    <th>Token Name</th>
                                    <th>Ticker</th>
                                    <th>Security Score</th>
                                    <th>Smart Money Buys</th>
                                    <th>Early Trending</th>
                                    <th>Hype</th>
                                    <th>Total Calls</th>
                                    <th>Dexscreener Hot</th>
                                    <th>High Volume</th>
                                    <th>Score</th>
                                </tr>
                            </thead>
                            <tbody id="tokenTableBody"></tbody>
                        </table>
                    </div>
                    <script>
                        function refreshData() {
                            fetch('/api/tokens')
                                .then(response => response.json())
                                .then(data => {
                                    const tbody = document.getElementById('tokenTableBody');
                                    tbody.innerHTML = '';
                                    data.forEach(token => {
                                        const row = document.createElement('tr');
                                        row.innerHTML = \`
                                            <td>\${token.tokenName || 'N/A'}</td>
                                            <td>\${token.ticker || 'N/A'}</td>
                                            <td>\${token.securityScore || 'N/A'}</td>
                                            <td>\${token.smartMoneyBuys || 0}</td>
                                            <td>\${token.earlyTrending || 'NO'}</td>
                                            <td>\${token.hype || 'None'}</td>
                                            <td>\${token.totalCalls || 0}</td>
                                            <td>\${token.dexscreenerHot || 'NO'}</td>
                                            <td>\${token.highVolume || 'NO'}</td>
                                            <td class="score \${token.score >= 0 ? 'positive' : 'negative'}">\${token.score}</td>
                                        \`;
                                        tbody.appendChild(row);
                                    });
                                })
                                .catch(error => console.error('Error:', error));
                        }
                        // Initial load
                        refreshData();
                        // Refresh every 30 seconds
                        setInterval(refreshData, 30000);
                    </script>
                </body>
                </html>
            `);
        } else {
            console.log('Unknown route, serving default response');
            res.writeHead(200);
            res.end('Bot is running! Please visit / for the dashboard');
        }
    } catch (error) {
        console.error('Server error:', error);
        res.writeHead(500);
        res.end('Internal server error');
    }
});

// Listen on the port provided by Render or default to 3000
const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});