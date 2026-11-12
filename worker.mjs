const METHODS = new Set(['getState', 'getPoster', 'addMember', 'saveTitle', 'setStatus']);
const MAX_BODY = 1_500_000;

function json(body, status = 200) {
  return Response.json(body, {status, headers:{'Cache-Control':'no-store'}});
}

function fail(error, status) {
  return json({ok:false,error},status);
}

async function equal(left, right) {
  const encode = new TextEncoder();
  const [a,b] = await Promise.all([left,right].map(value =>
    crypto.subtle.digest('SHA-256',encode.encode(value))));
  const bytesA = new Uint8Array(a), bytesB = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < bytesA.length; i++) difference |= bytesA[i] ^ bytesB[i];
  return difference === 0;
}

async function allowed(request, password) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  try {
    const credentials = atob(header.slice(6));
    const separator = credentials.indexOf(':');
    return separator !== -1 && credentials.slice(0,separator) === 'club' &&
      await equal(credentials.slice(separator+1), password);
  } catch {
    return false;
  }
}

async function readJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Missing JSON body.');
  const decoder = new TextDecoder();
  let text = '', size = 0;
  try {
    while (true) {
      const {value,done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        throw new RangeError('Upload is too large.');
      }
      text += decoder.decode(value,{stream:true});
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(text + decoder.decode());
}

export default {
  async fetch(request, env) {
    if (!env.CLUB_PASSWORD) return new Response('Set the CLUB_PASSWORD Worker secret.',{status:503});
    if (!await allowed(request,env.CLUB_PASSWORD)) {
      return new Response('Enter the PL4YOU club credentials.',{status:401,headers:{
        'WWW-Authenticate':'Basic realm="PL4YOU"', 'Cache-Control':'no-store'
      }});
    }
    const url = new URL(request.url);
    if (url.pathname !== '/api') {
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body,asset);
      response.headers.set('Cache-Control','private, no-store');
      return response;
    }
    if (request.method !== 'POST') return fail('Use POST.',405);
    if (request.headers.get('Origin') !== url.origin) return fail('Invalid request origin.',403);
    if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') {
      return fail('Expected JSON.',415);
    }
    if (!env.API_SECRET || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(env.GOOGLE_SCRIPT_URL || '')) {
      return fail('Set GOOGLE_SCRIPT_URL and API_SECRET in Cloudflare.',503);
    }
    let payload;
    try { payload = await readJson(request); }
    catch (error) { return fail(error instanceof RangeError ? error.message : 'Invalid JSON.',error instanceof RangeError ? 413 : 400); }
    if (!METHODS.has(payload?.method) || !Array.isArray(payload.args)) return fail('Unknown operation.',400);
    try {
      let upstream = await fetch(env.GOOGLE_SCRIPT_URL,{
        method:'POST',redirect:'manual',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({method:payload.method,args:payload.args,secret:env.API_SECRET})
      });
      if ([301,302,303].includes(upstream.status)) {
        const location = new URL(upstream.headers.get('Location') || '', env.GOOGLE_SCRIPT_URL);
        if (location.origin !== 'https://script.googleusercontent.com') {
          return fail('Check that the Apps Script deployment allows Anyone to access it.',502);
        }
        upstream = await fetch(location,{redirect:'error'});
      }
      if (!upstream.ok || !upstream.headers.get('Content-Type')?.includes('application/json')) {
        return fail('Google did not return JSON. Check your Apps Script deployment and permissions.',502);
      }
      const result = await upstream.json();
      return json(result,result.ok ? 200 : 400);
    } catch {
      return fail('Google storage is unavailable. Try again shortly.',502);
    }
  }
};
