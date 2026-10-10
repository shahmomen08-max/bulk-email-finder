
const dns = require("dns").promises;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function cleanDomain(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRole(email) {
  const name = email.split("@")[0];

  if (/editor|editorial|newsroom|journalist/i.test(name))
    return "Editorial";
  if (/guest|contribut|write|submit|author/i.test(name))
    return "Guest posting candidate";
  if (/sales|advertis|sponsor|media/i.test(name))
    return "Sales / Advertising";
  if (/complaint|abuse|legal|privacy/i.test(name))
    return "Other";
  if (/info|contact|hello|enquir|admin/i.test(name))
    return "General contact";

  return "Unknown";
}

function getKeys() {
  return [
    process.env.SERPER_API_KEY_1,
    process.env.SERPER_API_KEY_2,
    process.env.SERPER_API_KEY_3
  ].filter(Boolean);
}

async function searchWithRotation(query, keys) {
  if (!keys.length) {
    throw new Error("No Serper API keys configured");
  }

  let lastError = "All configured keys failed";

  for (let i = 0; i < keys.length; i++) {
    try {
      const response = await fetch(
        "https://google.serper.dev/search",
        {
          method: "POST",
          headers: {
            "X-API-KEY": keys[i],
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ q: query, num: 10 })
        }
      );

      if (response.ok) {
        return await response.json();
      }

      lastError = `Serper returned HTTP ${response.status}`;

      // Only try another key for rate/limit or authorization errors.
      if (![403, 429].includes(response.status)) {
        throw new Error(lastError);
      }

      // Don't retry the same key; try the next configured key.
      console.warn(`Serper key slot ${i + 1} failed: HTTP ${response.status}`);
    } catch (err) {
      lastError = err.message || "Search request failed";

      if (err.message?.includes("HTTP ") &&
          !/HTTP (403|429)\b/.test(err.message)) {
        throw err;
      }

      // Network errors get one brief retry, then rotation continues.
      if (i < keys.length - 1) await sleep(300);
    }
  }

  throw new Error(lastError);
}

async function findEmails(rawDomain, keys) {
  const domain = cleanDomain(rawDomain);

  if (
    !domain ||
    domain.length > 253 ||
    !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
  ) {
    return {
      target: String(rawDomain),
      emails: [],
      emailDetails: [],
      status: "invalid_domain"
    };
  }

  let mxStatus = "Not checked";

  try {
    const mx = await dns.resolveMx(domain);
    mxStatus = mx.length ? "MX records found" : "No MX records returned";
  } catch {
    mxStatus = "MX records not confirmed";
  }

  try {
    const query =
      `site:${domain} (email OR contact OR editorial OR editor OR "write for us" OR "guest post")`;

    const data = await searchWithRotation(query, keys);
    const regex = new RegExp(
      `[a-zA-Z0-9._%+-]+@${escapeRegex(domain)}`,
      "gi"
    );

    const found = new Map();

    for (const item of data.organic || []) {
      const text = `${item.title || ""} ${item.snippet || ""}`;
      const matches = text.match(regex) || [];

      for (const value of matches) {
        const email = value.toLowerCase();

        if (!found.has(email)) {
          found.set(email, {
            email,
            role: getRole(email),
            sourceUrl: item.link || null,
            verificationStatus: "UNVERIFIED"
          });
        }
      }
    }

    const emailDetails = [...found.values()];

    return {
      target: domain,
      emails: emailDetails.map(item => item.email),
      emailDetails,
      mxStatus,
      status: emailDetails.length
        ? "emails_found_unverified"
        : "no_email_found"
    };
  } catch (err) {
    console.error(`Search failed for ${domain}: ${err.message}`);

    return {
      target: domain,
      emails: [],
      emailDetails: [],
      mxStatus,
      status: "search_failed"
    };
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const keys = getKeys();

  if (!keys.length) {
    return res.status(500).json({
      error: "Serper API keys are not configured in Vercel"
    });
  }

  const domains = req.body?.domains;

  if (!Array.isArray(domains) || !domains.length) {
    return res.status(400).json({
      error: "Provide a non-empty domains array"
    });
  }

  if (domains.length > 25) {
    return res.status(400).json({
      error: "Maximum 25 domains per request"
    });
  }

  const results = [];

  for (const domain of domains) {
    results.push(await findEmails(domain, keys));
  }

  return res.status(200).json({
    results,
    note: "Found emails are not confirmed active inboxes."
  });
};
