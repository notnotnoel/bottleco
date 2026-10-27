// Cloudflare Worker: shows the BottleCo app at noelpaliath.com/opsagent/bottleco/app/ (the engine runs on Google Cloud Run).
// Route: noelpaliath.com/opsagent/bottleco/app*
// The product page noelpaliath.com/opsagent/bottleco/ stays on the website (Cloudflare Pages) and links here with "Open the app".
// The Worker removes the /opsagent/bottleco/app part and passes the request on, so the address bar keeps noelpaliath.com.
const ENGINE = 'https://bottleco-660819960285.asia-southeast1.run.app';
const PREFIX = '/opsagent/bottleco/app';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === PREFIX) return Response.redirect(url.origin + PREFIX + '/', 301);
    if (!url.pathname.startsWith(PREFIX + '/')) return fetch(request);   // safety: anything else goes to the website
    const target = ENGINE + url.pathname.slice(PREFIX.length) + url.search;
    return fetch(new Request(target, request));   // same method, headers and body; answers stream through
  }
};
