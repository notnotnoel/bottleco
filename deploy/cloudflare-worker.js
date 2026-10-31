// Cloudflare Worker: shows the BottleCo app at noelpaliath.com/opsagent/bottleco/app/ (the engine runs on Google Cloud Run).
// Route: noelpaliath.com/opsagent/bottleco/app*
// The product page noelpaliath.com/opsagent/bottleco/ stays on the website (Cloudflare Pages) and links here with "Open the app".
// The Worker removes the /opsagent/bottleco/app part and passes the request on, so the address bar keeps noelpaliath.com.
//
// Secret: set once with `npx wrangler secret put PROXY_SECRET` (any long random string), and set the same value as
// BOTTLECO_PROXY_SECRET on the Cloud Run service. Cloud Run then refuses any /api/* call that did not come through
// this Worker (e.g. someone calling the bottleco-xxx.run.app URL directly), so the rate limit and spend cap cannot
// be bypassed by skipping Cloudflare. Leave the secret unset on either side to go back to the old, open behaviour.
const ENGINE = 'https://bottleco-660819960285.asia-southeast1.run.app';
const PREFIX = '/opsagent/bottleco/app';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === PREFIX) return Response.redirect(url.origin + PREFIX + '/', 301);
    if (!url.pathname.startsWith(PREFIX + '/')) return fetch(request);   // safety: anything else goes to the website
    const target = ENGINE + url.pathname.slice(PREFIX.length) + url.search;
    const proxied = new Request(target, request);   // same method, headers and body; answers stream through
    if (env.PROXY_SECRET) proxied.headers.set('x-bottleco-proxy-secret', env.PROXY_SECRET);
    return fetch(proxied);
  }
};
