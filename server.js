const express=require("express"),crypto=require("crypto"),multer=require("multer");
const {createClient}=require("@supabase/supabase-js");
const twilio=require("twilio");

const app=express(),PORT=process.env.PORT||10000;
const BASE="https://jr-pheef-marketplace.onrender.com";
const KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
const db=createClient(process.env.SUPABASE_URL,KEY);
const tw=process.env.TWILIO_ACCOUNT_SID?twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN):null;
const FROM=process.env.TWILIO_WHATSAPP_NUMBER;
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024}});
app.use(express.urlencoded({extended:true}),express.json());

// ---------- helpers ----------
const plans={free:0,pro:20,prime:20};
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clean=x=>String(x??"").trim();
const phone=x=>{
 x=clean(x).replace(/^whatsapp:/i,"").replace(/[^\d+]/g,"");
 if(x.startsWith("07"))x="+254"+x.slice(1);
 if(x.startsWith("254"))x="+"+x;
 return x;
};
const hash=p=>crypto.scryptSync(p,process.env.PASSWORD_SALT||"jr-pheef-salt",32).toString("hex");
// timing-safe compare — replaces the old `hash1 !== hash2` string comparison
function passwordMatches(inputHash,storedHash){
 try{
  let a=Buffer.from(String(inputHash),"hex"),b=Buffer.from(String(storedHash),"hex");
  if(a.length!==b.length)return false;
  return crypto.timingSafeEqual(a,b);
 }catch{return false}
}
const blocked=/(\+?\d[\d\s().-]{7,}|\b\d{9,13}\b|https?:\/\/|www\.|\.com\b|\.co\.ke\b|@\w+\.\w+|\bwhatsapp\b|\btelegram\b|\bemail\b)/i;
const fee=n=>Math.max(5,30-(Number(n)||0));

// very small in-memory login throttle (per phone). Resets on restart — a real
// deployment should back this with Redis/DB too, but it stops naive brute force.
const loginAttempts=new Map();
function loginLocked(p){
 let a=loginAttempts.get(p);
 if(!a)return false;
 if(Date.now()-a.first>15*60*1000){loginAttempts.delete(p);return false}
 return a.count>=8;
}
function loginFail(p){
 let a=loginAttempts.get(p)||{count:0,first:Date.now()};
 a.count++;loginAttempts.set(p,a);
}
function loginOk(p){loginAttempts.delete(p)}

async function one(t,id){let q=await db.from(t).select("*").eq("id",id).maybeSingle();return q.data}
async function byPhone(p){let q=await db.from("members").select("*").eq("phone",phone(p)).maybeSingle();return q.data}
async function save(t,d,id){return db.from(t).update(d).eq("id",id)}
async function dgbo(){let q=await db.from("members").select("id",{count:"exact",head:true});return"DGBO-"+String((q.count||0)+1).padStart(6,"0")}

// ---------- sessions (Supabase-backed, no more in-memory Map) ----------
// requires a `sessions` table — see migrations.sql
const SESSION_DAYS=30;
async function startSession(res,u){
 let s=crypto.randomBytes(32).toString("hex");
 let csrf=crypto.randomBytes(16).toString("hex");
 let expires=new Date(Date.now()+SESSION_DAYS*24*60*60*1000).toISOString();
 let{error}=await db.from("sessions").insert({id:s,member_id:u.id,csrf_token:csrf,expires_at:expires});
 if(error){console.error("session create failed",error);throw error}
 res.setHeader("Set-Cookie",[
  `sid=${s}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS*86400}`,
  `csrf=${csrf}; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS*86400}`
 ]);
}
async function endSession(req,res){
 let h=req.headers.cookie||"",m=h.match(/(?:^|;\s*)sid=([^;]+)/);
 if(m)await db.from("sessions").delete().eq("id",m[1]);
 res.setHeader("Set-Cookie",["sid=; Max-Age=0; Path=/","csrf=; Max-Age=0; Path=/"]);
}
async function me(req){
 let h=req.headers.cookie||"",m=h.match(/(?:^|;\s*)sid=([^;]+)/);
 if(!m)return null;
 let{data:s}=await db.from("sessions").select("*").eq("id",m[1]).maybeSingle();
 if(!s)return null;
 if(new Date(s.expires_at)<new Date()){db.from("sessions").delete().eq("id",m[1]);return null}
 let u=await one("members",s.member_id);
 if(u)u._csrf=s.csrf_token;
 return u;
}
// CSRF check for state-changing requests. Cookie csrf must match both the
// session's stored token and the hidden _csrf field submitted with the form.
function csrfOk(req,u){
 let h=req.headers.cookie||"",m=h.match(/(?:^|;\s*)csrf=([^;]+)/);
 let cookieCsrf=m&&m[1],bodyCsrf=req.body&&req.body._csrf;
 return !!(u&&u._csrf&&cookieCsrf&&bodyCsrf&&cookieCsrf===u._csrf&&bodyCsrf===u._csrf);
}
function csrfField(u){return `<input type=hidden name=_csrf value="${esc(u._csrf)}">`}
function requireCsrf(req,res,u){
 if(!csrfOk(req,u)){res.status(403).send(page("Session expired","<main><div class=card><h2>Your session expired.</h2><p>Please refresh the page and try again.</p><a class=btn href=/>Back home</a></div></main>"));return false}
 return true
}

