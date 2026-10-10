const dns = require('dns').promises;

// Aapki secure API keys (Backend par hidden rahengi)
const DEFAULT_KEYS = [
    "2deb2e45775a3712192d77cfca6031eeff8105c0",
    "940b615114b3e4df189739e06f770c67246499a9",
    "82ad7e7739464602794e2aa325dd18d2837ef5f6"
];

function extractEmailsFromText(text, domain) {
    if (!text) return [];
    const cleanDom = domain.replace(/^www\./, '');
    const regex = new RegExp(`[a-zA-Z0-9._%+-]+@${cleanDom.replace('.', '\\.')}`, 'gi');
    const matches = text.match(regex);
    if (!matches) return [];
    
    return [...new Set(matches.map(e => e.toLowerCase()))];
}

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
                return data;
            } else if (response.status === 403 || response.status === 429) {
                console.log(`Key ${i + 1} limit reached. Switching to next key...`);
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
        const mxRecords = await dns.resolveMx(cleanDomain);
        if (!mxRecords || mxRecords.length === 0) {
            return { target: cleanDomain, emails: [], status: 'No MX records found' };
        }

        let realEmails = [];

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

    const { domains } = req.body;
    if (!domains || !Array.isArray(domains)) {
        return res.status(400).json({ error: 'Invalid input format' });
    }

    // Vercel Environment Variables ya Default Secure Keys use karega
    let keysList = [
        process.env.SERPER_API_KEY_1 || DEFAULT_KEYS[0],
        process.env.SERPER_API_KEY_2 || DEFAULT_KEYS[1],
        process.env.SERPER_API_KEY_3 || DEFAULT_KEYS[2]
    ].filter(k => k);

    const results = [];
    for (const item of domains) {
        const result = await findEmailsForDomain(item, keysList);
        results.push(result);
    }

    return res.status(200).json({ results });
};
