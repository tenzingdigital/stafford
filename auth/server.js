/* GitHub OAuth handler for the CMS at /admin.
 *
 * Signing in to the CMS is an OAuth exchange, and the final step needs the
 * client secret — which cannot live in a browser. This service does that one
 * step and nothing else. No database, no state beyond a short-lived cookie.
 *
 * Flow:
 *   1. CMS opens  /auth   → we redirect to GitHub
 *   2. GitHub returns to  /callback?code=…
 *   3. We swap the code for a token using the secret
 *   4. We hand the token back to the CMS window via postMessage
 *
 * Environment: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, ALLOWED_ORIGIN
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const {
  GITHUB_CLIENT_ID: CLIENT_ID,
  GITHUB_CLIENT_SECRET: CLIENT_SECRET,
  EMAILOCTOPUS_API_KEY: EO_KEY,
  EMAILOCTOPUS_LIST_ID: EO_LIST,
  ALLOWED_ORIGIN = 'https://stafford-tyrrell.onrender.com',
  PORT = 10000,
} = process.env;

const configured = Boolean(CLIENT_ID && CLIENT_SECRET);

/* The CMS listens for a specific message shape. It first says "authorizing",
   we answer with the result. Replying to e.origin — rather than "*" — keeps the
   token from being posted to a window we did not expect. */
const handoff = (status, payload) => `<!doctype html>
<meta charset="utf-8"><title>Signing in…</title>
<body style="font:14px system-ui;padding:2rem">Signing in…</body>
<script>
(function () {
  var message = 'authorization:github:${status}:' + ${JSON.stringify(JSON.stringify(payload))};
  function receive(e) {
    if (e.origin !== ${JSON.stringify(ALLOWED_ORIGIN)}) return;
    window.opener.postMessage(message, e.origin);
    window.removeEventListener('message', receive, false);
    window.close();
  }
  window.addEventListener('message', receive, false);
  window.opener && window.opener.postMessage('authorizing:github', ${JSON.stringify(ALLOWED_ORIGIN)});
})();
</script>`;

/* ---------------------------------------------------------------- subscribe
 *
 * The mailing-list provider's own embed could not be used: their free plan
 * allows a single form and only the "hello bar" template, which cannot render
 * inside a page. So the site draws its own form — matching the rest of the
 * design, and with a name field, which the bar did not offer — and posts it
 * here. This service holds the API key and passes the details on.
 *
 * Environment: EMAILOCTOPUS_API_KEY, EMAILOCTOPUS_LIST_ID
 */

/* Read a request body, refusing anything implausibly large so a flood of bytes
   cannot exhaust the instance's memory. */
const readBody = (req, limit = 10_000) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });

const parseBody = (raw, type = '') => {
  if (type.includes('application/json')) { try { return JSON.parse(raw); } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(raw));
};

/* Deliberately permissive. Anything stricter starts rejecting real addresses,
   and the provider validates properly at its end anyway. */
const looksLikeEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/* One address can only be submitted so often. Held in memory, so it resets when
   the instance restarts — enough to blunt casual abuse of an open endpoint
   without a database. */
const recent = new Map();
const tooFrequent = (key) => {
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > 600_000) recent.delete(k);
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
};

/* Two generations of the provider's API are in circulation and which one a key
   belongs to is not reliably visible. Rather than guess, try the current one
   and fall back to the older on the errors that mean "wrong door": that way the
   key that gets pasted into Render works whichever it is. */
