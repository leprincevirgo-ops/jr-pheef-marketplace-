r.area||"")}</div>`).join("")}</main>`,u.theme))
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
const express=require("express"),crypto=require("crypto"),{createClient}=require("@supabase/supabase-js"),twilio=require("twilio"),multer=require("multer");

const app=express(),PORT=process.env.PORT||10000;
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY);
const wa=process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN?twilio(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN):null;
const FROM=process.env.TWILIO_WHATSAPP_NUMBER;
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024}});
app.use(express.urlencoded({extended:true}));app.use(express.json());

const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const phone=x=>String(x||"").replace(/^whatsapp:/i,"").trim();
const hash=p=>crypto.scryptSync(p,process.env.PASSWORD_SALT||"jr-pheef-salt",32).toString("hex");
const money=x=>Number(x||0).toLocaleString("en-KE");
const blocked=/(\+?\d[\d\s().-]{7,}|\b\d{9,13}\b|https?:\/\/|www\.|[\w.-]+@[\w.-]+\.\w+|whatsapp|telegram|t\.me|bit\.ly)/i;
const themes={green:"#08783c",blue:"#2563eb",purple:"#7c3aed",gold:"#b8860b",black:"#111827"};

const get=async(id)=>db.from("members").select("*").eq("id",id).maybeSingle();
const byPhone=async(p)=>db.from("members").select("*").eq("phone",phone(p)).maybeSingle();
const update=(t,id,d)=>db.from(t).update(d).eq("id",id);
const freeHours=()=>{let h=new Date(new Date().toLocaleString("en-US",{timeZone:"Africa/Nairobi"})).getHours();return h>=2&&h<6};

