const express=require("express"),crypto=require("crypto"),{createClient}=require("@supabase/supabase-js"),twilio=require("twilio"),multer=require("multer");

const app=express(),PORT=process.env.PORT||10000,BASE="https://jr-pheef-marketplace.onrender.com";
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_ANON_KEY;
const sb=process.env.SUPABASE_URL&&KEY?createClient(process.env.SUPABASE_URL,KEY):null;
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024}});
app.use(express.urlencoded({extended:true}));app.use(express.json());

const plans={free:{price:0,match:30},pro:{price:99,match:20},prime:{price:149,match:20}};
const themes={green:"#08783c",blue:"#2563eb",purple:"#7c3aed",gold:"#b8860b",black:"#111"};
const esc=s=>String(s??"").replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
const clean=s=>String(s??"").trim();
const phone=s=>{s=clean(s).replace(/[^\d+]/g,"");if(/^07\d{8}$/.test(s))return"+254"+s.slice(1);if(/^01\d{8}$/.test(s))return"+254"+s.slice(1);if(/^254\d{9}$/.test(s))return"+"+s;return s};
const salt=process.env.PASSWORD_SALT||"jr-pheef-salt-change-me";
const hash=p=>crypto.scryptSync(p,salt,32).toString("hex");
const sha256=p=>crypto.createHash("sha256").update(p).digest("hex");
const sha512=p=>crypto.createHash("sha512").update(p).digest("hex");
const verify=(p,h)=>h===hash(p)||h===sha256(p)||h===sha512(p);
const blocked=/(\+?\d[\d\s().-]{7,}|\b\d{9,13}\b|https?:\/\/|www\.|\.com\b|\.co\.ke\b|@\w+\.\w+|\bwhatsapp\b|\btelegram\b|\bemail\b)/i;

async function get(id){if(!sb)return null;const {data}=await sb.from("members").select("*").eq("id",id).maybeSingle();return data}
async function byPhone(p){if(!sb)return null;const {data}=await sb.from("members").select("*").eq("phone",phone(p)).maybeSingle();return data}
async function save(t,d,id){const q=sb.from(t);const r=id?await q.update(d).eq("id",id):await q.insert(d);if(r.error)throw r.error;return r}
async function dgbo(){const {count,error}=await sb.from("members").select("id",{count:"exact",head:true});if(error)throw error;return`DGBO-${String((count||0)+1).padStart(6,"0")}`}
function cookie(id){const sig=crypto.createHmac("sha256",salt).update(String(id)).digest("hex");return`${id}.${sig}`}
function session(req){const x=(req.headers.cookie||"").match(/jrp=([^;]+)/)?.[1];if(!x)return null;const [id,sig]=x,good=crypto.createHmac("sha256",salt).update(id).digest("hex");return crypto.timingSafeEqual(Buffer.from(sig||""),Buffer.from(good))?id:null}
function setSession(res,id){res.setHeader("Set-Cookie",`jrp=${cookie(id)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000`)}
async function user(req){const id=session(req);return id?get(id):null}

function page(title,body,theme="green"){
return`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>:root{--c:${themes[theme]||themes.green};--bg:#f3f8f5}*{box-sizing:border-box}body{margin:0;background:var(--bg);font:15px Arial;color:#111}header{background:var(--c);color:white;padding:24px 20px}main{max-width:850px;margin:auto;padding:12px}.card{background:white;border-radius:18px;padding:18px;margin:12px 0;box-shadow:0 2px 12px #0001}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}input,textarea,select{width:100%;padding:13px;margin:6px 0;border:1px solid #ccc;border-radius:10px;font-size:15px}button,.btn{background:var(--c);color:white;border:0;border-radius:10px;padding:11px 16px;text-decoration:none;display:inline-block;margin:4px;cursor:pointer}.danger{background:#b42318}.muted{opacity:.65}.avatar{width:110px;height:110px;border-radius:50%;object-fit:cover;border:3px solid var(--c)}</style></head><body>${body}</body></html>`
}
function go(res,url){res.redirect(url)}