async function addContact(name, email) {
  const first = (name || '').trim().split(/\s+/)[0] || '';

  const v2 = await fetch(`https://api.emailoctopus.com/lists/${encodeURIComponent(EO_LIST)}/contacts`, {
    method: 'POST',
    headers: { authorization: `Bearer ${EO_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email_address: email, fields: { FirstName: first }, status: 'subscribed' }),
  });
  if (v2.ok || v2.status === 409) return { ok: true };
  const v2body = await v2.text();
  if (![401, 403, 404].includes(v2.status)) {
    return { ok: /exist/i.test(v2body), status: v2.status, body: v2body };
  }

  const v1 = await fetch(`https://emailoctopus.com/api/1.6/lists/${encodeURIComponent(EO_LIST)}/contacts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: EO_KEY, email_address: email, fields: { FirstName: first }, status: 'SUBSCRIBED',
    }),
  });
  if (v1.ok) return { ok: true };
  const v1body = await v1.text();
  /* Already subscribed is a success as far as the visitor is concerned. */
  return { ok: /MEMBER_EXISTS/i.test(v1body), status: v1.status, body: v1body };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const send = (code, body, headers = {}) =>
    res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', ...headers }).end(body);

  if (url.pathname === '/healthz') return send(200, 'ok', { 'content-type': 'text/plain' });

  /* The site is on a different domain to this service, so the browser asks
     permission before letting a page here post to it. Only his site is named. */
  if (url.pathname === '/subscribe') {
    const cors = {
      'access-control-allow-origin': ALLOWED_ORIGIN,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, accept',
      'access-control-max-age': '86400',
    };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    if (req.method !== 'POST') return send(405, 'Use POST.', { ...cors, 'content-type': 'text/plain' });

    const json = (code, payload) =>
      res.writeHead(code, { ...cors, 'content-type': 'application/json' }).end(JSON.stringify(payload));

    /* Without JavaScript the form navigates here, so the reply has to be a
       page a person can read, with a way back. */
    const wantsPage = !(req.headers.accept || '').includes('application/json');
    const page = (heading, note) => send(200, `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading}</title>
<body style="font:16px/1.5 system-ui;max-width:34rem;margin:12vh auto;padding:0 1.5rem">
<h1 style="font-size:1.5rem">${heading}</h1><p>${note}</p>
<p><a href="${ALLOWED_ORIGIN}">Back to the site</a></p>`, cors);

    if (!EO_KEY || !EO_LIST) {
      console.error('subscribe: EMAILOCTOPUS_API_KEY or EMAILOCTOPUS_LIST_ID is not set');
      return wantsPage
        ? page('Not set up yet', 'The mailing list is not connected. Please try again later.')
        : json(503, { ok: false, message: 'Not configured' });
    }

    let body;
    try {
      body = parseBody(await readBody(req), req.headers['content-type'] || '');
    } catch {
      return wantsPage ? page('That was too long', 'Please try again.') : json(413, { ok: false });
    }

    /* A field hidden from people but visible to a robot filling in everything
       it finds. If it has content, drop the submission — and say nothing, so
       whoever sent it learns no more than a real visitor would. */
    if ((body.website || '').trim()) {
      return wantsPage ? page('Thank you', 'You are on the list.') : json(200, { ok: true });
    }

    const email = (body.email || '').trim().toLowerCase();
    const name = (body.name || '').trim().slice(0, 100);
    if (!looksLikeEmail(email)) {
      return wantsPage
        ? page('That address did not look right', 'Please go back and check it.')
        : json(400, { ok: false, message: 'Please check the email address.' });
    }
    if (tooFrequent(email)) {
      return wantsPage ? page('Thank you', 'You are on the list.') : json(200, { ok: true });
    }

    try {
      const result = await addContact(name, email);
      if (!result.ok) console.error('subscribe: provider refused', result.status, result.body);
      return wantsPage
        ? page(result.ok ? 'Thank you' : 'That did not go through',
               result.ok ? 'You are on the list.' : 'Please try again in a moment.')
        : json(result.ok ? 200 : 502, { ok: result.ok });
    } catch (err) {
      console.error('subscribe: could not reach the provider', err);
      return wantsPage
        ? page('That did not go through', 'Please try again in a moment.')
        : json(502, { ok: false });
    }
  }

  if (!configured) {
    return send(500, '<p>Not configured yet: set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.</p>');
  }

  if (url.pathname === '/auth') {
    const state = randomBytes(16).toString('hex');
    const to = new URL('https://github.com/login/oauth/authorize');
    to.searchParams.set('client_id', CLIENT_ID);
    // Defence in depth: even if the CMS asks for broader access, cap it here.
    // Only public_repo is issued, so a token from this service can never reach
    // a private repository. Widen deliberately if the repo is ever made private.
    const requested = url.searchParams.get('scope') || 'public_repo';
    to.searchParams.set('scope', requested === 'repo' ? 'public_repo' : requested);
    to.searchParams.set('state', state);
    return res.writeHead(302, {
      location: to.toString(),
      'set-cookie': `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
    }).end();
  }

  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const cookie = /oauth_state=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];

    if (!code) return send(400, handoff('error', { message: 'No code returned by GitHub' }));
    if (!state || state !== cookie) {
      return send(400, handoff('error', { message: 'State mismatch — please try signing in again' }));
    }

    try {
      const r = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
      });
      const data = await r.json();
      if (!data.access_token) {
        return send(401, handoff('error', { message: data.error_description || 'No token returned' }));
      }
      return send(200, handoff('success', { token: data.access_token, provider: 'github' }), {
        'set-cookie': 'oauth_state=; Path=/; Max-Age=0',
      });
    } catch {
      return send(502, handoff('error', { message: 'Could not reach GitHub' }));
    }
  }

  send(404, '<p>Not found.</p>');
});

server.listen(PORT, () => console.log(`cms auth listening on ${PORT}; configured=${configured}`));
