// Cloudflare Worker: shows BottleCo at noelpaliath.com/opsagent/bottleco/ (the engine runs on Google Cloud Run).
// Route: noelpaliath.com/opsagent/bottleco*
// The Worker removes the /opsagent/bottleco part and passes the request on, so the address bar keeps noelpaliath.com.
const ENGINE = 'https://bottleco-660819960285.asia-southeast1.run.app';
const PREFIX = '/opsagent/bottleco';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === PREFIX) return Response.redirect(url.origin + PREFIX + '/', 301);
    const target = ENGINE + url.pathname.slice(PREFIX.length) + url.search;
    return fetch(new Request(target, request));   // same method, headers and body; answers stream through
  }
};