app.get("/",(req,res)=>res.send(page("JR PHEEF",`<header><h1>JR PHEEF</h1><p>Find. Match. Connect. Trade.</p></header><main><div class="card"><h2>Welcome 👋</h2><p>People, products, services, opportunities and genuine connections.</p><a class="btn" href="/register">Create account</a><a class="btn" href="/login">Sign in</a></div></main>`)));

app.get("/register",(req,res)=>res.send(page("Register",`<header><h1>Create JR PHEEF Account</h1></header><main><div class="card"><form method="post">
<input name="name" placeholder="Full name" required><input name="phone" placeholder="Phone number" required><input name="year" type="number" placeholder="Birth year">
<input id="p" name="password" type="password" placeholder="Create password" required><label><input type="checkbox" onclick="p.type=this.checked?'text':'password'"> Show password</label><button>Create account</button></form></div></main>`)));

app.post("/register",async(req,res)=>{
try{
 const p=phone(req.body.phone),name=clean(req.body.name),password=clean(req.body.password);
 if(!name||!p||!password)return res.status(400).send("Please complete all required fields.");
 if(await byPhone(p))return go(res,"/login?exists=1");
 const row={dgbo_id:await dgbo(),full_name:name,phone:p,birth_year:clean(req.body.year),password_hash:hash(password),reputation:0,verified:false,status:"active",bio:"",location:"",country:"Kenya",profile_photo:"",public_profile:true,public_phone:false,theme:"green",role:"person",plan:"free",rewards:0,credits:0};
 const {data,error}=await sb.from("members").insert(row).select().single();if(error)throw error;
 setSession(res,data.id);go(res,"/home");
}catch(e){console.error(e);res.status(500).send("Registration failed: "+esc(e.message))}
});

app.get("/login",(req,res)=>res.send(page("Sign in",`<header><h1>JR PHEEF</h1></header><main><div class="card">${req.query.exists?"<p>Account already exists. Sign in below.</p>":""}
<form method="post"><input name="phone" placeholder="Phone number" required><input id="p" name="password" type="password" placeholder="Password" required><label><input type="checkbox" onclick="p.type=this.checked?'text':'password'"> Show password</label><button>Continue</button></form>
<p><a href="/register">Create a new account</a></p></div></main>`)));

app.post("/login",async(req,res)=>{
try{
 const p=phone(req.body.phone),u=await byPhone(p);
 if(!u||!verify(req.body.password,u.password_hash))return res.status(401).send("Incorrect phone or password. <br><br><a href='/login'>Try again</a>");
 if(u.password_hash!==hash(req.body.password))await save("members",{password_hash:hash(req.body.password)},u.id);
 await save("members",{last_login:new Date().toISOString()},u.id);
 setSession(res,u.id);go(res,"/home");
}catch(e){console.error(e);res.status(500).send("Login error: "+esc(e.message))}
});

app.get("/home",async(req,res)=>{
const u=await user(req);if(!u)return go(res,"/login");
const t=themes[u.theme]?u.theme:"green",plan=u.plan||"free";
res.send(page("JR PHEEF",`<header><h1>JR PHEEF</h1><p>Welcome, ${esc(u.full_name)} 👋</p><b>${esc(u.dgbo_id)}</b></header><main>
<div class="card"><h2>👤 Your Profile</h2>${u.profile_photo?`<img class="avatar" src="${esc(u.profile_photo)}">`:"👤"}<p><b>${esc(u.full_name)}</b></p><p>${esc(u.bio||"Tell people about yourself.")}</p><a class="btn" href="/profile">Edit profile</a></div>
<div class="grid">
${[
["🔎 Find","People, products, services and opportunities.","/find"],
["🏪 Sell","Free marketplace listings.","/listing"],
["🤝 Matches","Rotating local and international matches.","/matches"],
["💬 Connections","Talk naturally and safely.","/connections"],
["💞 Love & Friendship","Genuine connections.","/love"],
["🤝 Deal Rooms","Keep trade discussions inside JR PHEEF.","/deals"],
["🚚 Delivery","Find approved riders.","/delivery"],
["🏢 Organizations","Business, institution and organization operations.","/organization"],
["🎁 Wallet",`Rewards KSh ${u.rewards||0} · Credits KSh ${u.credits||0}`,"/wallet"]
].map(x=>`<div class="card"><h2>${x[0]}</h2><p>${x[1]}</p><a class="btn" href="${x[2]}">${x[0].replace(/^\\S+ /,"Open")}</a></div>`).join("")}</div>
<div class="card"><h2>⭐ Membership</h2><p><b>Current: ${plan.toUpperCase()}</b></p>${Object.entries(plans).map(([k,v])=>`<p>${k.toUpperCase()} — KSh ${v.price}/month · KSh ${v.match} match fee <a class="btn" href="/upgrade?plan=${k}">${k===plan?"Current":"Choose"}</a></p>`).join("")}</div>
<div class="card"><h2>🎨 Theme</h2><form method="post" action="/theme"><select name="theme">${Object.keys(themes).map(k=>`<option value="${k}" ${k===t?"selected":""}>${k}</option>`).join("")}</select><button>Save theme</button></form></div>
<div class="card"><a class="btn" href="/logout">Sign out</a></div></main>`,t))
});