// ---------- page shell ----------
function page(title,body,theme="green"){
 const c={green:"#08783c",blue:"#2563eb",purple:"#7c3aed",gold:"#b8860b",black:"#111"}[theme]||"#08783c";
 return`<!doctype html><html><meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
 <style>body{margin:0;background:#f3f8f5;font:15px Arial;color:#111}header{background:${c};color:white;padding:24px 20px}main{max-width:850px;margin:auto;padding:14px}.card{background:white;padding:18px;border-radius:18px;margin:12px 0;box-shadow:0 2px 10px #0001}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}input,textarea,select{width:100%;padding:12px;margin:5px 0;border:1px solid #ccc;border-radius:10px;box-sizing:border-box}button,.btn{background:${c};color:white;border:0;border-radius:10px;padding:11px 15px;margin:4px;text-decoration:none;display:inline-block;cursor:pointer}img{max-width:120px}.avatar{width:110px;height:110px;border-radius:50%;object-fit:cover}.tag{display:inline-block;font-size:12px;padding:2px 8px;border-radius:20px;background:#eee;margin-left:6px}</style>
 <body>${body}</body></html>`
}
function home(u){
 return page("JR PHEEF",`<header><h1>JR PHEEF</h1><p>Welcome, ${esc(u.full_name)} 👋</p><b>${esc(u.dgbo_id)}</b></header><main>
 <div class=card><h2>👤 Profile</h2>${u.profile_photo?`<img class=avatar src="${esc(u.profile_photo)}">`:"👤"}<p><b>${esc(u.full_name)}</b></p><p>${esc(u.bio||"Tell people about yourself.")}</p><a class=btn href=/profile>Edit profile</a></div>
 <div class=grid>
 <div class=card><h2>🔎 Find</h2><p>People, products, services and opportunities.</p><a class=btn href=/find>Explore</a></div>
 <div class=card><h2>🏪 Sell</h2><p>Listings are FREE.</p><a class=btn href=/listing>Create listing</a></div>
 <div class=card><h2>🤝 Matches</h2><p>Local and international.</p><a class=btn href=/matches>View matches</a></div>
 <div class=card><h2>💬 Connections</h2><p>Talk naturally and safely.</p><a class=btn href=/connections>Open</a></div>
 <div class=card><h2>💞 Love & Friendship</h2><a class=btn href=/love>Discover</a></div>
 <div class=card><h2>🤝 Deal Rooms</h2><a class=btn href=/deals>Open</a></div>
 <div class=card><h2>🚚 Delivery</h2><p>Free request.</p><a class=btn href=/delivery>Request</a></div>
 <div class=card><h2>🏢 Organizations</h2><a class=btn href=/organization>Manage</a></div>
 <div class=card><h2>📣 JR PHEEF Promote</h2><p>Community picks, official & featured brands.</p><a class=btn href=/promote>Explore</a></div>
 </div>
 <div class=card><h2>🎁 Wallet</h2><p>Rewards: KSh ${u.rewards||0}<br>Credits: KSh ${u.credits||0}</p><a class=btn href=/wallet>Open</a></div>
 <div class=card><h2>⭐ Membership</h2><p>FREE — KSh ${fee(u.paid_matches)} next trade match</p><p>PRO — KSh 99/month</p><p>PRIME — KSh 149/month</p>
 <form method=post action=/upgrade style="display:inline">${csrfField(u)}<input type=hidden name=plan value=pro><button>Try PRO</button></form>
 <form method=post action=/upgrade style="display:inline">${csrfField(u)}<input type=hidden name=plan value=prime><button>Try PRIME</button></form>
 </div>
 <div class=card><h2>🎨 Theme</h2><form method=post action=/theme>${csrfField(u)}<select name=theme><option value=green>JR PHEEF Green</option><option value=blue>Ocean Blue</option><option value=purple>Royal Purple</option><option value=gold>Gold</option><option value=black>Black</option></select><button>Save theme</button></form></div>
 <div class=card><form method=post action=/logout>${csrfField(u)}<button>Sign out</button></form></div></main>`,u.theme)
}

