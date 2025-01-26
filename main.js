const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const dotenv = require('dotenv');
const path = require('path');
const processedMessageIdsFile = 'processedMessageIds.json';
const { db } = require('./db');
const { startBot } = require('./bot');
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

// Start the Telegram client and message polling
(async () => {
    console.log('Starting Telegram client...');
    try {
        const client = new TelegramClient(stringSession, apiId, apiHash, {
            connectionRetries: 5,
            retryDelay: 2000
        });

        await client.start();
        console.log('Connected to Telegram.');

        // Add staggered polling for each channel
        Object.entries(config.channels).forEach(([chatName, chatConfig], index) => {
            const pollInterval = 30000; // 30 seconds
            const staggerDelay = index * 2000; // Stagger by 2 seconds per channel

            setInterval(async () => {
                try {
                    const messages = await client.getMessages(chatConfig.id, { limit: 5 });
                    console.log(`Fetched ${messages.length} messages from ${chatName}`);
                    for (const msg of messages) {
                        if (msg && msg.text) {
                            await processMessage(chatName, msg);
                        }
                    }
                } catch (error) {
                    console.error(`Error fetching messages for ${chatName}:`, error);
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
    res.writeHead(200);
    res.end('Bot is running!');
});

// Listen on the port provided by Render or default to 3000
const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

// Start the bot
startBot().catch(console.error);