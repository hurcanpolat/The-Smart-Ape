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

// Minimal configuration - just one channel to test
const TEST_CHANNEL = '@NansenBot';

// Simple error logging
function logError(context, error) {
    console.error(`=== ERROR: ${context} ===`);
    console.error(error);
    console.error('===================\n');
}

// Add this helper function
function logTelegramStatus(client) {
    console.log('\n=== Telegram Client Status ===');
    console.log('Connected:', client.connected);
    console.log('Authorized:', client._authorized); // Note: internal property
    console.log('Session Valid:', !!client.session.authKey);
    console.log('============================\n');
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

// Debug client setup
(async () => {
    console.log('\n=== Debug Information ===');
    const apiId = parseInt(process.env.TELEGRAM_API_ID);
    const apiHash = process.env.TELEGRAM_API_HASH;
    
    // Add detailed session logging
    console.log('\n=== Session Debug ===');
    console.log('Raw session string:', process.env.TELEGRAM_STRING_SESSION);
    console.log('Session string type:', typeof process.env.TELEGRAM_STRING_SESSION);
    console.log('Session string length:', process.env.TELEGRAM_STRING_SESSION?.length);
    
    const stringSession = new StringSession(process.env.TELEGRAM_STRING_SESSION || '');
    console.log('Initialized session length:', stringSession?.length || 'Not set');

    // Rest of your existing debug logs
    console.log('\n=== Credential Lengths ===');
    console.log('API ID Length:', apiId?.toString().length || 'Not set');
    console.log('API Hash Length:', apiHash?.length || 'Not set');
    
    try {
        const client = new TelegramClient(stringSession, apiId, apiHash, {
            connectionRetries: 5,
            useWSS: false,
            requestRetries: 3
        });

        await client.connect();
        console.log('Connected to Telegram');
        
        const isAuthorized = await client.isUserAuthorized();
        console.log('User Authorized:', isAuthorized);

        if (!isAuthorized) {
            throw new Error('Not authorized');
        }

        // Set up polling for all channels
        Object.entries(config.channels).forEach(([chatName, chatConfig], index) => {
            const pollInterval = 30000;
            const staggerDelay = index * 2000;

            console.log(`Setting up polling for ${chatName}`);
            
            setInterval(async () => {
                try {
                    const entity = await client.getEntity(chatConfig.id);
                    const messages = await client.getMessages(entity, { limit: 5 });
                    
                    console.log(`Got ${messages.length} messages from ${chatName}`);
                    
                    for (const msg of messages) {
                        if (msg?.text) {
                            await processMessage(chatName, msg);
                        }
                    }
                } catch (error) {
                    console.error(`Error polling ${chatName}:`, error);
                }
            }, pollInterval + staggerDelay);
        });

    } catch (error) {
        console.error('Fatal error:', error);
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