app.get("/logout",(req,res)=>{res.setHeader("Set-Cookie","jrp=; Path=/; Max-Age=0");go(res,"/")});

app.get("/profile",async(req,res)=>{
const u=await user(req);if(!u)return go(res,"/login");
res.send(page("Profile",`<header><h1>👤 Edit Profile</h1></header><main><div class="card"><form method="post" enctype="multipart/form-data">
${u.profile_photo?`<img class="avatar" src="${esc(u.profile_photo)}"><br>`:""}<label>Profile photo</label><input type="file" name="photo" accept="image/*">
<input name="name" value="${esc(u.full_name)}" placeholder="Full name"><textarea name="bio" placeholder="Bio">${esc(u.bio)}</textarea>
<input name="location" value="${esc(u.location)}" placeholder="City / location"><input name="country" value="${esc(u.country||"Kenya")}" placeholder="Country">
<label><input type="checkbox" name="public_profile" ${u.public_profile!==false?"checked":""}> Show profile publicly</label>
<label><input type="checkbox" name="public_phone" ${u.public_phone?"checked":""}> Show phone publicly</label><button>Save profile</button></form></div></main>`))
});

app.post("/profile",upload.single("photo"),async(req,res)=>{
try{
const u=await user(req);if(!u)return go(res,"/login");
const d={full_name:clean(req.body.name),bio:clean(req.body.bio),location:clean(req.body.location),country:clean(req.body.country),public_profile:!!req.body.public_profile,public_phone:!!req.body.public_phone};
if(req.file){
 const ext=(req.file.originalname.split(".").pop()||"jpg").toLowerCase(),path=`${u.id}/profile-${Date.now()}.${ext}`;
 const x=await sb.storage.from("profiles").upload(path,req.file.buffer,{contentType:req.file.mimetype,upsert:true});
 if(x.error)throw x.error;d.profile_photo=sb.storage.from("profiles").getPublicUrl(path).data.publicUrl;
}
await save("members",d,u.id);go(res,"/home");
}catch(e){res.status(500).send("Profile update failed: "+esc(e.message))}
});

app.post("/theme",async(req,res)=>{const u=await user(req);if(!u)return go(res,"/login");if(!themes[req.body.theme])return res.status(400).send("Invalid theme.");await save("members",{theme:req.body.theme},u.id);go(res,"/home")});

app.get("/find",async(req,res)=>{
const u=await user(req);if(!u)return go(res,"/login");
const {data:people}=await sb.from("members").select("*").eq("status","active").eq("public_profile",true).neq("id",u.id).limit(30);
const {data:ls}=await sb.from("jr_listings").select("*").eq("status","active").limit(30);
res.send(page("Find",`<header><h1>🔎 Find</h1></header><main><div class="card"><h2>People</h2>${(people||[]).map(p=>`<div class="card"><b>${esc(p.full_name)}</b><p>${esc(p.bio||"JR PHEEF member")}</p><p>📍 ${esc(p.location||"Location private")}</p><a class="btn" href="/chat?to=${p.id}">Connect</a></div>`).join("")||"<p>No people found yet.</p>"}</div><div class="card"><h2>Marketplace</h2>${(ls||[]).map(x=>`<div class="card"><b>${esc(x.title)}</b><p>${esc(x.description)}</p><p>KSh ${esc(x.price||"")}</p><p>📍 ${esc(x.location||"")}</p></div>`).join("")||"<p>No listings yet.</p>"}</div></main>`))
});

