
const dns = require("dns").promises;

const MAX_PAGES = 6;
const TIMEOUT_MS = 6000;
const MAX_HTML_BYTES = 1000000;

function normalizeDomain(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "");
}

function validDomain(domain) {
  return domain.length <= 253 &&
    /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain);
}

function decodeText(value) {
  return value
    .replace(/&commat;|&#64;|&#x40;/gi, "@")
    .replace(/&period;|&#46;|&#x2e;/gi, ".")
    .replace(/&colon;|&#58;/gi, ":")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    );
}

function stripTags(html) {
  return decodeText(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]*>/g, " ")
  ).replace(/\s+/g, " ");
}

function classifyEmail(email) {
  const local = email.split("@")[0].toLowerCase();

  if (/editor|editorial|newsroom|press/.test(local))
    return "Editorial";
  if (/guest|contribut|write|submit|author|pitch/.test(local))
    return "Guest-post candidate";
  if (/advertis|sales|sponsor|media/.test(local))
    return "Advertising / Sales";
  if (/complaint|abuse|privacy|legal|support/.test(local))
    return "Other";
  if (/info|contact|hello|enquir|admin|office/.test(local))
    return "General contact";

  return "Unknown role";
}

function priority(path) {
  if (/write-for-us|guest-post|contribut|submit|pitch/i.test(path))
    return 0;
  if (/editor|editorial|newsroom|press/i.test(path))
    return 1;
  if (/contact|get-in-touch|about/i.test(path))
    return 2;
  return 3;
}

function findLinks(html, baseUrl, host) {
  const links = [];
  const regex = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    try {
      const url = new URL(decodeText(match[1]), baseUrl);

      if (!["http:", "https:"].includes(url.protocol)) continue;
      if (url.hostname.toLowerCase() !== host) continue;

      const searchable = (
        url.pathname + " " + stripTags(match[2])
      ).toLowerCase();

      if (!/contact|about|editor|editorial|write|guest|contribut|submit|pitch|press/.test(searchable)) {
        continue;
      }

      url.hash = "";
      links.push({
        url: url.toString(),
        priority: priority(searchable)
      });
    } catch {}
  }

  return links.sort((a, b) => a.priority - b.priority);
}

async function fetchPage(url, host) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PublicContactPageFinder/1.0)",
        "Accept": "text/html,application/xhtml+xml"
      }
    });

    // Avoid following redirects to unrelated or internal destinations.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;

      const next = new URL(location, url);

      if (
        !["http:", "https:"].includes(next.protocol) ||
        next.hostname.toLowerCase() !== host
      ) return null;

      return fetchPageOnce(next.toString(), host);
    }

    if (!response.ok) return null;

    const type = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) return null;

    const reader = response.body?.getReader();
    if (!reader) return null;

    const chunks = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.byteLength;

      if (total > MAX_HTML_BYTES) {
        await reader.cancel();
        return null;
      }

      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }

    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPageOnce(url, host) {
  // A redirected page is accepted only on the same host.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PublicContactPageFinder/1.0)",
        "Accept": "text/html,application/xhtml+xml"
      }
    });

    if (!response.ok) return null;

    const type = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) return null;

    const html = await response.text();

    if (html.length > MAX_HTML_BYTES) return null;
    return html;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function mxStatus(domain) {
  try {
    const records = await dns.resolveMx(domain);
    return records.length ? "MX records found" : "No MX records returned";
  } catch {
    return "MX records not confirmed";
  }
}

function extractEmails(html, domain, sourceUrl) {
  const visible = decodeText(html)
    .replace(/\s*\[at\]\s*|\s*\(at\)\s*/gi, "@")
    .replace(/\s*\[dot\]\s*|\s*\(dot\)\s*/gi, ".");

  const regex = /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+/g;
  const matches = visible.match(regex) || [];
  const found = [];

  for (const candidate of matches) {
    const email = candidate.replace(/[.,;:]+$/, "").toLowerCase();
    const parts = email.split("@");

    if (parts.length !== 2 || email.length > 254) continue;

    // Only accept addresses whose domain matches the scanned website.
    if (parts[1] !== domain) continue;

    found.push({
      email,
      role: classifyEmail(email),
      sourceUrl,
      status: "FOUND_ON_WEBSITE_INBOX_UNVERIFIED"
    });
  }

  return found;
}

async function scanDomain(rawInput) {
  const domain = normalizeDomain(rawInput);

  if (!validDomain(domain)) {
    return {
      target: String(rawInput),
      emails: [],
      emailDetails: [],
      status: "invalid_domain"
    };
  }

  const mailStatus = await mxStatus(domain);
  const homepageUrls = [`https://${domain}/`, `http://${domain}/`];

  let homepage = null;
  let homepageUrl = null;

  for (const url of homepageUrls) {
    const html = await fetchPage(url, domain);
    if (html) {
      homepage = html;
      homepageUrl = url;
      break;
    }
  }

  if (!homepage) {
    return {
      target: domain,
      emails: [],
      emailDetails: [],
      mxStatus: mailStatus,
      pagesScanned: 0,
      status: "website_unreachable_or_blocked",
      note: "Website could not be fetched; it may block automated requests."
    };
  }

  const pages = [{ url: homepageUrl, html: homepage }];
  const seen = new Set([homepageUrl]);
  const links = findLinks(homepage, homepageUrl, domain);

  for (const link of links) {
    if (pages.length >= MAX_PAGES) break;
    if (seen.has(link.url)) continue;

    seen.add(link.url);

    const html = await fetchPage(link.url, domain);
    if (html) pages.push({ url: link.url, html });
  }

  const all = new Map();

  for (const page of pages) {
    for (const detail of extractEmails(page.html, domain, page.url)) {
      if (!all.has(detail.email)) {
        all.set(detail.email, detail);
      }
    }
  }

  const emailDetails = [...all.values()];

  return {
    target: domain,
    emails: emailDetails.map(item => item.email),
    emailDetails,
    mxStatus: mailStatus,
    pagesScanned: pages.length,
    status: emailDetails.length
      ? "emails_found_unverified"
      : "no_email_found_on_scanned_pages",
    note: "Public-page discovery only. Inbox activity and guest-post acceptance are not verified."
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const domains = req.body?.domains;

  if (!Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({
      error: "Provide a non-empty domains array."
    });
  }

  if (domains.length > 10) {
    return res.status(400).json({
      error: "Maximum 10 domains per request."
    });
  }

  const results = [];

  for (const domain of domains) {
    results.push(await scanDomain(domain));
  }

  return res.status(200).json({ results });
};