app.get("/",async(req,res)=>{let u=await me(req);res.send(u?home(u):page("JR PHEEF",`<header><h1>JR PHEEF</h1><p>Find. Match. Connect. Trade.</p></header><main><div class=card><h2>Welcome 👋</h2><p>Discover people, businesses, products, services and opportunities.</p><a class=btn href=/register>Create account</a><a class=btn href=/login>Sign in</a></div></main>`))});

app.get("/register",(req,res)=>res.send(page("Register",`<header><h1>Create JR PHEEF Account</h1></header><main><div class=card><form method=post><input name=name placeholder="Full name" required><input name=phone placeholder="Phone number" required><input name=year type=number placeholder="Birth year"><input name=password type=password placeholder="Create password" required><button>Create account</button></form></div></main>`)));

app.post("/register",async(req,res)=>{
 try{
  let p=phone(req.body.phone),old=await byPhone(p);
  if(old)return res.redirect("/login?exists=1");
  let {data,error}=await db.from("members").insert({dgbo_id:await dgbo(),full_name:clean(req.body.name),phone:p,birth_year:req.body.year||null,password_hash:hash(req.body.password),status:"active",role:"person"}).select().single();
  if(error)throw error;
  await startSession(res,data);res.redirect("/");
 }catch(e){console.error(e);res.status(500).send("Registration failed: "+esc(e.message))}
});

app.get("/login",(req,res)=>res.send(page("Sign in",`<header><h1>JR PHEEF</h1></header><main><div class=card>${req.query.exists?"<p>Account already exists. Sign in below.</p>":""}${req.query.locked?"<p>Too many attempts. Please wait 15 minutes and try again.</p>":""}<form method=post><input name=phone placeholder="Phone number" required><input name=password type=password placeholder="Password" required><button>Continue</button></form><p>No account? <a href=/register>Register</a></p></div></main>`)));

app.post("/login",async(req,res)=>{
 let p=phone(req.body.phone);
 if(loginLocked(p))return res.redirect("/login?locked=1");
 let u=await byPhone(req.body.phone);
 if(!u||!u.password_hash||!passwordMatches(hash(req.body.password),u.password_hash)){
  loginFail(p);
  return res.status(401).send(page("Login failed",`<main><div class=card><h2>Incorrect phone or password.</h2><a class=btn href=/login>Try again</a><a class=btn href=/register>Create account</a></div></main>`));
 }
 loginOk(p);
 await save("members",{last_login:new Date().toISOString()},u.id);await startSession(res,u);res.redirect("/");
});

app.post("/logout",async(req,res)=>{let u=await me(req);if(u&&!csrfOk(req,u))return res.status(403).send("Denied");await endSession(req,res);res.redirect("/")});
app.get("/logout",async(req,res)=>{await endSession(req,res);res.redirect("/")}); // fallback for old links

app.get("/profile",async(req,res)=>{
 let u=await me(req);if(!u)return res.redirect("/login");
 res.send(page("Profile",`<header><h1>👤 Edit Profile</h1></header><main><div class=card><form method=post enctype=multipart/form-data>${csrfField(u)}${u.profile_photo?`<img class=avatar src="${esc(u.profile_photo)}"><br>`:""}<input type=file name=photo accept=image/*><input name=name value="${esc(u.full_name)}" placeholder="Name"><textarea name=bio placeholder="Bio">${esc(u.bio||"")}</textarea><input name=location value="${esc(u.location||"")}" placeholder="City / location"><input name=country value="${esc(u.country||"Kenya")}" placeholder="Country"><label><input type=checkbox name=public_profile ${u.public_profile!==false?"checked":""}> Public profile</label><label><input type=checkbox name=public_phone ${u.public_phone?"checked":""}> Public phone</label><button>Save profile</button></form></div></main>`,u.theme))
});

app.post("/profile",upload.single("photo"),async(req,res)=>{
 let u=await me(req);if(!u)return res.redirect("/login");
 if(!requireCsrf(req,res,u))return;
 let d={full_name:clean(req.body.name),bio:clean(req.body.bio),location:clean(req.body.location),country:clean(req.body.country),public_profile:!!req.body.public_profile,public_phone:!!req.body.public_phone};
 if(req.file){
  let ext=(req.file.originalname.split(".").pop()||"jpg").replace(/\W/g,""),path=`${u.id}/${Date.now()}.${ext}`;
  let x=await db.storage.from("profiles").upload(path,req.file.buffer,{contentType:req.file.mimetype,upsert:true});
  if(x.error)console.error(x.error);else d.profile_photo=db.storage.from("profiles").getPublicUrl(path).data.publicUrl;
 }
 await save("members",d,u.id);res.redirect("/");
});

