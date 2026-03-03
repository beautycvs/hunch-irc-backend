const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const app = express();
app.use(express.json());

const RELAY_TOKEN = process.env.RELAY_TOKEN || "fallback";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_NAME = process.env.DISCORD_CHANNEL || "irc-bridge";
const PORT = process.env.PORT || 3000;

// ============ DATA STORAGE ============
let messages = [];
let dmMessages = [];
let onlineUsers = {};
let discordLinks = {}; // ircNick -> discordUserId

// ============ DISCORD BOT ============
const discord = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let ircBridgeChannel = null;

discord.once('ready', () => {
    console.log(`Discord bot logged in as ${discord.user.tag}`);

    // Find the irc-bridge channel
    discord.channels.cache.forEach(channel => {
        if (channel.name === DISCORD_CHANNEL_NAME) {
            ircBridgeChannel = channel;
            console.log(`Found IRC bridge channel: #${channel.name}`);
        }
    });

    if (!ircBridgeChannel) {
        console.warn(`Could not find channel: ${DISCORD_CHANNEL_NAME}`);
    }
});

discord.on('messageCreate', message => {
    // Ignore bot messages and wrong channel
    if (message.author.bot) return;
    if (!ircBridgeChannel) return;
    if (message.channel.id !== ircBridgeChannel.id) return;

    // Add Discord message to IRC message list
    const msg = {
        from: message.author.displayName || message.author.username,
        text: `[Discord] ${message.author.displayName || message.author.username}: ${message.content}`,
        ts: Date.now(),
        utcOffsetMin: 0
    };

    messages.push(msg);
    if (messages.length > 500) messages.shift();

    console.log(`Discord -> IRC: ${msg.text}`);
});

discord.login(DISCORD_TOKEN).catch(err => {
    console.error('Failed to login to Discord:', err.message);
});

// ============ AUTH MIDDLEWARE ============
function auth(req, res, next) {
    const token = req.headers['x-relay-token'];
    if (token !== RELAY_TOKEN) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    next();
}

// ============ IRC ENDPOINTS ============

app.post('/send', auth, (req, res) => {
    const { user, message, utcOffsetMin } = req.body;
    if (!user) return res.status(400).json({ error: 'missing user' });

    onlineUsers[user] = Date.now();

    if (!message || message.trim() === '') {
        return res.json({ ok: true });
    }

    const msg = {
        from: user,
        text: message,
        ts: Date.now(),
        utcOffsetMin: utcOffsetMin || 0
    };

    messages.push(msg);
    if (messages.length > 500) messages.shift();

    // Forward to Discord
    if (ircBridgeChannel) {
        ircBridgeChannel.send(`**[IRC] ${user}:** ${message}`)
            .catch(err => console.error('Failed to send to Discord:', err.message));
    }

    res.json({ ok: true });
});

app.get('/poll', auth, (req, res) => {
    const since = parseInt(req.query.since) || 0;
    const now = Date.now();
    const lines = messages.filter(m => m.ts > since);
    res.json({ ok: true, now, lines });
});

app.get('/users', auth, (req, res) => {
    const cutoff = Date.now() - (2 * 60 * 1000);
    const users = Object.entries(onlineUsers)
        .filter(([name, ts]) => ts > cutoff)
        .map(([name]) => name);
    res.json({ ok: true, users });
});

// ============ DM ENDPOINTS ============

app.post('/dm', auth, (req, res) => {
    const { from, target, message } = req.body;
    if (!from || !target || !message) {
        return res.status(400).json({ error: 'missing fields' });
    }

    const dm = { from, to: target, message, ts: Date.now() };
    dmMessages.push(dm);
    if (dmMessages.length > 1000) dmMessages.shift();

    res.json({ ok: true });
});

app.get('/dm/poll', auth, (req, res) => {
    const since = parseInt(req.query.since) || 0;
    const user = req.query.user;
    const now = Date.now();

    if (!user) return res.status(400).json({ error: 'missing user' });

    const dms = dmMessages.filter(m => m.ts > since && m.to === user);
    res.json({ ok: true, now, dms });
});

app.get('/dm/conversation', auth, (req, res) => {
    const user = req.query.user;
    if (!user) return res.status(400).json({ error: 'missing user' });

    const conversation = dmMessages.filter(m => m.from === user || m.to === user);
    res.json({ ok: true, messages: conversation });
});

// ============ AUTH ENDPOINTS ============

app.post('/auth/session', (req, res) => {
    res.json({ ok: true, token: 'session-token' });
});

app.post('/auth/heartbeat', (req, res) => {
    res.json({ ok: true });
});

// ============ DISCORD LINK ============

app.post('/link-discord', auth, (req, res) => {
    const { ircNick, discordUserId } = req.body;
    if (ircNick && discordUserId) {
        discordLinks[ircNick] = discordUserId;
        console.log(`Linked IRC nick '${ircNick}' to Discord user ${discordUserId}`);
    }
    res.json({ ok: true });
});

// ============ START ============
app.listen(PORT, () => {
    console.log(`Hunch IRC backend running on port ${PORT}`);
});
