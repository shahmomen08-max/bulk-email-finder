const dns = require('dns').promises;

// Aapki Single Nayi Serper API Key
const SERPER_API_KEY = process.env.SERPER_API_KEY || "a9ec42e633ce3bc04f4874eede56462f2f123bc7";

// Strict extractor: Search result text se exact `@domain.com` email dhoondta hai
function extractExactEmails(text, domain) {
    if (!text) return [];
    const baseDomain = domain.replace(/^www\./, '').split('/')[0];
    
    const regex = new RegExp(`[a-zA-Z0-9._%+-]+@${baseDomain.replace('.', '\\.')}`, 'gi');
    const matches = text.match(regex);
    
    if (!matches) return [];

    const cleanList = matches.map(e => e.toLowerCase().trim());
    return [...new Set(cleanList)];
}

async function searchSerper(query, apiKey) {
    if (!apiKey) return null;

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
        } else {
            console.error(`Serper API error status: ${response.status}`);
        }
    } catch (err) {
        console.error(`Serper fetch error:`, err.message);
    }
    return null;
}

async function findEmailsForDomain(inputStr, apiKey) {
    let cleanDomain = inputStr.trim().toLowerCase();
    cleanDomain = cleanDomain.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];

    if (!cleanDomain) return { target: inputStr, emails: [], status: 'Invalid domain' };

    try {
        const mxRecords = await dns.resolveMx(cleanDomain);
        if (!mxRecords || mxRecords.length === 0) {
            return { target: cleanDomain, emails: [], status: 'Inactive Domain (No MX)' };
        }

        let foundEmails = [];

        if (apiKey) {
            const query = `site:${cleanDomain} "email" OR "contact" OR "@${cleanDomain}"`;
            const serperData = await searchSerper(query, apiKey);

            if (serperData && serperData.organic) {
                let corpus = "";
                serperData.organic.forEach(item => {
                    corpus += ` ${item.title} ${item.snippet} ${item.link}`;
                });
                foundEmails = extractExactEmails(corpus, cleanDomain);
            }
        }

        return {
            target: cleanDomain,
            emails: foundEmails,
            status: foundEmails.length > 0 ? 'Verified Active' : 'No Email Found'
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

    const results = [];
    for (const item of domains) {
        const result = await findEmailsForDomain(item, SERPER_API_KEY);
        results.push(result);
    }

    return res.status(200).json({ results });
};