app.get("/listing",async(req,res)=>{if(!await user(req))return go(res,"/login");res.send(page("Listing",`<header><h1>🏪 Free Listing</h1></header><main><div class="card"><form method="post"><input name="title" placeholder="What are you offering?" required><textarea name="description" placeholder="Description"></textarea><input name="price" type="number" placeholder="Price"><input name="location" placeholder="Location"><select name="category"><option>Product</option><option>Service</option><option>Business</option><option>Job</option><option>Property</option><option>Investment</option><option>Event</option></select><button>Create listing</button></form></div></main>`))});
app.post("/listing",async(req,res)=>{const u=await user(req);if(!u)return go(res,"/login");try{await save("jr_listings",{member_id:u.id,title:clean(req.body.title),description:clean(req.body.description),price:req.body.price||0,location:clean(req.body.location),category:clean(req.body.category),photos:[],status:"active"},null);go(res,"/home")}catch(e){res.status(500).send("Listing failed: "+esc(e.message))}});

async function people(req,res,title,n=10){const u=await user(req);if(!u)return go(res,"/login");const {data}=await sb.from("members").select("*").eq("status","active").eq("public_profile",true).neq("id",u.id).limit(60);const a=(data||[]).sort(()=>Math.random()-.5).slice(0,n);res.send(page(title,`<header><h1>${title}</h1></header><main>${a.map(p=>`<div class="card"><b>${esc(p.full_name)}</b><p>${esc(p.bio||"Open to connections")}</p><p>📍 ${esc(p.location||"Around you / international")}</p><a class="btn" href="/chat?to=${p.id}">Connect</a></div>`).join("")||"<p>No matches available yet.</p>"}</main>`))}
app.get("/matches",(q,r)=>people(q,r,"🤝 Your Matches",8));app.get("/love",(q,r)=>people(q,r,"💞 Love & Friendship",10));app.get("/connections",(q,r)=>people(q,r,"💬 Connections",10));

app.get("/chat",async(req,res)=>{const u=await user(req),to=await get(req.query.to);if(!u||!to)return go(res,"/home");const {data}=await sb.from("messages").select("*").or(`and(sender_id.eq.${u.id},receiver_id.eq.${to.id}),and(sender_id.eq.${to.id},receiver_id.eq.${u.id})`).order("created_at");res.send(page("Chat",`<header><h1>💬 ${esc(to.full_name)}</h1><p>JR PHEEF protects contact details.</p></header><main><div class="card">${(data||[]).map(m=>`<p><b>${m.sender_id===u.id?"You":esc(to.full_name)}:</b> ${esc(m.body)}</p>`).join("")||"Start talking naturally."}</div><div class="card"><form method="post"><input type="hidden" name="to" value="${to.id}"><textarea name="body" placeholder="Write naturally..." required></textarea><button>Send</button></form></div></main>`))});
app.post("/chat",async(req,res)=>{const u=await user(req);if(!u)return go(res,"/login");const body=clean(req.body.body);if(blocked.test(body))return res.status(400).send("JR PHEEF protected this message because it appears to contain contact details, links or an attempt to move the conversation outside JR PHEEF.");const to=await get(req.body.to);if(!to)return res.status(404).send("Member not found.");const {error}=await sb.from("messages").insert({sender_id:u.id,receiver_id:to.id,body});if(error)return res.status(500).send(esc(error.message));go(res,`/chat?to=${to.id}`)});

