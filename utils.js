function getAllUrls(message) {
    const urls = [];
    
    // Extract URLs from text
    if (message.text) {
        const urlMatches = message.text.match(/https?:\/\/[^\s]+/g);
        if (urlMatches) {
            urls.push(...urlMatches);
        }
    }

    // Extract URLs from entities
    if (message.entities) {
        message.entities.forEach(entity => {
            if (entity.url) {
                urls.push(entity.url);
            }
        });
    }

    // Extract URLs from reply markup
    if (message.replyMarkup && message.replyMarkup.rows) {
        message.replyMarkup.rows.forEach(row => {
            row.buttons.forEach(button => {
                if (button.url) {
                    urls.push(button.url);
                }
            });
        });
    }

    return urls;
}

function extractContractAddress(url) {
    if (!url) return null;

    const patterns = [
        /tokenAddress=([A-Za-z0-9]{32,}(?:pump|[A-Za-z0-9]{11}))/i,
        /token\/([A-Za-z0-9]{32,}(?:pump|[A-Za-z0-9]{11}))/i,
        /start=\d*_?([A-Za-z0-9]{32,}(?:pump|[A-Za-z0-9]{11}))/i
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }

    return null;
}

module.exports = {
    getAllUrls,
    extractContractAddress
}; 