app.post("/theme",async(req,res)=>{
 let u=await me(req);if(!u)return res.redirect("/login");
 if(!requireCsrf(req,res,u))return;
 if(["green","blue","purple","gold","black"].includes(req.body.theme))await save("members",{theme:req.body.theme},u.id);
 res.redirect("/")
});

app.post("/upgrade",async(req,res)=>{
 let u=await me(req);if(!u)return res.redirect("/login");
 if(!requireCsrf(req,res,u))return;
 if(["pro","prime"].includes(req.body.plan))await save("members",{plan:req.body.plan},u.id);
 res.redirect("/")
});

app.get("/listing",async(req,res)=>{let u=await me(req);if(!u)return res.redirect("/login");res.send(page("Listing",`<header><h1>🏪 Free Listing</h1></header><main><div class=card><form method=post enctype=multipart/form-data>${csrfField(u)}<input name=title placeholder="What are you selling/offering?" required><textarea name=description placeholder="Description"></textarea><input name=price type=number placeholder="Price"><input name=location placeholder="Location"><select name=category><option>Product</option><option>Service</option><option>Business</option><option>Job</option><option>Property</option><option>Investment</option><option>Other</option></select><input type=file name=photos accept=image/* multiple><button>Publish FREE</button></form></div></main>`,u.theme))});

app.post("/listing",upload.array("photos",5),async(req,res)=>{
 let u=await me(req);if(!u)return res.redirect("/login");
 if(!requireCsrf(req,res,u))return;
 let photos=[];
 for(let f of(req.files||[])){let ext=(f.originalname.split(".").pop()||"jpg").replace(/\W/g,""),p=`${u.id}/${Date.now()}-${crypto.randomBytes(3).toString("hex")}.${ext}`,x=await db.storage.from("listing-photos").upload(p,f.buffer,{contentType:f.mimetype,upsert:true});if(!x.error)photos.push(db.storage.from("listing-photos").getPublicUrl(p).data.publicUrl)}
 await db.from("jr_listings").insert({member_id:u.id,title:clean(req.body.title),description:clean(req.body.description),price:Number(req.body.price)||0,location:clean(req.body.location),category:req.body.category||"Product",photos,status:"active"});
 res.redirect("/");
});

app.get("/find",async(req,res)=>{
 let u=await me(req);if(!u)return res.redirect("/login");
 let q=clean(req.query.q),{data}=await db.from("jr_listings").select("*").eq("status","active").ilike("title",`%${q}%`).limit(30);
 res.send(page("Find",`<header><h1>🔎 Find</h1></header><main><div class=card><form><input name=q value="${esc(q)}" placeholder="What are you looking for?"><button>Search</button></form></div>${(data||[]).map(x=>`<div class=card><h3>${esc(x.title)}</h3><p>${esc(x.description)}</p><b>KSh ${Number(x.price||0).toLocaleString()}</b><p>📍 ${esc(x.location)}</p><a class=btn href="/trade/${x.id}">Connect</a></div>`).join("")||"<div class=card>No listings found yet.</div>"}</main>`,u.theme))
});

app.get("/matches",async(req,res)=>{
 let u=await me(req);if(!u)return res.redirect("/login");
 let {data}=await db.from("members").select("*").eq("status","active").eq("public_profile",true).neq("id",u.id).limit(100);
 data=(data||[]).sort(()=>Math.random()-.5).slice(0,10);
 res.send(page("Matches",`<header><h1>🤝 Matches</h1><p>JR PHEEF keeps giving different people opportunities.</p></header><main>${data.map(p=>`<div class=card><b>${esc(p.full_name)}</b><p>${esc(p.bio||"Open to connections")}</p><p>📍 ${esc(p.location||"Location private")}</p><a class=btn href="/connect/${p.id}">Connect FREE</a></div>`).join("")||"<div class=card>No matches yet.</div>"}</main>`,u.theme))
});

app.get("/connect/:id",async(req,res)=>{
 let u=await me(req),p=await one("members",req.params.id);if(!u||!p||u.id===p.id)return res.redirect("/matches");
 await db.from("connections").insert({member_a:u.id,member_b:p.id,type:"normal"});
 res.redirect(`/chat/${p.id}`);
});

