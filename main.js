const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const dotenv = require('dotenv');
const path = require('path');
const processedMessageIdsFile = 'processedMessageIds.json';
const { db } = require('./db');
const http = require('http');
const https = require('https');
const { sleep } = require('telegram/Helpers');

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

async function processMessage(chatName, message) {
    if (!message || !message.text) return;

    const chatConfig = config.channels[chatName];
    if (!chatConfig) return;

    try {
        const channelProcessor = channelModules[chatName]?.processMessage;
        if (channelProcessor) {
            await channelProcessor(message);
        }
    } catch (error) {
        console.error(`Error processing message for ${chatName}:`, error);
    }
}

// Add connection management
let client = null;
let isConnecting = false;

async function connectClient() {
    if (isConnecting) return;
    isConnecting = true;

    try {
        // Add initial delay to allow previous instances to timeout
        await sleep(10000); // 10 second delay

        if (client) {
            try {
                await client.disconnect();
            } catch (err) {
                console.log('Error disconnecting existing client:', err.message);
            }
        }

        const apiId = parseInt(process.env.TELEGRAM_API_ID);
        const apiHash = process.env.TELEGRAM_API_HASH;
        const stringSession = new StringSession(process.env.TELEGRAM_STRING_SESSION || '');

        console.log('Initializing client...');
        client = new TelegramClient(stringSession, apiId, apiHash, {
            connectionRetries: 5,
            useWSS: false
        });

        console.log('Connecting to Telegram...');
        await client.connect();
        
        console.log('Checking authorization...');
        const isAuthorized = await client.isUserAuthorized();
        if (!isAuthorized) {
            console.error('Session string:', process.env.TELEGRAM_STRING_SESSION ? 'Present' : 'Missing');
            console.error('API ID:', apiId);
            console.error('API Hash:', apiHash ? 'Present' : 'Missing');
            throw new Error('Not authorized - check credentials');
        }

        console.log('Successfully connected to Telegram');
        
        // Set up polling with retry mechanism
        setupPolling();

    } catch (error) {
        console.error('Connection error:', error);
        // Wait before trying to reconnect
        await sleep(5000);
        isConnecting = false;
        return connectClient();
    }

    isConnecting = false;
}

async function setupPolling() {
    Object.entries(config.channels).forEach(([chatName, chatConfig], index) => {
        const pollInterval = 30000;
        const staggerDelay = index * 2000;

        console.log(`Setting up polling for ${chatName}`);
        
        let isPolling = false;
        
        setInterval(async () => {
            if (isPolling) return;
            isPolling = true;

            try {
                const entity = await client.getEntity(chatConfig.id);
                const messages = await client.getMessages(entity, { limit: 5 });
                
                console.log(`Got ${messages.length} messages from ${chatName}`);
                
                for (const msg of [...messages].reverse()) {
                    if (msg?.text) {
                        await processMessage(chatName, msg);
                    }
                }
            } catch (error) {
                console.error(`Error polling ${chatName}:`, error);
                if (error.message.includes('AUTH_KEY_DUPLICATED')) {
                    // Reconnect if we get an auth key error
                    await connectClient();
                }
            } finally {
                isPolling = false;
            }
        }, pollInterval + staggerDelay);
    });
}

