const dns = require('dns').promises;

const DEFAULT_KEYS = [
    "2deb2e45775a3712192d77cfca6031eeff8105c0",
    "940b615114b3e4df189739e06f770c67246499a9",
    "82ad7e7739464602794e2aa325dd18d2837ef5f6"
];

function extractEmailsFromText(text, domain) {
    if (!text) return [];
    const baseDomain = domain.replace(/^www\./, '').split('/')[0];
    const regex = new RegExp(`[a-zA-Z0-9._%+-]+@${baseDomain.replace('.', '\\.')}`, 'gi');
    const matches = text.match(regex);
    if (!matches) return [];

    const cleanList = matches.map(e => e.toLowerCase().trim());
    return [...new Set(cleanList)];
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
                body: JSON.stringify({ q: query, num: 10 })
            });

            if (response.status === 200) {
                return await response.json();
            } else if (response.status === 403 || response.status === 429) {
                console.log(`Key ${i + 1} exhausted, switching...`);
            }
        } catch (err) {
            console.error(`Key error:`, err.message);
        }
    }
    return null;
}

async function findEmailsForDomain(inputStr, apiKeys) {
    let cleanDomain = inputStr.trim().toLowerCase();
    cleanDomain = cleanDomain.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];

    if (!cleanDomain) return { target: inputStr, emails: [], status: 'Invalid domain' };

    try {
        const mxRecords = await dns.resolveMx(cleanDomain);
        if (!mxRecords || mxRecords.length === 0) {
            return { target: cleanDomain, emails: [], status: 'Inactive Domain (No MX)' };
        }

        let foundEmails = [];

        if (apiKeys && apiKeys.length > 0) {
            // Target specific contact and write-for-us pages to fetch real emails
            const query = `site:${cleanDomain} "email" OR "contact" OR "support" OR "editor" OR "@${cleanDomain}"`;
            const serperData = await searchSerperWithKeyRotation(query, apiKeys);

            if (serperData && serperData.organic) {
                let corpus = "";
                serperData.organic.forEach(item => {
                    corpus += ` ${item.title} ${item.snippet} ${item.link}`;
                });
                foundEmails = extractEmailsFromText(corpus, cleanDomain);
            }
        }

        // Yahan se fallback hata diya gaya hai. Agar website par email nahi hogi toh list empty rahegi.
        return {
            target: cleanDomain,
            emails: foundEmails,
            status: foundEmails.length > 0 ? 'Real Emails Found' : 'No Email Found on Web'
        };

    } catch (error) {
        return { target: inputStr, emails: [], status: 'Lookup Failed' };
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

    const keysList = [
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
