const MAX = 25 * 1024 * 1024;
const cookie = (r, name) => r.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
const token = () => crypto.randomUUID().replaceAll('-','') + crypto.randomUUID().replaceAll('-','');
const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const allowed = (env,email) => (env.ALLOWED_EMAILS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
function setCookie(name,value,age){return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;}
function redirect(url,cookies=[]){const headers=new Headers({Location:url,'Cache-Control':'no-store'});for(const c of cookies)headers.append('Set-Cookie',c);return new Response(null,{status:302,headers});}
export function validName(value){return typeof value==='string'&&value.trim().length>0&&value.length<=200&&!/[\x00-\x1f/\\]/.test(value);}
export async function onRequest({request:r,env}){
 try {
 const u=new URL(r.url),p=u.pathname;
 if(p.startsWith('/f/') && ['GET','HEAD'].includes(r.method)){
  const id=p.slice(3);if(!/^[a-f0-9]{64}$/.test(id))return new Response('Not found',{status:404});
  const object=await env.FILES.get(id,{range:r.headers});if(!object)return new Response('Not found',{status:404});
  const h=new Headers({'Content-Type':'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'",'Cache-Control':'public, max-age=3600','ETag':object.httpEtag,'Accept-Ranges':'bytes'});
  const name=object.customMetadata?.name||'download';h.set('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g,'%27')}`);
  h.set('Content-Length',String(object.range?.length??object.size));
  if(object.range)h.set('Content-Range',`bytes ${object.range.offset}-${object.range.offset+object.range.length-1}/${object.size}`);
  return new Response(r.method==='HEAD'?null:object.body,{status:object.range?206:200,headers:h});
 }
 if(!env.APP_ORIGIN||new URL(env.APP_ORIGIN).origin!==u.origin)return json({error:'Configure APP_ORIGIN to match this deployment.'},503);
 if(r.method!=='GET'&&r.headers.get('Origin')!==u.origin)return json({error:'Invalid request origin'},403);
 if(p==='/auth/login'&&r.method==='GET'){
  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET)return redirect('/?error=setup');
  const state=token(),v=token();const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const target=new URL('https://accounts.google.com/o/oauth2/v2/auth');target.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:u.origin+'/auth/callback',response_type:'code',scope:'openid email',state,code_challenge:challenge,code_challenge_method:'S256'});
  return redirect(target,[setCookie('oauth_state',state,600),setCookie('oauth_verifier',v,600)]);
 }
 if(p==='/auth/callback'&&r.method==='GET'){
  const state=cookie(r,'oauth_state'),verifier=cookie(r,'oauth_verifier');
  if(!state||state!==u.searchParams.get('state')||!verifier||!u.searchParams.get('code'))return redirect('/?error=signin');
  const t=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({code:u.searchParams.get('code'),client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:u.origin+'/auth/callback',grant_type:'authorization_code',code_verifier:verifier})});
  if(!t.ok)return redirect('/?error=signin');const auth=await t.json();
  const info=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${auth.access_token}`}});if(!info.ok)return redirect('/?error=signin');const user=await info.json();
  if(!user.sub||!user.email||user.email_verified!==true||!allowed(env,user.email))return redirect('/?error=denied');
  const session=token();await env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(Date.now()).run();await env.DB.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(session,user.sub,user.email,Date.now()+86400000).run();
  return redirect('/',[setCookie('__Host-session',session,86400),setCookie('oauth_state','',0),setCookie('oauth_verifier','',0)]);
 }
 const sessionId=cookie(r,'__Host-session');const user=sessionId?await env.DB.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').bind(sessionId,Date.now()).first():null;
 if(p==='/api/me')return json({user:user&&allowed(env,user.email)?{email:user.email}:null,maxUpload:MAX});
 if(!user||!allowed(env,user.email))return json({error:'Sign in with an approved Google account.'},401);
 if(p==='/auth/logout'&&r.method==='POST'){await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(sessionId).run();return new Response(null,{status:204,headers:{'Set-Cookie':setCookie('__Host-session','',0)}});}
 const owner=user.subject;
 if(p==='/api/list'&&r.method==='GET'){
  const folders=await env.DB.prepare('SELECT id,parent,name,created FROM folders WHERE owner=? ORDER BY name').bind(owner).all();
  const files=await env.DB.prepare('SELECT id,folder,name,size,type,created FROM files WHERE owner=? ORDER BY created DESC').bind(owner).all();return json({folders:folders.results,files:files.results});
 }
 if(p==='/api/folders'&&r.method==='POST'){
  const {name,parent=''}=await r.json();if(!validName(name)||typeof parent!=='string')return json({error:'Use a folder name of 1–200 characters, without slashes.'},400);
  if(parent&&!await env.DB.prepare('SELECT id FROM folders WHERE id=? AND owner=?').bind(parent,owner).first())return json({error:'Folder not found'},404);
  const id=token();try{await env.DB.prepare('INSERT INTO folders VALUES (?,?,?,?,?)').bind(id,owner,parent,name.trim(),Date.now()).run();}catch{return json({error:'A folder with that name already exists.'},409);}return json({id},201);
 }
 if(p==='/api/upload'&&r.method==='POST'){
  if(Number(r.headers.get('Content-Length'))>MAX)return json({error:'Files must be 25 MB or smaller.'},413);
  const name=u.searchParams.get('name'),folder=u.searchParams.get('folder')||'';if(!validName(name))return json({error:'Invalid filename'},400);
  if(folder&&!await env.DB.prepare('SELECT id FROM folders WHERE id=? AND owner=?').bind(folder,owner).first())return json({error:'Folder not found'},404);
  let size=0;const chunks=[];const reader=r.body?.getReader();if(!reader)return json({error:'Empty upload'},400);
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX){await reader.cancel();return json({error:'Files must be 25 MB or smaller.'},413);}chunks.push(value);}
  const id=token(),type=r.headers.get('Content-Type')||'application/octet-stream';await env.FILES.put(id,new Blob(chunks),{customMetadata:{name}});
  try{await env.DB.prepare('INSERT INTO files VALUES (?,?,?,?,?,?,?)').bind(id,owner,folder,name,size,type,Date.now()).run();}catch(e){await env.FILES.delete(id);throw e;}return json({id,url:u.origin+'/f/'+id},201);
 }
 return json({error:'Not found'},404);
 }catch(e){console.error('Request failed',e.message);return json({error:'Unable to complete this request. Please try again.'},500);}
}
