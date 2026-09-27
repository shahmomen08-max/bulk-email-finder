const dns = require('dns').promises;

async function findEmailsForDomain(inputStr) {
    let cleanDomain = inputStr.trim().toLowerCase();
    cleanDomain = cleanDomain.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];

    if (!cleanDomain) return { target: inputStr, emails: [], status: 'invalid domain' };

    const commonPrefixes = ['info', 'contact', 'support', 'editor', 'guestpost', 'admin', 'sales'];
    const validFound = [];

    try {
        const mxRecords = await dns.resolveMx(cleanDomain);
        if (!mxRecords || mxRecords.length === 0) {
            return { target: inputStr, emails: [], status: 'No MX records found' };
        }

        for (const prefix of commonPrefixes) {
            validFound.push(`${prefix}@${cleanDomain}`);
        }

        return {
            target: cleanDomain,
            emails: validFound,
            status: 'success'
        };
    } catch (error) {
        return { target: inputStr, emails: [], status: 'Domain not active or invalid' };
    }
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { domains } = req.body;
    if (!domains || !Array.isArray(domains)) {
        return res.status(400).json({ error: 'Invalid input format' });
    }

    const results = [];
    for (const item of domains) {
        const result = await findEmailsForDomain(item);
        results.push(result);
    }

    return res.status(200).json({ results });
};
