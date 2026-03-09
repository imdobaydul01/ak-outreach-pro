// netlify/functions/fetch-url.js — AK Outreach Pro Premium v5
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache', 'Connection': 'close',
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
        if (bytes > MAX_BYTES) { res.destroy(); resolve({ html: data, status: res.statusCode, truncated: true }); return; }
        data += chunk.toString('utf8');
      });
      res.on('end', () => resolve({ html: data, status: res.statusCode, truncated: false }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timed out')); });
    req.on('error', reject);
    req.end();
  });
}

function detectTracking(html) {
  // FACEBOOK PIXEL — 25+ patterns covering all injection methods
  const fbPatterns = [
    /fbq\s*\(/i, /fbq\s*=\s*function/i, /_fbq\s*=/i, /window\.fbq/i,
    /facebook\.com\/tr[?/]/i, /facebook\.com\/tr\b/i,
    /connect\.facebook\.net[^\s"']*fbevents/i, /fbevents\.js/i,
    /FacebookPixel/i, /facebook_pixel/i,
    /"pixel_id"\s*:/i, /pixel_id\s*[:=]/i,
    /FACEBOOK_PIXEL_ID/i, /FB_PIXEL/i,
    /analytics\.facebook\.com/i, /pixel\.facebook\.com/i,
    /meta-pixel/i, /"metaPixelId"/i,
    /fbq\.queue/i, /fb-pixel/i,
    /"type":"FacebookPixel"/i,
    /shopify_pixel.*facebook/i,
  ];
  const hasPixel = fbPatterns.some(p => p.test(html));

  let pixelId = null;
  const pidPatterns = [
    /fbq\s*\(\s*['"]init['"]\s*,\s*['"]?(\d{13,20})/i,
    /"pixel_id"\s*:\s*["']?(\d{13,20})/i,
    /FACEBOOK_PIXEL_ID['":\s=]+["']?(\d{13,20})/i,
    /"metaPixelId"\s*:\s*["']?(\d{13,20})/i,
    /pixel[_\s-]?id['":\s=]+["']?(\d{13,20})/i,
  ];
  for (const p of pidPatterns) { const m = html.match(p); if (m?.[1]) { pixelId = m[1]; break; } }

  const hasGTM = /GTM-[A-Z0-9]{4,8}|googletagmanager\.com\/gtm|googletagmanager\.com\/ns\.html/i.test(html);
  const gtmId = html.match(/GTM-([A-Z0-9]{4,8})/i)?.[0] || null;
  const hasGA4 = /G-[A-Z0-9]{6,12}|gtag\s*\(\s*['"]config['"]\s*,\s*['"]G-|google-analytics\.com\/g\/collect/i.test(html);
  const ga4Id = html.match(/G-([A-Z0-9]{6,12})/i)?.[0] || null;
  const hasUA = /UA-\d{4,}-\d{1,3}|analytics\.js/i.test(html);
  const hasTikTok = /analytics\.tiktok\.com|tiktok.*pixel|ttq\s*\.\s*load|_ttq\s*=|TiktokAnalytics/i.test(html);
  const tiktokId = html.match(/ttq\.load\s*\(\s*['"]([A-Z0-9]{18,})['"]/i)?.[1] || null;
  const hasKlaviyo = /klaviyo|a\.klaviyo\.com|_learnq\s*=|KlaviyoSubscribe/i.test(html);
  const hasReviews = /yotpo|judge\.me|okendo|stamped\.io|loox\.io|trustpilot/i.test(html);
  const hasShopify = /shopify|myshopify\.com|Shopify\.shop/i.test(html);
  const shopifyStore = html.match(/["']([a-z0-9-]+)\.myshopify\.com/i)?.[1] || null;
  const hasChat = /tidiochat|gorgias|freshchat|intercom|zendesk|livechat|crisp\.chat/i.test(html);
  const hasPinterest = /pintrk\s*\(|ct\.pinterest\.com/i.test(html);

  return {
    hasPixel, pixelId, hasGTM, gtmId, hasGA4, ga4Id, hasUA,
    hasAnalytics: hasGTM || hasGA4 || hasUA,
    hasTikTok, tiktokId, hasKlaviyo, hasReviews,
    hasShopify, shopifyStore, hasChat, hasPinterest,
  };
}

function extractContent(html) {
  const tracking = detectTracking(html);
  const title = html.match(/<title[^>]*>([^<]+)/i)?.[1]?.trim() || '';
  const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,400})/i)?.[1]?.trim() || '';
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]?.trim() || '';
  const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{0,400})/i)?.[1]?.trim() || '';
  const ogSiteName = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i)?.[1]?.trim() || '';
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ').replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ').replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&nbsp;/g,' ').replace(/&#\d+;/g,' ').replace(/&[a-z]+;/g,' ')
    .replace(/\s{2,}/g, ' ').trim().substring(0, 6000);
  return { title, metaDesc, ogTitle, ogDesc, ogSiteName, text: clean, tracking };
}

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  let targetUrl = event.queryStringParameters?.url;
  if (!targetUrl && event.body) { try { targetUrl = JSON.parse(event.body).url; } catch(e) {} }
  if (!targetUrl) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing url' }) };
  if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;
  if (/localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\./i.test(targetUrl)) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Blocked' }) };
  try {
    const { html, status, truncated } = await fetchWithRedirects(targetUrl);
    const content = extractContent(html);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, url: targetUrl, httpStatus: status, truncated, content }) };
  } catch (err) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: false, url: targetUrl, error: err.message, content: null }) };
  }
};