app.get("/connections",async(req,res)=>{let u=await me(req);if(!u)return res.redirect("/login");let {data}=await db.from("connections").select("*").or(`member_a.eq.${u.id},member_b.eq.${u.id}`).limit(30);res.send(page("Connections",`<header><h1>💬 Connections</h1></header><main>${(data||[]).map(x=>{let id=x.member_a===u.id?x.member_b:x.member_a;return`<div class=card><a class=btn href=/chat/${id}>Open conversation</a></div>`}).join("")||"<div class=card>No connections yet.</div>"}</main>`,u.theme))});

app.get("/chat/:id",async(req,res)=>{
 let u=await me(req),p=await one("members",req.params.id);if(!u||!p)return res.redirect("/login");
 let {data}=await db.from("messages").select("*").or(`and(sender_id.eq.${u.id},receiver_id.eq.${p.id}),and(sender_id.eq.${p.id},receiver_id.eq.${u.id})`).order("created_at");
 res.send(page("Chat",`<header><h1>💬 ${esc(p.full_name)}</h1><p>JR PHEEF protects contact details.</p></header><main><div class=card>${(data||[]).map(m=>`<p><b>${m.sender_id===u.id?"You":esc(p.full_name)}:</b> ${esc(m.body)}</p>`).join("")||"Start chatting."}</div><div class=card><form method=post action="/chat/${p.id}">${csrfField(u)}<textarea name=body placeholder="Write naturally..." required></textarea><button>Send</button></form></div></main>`,u.theme))
});

app.post("/chat/:id",async(req,res)=>{
 let u=await me(req);if(!u)return res.redirect("/login");
 if(!requireCsrf(req,res,u))return;
 let b=clean(req.body.body);
 if(blocked.test(b))return res.status(400).send(page("Protected",`<main><div class=card><h2>🛡️ JR PHEEF protected this conversation.</h2><p>Please keep contact details, links and outside-payment information inside JR PHEEF.</p><a class=btn href=/chat/${req.params.id}>Back to chat</a></div></main>`));
 await db.from("messages").insert({sender_id:u.id,receiver_id:req.params.id,body:b});res.redirect(`/chat/${req.params.id}`);
});

app.get("/trade/:id",async(req,res)=>{
 let u=await me(req),l=await one("jr_listings",req.params.id);if(!u||!l||l.member_id===u.id)return res.redirect("/find");
 let seller=await one("members",l.member_id),f=fee(u.paid_matches);
 res.send(page("Trade Match",`<header><h1>🤝 JR PHEEF Match</h1></header><main><div class=card><h2>${esc(l.title)}</h2><p>${esc(l.description)}</p><p>💰 KSh ${Number(l.price||0).toLocaleString()}</p><p>📍 ${esc(l.location)}</p><p>👤 ${esc(seller?.full_name||"Seller")}</p><h3>Your connection fee: KSh ${f}</h3><form method=post action=/trade/${l.id}/pay>${csrfField(u)}<button>Pay KSh ${f} & Open Deal Room</button></form></div></main>`,u.theme))
});

app.post("/trade/:id/pay",async(req,res)=>{
 let u=await me(req),l=await one("jr_listings",req.params.id);if(!u||!l||l.member_id===u.id)return res.redirect("/find");
 if(!requireCsrf(req,res,u))return;
 let seller=await one("members",l.member_id),f=fee(u.paid_matches);
 let {data:r}=await db.from("deal_rooms").insert({member_a:u.id,member_b:seller.id,listing_id:l.id,amount:l.price,match_fee:f,status:"open",member_a_paid:true,member_b_paid:false}).select().single();
 if(!r)return res.status(500).send("Could not create Deal Room.");
 await save("members",{paid_matches:(u.paid_matches||0)+1},u.id);
 res.redirect(`/deal/${r.id}`);
});

app.get("/deal/:id",async(req,res)=>{
 let u=await me(req);if(!u)return res.redirect("/login");
 let r=await one("deal_rooms",req.params.id);if(!r||![r.member_a,r.member_b].includes(u.id))return res.status(403).send("Denied");
 let other=await one("members",r.member_a===u.id?r.member_b:r.member_a);
 let {data:m}=await db.from("messages").select("*").or(`and(sender_id.eq.${u.id},receiver_id.eq.${other.id}),and(sender_id.eq.${other.id},receiver_id.eq.${u.id})`).order("created_at");
 res.send(page("Deal Room",`<header><h1>🤝 Deal Room</h1><p>Connected with ${esc(other.full_name)}</p></header><main><div class=card>${(m||[]).map(x=>`<p><b>${x.sender_id===u.id?"You":esc(other.full_name)}:</b> ${esc(x.body)}</p>`).join("")||"Deal Room ready."}</div><div class=card><form method=post action=/deal/${r.id}>${csrfField(u)}<textarea name=body placeholder="Talk normally..." required></textarea><button>Send</button></form></div></main>`,u.theme))
});