async function active(u){
 if(freeHours())return true;
 return u?.active_until&&new Date(u.active_until)>new Date();
}
async function need(u){
 if(await active(u))return true;
 return false;
}
async function dgbo(){
 const {count}=await db.from("members").select("*",{count:"exact",head:true});
 return `DGBO-${String((count||0)+1).padStart(6,"0")}`;
}
function page(title,body,theme="green"){
 return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
 <title>${esc(title)}</title><style>
 :root{--c:${themes[theme]||themes.green};--bg:#f3f7f5}*{box-sizing:border-box}
 body{margin:0;background:var(--bg);font-family:Arial;color:#111}
 header{background:var(--c);color:white;padding:22px}main{max-width:900px;margin:auto;padding:14px}
 .card{background:white;border-radius:18px;padding:18px;margin:12px 0;box-shadow:0 2px 10px #0001}
 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}
 input,textarea,select{width:100%;padding:12px;margin:5px 0;border:1px solid #ccc;border-radius:10px}
 button,.btn{background:var(--c);color:white;border:0;border-radius:10px;padding:11px 15px;text-decoration:none;display:inline-block;margin:4px;cursor:pointer}
 img{max-width:150px}.avatar{width:110px;height:110px;border-radius:50%;object-fit:cover;border:3px solid var(--c)}
 .muted{opacity:.65;font-size:13px}
 </style></head><body>${body}</body></html>`;
}

/* HOME */

app.get("/",(q,r)=>r.send(page("JR PHEEF",`
<header><h1>JR PHEEF</h1><p>Find. Match. Connect. Trade.</p></header>
<main><div class="card"><h2>Welcome 👋</h2>
<p>People. Opportunities. Businesses. Services. Friendship. Love. Marketplace.</p>
<a class="btn" href="/register">Create account</a><a class="btn" href="/login">Sign in</a></div></main>`)));

/* AUTH */

app.get("/register",(q,r)=>r.send(page("Register",`
<header><h1>Create JR PHEEF Account</h1></header><main><div class="card">
<form method="post">
<input name="name" placeholder="Full name" required>
<input name="phone" placeholder="Phone number" required>
<input name="password" id="p" type="password" placeholder="Password" required>
<label><input type="checkbox" onclick="p.type=this.checked?'text':'password'"> 👁 Show password</label>
<button>Create account</button></form></div></main>`)));

app.post("/register",async(q,r)=>{
 try{
  let name=String(q.body.name||"").trim(),p=phone(q.body.phone),pw=String(q.body.password||"");
  if(!name||!p||!pw)return r.status(400).send("Complete all fields.");
  if((await byPhone(p)).data)return r.redirect("/login?exists=1");
  let id=(await dgbo());
  let {data,error}=await db.from("members").insert({
   dgbo_id:id,full_name:name,phone:p,reputation:0,verified:false,status:"active",
   password_hash:hash(pw),bio:"",location:"",country:"Kenya",profile_photo:"",
   public_profile:true,public_phone:false,theme:"green",role:"person",
   plan:"free",rewards:0,credits:0,active_until:null
  }).select().single();
  if(error)throw error;
  r.redirect("/home?id="+data.id);
 }catch(e){console.error(e);r.status(500).send("Registration error: "+esc(e.message))}
});

app.get("/login",(q,r)=>r.send(page("Login",`
<header><h1>JR PHEEF</h1></header><main><div class="card">
${q.query.exists?"<p>Account already exists. Please sign in.</p>":""}
<form method="post">
<input name="phone" placeholder="Phone number" required>
<input name="password" id="p" type="password" placeholder="Password" required>
<label><input type="checkbox" onclick="p.type=this.checked?'text':'password'"> 👁 Show password</label>
<button>Continue</button></form></div></main>`)));

app.post("/login",async(q,r)=>{
 let {data:u}=await byPhone(q.body.phone);
 if(!u||u.password_hash!==hash(q.body.password))return r.status(401).send("Incorrect phone or password.");
 r.redirect("/home?id="+u.id);
});

/* HOME */

app.get("/home",async(q,r)=>{
 let {data:u}=await get(q.query.id);if(!u)return r.redirect("/login");
 let ok=await need(u),free=freeHours(),t=u.theme||"green";
 r.send(page("JR PHEEF",`
<header><h1>JR PHEEF</h1><p>Welcome, ${esc(u.full_name)} 👋</p><b>${esc(u.dgbo_id)}</b></header>
<main>
<div class="card"><h2>👤 Profile</h2>
${u.profile_photo?`<img class="avatar" src="${esc(u.profile_photo)}">`:"👤"}
<p><b>${esc(u.full_name)}</b></p><p>${esc(u.bio||"Add your bio.")}</p>
<a class="btn" href="/profile?id=${u.id}">Edit profile</a></div>

<div class="card"><h2>⚡ JR PHEEF Access</h2>
${free?"🌙 FREE NIGHT ACCESS — 2:00 AM–6:00 AM":ok?`✅ ACTIVE until ${new Date(u.active_until).toLocaleString("en-KE")}`:"🔒 Activate for KSh 30 / 5 hours"}
${!ok&&!free?`<form method="post" action="/activate"><input type="hidden" name="id" value="${u.id}"><button>Activate KSh 30 / 5 Hours</button></form>`:""}
</div>

<div class="grid">
${[
["🔎 Find","/find","People, goods, services & opportunities"],
["🏪 Listings","/listing","List free"],
["🤝 Matches","/matches","Rotating local & global matches"],
["💬 Connections","/connections","Normal conversations"],
["💞 Love & Friendship","/love","Genuine connections"],
["🤝 Deal Rooms","/deals","Protected business rooms"],
["🚚 Delivery","/delivery","Approved riders"],
["🏢 Organizations","/organization","Business & institution tools"],
["📣 Brands","/brands","Brand promotion"],
["🎁 Wallet","/wallet","Rewards & credits"],
["👑 Owner","/owner","Command Center"]
].map(x=>`<div class="card"><h2>${x[0]}</h2><p>${x[2]}</p><a class="btn" href="${x[1]}?id=${u.id}">Open</a></div>`).join("")}
</div>

<div class="card"><h2>🎨 Theme / Wallpaper</h2>
<form method="post" action="/theme"><input type="hidden" name="id" value="${u.id}">
<select name="theme">${Object.keys(themes).map(x=>`<option ${t==x?"selected":""}>${x}</option>`).join("")}</select>
<button>Save</button></form></div>
</main>`,t));
});

/* ACTIVATION */

app.post("/activate",async(q,r)=>{
 let {data:u}=await get(q.body.id);if(!u)return r.redirect("/login");
 if(freeHours())return r.redirect("/home?id="+u.id);
 let until=new Date(Date.now()+5*60*60*1000).toISOString();
 await update("members",u.id,{active_until:until,last_activation:new Date().toISOString()});
 await db.from("payments").insert({member_id:u.id,amount:30,type:"activation",status:"test"});
 r.redirect("/home?id="+u.id);
});

/* PROFILE */

app.get("/profile",async(q,r)=>{
 let {data:u}=await get(q.query.id);if(!u)return r.redirect("/");
 r.send(page("Profile",`<header><h1>👤 Profile</h1></header><main><div class="card">
<form method="post" enctype="multipart/form-data">
<input type="hidden" name="id" value="${u.id}">
${u.profile_photo?`<img class="avatar" src="${esc(u.profile_photo)}"><br>`:""}
<input type="file" name="photo" accept="image/*">
<input name="name" value="${esc(u.full_name)}" placeholder="Name">
<textarea name="bio" placeholder="Bio">${esc(u.bio)}</textarea>
<input name="location" value="${esc(u.location)}" placeholder="Location">
<input name="country" value="${esc(u.country||"Kenya")}" placeholder="Country">
<label><input type="checkbox" name="public_profile" ${u.public_profile!==false?"checked":""}> Public profile</label>
<label><input type="checkbox" name="public_phone" ${u.public_phone?"checked":""}> Public phone</label>
<button>Save</button></form></div></main>`));
});

app.post("/profile",upload.single("photo"),async(q,r)=>{
 let {data:u}=await get(q.body.id);if(!u)return r.redirect("/");
 let d={full_name:String(q.body.name||"").trim(),bio:String(q.body.bio||"").trim(),location:String(q.body.location||"").trim(),country:String(q.body.country||"Kenya").trim(),public_profile:!!q.body.public_profile,public_phone:!!q.body.public_phone};
 if(q.file){
  let path=`${u.id}/${Date.now()}.jpg`,x=await db.storage.from("profiles").upload(path,q.file.buffer,{contentType:q.file.mimetype,upsert:true});
  if(!x.error)d.profile_photo=db.storage.from("profiles").getPublicUrl(path).data.publicUrl;
 }
 await update("members",u.id,d);r.redirect("/home?id="+u.id);
});

app.post("/theme",async(q,r)=>{await update("members",q.body.id,{theme:q.body.theme});r.redirect("/home?id="+q.body.id)});

/* LISTINGS */

app.get("/listing",async(q,r)=>{
 let {data:u}=await get(q.query.id);if(!u)return r.redirect("/");
 r.send(page("Listing",`<header><h1>🏪 Free Listing</h1></header><main><div class="card">
<form method="post"><input type="hidden" name="member_id" value="${u.id}">
<input name="item_name" placeholder="What are you offering?" required>
<textarea name="description" placeholder="Description"></textarea>
<input name="price" type="number" placeholder="Price">
<input name="location" placeholder="Location">
<select name="category"><option>Product</option><option>Service</option><option>Business</option><option>Job</option><option>Property</option><option>Investment</option><option>Event</option></select>
<button>Publish Free</button></form></div></main>`));
});

app.post("/listing",async(q,r)=>{
 let {data:u}=await get(q.body.member_id);if(!u)return r.redirect("/");
 if(!(await need(u)))return r.redirect("/home?id="+u.id);
 let {error}=await db.from("jr_listings").insert({
  member_id:u.id,seller_name:u.full_name,phone:u.phone,item_name:q.body.item_name,
  description:q.body.description||"",price:q.body.price||null,location:q.body.location||"",
  category:q.body.category,status:"ACTIVE",photos:[]
 });
 if(error)return r.status(400).send(error.message);
 r.redirect("/home?id="+u.id);
});

/* FIND */

app.get("/find",async(q,r)=>{
 let {data:u}=await get(q.query.id);if(!u)return r.redirect("/");
 if(!(await need(u)))return r.redirect("/home?id="+u.id);
 let term=String(q.query.q||"").trim();
 let query=db.from("jr_listings").select("*").eq("status","ACTIVE").limit(40);
 if(term)query=query.or(`item_name.ilike.%${term}%,description.ilike.%${term}%,location.ilike.%${term}%`);
 let {data}=await query;
 r.send(page("Find",`<header><h1>🔎 Find</h1></header><main>
<div class="card"><form><input type="hidden" name="id" value="${u.id}"><input name="q" placeholder="Search anything"><button>Search</button></form></div>
${(data||[]).map(x=>`<div class="card"><h3>${esc(x.item_name)}</h3><p>${esc(x.description||"")}</p><b>KSh ${money(x.price)}</b><p>📍 ${esc(x.location||"")}</p><a class="btn" href="/connect?id=${u.id}&listing=${x.id}">Connect</a></div>`).join("")||"<div class=card>No results yet.</div>"}
</main>`));
});

/* MATCHES */

app.get("/matches",async(q,r)=>{
 let {data:u}=await get(q.query.id);if(!u)return r.redirect("/");
 let {data:p}=await db.from("members").select("*").eq("status","active").eq("public_profile",true).neq("id",u.id).limit(80);
 p=(p||[]).sort(()=>Math.random()-.5).slice(0,10);
 r.send(page("Matches",`<header><h1>🤝 Matches</h1><p>JR PHEEF rotates opportunities so different people can be discovered.</p></header><main>
${p.map(x=>`<div class="card"><b>${esc(x.full_name)}</b><p>${esc(x.bio||"Open to connections")}</p><p>📍 ${esc(x.location||"Around you / international")}</p><a class="btn" href="/chat?id=${u.id}&to=${x.id}">Connect</a></div>`).join("")}
</main>`));
});

/* CONNECT TO LISTING */

app.get("/connect",async(q,r)=>{
 let {data:u}=await get(q.query.id);if(!u)return r.redirect("/");
 if(!(await need(u)))return r.redirect("/home?id="+u.id);
 let {data:l}=await db.from("jr_listings").select("*").eq("id",q.query.listing).single();
 if(!l||l.member_id===u.id)return r.redirect("/find?id="+u.id);
 let {data:old}=await db.from("deal_rooms").select("*").eq("listing_id",l.id).eq("buyer_id",u.id).limit(1);
 let room=old?.[0];
 if(!room){
  let x=await db.from("deal_rooms").insert({listing_id:l.id,buyer_id:u.id,seller_id:l.member_id,buyer_phone:u.phone,seller_phone:l.phone,status:"negotiating",buyer_paid:false,seller_paid:false}).select().single();
  room=x.data;
 }
 r.send(page("Match",`<header><h1>🎉 Match Found</h1></header><main><div class="card">
<h2>${esc(l.item_name)}</h2><p>${esc(l.description||"")}</p><p>KSh ${money(l.price)}</p><p>📍 ${esc(l.location||"")}</p>
<p>🔐 Secure Deal Room created.</p><a class="btn" href="/chat?id=${u.id}&room=${room?.id}">CHAT</a></div></main>`));
});

/* CHAT */

app.get("/chat",async(q,r)=>{
 let {data:u}=await get(q.query.id);if(!u)return r.redirect("/");
 let to=q.query.to,room=q.query.room;
 if(room){
  let {data:rr}=await db.from("deal_rooms").select("*").eq("id",room).single();
  if(!rr||([rr.buyer_id,rr.seller_id].indexOf(u.id)<0))return r.redirect("/home?id="+u.id);
  to=rr.buyer_id===u.id?rr.seller_id:rr.buyer_id;
 }
 let {data:p}=await get(to);if(!p)return r.redirect("/home?id="+u.id);
 let {data:m}=await db.from("messages").select("*").or(`and(sender_id.eq.${u.id},receiver_id.eq.${p.id}),and(sender_id.eq.${p.id},receiver_id.eq.${u.id})`).order("created_at");
 r.send(page("Chat",`<header><h1>💬 ${esc(p.full_name)}</h1></header><main>
<div class="card">${(m||[]).map(x=>`<p><b>${x.sender_id===u.id?"You":esc(p.full_name)}:</b> ${esc(x.body||x.message)}</p>`).join("")||"Start the conversation."}</div>
<div class="card"><form method="post"><input type="hidden" name="from" value="${u.id}"><input type="hidden" name="to" value="${p.id}">
<textarea name="body" placeholder="Write naturally..." required></textarea><button>Send</button></form></div></main>`));
});

app.post("/chat",async(q,r)=>{
 let body=String(q.body.body||"").trim();
 if(blocked.test(body))return r.status(400).send("JR PHEEF protected this message because it appears to contain contact details, links or an attempt to move the connection outside JR PHEEF.");
 let {error}=await db.from("messages").insert({sender_id:q.body.from,receiver_id:q.body.to,body});
 if(error)return r.status(400).send(error.message);
 r.redirect(`/chat?id=${q.body.from}&to=${q.body.to}`);
});

/* FRIENDSHIP / LOVE */

app.get("/connections",(q,r)=>r.redirect(`/matches?id=${q.query.id}`));
app.get("/love",async(q,r)=>{
 let {data:u}=await get(q.query.id);if(!u)return r.redirect("/");
 let {data:p}=await db.from("members").select("*").eq("status","active").eq("public_profile",true).neq("id",u.id).limit(50);
 r.send(page("Love & Friendship",`<header><h1>💞 Love & Friendship</h1></header><main>
${(p||[]).sort(()=>Math.random()-.5).slice(0,12).map(x=>`<div class=card><b>${esc(x.full_name)}</b><p>${esc(x.bio||"Meaningful connections")}</p><p>📍 ${esc(x.location||"")}</p><a class=btn href="/chat?id=${u.id}&to=${x.id}">Connect</a></div>`).join("")}</main>`));
});

/* DEALS */

app.get("/deals",async(q,r)=>{
 let {data:u}=await get(q.query.id);if(!u)return r.redirect("/");
 let {data:d}=await db.from("deal_rooms").select("*").or(`buyer_id.eq.${u.id},seller_id.eq.${u.id}`).order("created_at",{ascending:false});
 r.send(page("Deal Rooms",`<header><h1>🤝 Deal Rooms</h1></header><main>
${(d||[]).map(x=>`<div class=card><b>Room ${esc(x.id)}</b><p>Status: ${esc(x.status)}</p><a class=btn href="/chat?id=${u.id}&room=${x.id}">CHAT</a></div>`).join("")||"<div class=card>No Deal Rooms yet.</div>"}</main>`));
});

/* DELIVERY */

app.get("/delivery",async(q,r)=>{
 let {data:u}=await get(q.query.id);if(!u)return r.redirect("/");
 let {data:riders}=await db.from("riders").select("*").eq("status","approved").limit(30);
 r.send(page("Delivery",`<header><h1>🚚 Delivery</h1></header><main>
<div class=card><form method=post><input type=hidden name=member_id value="${u.id}">
<input name=pickup placeholder="Pickup" required><input name=destination placeholder="Destination" required>
<input name=item placeholder="Item"><button>Find Rider</button></form></div>
<div class=card><h2>Register as rider</h2><form method=post action="/rider">
<input type=hidden name=member_id value="${u.id}"><input name=company placeholder="Company">
<input name=vehicle placeholder="Vehicle"><input name=area placeholder="Operating area">
<button>Apply</button></form></div>
${(riders||[]).map(x=>`<div class=card>🚚 ${esc(x.company||"Approved rider")} — ${esc(x.area||"")}</div>`).join("")}</main>`));
});

app.post("/delivery",async(q,r)=>{
 let {data}=await db.from("riders").select("*").eq("status","approved").limit(1);
 r.send(page("Delivery",`<header><h1>🚚 Rider Match</h1></header><main><div class=card>
${data?.[0]?`A rider match is available. JR PHEEF will notify the approved rider.`:"No approved rider available yet. Your request can be queued."}</div></main>`));
});

app.post("/rider",async(q,r)=>{
 let {error}=await db.from("riders").insert({member_id:q.body.member_id,company:q.body.company,vehicle:q.body.vehicle,area:q.body.area,status:"pending",online:false});
 r.send(page("Rider",`<header><h1>🚚 Application received</h1></header><main><div class=card>${error?"Could not submit: "+esc(error.message):"Application submitted. Once approved, you can receive JR PHEEF delivery requests."}</div></main>`));
});

/* ORGANIZATIONS */

app.get("/organization",async(q,r)=>{
 let {data:u}=await get(q.query.id);if(!u)return r.redirect("/");
 r.send(page("Organization",`<header><h1>🏢 Organization</h1></header><main><div class=card>
<form method=post><input type=hidden name=member_id value="${u.id}">
<input name=name placeholder="Organization name" required><input name=registration_no placeholder="Registration number">
<input name=phone placeholder="Official phone"><input name=location placeholder="Location">
<textarea name=description placeholder="What does the organization do?"></textarea><button>Register</button>
</form></div></main>`));
});

app.post("/organization",async(q,r)=>{
 let {error}=await db.from("organizations").insert({...q.body,status:"pending"});
 r.send(page("Organization",`<header><h1>🏢 Organization</h1></header><main><div class=card>${error?esc(error.message):"Registration submitted for approval."}</div></main>`));
});

/* BRANDS */

app.get("/brands",async(q,r)=>{
 let {data:u}=await get(q.query.id);if(!u)return r.redirect("/");
 let {data:b}=await db.from("brand_promotions").select("*").eq("status","active").limit(30);
 r.send(page("Brands",`<header><h1>📣 Brands & Promotions</h1><p>Discover brands and support businesses.</p></header><main>
<div class=card><p>Users can recommend/share brands through JR PHEEF. Official paid brand campaigns receive promoted placement.</p></div>
${(b||[]).map(x=>`<div class=card><h2>${esc(x.brand_name)}</h2><p>${esc(x.description||"")}</p></div>`).join("")}</main>`));
});

/* WALLET */

app.get("/wallet",async(q,r)=>{
 let {data:u}=await get(q.query.id);if(!u)return r.redirect("/");
 r.send(page("Wallet",`<header><h1>🎁 Wallet</h1></header><main><div class=card>
<h2>Rewards: KSh ${money(u.rewards)}</h2><h2>Credits: KSh ${money(u.credits)}</h2>
<p>Minimum withdrawal: KSh 200</p><p class=muted>M-Pesa payout activates after live payment integration.</p>
</div></main>`));
});

/* OWNER */

app.get("/owner",async(q,r)=>{
 if(!process.env.OWNER_KEY||q.query.key!==process.env.OWNER_KEY)return r.status(403).send("🔒 Owner access denied.");
 let [m,l,ri,o,b]=await Promise.all([
  db.from("members").select("*").order("created_at",{ascending:false}).limit(100),
  db.from("jr_listings").select("*").limit(100),
  db.from("riders").select("*").limit(100),
  db.from("organizations").select("*").limit(100),
  db.from("brand_promotions").select("*").limit(100)
 ]);
 r.send(page("Owner",`<header><h1>👑 JR PHEEF COMMAND CENTER</h1></header><main>
<div class=grid>
<div class=card>👥 Members<br><b>${m.data?.length||0}</b></div>
<div class=card>🏪 Listings<br><b>${l.data?.length||0}</b></div>
<div class=card>🚚 Riders<br><b>${ri.data?.length||0}</b></div>
<div class=card>🏢 Organizations<br><b>${o.data?.length||0}</b></div>
<div class=card>📣 Brands<br><b>${b.data?.length||0}</b></div>
</div>

<div class=card><h2>Members</h2>${(m.data||[]).map(x=>`
<form method=post action="/owner/member">
<b>${esc(x.full_name)}</b> — ${esc(x.dgbo_id)}
<input type=hidden name=id value="${x.id}">
<select name=status><option>active</option><option>pending</option><option>approved</option><option>suspended</option></select>
<select name=plan><option>free</option><option>pro</option><option>prime</option></select>
<button>Update</button></form>`).join("")}</div>

<div class=card><h2>Riders</h2>${(ri.data||[]).map(x=>`
<form method=post action="/owner/rider">${esc(x.company||"Rider")} — ${esc(x.status)}
<input type=hidden name=id value="${x.id}">
<button name=status value=approved>Approve</button><button name=status value=rejected>Reject</button></form>`).join("")}</div>

<div class=card><h2>Organizations</h2>${(o.data||[]).map(x=>`
<form method=post action="/owner/org">${esc(x.name)} — ${esc(x.status)}
<input type=hidden name=id value="${x.id}">
<button name=status value=approved>Approve</button><button name=status value=rejected>Reject</button></form>`).join("")}</div>
</main>`));
});

app.post("/owner/member",async(q,r)=>{await update("members",q.body.id,{status:q.body.status,plan:q.body.plan});r.redirect(`/owner?key=${encodeURIComponent(process.env.OWNER_KEY)}`)});
app.post("/owner/rider",async(q,r)=>{await update("riders",q.body.id,{status:q.body.status});r.redirect(`/owner?key=${encodeURIComponent(process.env.OWNER_KEY)}`)});
app.post("/owner/org",async(q,r)=>{await update("organizations",q.body.id,{status:q.body.status});r.redirect(`/owner?key=${encodeURIComponent(process.env.OWNER_KEY)}`)});

/* WHATSAPP */

app.post("/api/webhook/whatsapp",async(q,r)=>{
 try{
  let p=phone(q.body.From),text=String(q.body.Body||"").trim(),{data:u}=await byPhone(p);
  let reply;
  if(!u)reply=`👋 Karibu JR PHEEF!\n\nCreate your account:\nhttps://jr-pheef-marketplace.onrender.com/register`;
  else{
   let free=freeHours();
   reply=free
    ?`👋 ${u.full_name}\n\n🌙 JR PHEEF FREE HOURS are active until 6:00 AM.\n\nTell me naturally what you're looking for or what opportunity you have.`
    :await need(u)
      ?`👋 ${u.full_name}\n\nYou're active on JR PHEEF.\n\nTell me naturally what you need, what you're offering, or who/what you'd like to connect with.`
      :`👋 ${u.full_name}\n\nYour JR PHEEF access has expired.\n\nActivate for KSh 30 and use JR PHEEF for 5 hours.\n\nFree access: 2:00 AM–6:00 AM.`;
  if(text&&blocked.test(text))reply="🛡️ JR PHEEF protects members by blocking phone numbers, emails and external links.";
  if(wa&&FROM&&q.body.From)console.log("WhatsApp message from",p,text);
  r.type("text/xml").send(`<Response><Message>${esc(reply)}</Message></Response>`);
 }catch(e){console.error(e);r.type("text/xml").send("<Response><Message>JR PHEEF is temporarily unavailable. Please try again.</Message></Response>")}
});

/* HEALTH */

app.get("/health",(q,r)=>r.json({
 ok:true,service:"JR PHEEF",database:"Supabase",listings:"jr_listings",
 activation:"KSh30/5hours",free_hours:"02:00-06:00 EAT",
 marketplace:true,connections:true,love:true,delivery:true,organizations:true,
 brands:true,owner:true,whatsapp:!!wa
}));

app.listen(PORT,()=>console.log(
`🚀 JR PHEEF running on ${PORT} | DB ${db?"CONNECTED":"CHECK ENV"} | KSh30/5H | FREE 02:00-06:00 | jr_listings | CONNECTIONS | MARKETPLACE | DELIVERY | ORGANIZATIONS | BRANDS | OWNER`
));
