const express=require("express");
const crypto=require("crypto");
const {createClient}=require("@supabase/supabase-js");
const twilio=require("twilio");
const multer=require("multer");

const app=express(), PORT=process.env.PORT||10000;
const BASE="https://jr-pheef-marketplace.onrender.com";
const KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_ANON_KEY;
const sb=process.env.SUPABASE_URL&&KEY?createClient(process.env.SUPABASE_URL,KEY):null;
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024}});
app.use(express.urlencoded({extended:true}));
app.use(express.json());

const plans={
 free:{price:0,match:30},
 pro:{price:99,match:20},
 prime:{price:149,match:20}
};

const esc=s=>String(s??"").replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
const clean=s=>String(s??"").trim();
const hash=p=>crypto.scryptSync(p,process.env.PASSWORD_SALT||"jr-pheef-salt",32).toString("hex");
const block=/(\+?\d[\d\s().-]{7,}|\b\d{9,13}\b|https?:\/\/|www\.|\.com\b|\.co\.ke\b|@\w+\.\w+|\bwhatsapp\b|\btelegram\b|\bemail\b)/i;
const member=async id=>{
 if(!sb)return null;
 const {data}=await sb.from("members").select("*").eq("id",id).maybeSingle();
 return data;
};
const phoneMember=async phone=>{
 if(!sb)return null;
 const p=clean(phone);
 const {data}=await sb.from("members").select("*").eq("phone",p).maybeSingle();
 return data;
};
const nextDGBO=async()=>{
 const {count}=await sb.from("members").select("*",{count:"exact",head:true});
 return `DGBO-${String((count||0)+1).padStart(6,"0")}`;
};
const save=(table,data,id)=>{
 let q=sb.from(table);
 return id?q.update(data).eq("id",id):q.insert(data);
};

