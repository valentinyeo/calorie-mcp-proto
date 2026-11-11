const html = (body: string) =>
  new Response(
    `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><title>Calorie Tracker</title>
<style>body{font:16px system-ui;max-width:360px;margin:12vh auto;padding:0 16px}input,button{display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:10px;font:inherit}.g{background:#fff;color:#111;border:1px solid #ccc}</style>${body}`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

// oauth_query = the signed query string Better Auth put on this page's URL.
export const signInPage = (googleEnabled: boolean) =>
  html(`<h2>Sign in to Calorie Tracker</h2>${
    googleEnabled
      ? `<button class=g id=g>Continue with Google</button><p style=text-align:center;color:#666>or</p>`
      : ""
  }<form id=f><input name=email type=email placeholder=Email required><input name=password type=password placeholder=Password required><button>Sign in</button></form><p id=e style=color:#b00></p>
<script>
const q=location.search.slice(1);
${
  googleEnabled
    ? `g.onclick=async()=>{const r=await fetch('/sign-in/social',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:'google',oauth_query:q,callbackURL:location.href})});const j=await r.json().catch(()=>({}));if(j.url)location.href=j.url;else e.textContent=j.message||'Google sign-in failed ('+r.status+')'};`
    : ""
}
f.onsubmit=async ev=>{ev.preventDefault();const d=new FormData(f);const r=await fetch('/sign-in/email',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:d.get('email'),password:d.get('password'),oauth_query:q})});const j=await r.json().catch(()=>({}));if(j.url)location.href=j.url;else e.textContent=j.message||'Sign-in failed ('+r.status+')'};
</script>`);

export const consentPage = () =>
  html(`<h2>Allow access?</h2><p>An app wants to read and update your Calorie Tracker food log.</p><button id=a>Allow</button><button id=d>Deny</button>
<script>const go=async accept=>{const r=await fetch('/oauth2/consent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accept,oauth_query:location.search.slice(1)})});const j=await r.json().catch(()=>({}));if(j.url)location.href=j.url;else document.body.append('Error '+r.status)};a.onclick=()=>go(true);d.onclick=()=>go(false)</script>`);