app.post("/deal/:id",async(req,res)=>{
 let u=await me(req),r=await one("deal_rooms",req.params.id);if(!u||!r||![r.member_a,r.member_b].includes(u.id))return res.status(403).send("Denied");
 if(!requireCsrf(req,res,u))return;
 let b=clean(req.body.body);if(blocked.test(b))return res.status(400).send("JR PHEEF blocked contact details or outside links.");
 let to=r.member_a===u.id?r.member_b:r.member_a;await db.from("messages").insert({sender_id:u.id,receiver_id:to,body:b});res.redirect(`/deal/${r.id}`);
});

app.get("/love",async(req,res)=>{let u=await me(req);if(!u)return res.redirect("/login");let {data}=await db.from("members").select("*").eq("status","active").eq("public_profile",true).neq("id",u.id).limit(30);res.send(page("Love & Friendship",`<header><h1>💞 Love & Friendship</h1></header><main>${(data||[]).sort(()=>Math.random()-.5).slice(0,10).map(p=>`<div class=card><b>${esc(p.full_name)}</b><p>${esc(p.bio||"Genuine connection")}</p><p>📍 ${esc(p.location||"")}</p><a class=btn href=/chat/${p.id}>Connect FREE</a></div>`).join("")}</main>`,u.theme))});

app.get("/delivery",async(req,res)=>{let u=await me(req);if(!u)return res.redirect("/login");res.send(page("Delivery",`<header><h1>🚚 Delivery</h1></header><main><div class=card><form method=post>${csrfField(u)}<input name=pickup placeholder="Pickup" required><input name=destination placeholder="Destination" required><input name=item placeholder="What needs moving?"><button>Find rider FREE</button></form></div><div class=card><h3>Become a rider</h3><form method=post action=/rider>${csrfField(u)}<input name=company placeholder="Company / Independent"><input name=vehicle placeholder="Vehicle"><input name=area placeholder="Operating area"><button>Register</button></form></div></main>`,u.theme))});

app.post("/delivery",async(req,res)=>{
 let u=await me(req);if(!u)return res.redirect("/login");
 if(!requireCsrf(req,res,u))return;
 let {data}=await db.from("riders").select("*").eq("status","approved").limit(20);res.send(page("Riders",`<header><h1>🚚 Riders</h1></header><main><div class=card><p>Your request is free. Approved riders can receive it.</p></div>${(data||[]).map(r=>`<div class=card>🚚 ${esc(r.company||"Independent rider")}<br>${esc(r.area||"")}</div>`).join("")}</main>`,u.theme))
});

app.post("/rider",async(req,res)=>{
 let u=await me(req);if(!u)return res.redirect("/login");
 if(!requireCsrf(req,res,u))return;
 await db.from("riders").insert({member_id:u.id,company:clean(req.body.company),vehicle:clean(req.body.vehicle),area:clean(req.body.area),status:"pending"});res.redirect("/delivery")
});

app.get("/organization",async(req,res)=>{let u=await me(req);if(!u)return res.redirect("/login");res.send(page("Organization",`<header><h1>🏢 Organization</h1></header><main><div class=card><form method=post>${csrfField(u)}<input name=name placeholder="Business / institution / organization" required><input name=registration_no placeholder="Registration number"><input name=phone placeholder="Organization phone"><input name=location placeholder="Location"><textarea name=description placeholder="What does it do?"></textarea><button>Register organization</button></form></div></main>`,u.theme))});

app.post("/organization",async(req,res)=>{
 let u=await me(req);if(!u)return res.redirect("/login");
 if(!requireCsrf(req,res,u))return;
 await db.from("organizations").insert({member_id:u.id,name:clean(req.body.name),registration_no:clean(req.body.registration_no),phone:clean(req.body.phone),location:clean(req.body.location),description:clean(req.body.description),status:"pending"});res.redirect("/")
});

app.get("/wallet",async(req,res)=>{let u=await me(req);if(!u)return res.redirect("/login");res.send(page("Wallet",`<header><h1>🎁 Wallet</h1></header><main><div class=card><h2>Rewards</h2><p>KSh ${u.rewards||0}</p><h2>Credits</h2><p>KSh ${u.credits||0}</p><p>Next trade match: <b>KSh ${fee(u.paid_matches)}</b></p><p>Minimum withdrawal: KSh 200</p></div></main>`,u.theme))});