app.get("/deals",async(req,res)=>{const u=await user(req);if(!u)return go(res,"/login");const fee=plans[u.plan||"free"].match;res.send(page("Deal Rooms",`<header><h1>🤝 Deal Room</h1></header><main><div class="card"><p>Current match fee: KSh ${fee}</p><form method="post"><input name="other" placeholder="Matched member ID" required><input name="amount" type="number" placeholder="Transaction amount"><button>Create Deal Room</button></form></div></main>`))});
app.post("/deals",async(req,res)=>{const u=await user(req);if(!u)return go(res,"/login");try{const fee=plans[u.plan||"free"].match,r=await sb.from("deal_rooms").insert({member_a:u.id,member_b:req.body.other,amount:req.body.amount||0,match_fee:fee,status:"open"}).select().single();if(r.error)throw r.error;res.send(page("Deal Room",`<header><h1>🤝 Deal Room Ready</h1></header><main><div class="card"><p>Room: ${esc(r.data.id)}</p><p>Status: OPEN</p><p>Match fee: KSh ${fee}</p></div></main>`))}catch(e){res.status(400).send(esc(e.message))}});
app.post("/deal",(req,res)=>{req.url="/deals";app._router.handle(req,res)});

app.get("/delivery",async(req,res)=>{const u=await user(req);if(!u)return go(res,"/login");res.send(page("Delivery",`<header><h1>🚚 Delivery</h1></header><main><div class="card"><h2>Request delivery</h2><form method="post"><input name="pickup" placeholder="Pickup location" required><input name="destination" placeholder="Destination" required><input name="item" placeholder="What needs moving?"><button>Find rider</button></form></div><div class="card"><h2>Become a rider</h2><form method="post" action="/rider"><input name="company" placeholder="Company / independent"><input name="vehicle" placeholder="Vehicle"><input name="area" placeholder="Operating area"><button>Apply</button></form></div></main>`))});
app.post("/delivery",async(req,res)=>{const {data}=await sb.from("riders").select("*").eq("status","approved").limit(20);res.send(page("Riders",`<header><h1>🚚 Rider Matching</h1></header><main><div class="card"><p>Request received. Approved riders can be matched.</p></div>${(data||[]).map(x=>`<div class="card">✅ ${esc(x.company||"Independent rider")} — ${esc(x.area||"")}</div>`).join("")}</main>`))});
app.post("/rider",async(req,res)=>{const u=await user(req);if(!u)return go(res,"/login");try{await save("riders",{member_id:u.id,company:clean(req.body.company),vehicle:clean(req.body.vehicle),area:clean(req.body.area),status:"pending"},null);res.send(page("Rider",`<header><h1>🚚 Application received</h1></header><main><div class="card">Your rider application is pending approval.</div></main>`))}catch(e){res.status(500).send(esc(e.message))}});

app.get("/organization",async(req,res)=>{const u=await user(req);if(!u)return go(res,"/login");res.send(page("Organization",`<header><h1>🏢 Organization</h1></header><main><div class="card"><form method="post"><input name="name" placeholder="Organization name" required><input name="registration_no" placeholder="Official registration number"><input name="phone" placeholder="Organization phone"><input name="location" placeholder="Location"><textarea name="description" placeholder="What does it do?"></textarea><button>Register organization</button></form></div></main>`))});
app.post("/organization",async(req,res)=>{const u=await user(req);if(!u)return go(res,"/login");try{await save("organizations",{member_id:u.id,name:clean(req.body.name),registration_no:clean(req.body.registration_no),phone:clean(req.body.phone),location:clean(req.body.location),description:clean(req.body.description),status:"pending"},null);res.send(page("Organization",`<header><h1>🏢 Submitted</h1></header><main><div class="card">Organization submitted for approval.</div></main>`))}catch(e){res.status(500).send(esc(e.message))}});

app.get("/wallet",async(req,res)=>{const u=await user(req);if(!u)return go(res,"/login");res.send(page("Wallet",`<header><h1>🎁 JR PHEEF Wallet</h1></header><main><div class="card"><h2>Rewards</h2><h3>KSh ${u.rewards||0}</h3><h2>JR PHEEF Credits</h2><h3>KSh ${u.credits||0}</h3><p>Minimum individual withdrawal: KSh 200</p><p class="muted">M-Pesa activates after live payment integration.</p></div></main>`))});

app.get("/upgrade",async(req,res)=>{const u=await user(req),p=plans[req.query.plan];if(!u||!p)return res.status(400).send("Invalid plan.");await save("members",{plan:req.query.plan},u.id);go(res,"/home")});

