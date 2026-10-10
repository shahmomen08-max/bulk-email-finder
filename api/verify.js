const dns = require('dns').promises;

// Text me se Domain-Specific Emails extract karne ka function
function extractEmailsFromText(text, domain) {
    if (!text) return [];
    const cleanDom = domain.replace(/^www\./, '');
    const regex = new RegExp(`[a-zA-Z0-9._%+-]+@${cleanDom.replace('.', '\\.')}`, 'gi');
    const matches = text.match(regex);
    if (!matches) return [];
    
    return [...new Set(matches.map(e => e.toLowerCase()))];
}

// Serper API Call with Automatic Key Switching
async function searchSerperWithKeyRotation(query, apiKeys) {
    for (let i = 0; i < apiKeys.length; i++) {
        const apiKey = apiKeys[i];
        if (!apiKey) continue;

        try {
            const response = await fetch('https://google.serper.dev/search', {
                method: 'POST',
                headers: {
                    'X-API-KEY': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ q: query, num: 5 })
            });

            if (response.status === 200) {
                const data = await response.json();
                return data; // Success
            } else if (response.status === 403 || response.status === 429) {
                console.log(`Key ${i + 1} limit reached. Switching to key ${i + 2}...`);
                // Next key par switch karega
            }
        } catch (err) {
            console.error(`Error with Key ${i + 1}:`, err.message);
        }
    }
    return null;
}

async function findEmailsForDomain(inputStr, apiKeys) {
    let cleanDomain = inputStr.trim().toLowerCase();
    cleanDomain = cleanDomain.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];

    if (!cleanDomain) return { target: inputStr, emails: [], status: 'invalid domain' };

    try {
        // Step 1: MX Check (Domain Existence)
        const mxRecords = await dns.resolveMx(cleanDomain);
        if (!mxRecords || mxRecords.length === 0) {
            return { target: cleanDomain, emails: [], status: 'No MX records found' };
        }

        let realEmails = [];

        // Step 2: Serper Live Search Search
        if (apiKeys && apiKeys.length > 0) {
            const query = `site:${cleanDomain} "email" OR "contact" OR "@${cleanDomain}"`;
            const serperData = await searchSerperWithKeyRotation(query, apiKeys);

            if (serperData && serperData.organic) {
                let fullText = "";
                serperData.organic.forEach(item => {
                    fullText += ` ${item.title} ${item.snippet}`;
                });
                realEmails = extractEmailsFromText(fullText, cleanDomain);
            }
        }

        // Step 3: Fallback if no specific email found in Google Index
        if (realEmails.length === 0) {
            realEmails.push(`contact@${cleanDomain}`);
        }

        return {
            target: cleanDomain,
            emails: realEmails,
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

    const { domains, serperApiKey } = req.body;
    if (!domains || !Array.isArray(domains)) {
        return res.status(400).json({ error: 'Invalid input format' });
    }

    let keysList = [];
    if (serperApiKey) {
        keysList = serperApiKey.split(',').map(k => k.trim()).filter(k => k);
    }

    const results = [];
    for (const item of domains) {
        const result = await findEmailsForDomain(item, keysList);
        results.push(result);
    }

    return res.status(200).json({ results });
};
