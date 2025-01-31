const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const dotenv = require('dotenv');

dotenv.config();

async function main() {
    console.log('Starting authentication process...');
    
    const apiId = parseInt(process.env.TELEGRAM_API_ID);
    const apiHash = process.env.TELEGRAM_API_HASH;
    
    console.log('Creating new Telegram client...');
    const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
        connectionRetries: 5,
    });

    console.log('Starting client...');
    try {
        await client.start({
            phoneNumber: async () => {
                const phone = await input.text("Please enter your phone number (including + sign): ");
                console.log('Phone number entered:', phone);
                return phone;
            },
            password: async () => {
                const password = await input.text("Please enter your 2FA password (if any): ");
                return password;
            },
            phoneCode: async () => {
                const code = await input.text("Please enter the code you received: ");
                console.log('Code entered');
                return code;
            },
            onError: (err) => console.log('Error occurred:', err),
        });

        console.log('Client successfully connected!');
        console.log('Generating session string...');
        const sessionString = client.session.save();
        console.log('\nHere is your session string (copy this to your .env file):\n');
        console.log(sessionString);
        console.log('\nDisconnecting client...');
        await client.disconnect();
        console.log('Done!');
    } catch (error) {
        console.error('An error occurred:', error);
    }
}

console.log('Starting auth script...');
main().catch(console.error); 