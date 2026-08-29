const express=require("express");
const {createClient}=require("@supabase/supabase-js");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const multer=require("multer");
const twilio=require("twilio");

const app=express();
app.use(express.urlencoded({extended:true}));
app.use(express.json());

const PORT=process.env.PORT||10000;
const BASE="https://jr-pheef-marketplace.onrender.com";
const JWT_SECRET=process.env.JWT_SECRET||"CHANGE_THIS_IN_RENDER";
const BUCKET="jr-pheef-profiles";

const sbKey=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_ANON_KEY;
const supabase=process.env.SUPABASE_URL&&sbKey
 ?createClient(process.env.SUPABASE_URL,sbKey):null;

const upload=multer({
 storage:multer.memoryStorage(),
 limits:{fileSize:5*1024*1024}
});

const plans={
 free:{price:0,match:30},
 pro:{price:99,match:20},
 prime:{price:149,match:20}
};

const blocked=/(https?:\/\/|www\.|@[a-z0-9.-]+\.[a-z]{2,}|(?:\+?254|0)?7\d{8}|(?:\+?254|0)?1\d{8}|whatsapp|telegram|t\.me|instagram|facebook|email|e-mail|send\s+(me\s+)?your\s+(number|contact)|call\s+me)/i;

function clean(s=""){
 return String(s).replace(/[<>]/g,"").trim().slice(0,3000);
}

function token(u){
 return jwt.sign({id:u.id},JWT_SECRET,{expiresIn:"30d"});
}

async function auth(req,res,next){
 try{
  const t=(req.headers.authorization||"").replace("Bearer ","")||req.cookies?.jr;
  if(!t) return res.status(401).send("Please sign in.");
  const x=jwt.verify(t,JWT_SECRET);
  const {data}=await supabase.from("jr_profiles").select("*").eq("id",x.id).single();
  if(!data)return res.status(401).send("Account not found.");
  req.user=data;next();
 }catch(e){res.status(401).send("Please sign in again.");}
}

function html(title,body){
 return `<!doctype html><html><head>
 <meta name="viewport" content="width=device-width,initial-scale=1">
 <title>${title}</title>
 <style>
 :root{--c:#08783c;--bg:#f3f8f5;--card:#fff;--txt:#111}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);
 font-family:Arial,sans-serif}header{background:#063d20;color:white;padding:24px}
 main{max-width:850px;margin:auto;padding:15px}.card{background:var(--card);
 margin:14px 0;padding:20px;border-radius:18px;box-shadow:0 2px 10px #0001}
 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
 button,.btn{background:var(--c);color:#fff;border:0;border-radius:10px;
 padding:12px 17px;text-decoration:none;display:inline-block;margin:4px;cursor:pointer}
 input,textarea,select{width:100%;padding:12px;margin:6px 0;border:1px solid #ccc;
 border-radius:10px;background:white}img.avatar{width:110px;height:110px;
 border-radius:50%;object-fit:cover}.small{font-size:13px;opacity:.7}
 .tag{display:inline-block;padding:6px 10px;background:#e8f5ed;border-radius:20px;margin:3px}
 </style></head><body>${body}</body></html>`;
}

function page(req,res,title,body){res.send(html(title,body));}

/* LANDING + LOGIN */

app.get("/",(req,res)=>page(req,res,"JR PHEEF",`
<header><h1>JR PHEEF</h1><p>Find. Match. Connect.</p></header>
<main>
<div class="card"><h2>Welcome 👋</h2>
<p>Discover people, businesses, products, services and opportunities.</p>
<form method="POST" action="/signup">
<input name="name" placeholder="Full name" required>
<input name="phone" placeholder="Phone number" required>
<input name="password" type="password" placeholder="Create password" required>
<select name="type"><option value="person">Personal account</option>
<option value="organization">Company / Institution / Organization</option></select>
<button>Create account</button></form></div>

<div class="card"><h3>Already a member?</h3>
<form method="POST" action="/login">
<input name="phone" placeholder="Phone number" required>
<input name="password" type="password" placeholder="Password" required>
<button>Sign in</button></form></div>
</main>`));

