const express = require('express');
const app = express();
app.use(express.json());

const RELAY_TOKEN = process.env.RELAY_TOKEN || "fallback";
const PORT = process.env.PORT || 3000;

// ============ DATA STORAGE ============
let messages = [];       // IRC messages
let dmMessages = [];     // Direct messages
let onlineUsers = {};    // username -> last seen timestamp

// ============ AUTH MIDDLEWARE ============
function auth(req, res, next) {
    const token = req.headers['x-relay-token'];
    if (token !== RELAY_TOKEN) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    next();
}

// ============ IRC ENDPOINTS ============

// Send a message
app.post('/send', auth, (req, res) => {
    const { user, message, utcOffsetMin } = req.body;
    if (!user) return res.status(400).json({ error: 'missing user' });

    // Update user as online
    onlineUsers[user] = Date.now();

    // Keepalive (empty message)
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

    // Keep only last 500 messages
    if (messages.length > 500) messages.shift();

    res.json({ ok: true });
});

// Poll for messages
app.get('/poll', auth, (req, res) => {
    const since = parseInt(req.query.since) || 0;
    const now = Date.now();

    const lines = messages.filter(m => m.ts > since);

    res.json({ ok: true, now, lines });
});

// Get online users (seen in last 2 minutes)
app.get('/users', auth, (req, res) => {
    const cutoff = Date.now() - (2 * 60 * 1000);
    const users = Object.entries(onlineUsers)
        .filter(([name, ts]) => ts > cutoff)
        .map(([name]) => name);

    res.json({ ok: true, users });
});

// ============ DM ENDPOINTS ============

// Send a DM
app.post('/dm', auth, (req, res) => {
    const { from, target, message } = req.body;
    if (!from || !target || !message) {
        return res.status(400).json({ error: 'missing fields' });
    }

    const dm = {
        from,
        to: target,
        message,
        ts: Date.now()
    };

    dmMessages.push(dm);

    // Keep only last 1000 DMs
    if (dmMessages.length > 1000) dmMessages.shift();

    res.json({ ok: true });
});

// Poll for DMs
app.get('/dm/poll', auth, (req, res) => {
    const since = parseInt(req.query.since) || 0;
    const user = req.query.user;
    const now = Date.now();

    if (!user) return res.status(400).json({ error: 'missing user' });

    const dms = dmMessages.filter(m => m.ts > since && m.to === user);

    res.json({ ok: true, now, dms });
});

// Get conversation history
app.get('/dm/conversation', auth, (req, res) => {
    const user = req.query.user;
    const me = req.query.me;

    if (!user) return res.status(400).json({ error: 'missing user' });

    const conversation = dmMessages.filter(m =>
        (m.from === user || m.to === user)
    );

    res.json({ ok: true, messages: conversation });
});

// ============ AUTH ENDPOINTS ============
// These just return ok for now
app.post('/auth/session', (req, res) => {
    res.json({ ok: true, token: 'session-token' });
});

app.post('/auth/heartbeat', (req, res) => {
    res.json({ ok: true });
});

// ============ DISCORD LINK ============
app.post('/link-discord', auth, (req, res) => {
    res.json({ ok: true });
});

// ============ START ============
app.listen(PORT, () => {
    console.log(`Hunch IRC backend running on port ${PORT}`);

});