app.post("/api/webhook/whatsapp",async(req,res)=>{const u=await byPhone(req.body.From||""),r=new twilio.twiml.MessagingResponse();r.message(u?`👋 ${u.full_name}, karibu JR PHEEF.\n${BASE}/home`:`👋 Karibu JR PHEEF!\nCreate your account:\n${BASE}/register`);res.type("text/xml").send(r.toString())});

async function owner(req,res,next){if(!process.env.OWNER_KEY)return res.status(500).send("OWNER_KEY is not configured.");if(req.query.key===process.env.OWNER_KEY){res.setHeader("Set-Cookie",`owner=${crypto.createHmac("sha256",salt).update(process.env.OWNER_KEY).digest("hex")}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=86400`);return next()}const c=req.headers.cookie||"";if(c.includes("owner=")&&c.includes(crypto.createHmac("sha256",salt).update(process.env.OWNER_KEY).digest("hex")))return next();res.status(403).send("🔒 Owner access denied.")}

app.get("/owner",owner,async(req,res)=>{const [m,l,r,o]=await Promise.all([sb.from("members").select("*").order("created_at",{ascending:false}).limit(100),sb.from("jr_listings").select("*").limit(100),sb.from("riders").select("*").limit(100),sb.from("organizations").select("*").limit(100)]);res.send(page("Owner",`<header><h1>👑 JR PHEEF</h1><p>COMMAND CENTER</p></header><main><div class="grid">${[["👥 Members",m.data?.length],["🏪 Listings",l.data?.length],["🚚 Riders",r.data?.length],["🏢 Organizations",o.data?.length]].map(x=>`<div class="card"><h2>${x[0]}</h2><h1>${x[1]||0}</h1></div>`).join("")}</div><div class="card"><h2>Members</h2>${(m.data||[]).map(x=>`<p><b>${esc(x.full_name)}</b> · ${esc(x.dgbo_id)} · ${esc(x.plan||"free")} · ${esc(x.status)}</p><form method="post" action="/owner/member"><input type="hidden" name="id" value="${x.id}"><select name="plan"><option>free</option><option>pro</option><option>prime</option></select><select name="status"><option>active</option><option>suspended</option><option>pending</option></select><button>Save</button></form>`).join("")}</div><div class="card"><h2>🚚 Rider approvals</h2>${(r.data||[]).map(x=>`<p>${esc(x.company||"Rider")} · ${esc(x.status)} <form method="post" action="/owner/rider" style="display:inline"><input type="hidden" name="id" value="${x.id}"><button name="status" value="approved">Approve</button><button class="danger" name="status" value="rejected">Reject</button></form></p>`).join("")}</div><div class="card"><h2>🏢 Organization approvals</h2>${(o.data||[]).map(x=>`<p>${esc(x.name)} · ${esc(x.status)} <form method="post" action="/owner/org" style="display:inline"><input type="hidden" name="id" value="${x.id}"><button name="status" value="approved">Approve</button><button class="danger" name="status" value="rejected">Reject</button></form></p>`).join("")}</div></main>`))});

app.post("/owner/member",owner,async(req,res)=>{await save("members",{plan:req.body.plan,status:req.body.status},req.body.id);go(res,"/owner")});
app.post("/owner/rider",owner,async(req,res)=>{await save("riders",{status:req.body.status},req.body.id);go(res,"/owner")});
app.post("/owner/org",owner,async(req,res)=>{await save("organizations",{status:req.body.status},req.body.id);go(res,"/owner")});

app.get("/health",async(req,res)=>{let db=false;try{db=!!(await sb.from("members").select("id").limit(1)).error===false}catch{}res.json({ok:true,service:"JR PHEEF",database:!!sb,registration:true,login:true,profiles:true,photos:true,themes:true,membership:true,listings:true,matches:true,chat:true,delivery:true,organizations:true,deals:true,wallet:true,whatsapp:true,owner:true})});

app.listen(PORT,()=>console.log(`🚀 JR PHEEF running on ${PORT} | Supabase ${sb?"CONNECTED":"NOT CONNECTED"}`)); 