app.post("/signup",async(req,res)=>{
 try{
  const name=clean(req.body.name),phone=clean(req.body.phone);
  const password=String(req.body.password||"");
  if(password.length<6)return res.status(400).send("Password must be at least 6 characters.");

  const {data:old}=await supabase.from("jr_profiles").select("id").eq("phone",phone).maybeSingle();
  if(old)return res.status(409).send("This phone already has a JR PHEEF account.");

  const hash=await bcrypt.hash(password,10);
  const {data:u,error}=await supabase.from("jr_profiles").insert({
   full_name:name,phone,password_hash:hash,account_type:req.body.type||"person",
   bio:"",photo_url:null,public_bio:true,public_phone:false,
   country:"Kenya",location:"",lat:null,lng:null,
   plan:"free",reputation:0,verified:false,status:"active"
  }).select("*").single();

  if(error)throw error;
  res.redirect(`/welcome?id=${u.id}`);
 }catch(e){console.error(e);res.status(500).send("Could not create account.");}
});

app.get("/welcome",(req,res)=>page(req,res,"Welcome to JR PHEEF",`
<header><h1>JR PHEEF</h1><p>Your account is ready 🎉</p></header>
<main><div class="card">
<h2>Welcome to real connections.</h2>
<p>Find. Match. Connect.</p>
<a class="btn" href="/">Continue to sign in</a>
</div></main>`));

app.post("/login",async(req,res)=>{
 try{
  const {data:u}=await supabase.from("jr_profiles").select("*").eq("phone",clean(req.body.phone)).maybeSingle();
  if(!u||!(await bcrypt.compare(String(req.body.password||""),u.password_hash)))
   return res.status(401).send("Incorrect phone or password.");

  res.send(`<script>
  localStorage.setItem("jr_token","${token(u)}");
  location.href="/app";
  </script>`);
 }catch(e){res.status(500).send("Login failed.");}
});

/* HOME */

app.get("/app",auth,(req,res)=>page(req,res,"JR PHEEF",`
<header><h1>JR PHEEF</h1><p>Welcome, ${clean(req.user.full_name)} 👋</p>
<span class="tag">${req.user.plan.toUpperCase()}</span></header>
<main>
<div class="grid">
${[
["🔎","Find","Discover people, products, services & opportunities","/find"],
["🤝","Connections","People and opportunities matched for you","/connections"],
["💬","Conversations","Chat naturally and safely","/chat"],
["🛒","Sell","Create free listings","/listing"],
["❤️","People","Discover compatible connections","/people"],
["🚚","Delivery","Request or provide delivery","/delivery"],
["🏢","My Organization","Manage company or institution","/organization"],
["🎁","Wallet & Rewards","Rewards, referrals & credits","/wallet"],
["⚙️","My Profile","Photo, bio and privacy controls","/profile"]
].map(x=>`<div class="card"><h2>${x[0]} ${x[1]}</h2><p>${x[2]}</p>
<a class="btn" href="${x[3]}">Open</a></div>`).join("")}
</div>
<div class="card"><h2>⭐ Membership</h2>
<p>FREE — first month free</p><p>PRO — KSh 99/month</p>
<p>PRIME — KSh 149/month</p></div>
<button onclick="localStorage.removeItem('jr_token');location.href='/'">Sign out</button>
<script>
const t=localStorage.getItem("jr_token");
if(!t)location.href="/";
document.querySelectorAll("a").forEach(a=>{
 if(a.href.includes("/app"))return;
 const old=a.href;a.href=old+"?token="+encodeURIComponent(t);
});
</script>
</main>`));

/* PROFILE */

