// api/fetch-url.js — AK Outreach Pro — Vercel Edition
const https = require('https');
const http = require('http');
const { URL } = require('url');

const MAX_BYTES = 700 * 1024;
const TIMEOUT_MS = 14000;

function fetchWithRedirects(urlStr, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 6) return reject(new Error('Too many redirects'));
    let parsed;
    try { parsed = new URL(urlStr); } catch (e) { return reject(new Error('Invalid URL')); }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET', timeout: TIMEOUT_MS,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        'Connection': 'close',
      },
    }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        let loc = res.headers.location;
        if (loc.startsWith('/')) loc = `${parsed.protocol}//${parsed.hostname}${loc}`;
        else if (!loc.startsWith('http')) loc = `${parsed.protocol}//${parsed.hostname}/${loc}`;
        res.destroy();
        return resolve(fetchWithRedirects(loc, redirectCount + 1));
      }
      let data = '', bytes = 0;
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) { res.destroy(); resolve({ html: data, status: res.statusCode }); return; }
        data += chunk.toString('utf8');
      });
      res.on('end', () => resolve({ html: data, status: res.statusCode }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timed out')); });
    req.on('error', reject);
    req.end();
  });
}

function detectTracking(html) {
  const hasPixel = /fbq\s*\(|fbevents\.js|connect\.facebook\.net.*fbevents|facebook\.com\/tr|meta-pixel/i.test(html);
  const pixelId = html.match(/fbq\s*\(\s*['"]init['"]\s*,\s*['"]?(\d{13,20})/i)?.[1] || null;
  const hasGTM = /GTM-[A-Z0-9]{4,8}|googletagmanager\.com\/gtm/i.test(html);
  const hasGA4 = /G-[A-Z0-9]{6,12}|gtag\s*\(\s*['"]config/i.test(html);
  const hasTikTok = /analytics\.tiktok\.com|ttq\s*\.\s*load|_ttq\s*=/i.test(html);
  const hasKlaviyo = /klaviyo|a\.klaviyo\.com|_learnq\s*=/i.test(html);
  const hasShopify = /shopify|myshopify\.com/i.test(html);
  const shopifyStore = html.match(/['"]([a-z0-9-]+)\.myshopify\.com/i)?.[1] || null;
  return { hasPixel, pixelId, hasGTM, hasGA4, hasTikTok, hasKlaviyo, hasShopify, shopifyStore };
}

function extractContent(html) {
  const tracking = detectTracking(html);
  const title = html.match(/<title[^>]*>([^<]+)/i)?.[1]?.trim() || '';
  const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,400})/i)?.[1]?.trim() || '';
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]?.trim() || '';
  const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{0,400})/i)?.[1]?.trim() || '';
  const ogSiteName = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i)?.[1]?.trim() || '';
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&nbsp;/g,' ').replace(/&#\d+;/g,' ').replace(/&[a-z]+;/g,' ')
    .replace(/\s{2,}/g, ' ').trim().substring(0, 6000);
  return { title, metaDesc, ogTitle, ogDesc, ogSiteName, text: clean, tracking };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let targetUrl = req.query?.url;
  if (!targetUrl && req.body) {
    try { targetUrl = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body).url; } catch(e) {}
  }

  if (!targetUrl) return res.status(400).json({ error: 'Missing url' });
  if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;
  if (/localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\./i.test(targetUrl)) {
    return res.status(403).json({ error: 'Blocked' });
  }

  try {
    const { html, status } = await fetchWithRedirects(targetUrl);
    const content = extractContent(html);
    return res.status(200).json({
      success: true, url: targetUrl, httpStatus: status,
      content, text: content.text, title: content.title,
      ogTitle: content.ogTitle, ogDesc: content.ogDesc,
    });
  } catch (err) {
    return res.status(200).json({ success: false, url: targetUrl, error: err.message, content: null, text: '' });
  }
};
