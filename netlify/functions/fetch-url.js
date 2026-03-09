const https = require('https');
const http = require('http');
const { URL } = require('url');
const MAX_BYTES = 500 * 1024;
const TIMEOUT_MS = 10000;

function fetchWithRedirects(urlStr, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    let parsedUrl;
    try { parsedUrl = new URL(urlStr); } catch (e) { return reject(new Error('Invalid URL')); }
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET', timeout: TIMEOUT_MS,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        'Connection': 'close',
      },
    };
    const req = lib.request(options, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        let r = res.headers.location;
        if (r.startsWith('/')) r = `${parsedUrl.protocol}//${parsedUrl.hostname}${r}`;
        res.destroy();
        return resolve(fetchWithRedirects(r, redirectCount + 1));
      }
      let data = ''; let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) { res.destroy(); resolve({ html: data, status: res.statusCode, truncated: true }); return; }
        data += chunk.toString('utf8', 0, chunk.length);
      });
      res.on('end', () => resolve({ html: data, status: res.statusCode, truncated: false }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    req.end();
  });
}

function extractUsefulContent(html) {
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const hasPixel = /fbq\s*\(|facebook\.com\/tr|connect\.facebook\.net\/.*\/fbevents|fbevents\.js/i.test(html);
  const pixelId = html.match(/fbq\s*\(\s*['"]init['"]\s*,\s*['"]?(\d+)/i)?.[1] || null;
  const hasGTM = /GTM-[A-Z0-9]+|googletagmanager\.com\/gtm/i.test(html);
  const hasGA4 = /gtag\s*\(|G-[A-Z0-9]+|ga4|google-analytics\.com\/g\//i.test(html);
  const hasUA = /UA-\d+-\d+|analytics\.js/i.test(html);
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';
  const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1]?.trim() || '';
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]?.trim() || '';
  const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i)?.[1]?.trim() || '';
  const ogSiteName = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i)?.[1]?.trim() || '';
  const text = clean.replace(/<[^>]+>/g, ' ').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/\s{2,}/g,' ').trim().substring(0, 4000);
  return { title, metaDesc, ogTitle, ogDesc, ogSiteName, text, tracking: { hasPixel, pixelId, hasGTM, hasGA4, hasUA, hasAnalytics: hasGTM||hasGA4||hasUA } };
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  let targetUrl = event.queryStringParameters?.url;
  if (!targetUrl && event.body) { try { targetUrl = JSON.parse(event.body).url; } catch(e){} }
  if (!targetUrl) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing url' }) };
  if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;
  const blocked = /localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\./i;
  if (blocked.test(targetUrl)) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Blocked' }) };
  try {
    const { html, status, truncated } = await fetchWithRedirects(targetUrl);
    const content = extractUsefulContent(html);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, url: targetUrl, httpStatus: status, truncated, content }) };
  } catch (err) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: false, url: targetUrl, error: err.message, content: null }) };
  }
};