app.get("/profile",auth,(req,res)=>page(req,res,"My Profile",`
<header><h1>👤 My Profile</h1></header><main>
<div class="card" style="text-align:center">
${req.user.photo_url?`<img class="avatar" src="${req.user.photo_url}">`:"<div class='avatar' style='margin:auto;background:#ddd'></div>"}
<form method="POST" action="/profile/photo" enctype="multipart/form-data">
<input type="file" name="photo" accept="image/*" required>
<button>📸 Choose profile photo</button></form></div>

<div class="card"><h2>✏️ Edit my information</h2>
<form method="POST" action="/profile">
<input name="name" value="${clean(req.user.full_name)}" placeholder="Name">
<textarea name="bio" placeholder="Your bio">${clean(req.user.bio)}</textarea>
<input name="country" value="${clean(req.user.country)}" placeholder="Country">
<input name="location" value="${clean(req.user.location)}" placeholder="City / area">
<label><input type="checkbox" name="public_bio" ${req.user.public_bio?"checked":""}> Show bio publicly</label>
<label><input type="checkbox" name="public_phone" ${req.user.public_phone?"checked":""}> Show phone publicly</label>
<button>Save profile</button></form></div>
</main>`));

app.post("/profile",auth,async(req,res)=>{
 await supabase.from("jr_profiles").update({
  full_name:clean(req.body.name),bio:clean(req.body.bio),
  country:clean(req.body.country),location:clean(req.body.location),
  public_bio:req.body.public_bio==="on",public_phone:req.body.public_phone==="on"
 }).eq("id",req.user.id);
 res.redirect("/profile");
});

app.post("/profile/photo",auth,upload.single("photo"),async(req,res)=>{
 if(!req.file)return res.status(400).send("No photo selected.");
 const path=`${req.user.id}-${Date.now()}.${req.file.mimetype.split("/")[1]}`;
 const {error}=await supabase.storage.from(BUCKET).upload(path,req.file.buffer,{
  contentType:req.file.mimetype,upsert:true
 });
 if(error)return res.status(500).send("Photo upload failed.");
 const {data}=supabase.storage.from(BUCKET).getPublicUrl(path);
 await supabase.from("jr_profiles").update({photo_url:data.publicUrl}).eq("id",req.user.id);
 res.redirect("/profile");
});

/* FIND */

app.get("/find",auth,(req,res)=>page(req,res,"Find",`
<header><h1>🔎 Find</h1><p>Tell JR PHEEF what you need.</p></header>
<main><div class="card">
<form method="GET" action="/find/results">
<input name="q" placeholder="Product, service, person or opportunity">
<input name="location" placeholder="Location (optional)">
<button>Find matches</button></form></div></main>`));

app.get("/find/results",auth,async(req,res)=>{
 const q=clean(req.query.q),loc=clean(req.query.location);
 let query=supabase.from("jr_profiles").select("id,full_name,bio,photo_url,country,location,reputation,verified")
 .eq("status","active").neq("id",req.user.id).limit(30);
 if(loc)query=query.ilike("location",`%${loc}%`);
 const {data=[]}=await query;
 const results=data.filter(x=>(x.full_name+" "+x.bio+" "+x.location+" "+x.country).toLowerCase().includes(q.toLowerCase()));
 page(req,res,"JR PHEEF Matches",`<header><h1>🤝 Matches</h1></header><main>
 ${results.map(x=>`<div class="card">
 ${x.photo_url?`<img class="avatar" src="${x.photo_url}">`:""}
 <h2>${clean(x.full_name)} ${x.verified?"✓":""}</h2>
 <p>${clean(x.bio)}</p><p>📍 ${clean(x.location)}, ${clean(x.country)}</p>
 <a class="btn" href="/connect/${x.id}">Connect</a></div>`).join("")||"<div class='card'>No match yet. Try another search.</div>"}
 </main>`);
});

/* FAIR MATCHING */