// ---------- JR PHEEF Promote ----------
// requires a `jr_promotions` table — see migrations.sql
// type: 'community' (user-submitted, needs approval) | 'official' | 'featured' (owner-added, auto-approved)
function promoCard(x){
 return `<div class=card>${x.image?`<img src="${esc(x.image)}"><br>`:""}<b>${esc(x.title)}</b><span class=tag>${esc(x.type)}</span><p>${esc(x.description||"")}</p>${x.link?`<p>🔗 ${esc(x.link)}</p>`:""}</div>`
}
app.get("/promote",async(req,res)=>{
 let u=await me(req);if(!u)return res.redirect("/login");
 let {data}=await db.from("jr_promotions").select("*").eq("status","approved").order("created_at",{ascending:false}).limit(60);
 let byType=t=>(data||[]).filter(x=>x.type===t);
 res.send(page("JR PHEEF Promote",`<header><h1>📣 JR PHEEF Promote</h1><p>Community picks, official & featured brands.</p></header><main>
 <div class=card><h2>Submit a community recommendation</h2><form method=post action=/promote/recommend>${csrfField(u)}<input name=title placeholder="What are you recommending?" required><textarea name=description placeholder="Why do you recommend it?"></textarea><button>Submit for review</button></form></div>
 <h2 style="padding:0 8px">⭐ Featured</h2>${byType("featured").map(promoCard).join("")||"<div class=card>Nothing featured yet.</div>"}
 <h2 style="padding:0 8px">✅ Official brands</h2>${byType("official").map(promoCard).join("")||"<div class=card>No official brands listed yet.</div>"}
 <h2 style="padding:0 8px">🗣️ Community recommendations</h2>${byType("community").map(promoCard).join("")||"<div class=card>No community picks yet — be the first!</div>"}
 </main>`,u.theme))
});

app.post("/promote/recommend",async(req,res)=>{
 let u=await me(req);if(!u)return res.redirect("/login");
 if(!requireCsrf(req,res,u))return;
 let title=clean(req.body.title);if(!title)return res.redirect("/promote");
 await db.from("jr_promotions").insert({type:"community",title,description:clean(req.body.description),submitted_by:u.id,status:"pending"});
 res.redirect("/promote");
});

app.get("/owner",async(req,res)=>{
 if(!process.env.OWNER_KEY||req.query.key!==process.env.OWNER_KEY)return res.status(403).send("🔒 Owner access denied.");
 let [m,l,r,o,promoPending,promoLive]=await Promise.all([
  "members","jr_listings","riders","organizations"
 ].map(x=>db.from(x).select("*").order("created_at",{ascending:false}).limit(100)).concat([
  db.from("jr_promotions").select("*").eq("status","pending").order("created_at",{ascending:false}).limit(50),
  db.from("jr_promotions").select("*").in("type",["official","featured"]).order("created_at",{ascending:false}).limit(50)
 ]));
 res.send(page("Owner",`<header><h1>👑 JR PHEEF</h1><p>COMMAND CENTER</p></header><main>
 <div class=grid><div class=card>👥 Members<br><b>${m.data?.length||0}</b></div><div class=card>🏪 Listings<br><b>${l.data?.length||0}</b></div><div class=card>🚚 Riders<br><b>${r.data?.length||0}</b></div><div class=card>🏢 Organizations<br><b>${o.data?.length||0}</b></div></div>
 <div class=card><h2>Members</h2>${(m.data||[]).map(x=>`<p><b>${esc(x.full_name)}</b> — ${esc(x.dgbo_id)} — ${esc(x.phone)} — ${esc(x.plan||"free")} — ${esc(x.status)}</p>`).join("")}</div>
 <div class=card><h2>Pending Riders</h2>${(r.data||[]).filter(x=>x.status==="pending").map(x=>`<p>${esc(x.company)} — ${esc(x.area)} <form method=post action=/owner/rider style="display:inline"><input type=hidden name=key value="${esc(req.query.key)}"><input type=hidden name=id value=${x.id}><button name=status value=approved>Approve</button><button name=status value=rejected>Reject</button></form></p>`).join("")||"None"}</div>
 <div class=card><h2>Organizations</h2>${(o.data||[]).map(x=>`<p>${esc(x.name)} — ${esc(x.status)}</p>`).join("")}</div>
 <div class=card><h2>📣 Pending community recommendations</h2>${(promoPending.data||[]).map(x=>`<p><b>${esc(x.title)}</b> — ${esc(x.description||"")} <form method=post action=/owner/promotion style="display:inline"><input type=hidden name=key value="${esc(req.query.key)}"><input type=hidden name=id value=${x.id}><button name=status value=approved>Approve</button><button name=status value=rejected>Reject</button></form></p>`).join("")||"None"}</div>
 <div class=card><h2>Add official / featured</h2><form method=post action=/owner/promotion/add><input type=hidden name=key value="${esc(req.query.key)}"><input name=title placeholder="Title" required><textarea name=description placeholder="Description"></textarea><input name=link placeholder="Link (shown as text, not clickable)"><input name=image placeholder="Image URL"><select name=type><option value=official>Official brand</option><option value=featured>Featured</option></select><button>Publish</button></form></div>
 <div class=card><h2>Live official / featured</h2>${(promoLive.data||[]).map(x=>`<p>${esc(x.title)} — ${esc(x.type)}</p>`).join("")||"None yet"}</div>
 </main>`))
});