// Modify the main execution
(async () => {
    try {
        await connectClient();
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
})();

// Cleanup on exit
process.on('SIGINT', async () => {
    console.log('Closing connections...');
    if (client) {
        try {
            await client.disconnect();
        } catch (err) {
            console.error('Error disconnecting client:', err);
        }
    }
    
    console.log('Closing database connection...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
            process.exit(1);
        }
        console.log('Cleanup complete.');
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
                            table-layout: fixed;
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
                        .filter-row th {
                            padding: 5px;
                        }
                        
                        .filter-input {
                            width: 90%;
                            padding: 5px;
                            border: 1px solid #ddd;
                            border-radius: 4px;
                        }
                        
                        th.sortable {
                            cursor: pointer;
                        }
                        
                        th.sortable:after {
                            content: '↕';
                            margin-left: 5px;
                            opacity: 0.5;
                        }
                        
                        th.sorted-asc:after {
                            content: '↑';
                            opacity: 1;
                        }
                        
                        th.sorted-desc:after {
                            content: '↓';
                            opacity: 1;
                        }
                        th small {
                            display: block;
                            font-weight: normal;
                            color: #666;
                            font-size: 0.8em;
                        }
                        th {
                            min-width: 100px;
                            padding: 8px 4px;
                        }
                        .ca-cell {
                            max-width: 100px;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            white-space: nowrap;
                            display: flex;
                            align-items: center;
                            gap: 4px;
                        }
                        .copy-btn {
                            padding: 4px;
                            background: #444;
                            border: none;
                            border-radius: 3px;
                            color: white;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                        .copy-btn:hover {
                            background: #666;
                        }
                        .copy-icon {
                            width: 14px;
                            height: 14px;
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
                                    <th class="sortable" data-sort="tokenName" style="width: 12%">Token Name</th>
                                    <th class="sortable" data-sort="ticker" style="width: 8%">Ticker</th>
                                    <th class="sortable" data-sort="contractAddress" style="width: 12%">CA</th>
                                    <th class="sortable" data-sort="securityScore" style="width: 10%">Security Score<br><small>(Good: +10, Bad: -30)</small></th>
                                    <th class="sortable" data-sort="smartMoneyBuys" style="width: 10%">Smart Money<br><small>(+20 each)</small></th>
                                    <th class="sortable" data-sort="earlyTrending" style="width: 8%">Trending<br><small>(+30)</small></th>
                                    <th class="sortable" data-sort="hype" style="width: 10%">Hype<br><small>(30/20/10)</small></th>
                                    <th class="sortable" data-sort="totalCalls" style="width: 8%">Calls<br><small>(+10)</small></th>
                                    <th class="sortable" data-sort="dexscreenerHot" style="width: 8%">Hot<br><small>(+20)</small></th>
                                    <th class="sortable" data-sort="highVolume" style="width: 8%">Volume<br><small>(+10)</small></th>
                                    <th class="sortable" data-sort="score" style="width: 6%">Score</th>
                                </tr>
                                <tr class="filter-row">
                                    <th><input class="filter-input" data-column="tokenName" placeholder="Filter..."></th>
                                    <th><input class="filter-input" data-column="ticker" placeholder="Filter..."></th>
                                    <th><input class="filter-input" data-column="contractAddress" placeholder="Filter..."></th>
                                    <th><input class="filter-input" data-column="securityScore" placeholder="Filter..."></th>
                                    <th><input class="filter-input" data-column="smartMoneyBuys" placeholder="Filter..."></th>
                                    <th><input class="filter-input" data-column="earlyTrending" placeholder="Filter..."></th>
                                    <th><input class="filter-input" data-column="hype" placeholder="Filter..."></th>
                                    <th><input class="filter-input" data-column="totalCalls" placeholder="Filter..."></th>
                                    <th><input class="filter-input" data-column="dexscreenerHot" placeholder="Filter..."></th>
                                    <th><input class="filter-input" data-column="highVolume" placeholder="Filter..."></th>
                                    <th><input class="filter-input" data-column="score" placeholder="Filter..."></th>
                                </tr>
                            </thead>
                            <tbody id="tokenTableBody"></tbody>
                        </table>
                    </div>
                    <script>
                    let allTokens = [];
                    let currentSort = { column: 'score', direction: 'desc' };
                    let filters = {};

                    function applyFiltersAndSort() {
                        let filtered = allTokens.filter(token => {
                            return Object.entries(filters).every(([column, value]) => {
                                if (!value) return true;
                                let tokenValue = String(token[column] || '').toLowerCase();
                                return tokenValue.includes(value.toLowerCase());
                            });
                        });

                        filtered.sort((a, b) => {
                            let aVal = a[currentSort.column] || '';
                            let bVal = b[currentSort.column] || '';
                            
                            if (typeof aVal === 'number' && typeof bVal === 'number') {
                                return currentSort.direction === 'asc' ? aVal - bVal : bVal - aVal;
                            }
                            
                            aVal = String(aVal).toLowerCase();
                            bVal = String(bVal).toLowerCase();
                            
                            if (currentSort.direction === 'asc') {
                                return aVal.localeCompare(bVal);
                            } else {
                                return bVal.localeCompare(aVal);
                            }
                        });

                        updateTable(filtered);
                    }

                    function updateTable(data) {
                        const tbody = document.getElementById('tokenTableBody');
                        tbody.innerHTML = '';
                        data.forEach(token => {
                            const row = document.createElement('tr');
                            row.innerHTML = \`
                                <td>\${token.tokenName || 'N/A'}</td>
                                <td>\${token.ticker || 'N/A'}</td>
                                <td class="ca-cell">
                                    <span title="\${token.contractAddress}">\${token.contractAddress?.slice(0, 8)}</span>
                                    <button class="copy-btn" onclick="copyCA('\${token.contractAddress}')" title="Copy address">
                                        <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                        </svg>
                                    </button>
                                </td>
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
                    }

                    // Set up event listeners
                    document.querySelectorAll('.sortable').forEach(th => {
                        th.addEventListener('click', () => {
                            const column = th.dataset.sort;
                            if (currentSort.column === column) {
                                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
                            } else {
                                currentSort = { column, direction: 'asc' };
                            }
                            
                            // Update sort indicators
                            document.querySelectorAll('.sortable').forEach(el => {
                                el.classList.remove('sorted-asc', 'sorted-desc');
                            });
                            th.classList.add(\`sorted-\${currentSort.direction}\`);
                            
                            applyFiltersAndSort();
                        });
                    });

                    document.querySelectorAll('.filter-input').forEach(input => {
                        input.addEventListener('input', () => {
                            filters[input.dataset.column] = input.value;
                            applyFiltersAndSort();
                        });
                    });

                    function refreshData() {
                        fetch('/api/tokens')
                            .then(response => response.json())
                            .then(data => {
                                allTokens = data;
                                applyFiltersAndSort();
                            })
                            .catch(error => console.error('Error:', error));
                    }

                    // Initial load
                    refreshData();
                    // Refresh every 30 seconds
                    setInterval(refreshData, 30000);

                    function copyCA(address) {
                        navigator.clipboard.writeText(address);
                        // Optional: Show feedback
                        const btn = event.target;
                        btn.textContent = 'Copied!';
                        setTimeout(() => btn.textContent = 'Copy', 1000);
                    }
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

// Keep-alive ping to prevent spin-down
const RENDER_URL = 'https://the-smart-ape.onrender.com';
setInterval(() => {
    https.get(RENDER_URL, (resp) => {
        if (resp.statusCode === 200) {
            console.log('Keep-alive ping successful');
        }
    }).on('error', (err) => {
        console.error('Keep-alive ping failed:', err.message);
    });
}, 840000); // 14 minutes (Render spins down after 15 minutes of inactivity)