app.get("/connections",auth,async(req,res)=>{
 const {data:seen=[]}=await supabase.from("jr_match_history").select("other_id")
 .eq("user_id",req.user.id).order("last_seen",{ascending:false}).limit(100);
 const ids=seen.map(x=>x.other_id);

 let {data}=await supabase.from("jr_profiles")
 .select("id,full_name,bio,photo_url,country,location,reputation,verified")
 .eq("status","active").neq("id",req.user.id).limit(50);

 data=(data||[]).sort((a,b)=>{
  const ai=ids.indexOf(a.id),bi=ids.indexOf(b.id);
  return (ai<0?-1:ai)-(bi<0?-1:bi);
 }).slice(0,10);

 page(req,res,"Connections",`<header><h1>🤝 Your Connections</h1>
 <p>JR PHEEF keeps rotating opportunities so everyone gets a chance.</p></header><main>
 ${data.map(x=>`<div class="card">${x.photo_url?`<img class="avatar" src="${x.photo_url}">`:""}
 <h2>${clean(x.full_name)}</h2><p>${clean(x.bio)}</p>
 <p>📍 ${clean(x.location)}, ${clean(x.country)}</p>
 <a class="btn" href="/connect/${x.id}">Connect</a></div>`).join("")}
 </main>`);
});

app.get("/connect/:id",auth,async(req,res)=>{
 const other=req.params.id;
 if(other===req.user.id)return res.send("You cannot connect with yourself.");

 await supabase.from("jr_match_history").upsert({
  user_id:req.user.id,other_id:other,last_seen:new Date().toISOString()
 },{onConflict:"user_id,other_id"});

 await supabase.from("jr_connections").upsert({
  user_id:req.user.id,other_id:other,status:"requested"
 },{onConflict:"user_id,other_id"});

 res.redirect(`/chat?with=${encodeURIComponent(other)}`);
});

/* SAFE CHAT */

app.get("/chat",auth,(req,res)=>page(req,res, "Conversations",`
<header><h1>💬 Conversations</h1>
<p>Talk naturally. JR PHEEF protects your contact information.</p></header>
<main><div class="card">
<form method="POST" action="/chat/send">
<input type="hidden" name="to" value="${clean(req.query.with||"")}">
<textarea name="message" placeholder="Write your message..." required></textarea>
<button>Send</button></form>
<p class="small">Phone numbers, emails, links and direct contact details are protected.</p>
</div></main>`));

app.post("/chat/send",auth,async(req,res)=>{
 const message=clean(req.body.message),to=clean(req.body.to);
 if(!to)return res.status(400).send("Choose a connection first.");
 if(blocked.test(message))
  return res.status(400).send("🛡️ JR PHEEF blocked that message because it contains contact information or an external contact route. Keep the conversation inside JR PHEEF.");

 await supabase.from("jr_messages").insert({
  sender_id:req.user.id,receiver_id:to,message
 });
 res.redirect(`/chat?with=${encodeURIComponent(to)}`);
});

/* FREE LISTING */

app.get("/listing",auth,(req,res)=>page(req,res,"Create Listing",`
<header><h1>🛒 Free Listing</h1></header><main><div class="card">
<form method="POST" action="/listing">
<input name="title" placeholder="What are you offering?" required>
<input name="price" type="number" placeholder="Price">
<input name="location" placeholder="Location">
<textarea name="description" placeholder="Describe it"></textarea>
<button>Publish free listing</button></form></div></main>`));

app.post("/listing",auth,async(req,res)=>{
 await supabase.from("jr_listings").insert({
  owner_id:req.user.id,title:clean(req.body.title),
  price:Number(req.body.price||0),location:clean(req.body.location),
  description:clean(req.body.description),status:"active"
 });
 res.redirect("/app");
});

/* DELIVERY / RIDERS */