// Owner-panel POSTs are protected by the OWNER_KEY (passed as a hidden field,
// since the panel itself is only reachable with the key) rather than the
// member CSRF token — the owner isn't necessarily a logged-in member.
function ownerOk(req){return !!process.env.OWNER_KEY && req.body.key===process.env.OWNER_KEY}

app.post("/owner/rider",async(req,res)=>{if(!ownerOk(req))return res.status(403).send("Denied");await save("riders",{status:req.body.status},req.body.id);res.redirect(`/owner?key=${encodeURIComponent(req.body.key)}`)});

app.post("/owner/promotion",async(req,res)=>{if(!ownerOk(req))return res.status(403).send("Denied");await save("jr_promotions",{status:req.body.status},req.body.id);res.redirect(`/owner?key=${encodeURIComponent(req.body.key)}`)});

app.post("/owner/promotion/add",async(req,res)=>{
 if(!ownerOk(req))return res.status(403).send("Denied");
 let type=["official","featured"].includes(req.body.type)?req.body.type:"official";
 await db.from("jr_promotions").insert({type,title:clean(req.body.title),description:clean(req.body.description),link:clean(req.body.link),image:clean(req.body.image),status:"approved"});
 res.redirect(`/owner?key=${encodeURIComponent(req.body.key)}`)
});

app.post("/api/webhook/whatsapp",async(req,res)=>{
 let p=phone(req.body.From),text=clean(req.body.Body),u=await byPhone(p);
 const xml=x=>esc(x).replace(/&#39;/g,"&apos;"),reply=x=>res.type("text/xml").send(`<Response><Message>${xml(x)}</Message></Response>`);
 if(!u)return reply(`👋 Karibu JR PHEEF!\n\nCreate your account here:\n${BASE}/register`);
 if(!text)return reply(`👋 ${u.full_name}, niko hapa. Tell me naturally what you're looking for, selling, or discussing.\n\n${BASE}/home`);
 if(blocked.test(text))return reply("🛡️ JR PHEEF protected your conversation. Contact details, links and outside contact information stay private.");
 let search=text.match(/(?:looking for|find|need|natafuta|natafut)\s+(.+)/i)?.[1];
 if(search){
  let {data}=await db.from("jr_listings").select("*").eq("status","active").ilike("title",`%${search}%`).neq("member_id",u.id).limit(5);
  if(!data?.length)return reply("😔 I haven't found the right match yet. I'll keep looking.");
  let l=data[0],seller=await one("members",l.member_id),f=fee(u.paid_matches);
  return reply(`🎉 JR PHEEF found a match!\n\n${l.title}\n💰 KSh ${Number(l.price||0).toLocaleString()}\n📍 ${l.location}\n\n🔐 Secure Deal Room available.\n\nYour connection fee: KSh ${f}\n\n${BASE}/trade/${l.id}`);
 }
 let {data:rooms}=await db.from("deal_rooms").select("*").or(`member_a.eq.${u.id},member_b.eq.${u.id}`).eq("status","open").order("created_at",{ascending:false}).limit(1);
 if(rooms?.length){
  let r=rooms[0],to=r.member_a===u.id?r.member_b:r.member_a;
  if(!blocked.test(text))await db.from("messages").insert({sender_id:u.id,receiver_id:to,body:text});
  return reply("☑️ Message kept inside your JR PHEEF connection.");
 }
 reply(`👋 ${u.full_name}, tell me naturally what you need.\n\nExamples:\n"Natafuta Toyota Nairobi."\n"I need a delivery."\n"I want to sell my phone."\n\n${BASE}/home`);
});

app.get("/health",(req,res)=>res.json({ok:true,service:"JR PHEEF",database:"connected",listings:"jr_listings",matchFee:"30→5",freeListings:true,naturalChat:true,sessions:"db-backed",csrf:"enabled"}));

app.listen(PORT,()=>console.log(`🚀 JR PHEEF running on ${PORT} | DB CONNECTED | MATCH FEE 30→5 | LISTINGS jr_listings | SESSIONS db-backed`));
