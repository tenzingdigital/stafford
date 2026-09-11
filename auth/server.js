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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const send = (code, body, headers = {}) =>
    res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', ...headers }).end(body);

  if (url.pathname === '/healthz') return send(200, 'ok', { 'content-type': 'text/plain' });

  if (!configured) {
    return send(500, '<p>Not configured yet: set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.</p>');
  }

  if (url.pathname === '/auth') {
    const state = randomBytes(16).toString('hex');
    const to = new URL('https://github.com/login/oauth/authorize');
    to.searchParams.set('client_id', CLIENT_ID);
    to.searchParams.set('scope', url.searchParams.get('scope') || 'repo');
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