app.get("/delivery",auth,async(req,res)=>{
 const {data:riders=[]}=await supabase.from("jr_riders")
 .select("id,name,vehicle,location,online,approved")
 .eq("approved",true).order("online",{ascending:false}).limit(20);

 page(req,res,"JR PHEEF Delivery",`<header><h1>🚚 Delivery</h1>
 <p>Registered and approved riders can receive delivery opportunities.</p></header>
 <main><div class="card"><form method="POST" action="/delivery">
 <input name="pickup" placeholder="Pickup location" required>
 <input name="destination" placeholder="Destination" required>
 <input name="details" placeholder="What needs moving?" required>
 <button>Request delivery</button></form></div>
 <div class="card"><h2>Available riders</h2>
 ${riders.map(r=>`<p>🚚 <b>${clean(r.name)}</b> — ${clean(r.vehicle)}
 ${r.online?"🟢 Online":"⚪ Offline"} — ${clean(r.location)}</p>`).join("")||"No approved riders listed yet."}
 </div></main>`);
});

app.post("/delivery",auth,async(req,res)=>{
 await supabase.from("jr_delivery_requests").insert({
  requester_id:req.user.id,pickup:clean(req.body.pickup),
  destination:clean(req.body.destination),details:clean(req.body.details),
  status:"open"
 });
 res.redirect("/delivery");
});

/* ORGANIZATION */

app.get("/organization",auth,async(req,res)=>{
 const {data:org}=await supabase.from("jr_organizations").select("*")
 .eq("owner_id",req.user.id).maybeSingle();

 page(req,res,"Organization",`<header><h1>🏢 Organization Operations</h1>
 <p>Companies, institutions and organizations can operate inside JR PHEEF.</p></header>
 <main><div class="card"><form method="POST" action="/organization">
 <input name="name" value="${org?clean(org.name):""}" placeholder="Organization name" required>
 <input name="category" value="${org?clean(org.category):""}" placeholder="Business / institution category">
 <textarea name="description" placeholder="About the organization">${org?clean(org.description):""}</textarea>
 <button>Save organization</button></form></div>
 <div class="card"><h2>Operations</h2>
 <p>👥 People & staff</p><p>🛒 Listings</p><p>🤝 Opportunities</p>
 <p>🚚 Rider/delivery network</p><p>📊 Activity</p><p>💳 Payments</p></div></main>`);
});

app.post("/organization",auth,async(req,res)=>{
 await supabase.from("jr_organizations").upsert({
  owner_id:req.user.id,name:clean(req.body.name),
  category:clean(req.body.category),description:clean(req.body.description)
 },{onConflict:"owner_id"});
 res.redirect("/organization");
});

/* WALLET */

app.get("/wallet",auth,(req,res)=>page(req,res,"Wallet",`
<header><h1>🎁 JR PHEEF Wallet</h1></header><main><div class="card">
<h2>Rewards & Credits</h2><p>Rewards: KSh ${req.user.rewards||0}</p>
<p>JR PHEEF Credits: ${req.user.credits||0}</p>
<p>Referrals: ${req.user.referrals||0}</p>
<p>Listings: FREE</p><p>🚚 Rider matching: FREE for users</p>
</div></main>`));

/* PEOPLE */

app.get("/people",auth,async(req,res)=>{
 const {data=[]}=await supabase.from("jr_profiles")
 .select("id,full_name,bio,photo_url,country,location,verified")
 .eq("status","active").neq("id",req.user.id).limit(20);

 page(req,res,"People",`<header><h1>❤️ People & Connections</h1>
 <p>Friendship, conversation, networking and meaningful connections.</p></header>
 <main>${data.map(x=>`<div class="card">
 ${x.photo_url?`<img class="avatar" src="${x.photo_url}">`:""}
 <h2>${clean(x.full_name)} ${x.verified?"✓":""}</h2>
 <p>${clean(x.bio)}</p><p>📍 ${clean(x.location)}, ${clean(x.country)}</p>
 <a class="btn" href="/connect/${x.id}">Connect</a></div>`).join("")}</main>`);
});

/* HEALTH */

app.get("/health",(req,res)=>res.json({
 ok:true,service:"JR PHEEF",
 supabase:!!supabase,
 marketplace:"active",
 connections:"active",
 safe_chat:"active",
 riders:"active",
 organizations:"active",
 payments:"test"
}));

