const dns = require('dns').promises;

// Simple email syntax & domain MX record verifier
async function checkEmail(email) {
    // 1. Regex Syntax Check
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!regex.test(email)) {
        return { email, status: 'invalid' };
    }

    // 2. Domain MX Record Check
    const domain = email.split('@')[1];
    try {
        const mxRecords = await dns.resolveMx(domain);
        if (mxRecords && mxRecords.length > 0) {
            return { email, status: 'valid' };
        } else {
            return { email, status: 'invalid' };
        }
    } catch (error) {
        return { email, status: 'invalid' };
    }
}

// Serverless function handler (Vercel compatible)
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { emails } = req.body;
    if (!emails || !Array.isArray(emails)) {
        return res.status(400).json({ error: 'Invalid input format' });
    }

    const results = [];
    for (const email of emails) {
        const result = await checkEmail(email);
        results.push(result);
    }

    return res.status(200).json({ results });
};