function layout(title,body,theme="green"){
 const colors={green:"#08783c",blue:"#2563eb",purple:"#7c3aed",gold:"#b8860b",black:"#111"};
 return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
 <title>${esc(title)}</title><style>
 :root{--c:${colors[theme]||colors.green};--bg:#f3f8f5;--card:#fff;--txt:#111}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font-family:Arial,sans-serif}
 header{background:var(--c);color:#fff;padding:25px 20px}main{max-width:850px;margin:auto;padding:14px}
 .card{background:var(--card);border-radius:18px;padding:20px;margin:14px 0;box-shadow:0 2px 12px #0001}
 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
 input,textarea,select{width:100%;padding:13px;margin:6px 0;border:1px solid #ccc;border-radius:10px;font-size:15px}
 button,.btn{display:inline-block;background:var(--c);color:#fff;border:0;border-radius:10px;padding:12px 17px;margin:4px;text-decoration:none;cursor:pointer}
 .danger{background:#b42318}.muted{opacity:.7;font-size:13px}.pill{display:inline-block;padding:6px 10px;border-radius:20px;background:#eee}
 img.avatar{width:110px;height:110px;border-radius:50%;object-fit:cover;border:3px solid var(--c)}
 </style></head><body>${body}</body></html>`;
}

app.get("/",(req,res)=>res.send(layout("JR PHEEF",`
<header><h1>JR PHEEF</h1><p>Find. Match. Connect. Trade.</p></header>
<main><div class="card"><h2>Welcome 👋</h2>
<p>One place to discover people, opportunities, businesses, services and real connections.</p>
<a class="btn" href="/register">Create account</a>
<a class="btn" href="/login">Sign in</a></div>
<div class="card"><h3>JR PHEEF</h3><p>Find opportunities. Create opportunities. Connect with people.</p></div></main>`)));

/* REGISTRATION */

app.get("/register",(req,res)=>res.send(layout("Create Account",`
<header><h1>Create JR PHEEF Account</h1></header><main><div class="card">
<form method="POST" action="/register">
<input name="name" placeholder="Full name" required>
<input name="phone" placeholder="Phone number" required>
<input name="year" type="number" placeholder="Birth year" required>
<input id="pw" name="password" type="password" placeholder="Create password" required>
<label><input type="checkbox" onclick="pw.type=this.checked?'text':'password'"> 👁 Show password</label>
<button>Continue</button></form></div></main>`)));

app.post("/register",async(req,res)=>{
 try{
  const name=clean(req.body.name),phone=clean(req.body.phone),year=clean(req.body.year),password=clean(req.body.password);
  if(!name||!phone||!password)return res.status(400).send("Complete all required fields.");
  if(await phoneMember(phone))return res.redirect("/login?error=exists");
  const dgbo=await nextDGBO();
  const row={
   dgbo_id:dgbo,full_name:name,phone,reputation:0,verified:false,status:"active",
   password_hash:hash(password),bio:"",location:"",country:"Kenya",
   profile_photo:"",public_profile:true,public_phone:false,theme:"green",
   role:"person",birth_year:year
  };
  const {data,error}=await sb.from("members").insert(row).select().single();
  if(error)throw error;
  res.redirect("/home?id="+data.id);
 }catch(e){console.error(e);res.status(500).send("Registration failed: "+esc(e.message));}
});

/* LOGIN */

app.get("/login",(req,res)=>res.send(layout("Sign in",`
<header><h1>JR PHEEF</h1></header><main><div class="card">
${req.query.error?`<p>Account already exists. Sign in below.</p>`:""}
<form method="POST" action="/login">
<input name="phone" placeholder="Phone number" required>
<input id="pw" name="password" type="password" placeholder="Password" required>
<label><input type="checkbox" onclick="pw.type=this.checked?'text':'password'"> 👁 Show password</label>
<button>Continue</button></form></div></main>`)));

app.post("/login",async(req,res)=>{
 const u=await phoneMember(req.body.phone);
 if(!u||u.password_hash!==hash(req.body.password))return res.status(401).send("Incorrect phone or password.");
 res.redirect("/home?id="+u.id);
});

/* HOME */

app.get("/home",async(req,res)=>{
 const u=await member(req.query.id); if(!u)return res.redirect("/login");
 const theme=u.theme||"green";
 res.send(layout("JR PHEEF",`
<header><h1>JR PHEEF</h1><p>Welcome, ${esc(u.full_name)} 👋</p><b>${esc(u.dgbo_id)}</b></header>
<main>
<div class="card"><h2>👤 Your Profile</h2>
${u.profile_photo?`<img class="avatar" src="${esc(u.profile_photo)}">`:"<div class=\"avatar\" style=\"display:grid;place-items:center\">👤</div>"}
<p><b>${esc(u.full_name)}</b></p><p>${esc(u.bio||"Tell people a little about yourself.")}</p>
<a class="btn" href="/profile?id=${u.id}">Edit profile</a></div>

<div class="grid">
<div class="card"><h2>🔎 Find</h2><p>People, products, services and opportunities.</p><a class="btn" href="/find?id=${u.id}">Explore</a></div>
<div class="card"><h2>🏪 Create</h2><p>Listings are free.</p><a class="btn" href="/listing?id=${u.id}">Create</a></div>
<div class="card"><h2>🤝 Matches</h2><p>Local and international connections.</p><a class="btn" href="/matches?id=${u.id}">View matches</a></div>
<div class="card"><h2>💬 Connections</h2><p>Chat and mingle naturally.</p><a class="btn" href="/connections?id=${u.id}">Open</a></div>
<div class="card"><h2>💞 Love & Friendship</h2><p>Meet people seeking genuine connections.</p><a class="btn" href="/love?id=${u.id}">Discover</a></div>
<div class="card"><h2>🤝 Deal Rooms</h2><p>Business conversations stay inside JR PHEEF.</p><a class="btn" href="/deals?id=${u.id}">Open</a></div>
<div class="card"><h2>🚚 Delivery</h2><p>Connect with approved riders.</p><a class="btn" href="/delivery?id=${u.id}">Request</a></div>
<div class="card"><h2>🏢 Organizations</h2><p>Business, institution and organization operations.</p><a class="btn" href="/organization?id=${u.id}">Manage</a></div>
<div class="card"><h2>🎁 Wallet</h2><p>Rewards: KSh ${u.rewards||0}<br>Credits: KSh ${u.credits||0}</p><a class="btn" href="/wallet?id=${u.id}">Open wallet</a></div>
</div>

<div class="card"><h2>⭐ Membership</h2>
<p>FREE — listings + normal connections</p><p>PRO — KSh 99/month</p><p>PRIME — KSh 149/month</p>
<a class="btn" href="/upgrade?id=${u.id}&plan=pro">Try PRO</a>
<a class="btn" href="/upgrade?id=${u.id}&plan=prime">Try PRIME</a></div>

<div class="card"><h2>🎨 Wallpaper & Theme</h2>
<form method="POST" action="/theme"><input type="hidden" name="id" value="${u.id}">
<select name="theme"><option value="green" ${theme=="green"?"selected":""}>JR PHEEF Green</option>
<option value="blue" ${theme=="blue"?"selected":""}>Ocean Blue</option>
<option value="purple" ${theme=="purple"?"selected":""}>Royal Purple</option>
<option value="gold" ${theme=="gold"?"selected":""}>Gold</option>
<option value="black" ${theme=="black"?"selected":""}>Black</option></select>
<button>Save theme</button></form></div>

<div class="card"><a class="btn" href="/">Sign out</a></div>
</main>`,theme));
});

/* PROFILE */

app.get("/profile",async(req,res)=>{
 const u=await member(req.query.id);if(!u)return res.redirect("/");
 res.send(layout("Profile",`<header><h1>👤 Edit Profile</h1></header><main><div class="card">
<form method="POST" action="/profile" enctype="multipart/form-data">
<input type="hidden" name="id" value="${u.id}">
${u.profile_photo?`<img class="avatar" src="${esc(u.profile_photo)}"><br>`:""}
<label>Profile photo — choose directly from gallery</label>
<input type="file" name="photo" accept="image/*">
<input name="name" value="${esc(u.full_name)}" placeholder="Full name">
<textarea name="bio" placeholder="Bio">${esc(u.bio||"")}</textarea>
<input name="location" value="${esc(u.location||"")}" placeholder="City / location">
<input name="country" value="${esc(u.country||"Kenya")}" placeholder="Country">
<label><input type="checkbox" name="public_profile" ${u.public_profile!==false?"checked":""}> Show profile publicly</label>
<label><input type="checkbox" name="public_phone" ${u.public_phone?"checked":""}> Show phone publicly</label>
<button>Save profile</button></form></div></main>`));
});

app.post("/profile",upload.single("photo"),async(req,res)=>{
 const u=await member(req.body.id);if(!u)return res.redirect("/");
 const data={
  full_name:clean(req.body.name),bio:clean(req.body.bio),location:clean(req.body.location),
  country:clean(req.body.country),public_profile:!!req.body.public_profile,public_phone:!!req.body.public_phone
 };
 if(req.file&&sb){
  const path=`${u.id}/${Date.now()}.${req.file.originalname.split(".").pop()||"jpg"}`;
  const x=await sb.storage.from("profiles").upload(path,req.file.buffer,{contentType:req.file.mimetype,upsert:true});
  if(!x.error)data.profile_photo=sb.storage.from("profiles").getPublicUrl(path).data.publicUrl;
 }
 await save("members",data,u.id);
 res.redirect("/home?id="+u.id);
});

app.post("/theme",async(req,res)=>{
 await save("members",{theme:req.body.theme},req.body.id);
 res.redirect("/home?id="+req.body.id);
});

/* FIND */

app.get("/find",async(req,res)=>{
 const u=await member(req.query.id);if(!u)return res.redirect("/");
 const {data:ls}=await sb.from("listings").select("*").eq("status","active").limit(30);
 const {data:people}=await sb.from("members").select("*").eq("status","active").neq("id",u.id).limit(20);
 res.send(layout("Find",`<header><h1>🔎 Find</h1></header><main>
<div class="card"><h2>People & Connections</h2>${(people||[]).map(p=>`
<div class="card"><b>${esc(p.full_name)}</b><p>${esc(p.bio||"JR PHEEF member")}</p>
<p>${esc(p.location||"Location not shared")}</p><a class="btn" href="/chat?id=${u.id}&to=${p.id}">Connect</a></div>`).join("")}</div>
<div class="card"><h2>Marketplace</h2>${(ls||[]).map(x=>`
<div class="card"><b>${esc(x.title)}</b><p>${esc(x.description||"")}</p><p>KSh ${esc(x.price||"")}</p><p>${esc(x.location||"")}</p></div>`).join("")||"<p>No listings yet.</p>"}</div>
</main>`));
});

/* LISTING */

app.get("/listing",async(req,res)=>{
 const u=await member(req.query.id);if(!u)return res.redirect("/");
 res.send(layout("Create Listing",`<header><h1>🏪 Create</h1></header><main><div class="card">
<form method="POST" action="/listing"><input type="hidden" name="member_id" value="${u.id}">
<input name="title" placeholder="What are you offering?" required>
<textarea name="description" placeholder="Description"></textarea>
<input name="price" type="number" placeholder="Price">
<input name="location" placeholder="Location">
<select name="category"><option>Product</option><option>Service</option><option>Business</option><option>Job</option><option>Property</option><option>Investment</option><option>Event</option></select>
<button>Create free listing</button></form></div></main>`));
});

app.post("/listing",async(req,res)=>{
 await sb.from("listings").insert({...req.body,status:"active"});
 res.redirect("/home?id="+req.body.member_id);
});

/* ROTATING MATCHES */

app.get("/matches",async(req,res)=>{
 const u=await member(req.query.id);if(!u)return res.redirect("/");
 const {data}=await sb.from("members").select("*").eq("status","active").eq("public_profile",true).neq("id",u.id).limit(50);
 let people=(data||[]).sort(()=>Math.random()-.5).slice(0,8);
 res.send(layout("Matches",`<header><h1>🤝 Your Matches</h1><p>JR PHEEF gives different people opportunities to connect.</p></header><main>
${people.map(p=>`<div class="card"><b>${esc(p.full_name)}</b><p>${esc(p.bio||"Open to connections")}</p><p>📍 ${esc(p.location||"Around you / international")}</p><a class="btn" href="/chat?id=${u.id}&to=${p.id}">Connect</a></div>`).join("")}</main>`));
});

/* CHAT */

app.get("/chat",async(req,res)=>{
 const u=await member(req.query.id),to=await member(req.query.to);if(!u||!to)return res.redirect("/");
 const {data}=await sb.from("messages").select("*").or(`and(sender_id.eq.${u.id},receiver_id.eq.${to.id}),and(sender_id.eq.${to.id},receiver_id.eq.${u.id})`).order("created_at");
 res.send(layout("Connection",`<header><h1>💬 ${esc(to.full_name)}</h1><p>Talk naturally. JR PHEEF protects contact information.</p></header><main>
<div class="card">${(data||[]).map(m=>`<p><b>${m.sender_id==u.id?"You":esc(to.full_name)}:</b> ${esc(m.body)}</p>`).join("")||"<p>Start the conversation.</p>"}</div>
<div class="card"><form method="POST" action="/chat">
<input type="hidden" name="sender_id" value="${u.id}"><input type="hidden" name="receiver_id" value="${to.id}">
<textarea name="body" placeholder="Write a message..." required></textarea><button>Send</button></form></div></main>`));
});

app.post("/chat",async(req,res)=>{
 const body=clean(req.body.body);
 if(block.test(body))return res.status(400).send("JR PHEEF blocked this message because it appears to contain contact details, links or an attempt to move a transaction outside JR PHEEF.");
 await sb.from("messages").insert({sender_id:req.body.sender_id,receiver_id:req.body.receiver_id,body});
 res.redirect(`/chat?id=${req.body.sender_id}&to=${req.body.receiver_id}`);
});

/* LOVE / FRIENDSHIP */

app.get("/love",async(req,res)=>{
 const u=await member(req.query.id);if(!u)return res.redirect("/");
 const {data}=await sb.from("members").select("*").eq("status","active").eq("public_profile",true).neq("id",u.id).limit(30);
 res.send(layout("Love & Friendship",`<header><h1>💞 Love & Friendship</h1><p>Genuine connections inside JR PHEEF.</p></header><main>
${(data||[]).sort(()=>Math.random()-.5).slice(0,10).map(p=>`<div class="card"><b>${esc(p.full_name)}</b><p>${esc(p.bio||"Looking for meaningful connections.")}</p><p>📍 ${esc(p.location||"")}</p><a class="btn" href="/chat?id=${u.id}&to=${p.id}">Connect</a></div>`).join("")}</main>`));
});

/* DEAL ROOMS */

app.get("/deals",async(req,res)=>{
 const u=await member(req.query.id);if(!u)return res.redirect("/");
 res.send(layout("Deal Room",`<header><h1>🤝 Deal Room</h1></header><main><div class="card">
<p>Keep business discussions and agreements inside JR PHEEF.</p>
<p>Current ${u.plan?.toUpperCase()||"FREE"} match fee: KSh ${plans[u.plan||"free"].match}</p>
<form method="POST" action="/deal"><input type="hidden" name="member_id" value="${u.id}">
<input name="other" placeholder="Matched member ID"><input name="amount" type="number" placeholder="Transaction amount"><button>Create Deal Room</button></form>
</div></main>`));
});

app.post("/deal",async(req,res)=>{
 const fee=plans[(await member(req.body.member_id)).plan||"free"].match;
 const {data,error}=await sb.from("deal_rooms").insert({member_a:req.body.member_id,member_b:req.body.other,amount:req.body.amount||0,match_fee:fee,status:"open"}).select().single();
 if(error)return res.status(400).send(error.message);
 res.send(layout("Deal Room",`<header><h1>🤝 Deal Room Created</h1></header><main><div class="card"><h2>${esc(data.id)}</h2><p>Status: OPEN</p><p>Match fee: KSh ${fee}</p><p>Payments are currently TEST MODE.</p></div></main>`));
});

/* DELIVERY / RIDERS */

app.get("/delivery",async(req,res)=>{
 const u=await member(req.query.id);if(!u)return res.redirect("/");
 res.send(layout("Delivery",`<header><h1>🚚 Delivery</h1></header><main>
<div class="card"><h2>Request delivery</h2><form method="POST" action="/delivery">
<input type="hidden" name="member_id" value="${u.id}">
<input name="pickup" placeholder="Pickup location" required><input name="destination" placeholder="Destination" required>
<input name="item" placeholder="What needs moving?"><button>Find rider</button></form></div>
<div class="card"><h2>Become an approved JR PHEEF rider</h2><form method="POST" action="/rider">
<input type="hidden" name="member_id" value="${u.id}">
<input name="company" placeholder="Company / transport company"><input name="vehicle" placeholder="Vehicle type">
<input name="area" placeholder="Operating area"><button>Register as rider</button></form></div></main>`));
});

app.post("/delivery",async(req,res)=>{
 const {data}=await sb.from("riders").select("*").eq("status","approved").limit(30);
 res.send(layout("Rider Matching",`<header><h1>🚚 Rider Matching</h1></header><main>
<div class="card"><p>Request received. Approved riders are notified through JR PHEEF.</p></div>
${(data||[]).map(r=>`<div class="card"><b>Approved rider</b><p>${esc(r.company||"Independent rider")}</p><p>${esc(r.area||"")}</p></div>`).join("")}</main>`));
});

app.post("/rider",async(req,res)=>{
 await sb.from("riders").insert({...req.body,status:"pending"});
 res.send(layout("Rider Registration",`<header><h1>🚚 Registration received</h1></header><main><div class="card"><p>Your rider application is pending approval.</p><p>Once approved, JR PHEEF can send you delivery match requests.</p></div></main>`));
});

/* ORGANIZATIONS */

app.get("/organization",async(req,res)=>{
 const u=await member(req.query.id);if(!u)return res.redirect("/");
 res.send(layout("Organization",`<header><h1>🏢 Organization</h1></header><main><div class="card">
<h2>Register business / institution / organization</h2>
<form method="POST" action="/organization">
<input type="hidden" name="member_id" value="${u.id}">
<input name="name" placeholder="Organization name" required>
<input name="registration_no" placeholder="Official registration number">
<input name="phone" placeholder="Organization phone">
<input name="location" placeholder="Location"><textarea name="description" placeholder="What does the organization do?"></textarea>
<button>Register organization</button></form></div></main>`));
});

app.post("/organization",async(req,res)=>{
 await sb.from("organizations").insert({...req.body,status:"pending"});
 res.send(layout("Organization",`<header><h1>🏢 Submitted</h1></header><main><div class="card"><p>Organization registration submitted for approval.</p></div></main>`));
});

/* WALLET / UPGRADE */

app.get("/wallet",async(req,res)=>{
 const u=await member(req.query.id);if(!u)return res.redirect("/");
 res.send(layout("Wallet",`<header><h1>🎁 JR PHEEF Wallet</h1></header><main><div class="card">
<h2>Rewards</h2><p>KSh ${u.rewards||0}</p><h2>JR PHEEF Credits</h2><p>KSh ${u.credits||0}</p>
<p>Minimum individual withdrawal: KSh 200</p><p class="muted">Real M-Pesa transfers activate after payment integration.</p></div></main>`));
});

app.get("/upgrade",async(req,res)=>{
 const u=await member(req.query.id),p=plans[req.query.plan];if(!u||!p)return res.status(400).send("Invalid upgrade.");
 await save("members",{plan:req.query.plan},u.id);
 res.redirect("/home?id="+u.id);
});

/* WHATSAPP — NATURAL, NOT COMMAND DEPENDENT */

app.post("/api/webhook/whatsapp",async(req,res)=>{
 const from=req.body.From||"",msg=clean(req.body.Body),u=await phoneMember(from);
 let reply;
 if(!u)reply=`👋 Karibu JR PHEEF!\n\nCreate your account here:\n${BASE}/register`;
 else reply=`👋 ${u.full_name}, karibu JR PHEEF.\n\nYou can use JR PHEEF naturally for people, opportunities, marketplace, connections, delivery and business.\n\nYour home:\n${BASE}/home?id=${u.id}`;
 const x=new twilio.twiml.MessagingResponse();x.message(reply);res.type("text/xml").send(x.toString());
});

/* OWNER COMMAND CENTER */

app.get("/owner",async(req,res)=>{
 if(!process.env.OWNER_KEY||req.query.key!==process.env.OWNER_KEY)return res.status(403).send("🔒 Owner access denied.");
 const [m,l,r,o]=await Promise.all([
  sb.from("members").select("*").order("created_at",{ascending:false}).limit(100),
  sb.from("listings").select("*").limit(100),
  sb.from("riders").select("*").limit(100),
  sb.from("organizations").select("*").limit(100)
 ]);
 res.send(layout("JR PHEEF Command Center",`<header><h1>👑 JR PHEEF</h1><p>COMMAND CENTER</p></header><main>
<div class="grid"><div class="card"><h2>👥 Members</h2><b>${m.data?.length||0}</b></div>
<div class="card"><h2>🏪 Listings</h2><b>${l.data?.length||0}</b></div>
<div class="card"><h2>🚚 Riders</h2><b>${r.data?.length||0}</b></div>
<div class="card"><h2>🏢 Organizations</h2><b>${o.data?.length||0}</b></div></div>

<div class="card"><h2>👥 Member control</h2>
${(m.data||[]).map(x=>`<p><b>${esc(x.full_name)}</b> — ${esc(x.dgbo_id)} — ${esc(x.status)}
<form method="POST" action="/owner/member"><input type="hidden" name="id" value="${x.id}">
<select name="status"><option>active</option><option>approved</option><option>suspended</option><option>pending</option></select>
<select name="plan"><option value="free">FREE</option><option value="pro">PRO</option><option value="prime">PRIME</option></select>
<button>Update</button></form></p>`).join("")}</div>

<div class="card"><h2>🚚 Rider approvals</h2>
${(r.data||[]).map(x=>`<p>${esc(x.company||"Rider")} — ${esc(x.status)}
<form method="POST" action="/owner/rider"><input type="hidden" name="id" value="${x.id}">
<button name="status" value="approved">Approve</button><button class="danger" name="status" value="rejected">Reject</button></form></p>`).join("")}</div>

<div class="card"><h2>🏢 Organization approvals</h2>
${(o.data||[]).map(x=>`<p>${esc(x.name)} — ${esc(x.registration_no||"No registration number")} — ${esc(x.status)}
<form method="POST" action="/owner/org"><input type="hidden" name="id" value="${x.id}">
<button name="status" value="approved">Approve</button><button class="danger" name="status" value="rejected">Reject</button></form></p>`).join("")}</div>
</main>`));
});

app.post("/owner/member",async(req,res)=>{
 if(req.body.key!==process.env.OWNER_KEY&&req.headers.referer?.includes("/owner")===false)return res.status(403).send("Denied");
 await save("members",{status:req.body.status,plan:req.body.plan},req.body.id);
 res.redirect("back");
});
app.post("/owner/rider",async(req,res)=>{await save("riders",{status:req.body.status},req.body.id);res.redirect("back")});
app.post("/owner/org",async(req,res)=>{await save("organizations",{status:req.body.status},req.body.id);res.redirect("back")});

/* HEALTH */

app.get("/health",(req,res)=>res.json({
 ok:true,service:"JR PHEEF",supabase:!!sb,accounts:true,
 marketplace:true,matches:true,connections:true,love_friendship:true,
 delivery:true,organizations:true,owner:true,payments:"TEST MODE"
}));

app.listen(PORT,()=>{
 console.log(`🚀 JR PHEEF running on ${PORT}`);
 console.log(`🗄️ Supabase: ${sb?"CONNECTED":"NOT CONNECTED"}`);
 console.log("👤 Registration/Login: ACTIVE");
 console.log("🏠 Unified Home: ACTIVE");
 console.log("👤 Profiles/Photos/Privacy: ACTIVE");
 console.log("🏪 Free Listings: ACTIVE");
 console.log("🔎 Discovery/Rotating Matches: ACTIVE");
 console.log("💬 Natural Connections: ACTIVE");
 console.log("🛡️ Contact Protection: ACTIVE");
 console.log("💞 Love & Friendship: ACTIVE");
 console.log("🚚 Rider Matching: ACTIVE");
 console.log("🏢 Organizations: ACTIVE");
 console.log("🤝 Deal Rooms: ACTIVE");
 console.log("🎁 Wallet: ACTIVE");
 console.log("👑 Owner Center: ACTIVE");
 console.log("📱 WhatsApp: ACTIVE");
 console.log("💳 Payments: TEST MODE");
});