/* WHATSAPP — NATURAL LANGUAGE, NOT COMMANDS */

app.post("/api/webhook/whatsapp",async(req,res)=>{
 const from=req.body.From||"",msg=clean(req.body.Body||"");

 let reply=`👋 Karibu JR PHEEF!

I'm here to help you find people, products, services and opportunities.

You can simply tell me what you're looking for or what you're offering.

Your JR PHEEF home:
${BASE}`;

 if(supabase){
  const {data:u}=await supabase.from("jr_profiles").select("*").eq("phone",from).maybeSingle();

  if(u){
   if(blocked.test(msg))
    reply=`🛡️ JR PHEEF protects members from exchanging phone numbers, emails, links or outside contact details.

Let's keep the conversation safely inside JR PHEEF.`;

   else{
    const low=msg.toLowerCase();
    if(/looking for|need|want|searching|find/i.test(low))
     reply=`🔎 Nimekupata ${u.full_name}!

Tell me what you're looking for, your budget if relevant, and your location.

JR PHEEF will look for suitable opportunities.`;
    else if(/sell|selling|offer|available/i.test(low))
     reply=`🛒 Sawa ${u.full_name}!

Tell me what you're offering, price and location.

Your listing can be published FREE on JR PHEEF.`;
    else if(/ride|delivery|deliver|transport/i.test(low))
     reply=`🚚 JR PHEEF Delivery

Tell me the pickup location, destination and what needs moving.

We'll look for approved riders and delivery opportunities.`;
    else
     reply=`💬 Nimekupata ${u.full_name}!

You can talk normally with JR PHEEF — no commands required.

Tell me what you need, what you're offering, or the type of connection you're looking for.`;
   }
  }
 }

 const tw=new twilio.twiml.MessagingResponse();
 tw.message(reply);
 res.type("text/xml").send(tw.toString());
});

/* OWNER */

app.get("/owner",async(req,res)=>{
 if(!process.env.OWNER_KEY||req.query.key!==process.env.OWNER_KEY)
  return res.status(403).send("🔒 Owner access denied.");

 const tables=["jr_profiles","jr_listings","jr_connections",
 "jr_messages","jr_delivery_requests","jr_riders","jr_organizations"];

 let stats="";
 for(const t of tables){
  const {count}=await supabase.from(t).select("*",{count:"exact",head:true});
  stats+=`<div class="card"><h3>${t}</h3><div style="font-size:28px">${count||0}</div></div>`;
 }

 page(req,res,"JR PHEEF Owner Center",`
 <header><h1>👑 JR PHEEF</h1><p>OWNER CENTER</p></header>
 <main><div class="grid">${stats}</div>
 <div class="card"><h2>Platform</h2>
 <p>👥 People & connections: ACTIVE</p>
 <p>🛒 Marketplace: ACTIVE</p>
 <p>🤝 Matching: ACTIVE</p>
 <p>💬 Safe conversation: ACTIVE</p>
 <p>🚚 Rider network: ACTIVE</p>
 <p>🏢 Organizations: ACTIVE</p>
 <p>🎁 Rewards: ACTIVE</p>
 <p>💳 Payments: TEST MODE</p>
 </div></main>`);
});

app.listen(PORT,()=>{
 console.log(`🚀 JR PHEEF running on ${PORT}`);
 console.log("👤 Accounts + secure login: ACTIVE");
 console.log("📸 Profiles: ACTIVE");
 console.log("🔎 Marketplace + opportunity search: ACTIVE");
 console.log("🤝 Fair matching: ACTIVE");
 console.log("❤️ People connections: ACTIVE");
 console.log("💬 Safe natural conversation: ACTIVE");
 console.log("🚚 Rider network: ACTIVE");
 console.log("🏢 Organization operations: ACTIVE");
 console.log("🎁 Rewards: ACTIVE");
 console.log("📱 WhatsApp: ACTIVE");
 console.log("💳 Payments: TEST MODE");
});
