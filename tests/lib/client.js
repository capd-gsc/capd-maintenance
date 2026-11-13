// Browser-side fake supabase-js: forwards every query to the local Postgres bridge
(function(){
const KEY='mock-session';
const sess=()=>{try{return JSON.parse(localStorage.getItem(KEY))}catch(e){return null}};
const subs=[];
let HDR={};const call=async body=>{const s=sess();const r=await fetch('http://bridge.local/q',{method:'POST',body:JSON.stringify({...body,email:s?.user?.email||'',headers:HDR})});return r.json();};
function Q(t){this.b={t,op:'select',f:[],order:[]};}
Q.prototype.select=function(){if(this.b.op!=='select')this.b.ret=true;return this};
Q.prototype.order=function(k,o){this.b.order.push([k,!o||o.ascending!==false]);return this};
Q.prototype.eq=function(k,v){this.b.f.push([k,v]);return this};
Q.prototype.single=function(){this.b.single=true;return this};
['insert','update','upsert','delete'].forEach(o=>Q.prototype[o]=function(p){this.b.op=o;this.b.payload=p;return this});
Q.prototype.then=function(res,rej){return call(this.b).then(res,rej)};
const auth={
  async getSession(){return {data:{session:sess()}}},
  onAuthStateChange(cb){subs.push(cb);return {data:{subscription:{unsubscribe(){}}}}},
  async signInWithOAuth(o){window.__oauth=o;return {error:null}},
  async signInWithOtp(o){window.__otp=o;return {error:null}},
  async verifyOtp(){return {error:{message:'x'}}},
  async signOut(){localStorage.removeItem(KEY);subs.forEach(c=>c('SIGNED_OUT',null));return {error:null}}
};
window.__login=email=>{const s={user:{email}};localStorage.setItem(KEY,JSON.stringify(s));subs.forEach(c=>c('SIGNED_IN',s));};
window.supabase={createClient:(u,k,o)=>(HDR=Object.fromEntries(Object.entries(o?.global?.headers||{}).map(([a,b])=>[a.toLowerCase(),b])),{from:t=>new Q(t),auth,rpc:n=>call({op:'rpc',t:n}),
 storage:{from:()=>({upload:async()=>({error:null}),createSignedUrls:async p=>({data:p.map(x=>({signedUrl:'data:text/plain,'+encodeURIComponent(x)}))}),createSignedUrl:async()=>({data:{signedUrl:'about:blank'}}),remove:async()=>({})})},
 channel:()=>({on(){return this},subscribe(){return this}}),removeChannel(){}})};
})();
