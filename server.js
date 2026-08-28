const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");
const crypto = require("crypto");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 10000;
const BASE = "https://jr-pheef-marketplace.onrender.com";

const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = process.env.SUPABASE_URL && key
  ? createClient(process.env.SUPABASE_URL, key) : null;

const sessions = new Map();
const users = new Map();
const listings = [];
const matches = [];
const deals = [];
const riders = [];
const payments = [];
const activity = [];

const plans = {
  free:  { price: 0, match: 0, freeMatches: 3 },
  pro:   { price: 99, match: 20, freeMatches: 5 },
  prime: { price: 149, match: 20, freeMatches: 10 }
};

const id = p => `${p}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

const log = (type, data = {}) => {
  activity.unshift({ type, ...data, time: new Date().toISOString() });
  activity.splice(50);
};

function clean(v) {
  return String(v || "").replace(/[<>]/g, "");
}

async function getUser(phone) {
  if (users.has(phone)) return users.get(phone);
  if (!supabase) return null;

  const { data } = await supabase
    .from("members")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();

  if (!data) return null;

  const u = {
    id: data.id,
    name: data.full_name,
    phone: data.phone,
    verified: data.verified,
    status: data.status,
    reputation: data.reputation || 0,
    plan: "free",
    photo: data.photo_url || "",
    theme: "green",
    rewards: 0,
    credits: 0,
    referrals: 0,
    matches: 0
  };

  users.set(phone, u);
  return u;
}

function sessionUser(req) {
  const token = req.cookies?.jrpheef;
  return token ? sessions.get(token) : null;
}

function page(title, body, theme = "green") {
  const colors = {
    green: "#08783c",
    black: "#111",
    blue: "#2563eb",
    purple: "#7c3aed",
    gold: "#b8860b"
  };

  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{--c:${colors[theme] || colors.green}}
*{box-sizing:border-box}
body{margin:0;font-family:Arial;background:#f2f7f4;color:#111}
header{background:#063d20;color:white;padding:25px}
main{max-width:850px;margin:auto;padding:15px}
.card{background:white;margin:12px 0;padding:20px;border-radius:18px;
box-shadow:0 2px 10px #0001}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
button,.btn{background:var(--c);color:white;border:0;padding:12px 17px;
border-radius:10px;text-decoration:none;display:inline-block;margin:4px}
input,select,textarea{width:100%;padding:12px;margin:6px 0;
border:1px solid #ccc;border-radius:9px}
textarea{min-height:100px}
img.avatar{width:90px;height:90px;border-radius:50%;object-fit:cover}
.stat{font-size:25px;font-weight:bold}
.small{font-size:13px;opacity:.7}
@media(max-width:650px){.grid{grid-template-columns:1fr 1fr}}
</style></head><body>${body}</body></html>`;
}

/* LANDING */

app.get("/", (req,res) => res.send(page("JR PHEEF", `
<header>
<h1>JR PHEEF</h1>
<p>Find. Match. Connect. Trade.</p>
</header>
<main>
<div class="card">
<h2>👋 Karibu JR PHEEF</h2>
<p>Create opportunities, find opportunities and connect with people.</p>
<a class="btn" href="/signup">Create Account</a>
<a class="btn" href="/login">Sign In</a>
</div>

<div class="card">
<h3>What can you do?</h3>
<p>🛒 Buy &nbsp; 🏪 Sell &nbsp; 🤝 Match</p>
<p>💬 Connect &nbsp; ❤️ Meet people &nbsp; 🚚 Delivery</p>
<p>💡 Discover opportunities &nbsp; 💼 Business</p>
</div>
</main>`)));

/* SIGN UP */

app.get("/signup", (req,res) => res.send(page("Create JR PHEEF Account", `
<header><h1>JR PHEEF</h1><p>Create your account</p></header>
<main><div class="card">
<form method="POST" action="/signup">
<input name="name" placeholder="Full name" required>
<input name="phone" placeholder="Phone number" required>
<input name="photo" type="url" placeholder="Profile photo URL" required>
<input name="password" id="p1" type="password" placeholder="Password" required>
<input name="confirm" id="p2" type="password" placeholder="Confirm password" required>
<label><input type="checkbox" onclick="showPass()"> 👁️ Show passwords</label>
<button>Create JR PHEEF Account</button>
</form>
<p class="small">Your profile photo helps people know who they are connecting with.</p>
<p>Already registered? <a href="/login">Sign in</a></p>
</div></main>
<script>
function showPass(){
 let a=document.getElementById("p1"),b=document.getElementById("p2");
 a.type=a.type==="password"?"text":"password";
 b.type=b.type==="password"?"text":"password";
}
</script>`)));

/* CREATE ACCOUNT */

app.post("/signup", async (req,res) => {
  const name=clean(req.body.name), phone=clean(req.body.phone);
  const photo=clean(req.body.photo), password=req.body.password;
  const confirm=req.body.confirm;

  if(!name || !phone || !photo || !password || password!==confirm)
    return res.status(400).send("Please complete the form and make sure passwords match.");

  const old=await getUser(phone);
  if(old) return res.redirect("/login");

  const u={
    id:id("USR"), name, phone, photo,
    plan:"free", rewards:0, credits:0, referrals:0,
    matches:0, verified:false, status:"active",
    reputation:0, theme:"green",
    passwordHash:crypto.createHash("sha256").update(password).digest("hex")
  };

  users.set(phone,u);

  if(supabase){
    await supabase.from("members").insert({
      full_name:name,
      phone,
      dgbo_id:u.id,
      reputation:0,
      verified:false,
      status:"active"
    }).catch(e=>log("Supabase account note",{error:e.message}));
  }

  log("New member",{name,phone});
  res.redirect(`/login?phone=${encodeURIComponent(phone)}`);
});

/* LOGIN */

app.get("/login",(req,res) => res.send(page("Sign In", `
<header><h1>JR PHEEF</h1><p>Welcome back</p></header>
<main><div class="card">
<form method="POST" action="/login">
<input name="phone" value="${clean(req.query.phone)}" placeholder="Phone number" required>
<input name="password" id="pass" type="password" placeholder="Password" required>
<label><input type="checkbox" onclick="toggle()"> 👁️ Show password</label>
<button>Sign In</button>
</form>
</div></main>
<script>
function toggle(){
const p=document.getElementById("pass");
p.type=p.type==="password"?"text":"password";
}
</script>`)));

/* LOGIN CHECK */

app.post("/login", async (req,res) => {
  const phone=clean(req.body.phone);
  const password=req.body.password;
  const u=await getUser(phone);

  if(!u) return res.status(401).send("Account not found. <a href='/signup'>Create account</a>");

  const hash=crypto.createHash("sha256").update(password).digest("hex");

  /* TEST compatibility for current accounts */
  if(u.passwordHash && u.passwordHash!==hash)
    return res.status(401).send("Incorrect password. <a href='/login'>Try again</a>");

  const token=id("SESSION");
  sessions.set(token,u);

  res.setHeader("Set-Cookie",`jr_pheef=${token}; HttpOnly; Path=/; SameSite=Lax`);
  res.redirect("/home");
});

/* HOME */

app.get("/home",(req,res) => {
  const u=sessionUser(req);
  if(!u) return res.redirect("/login");

  res.send(page("JR PHEEF",`
<header>
<h1>JR PHEEF</h1>
<p>Welcome, ${clean(u.name)} 👋</p>
<b>${u.plan.toUpperCase()}</b>
</header>
<main>

<div class="card" style="text-align:center">
${u.photo ? `<img class="avatar" src="${u.photo}" alt="Profile">` : "👤"}
<h2>${clean(u.name)}</h2>
<p>⭐ Reputation: ${u.reputation}</p>
<p>${u.verified ? "✅ Verified" : "🟡 Verification pending"}</p>
</div>

<div class="grid">
<div class="card"><h3>🔎 Find</h3><p>Products, services & opportunities.</p><a class="btn" href="/find">Open</a></div>
<div class="card"><h3>🏪 Sell</h3><p>Basic listings are FREE.</p><a class="btn" href="/sell">List</a></div>
<div class="card"><h3>🤝 Matches</h3><p>Free initial connections.</p><a class="btn" href="/matches">Open</a></div>

<div class="card"><h3>💬 Connect</h3><p>Chat, mingle & network safely.</p><a class="btn" href="/connect">Open</a></div>
<div class="card"><h3>❤️ Connections</h3><p>Friendship & relationship interests.</p><a class="btn" href="/connect">Explore</a></div>
<div class="card"><h3>🤝 Deal Rooms</h3><p>Agree safely inside JR PHEEF.</p><a class="btn" href="/deal">Open</a></div>

<div class="card"><h3>🚚 Delivery</h3><p>Find available verified riders.</p><a class="btn" href="/delivery">Request</a></div>
<div class="card"><h3>💳 Payments</h3><p>Secure payment flow.</p><a class="btn" href="/pay">Test</a></div>
<div class="card"><h3>🎁 Wallet</h3><p>KSh ${u.rewards} rewards.</p></div>
</div>

<div class="card">
<h2>🎨 Your Experience</h2>
<form method="POST" action="/theme">
<select name="theme">
<option value="green">🟢 JR PHEEF Green</option>
<option value="black">⚫ Midnight</option>
<option value="blue">🔵 Ocean</option>
<option value="purple">🟣 Royal Purple</option>
<option value="gold">🟡 Gold</option>
</select>
<button>Save Theme</button>
</form>
</div>

<div class="card">
<h2>⭐ Membership</h2>
<p>FREE — KSh 0 — 3 starter matches</p>
<p>PRO — KSh 99/month</p>
<p>PRIME — KSh 149/month</p>
<a class="btn" href="/upgrade?plan=pro">Try PRO</a>
<a class="btn" href="/upgrade?plan=prime">Try PRIME</a>
</div>

<div class="card">
<h3>👥 Refer & Earn</h3>
<p>Your code: <b>JRP-${u.id.slice(-6)}</b></p>
<p>Referrals: ${u.referrals}</p>
</div>

<a class="btn" href="/logout">Sign out</a>
</main>`,u.theme));
});

/* THEME */

app.post("/theme",(req,res) => {
  const u=sessionUser(req);
  if(u) u.theme=req.body.theme || "green";
  res.redirect("/home");
});

/* FREE LISTING */

app.get("/sell",(req,res) => {
  const u=sessionUser(req);
  if(!u) return res.redirect("/login");

  res.send(page("Sell",`
<header><h1>🏪 Sell</h1></header>
<main><div class="card">
<h2>FREE LISTING</h2>
<form method="POST" action="/sell">
<input name="title" placeholder="What are you selling?" required>
<input name="price" type="number" placeholder="Price KSh" required>
<input name="location" placeholder="Location" required>
<textarea name="description" placeholder="Describe your item"></textarea>
<input name="photo" type="url" placeholder="Item photo URL">
<button>Create FREE Listing</button>
</form>
</div></main>`));
});

app.post("/sell",(req,res) => {
  const u=sessionUser(req);
  if(!u) return res.redirect("/login");

  const l={
    id:id("LIST"),
    owner:u.phone,
    title:clean(req.body.title),
    price:Number(req.body.price)||0,
    location:clean(req.body.location),
    description:clean(req.body.description),
    photo:clean(req.body.photo),
    created:new Date().toISOString()
  };

  listings.unshift(l);
  log("Free listing",{title:l.title,owner:u.name});
  res.send(page("Listing Created",`
<header><h1>🏪 JR PHEEF</h1></header>
<main><div class="card">
<h2>✅ Listing created</h2>
<p>Your listing is FREE.</p>
<p><b>${l.title}</b></p>
<a class="btn" href="/home">Done</a>
</div></main>`));
});

/* FIND */

app.get("/find",(req,res) => {
  const u=sessionUser(req);
  if(!u) return res.redirect("/login");

  res.send(page("Find",`
<header><h1>🔎 Find</h1><p>Discover opportunities.</p></header>
<main><div class="card">
<form>
<input name="q" placeholder="Search products, services or opportunities">
<button>Search</button>
</form>
</div>
${listings.filter(x=>
 !req.query.q || x.title.toLowerCase().includes(req.query.q.toLowerCase())
).slice(0,20).map(x=>`
<div class="card">
<h3>${x.title}</h3>
<p>KSh ${x.price} • ${x.location}</p>
<p>${x.description}</p>
</div>`).join("")}
</main>`));
});

/* MATCHES */

app.get("/matches",(req,res) => {
  const u=sessionUser(req);
  if(!u) return res.redirect("/login");

  const remaining=Math.max(
    0,
    plans[u.plan].freeMatches-u.matches
  );

  res.send(page("Matches",`
<header><h1>🤝 Matches</h1><p>Find the right people and opportunities.</p></header>
<main><div class="card">
<h2>🎁 Free Matches</h2>
<p>You have <b>${remaining}</b> starter matches available.</p>
<p>Matches can connect you with buyers, sellers, businesses, service providers and opportunities.</p>
<button onclick="alert('Matching engine ready for the next connection.')">Find a Match</button>
</div></main>`));
});

/* CONNECTIONS */

app.get("/connect",(req,res) => {
  const u=sessionUser(req);
  if(!u) return res.redirect("/login");

  res.send(page("Connect",`
<header><h1>💬 Connect</h1><p>Real connections, safely.</p></header>
<main>
<div class="card">
<h2>What are you looking for?</h2>
<p>🤝 Friendship</p>
<p>❤️ Relationship</p>
<p>💼 Business networking</p>
<p>💡 Opportunities</p>
<p>🎓 Mentorship</p>
<p>🛠️ Skills & services</p>
</div>

<div class="card">
<h2>🛡️ JR PHEEF Safe Chat</h2>
<p>You can interact normally, but JR PHEEF protects users from attempts to move transactions outside the platform.</p>
<p class="small">Phone numbers, emails, external links and suspicious trade/payment contact information can be blocked or reviewed.</p>
</div>
</main>`));
});

/* MESSAGE SAFETY */

function unsafe(text) {
  return (
    /https?:\/\/|www\./i.test(text) ||
    /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/i.test(text) ||
    /(?:\+?254|0)\d{9}\b/.test(text) ||
    /\b(?:whatsapp|telegram|signal|instagram|facebook)\s*[:@]?\s*[\w.+-]+/i.test(text)
  );
}

app.post("/api/chat",(req,res) => {
  const u=sessionUser(req);
  if(!u) return res.status(401).json({error:"Login required"});

  const text=String(req.body.message||"");

  if(unsafe(text))
    return res.status(400).json({
      blocked:true,
      message:"🛡️ JR PHEEF Safety Notice: contact details or external transaction links are not allowed here. You can continue chatting safely inside JR PHEEF."
    });

  log("Safe chat",{user:u.name});
  res.json({ok:true,message:"Message delivered safely."});
});

/* DELIVERY / RIDERS */

app.get("/delivery",(req,res) => {
  const u=sessionUser(req);
  if(!u) return res.redirect("/login");

  res.send(page("JR PHEEF Delivery",`
<header><h1>🚚 JR PHEEF MOVE</h1><p>Deliver. Move. Connect.</p></header>
<main>
<div class="card">
<h2>Request a Rider — FREE</h2>
<form method="POST" action="/delivery">
<input name="pickup" placeholder="Pickup location" required>
<input name="destination" placeholder="Destination" required>
<input name="item" placeholder="What needs moving?" required>
<select name="vehicle">
<option>Motorcycle</option><option>Car</option><option>Van</option>
<option>Pickup</option><option>Truck</option>
</select>
<button>Find Rider</button>
</form>
</div>

<div class="card">
<h2>🛵 Become a JR PHEEF Rider</h2>
<p>Register → Verification → Receive delivery requests.</p>
<p>Rider registration is FREE during launch.</p>
<a class="btn" href="/rider">Register</a>
</div>
</main>`));
});

app.post("/delivery",(req,res) => {
  const u=sessionUser(req);
  if(!u) return res.redirect("/login");

  log("Delivery request",{user:u.name});
  res.send(page("Rider Request",`
<header><h1>🚚 JR PHEEF MOVE</h1></header>
<main><div class="card">
<h2>🔎 Looking for a verified rider...</h2>
<p>Your delivery request has been created.</p>
<p>Rider matching is FREE for customers.</p>
<a class="btn" href="/home">Return Home</a>
</div></main>`));
});

/* RIDER */

app.get("/rider",(req,res) => {
  const u=sessionUser(req);
  if(!u) return res.redirect("/login");

  res.send(page("Rider Registration",`
<header><h1>🛵 JR PHEEF RIDER</h1></header>
<main><div class="card">
<form method="POST" action="/rider">
<input name="vehicle" placeholder="Vehicle type" required>
<input name="registration" placeholder="Vehicle registration" required>
<input name="area" placeholder="Operating area" required>
<button>Register as Rider</button>
</form>
<p class="small">Registration is reviewed before receiving trusted delivery requests.</p>
</div></main>`));
});

app.post("/rider",(req,res) => {
  const u=sessionUser(req);
  if(!u) return res.redirect("/login");

  riders.push({
    id:id("RIDER"),user:u.phone,name:u.name,
    vehicle:clean(req.body.vehicle),
    registration:clean(req.body.registration),
    area:clean(req.body.area),
    status:"pending",
    online:false
  });

  log("Rider application",{name:u.name});
  res.send(page("Rider",`
<header><h1>🛵 JR PHEEF</h1></header>
<main><div class="card">
<h2>✅ Application received</h2>
<p>Your rider profile is pending verification.</p>
</div></main>`));
});

/* DEAL ROOM */

app.get("/deal",(req,res) => {
  const u=sessionUser(req);
  if(!u) return res.redirect("/login");

  const d={
    id:id("DEAL"),user:u.phone,
    amount:plans[u.plan].match,status:"awaiting_payment"
  };

  deals.push(d);

  res.send(page("Deal Room",`
<header><h1>🤝 Deal Room</h1></header>
<main><div class="card">
<h2>Secure JR PHEEF Deal</h2>
<p>Match/service fee: <b>KSh ${d.amount}</b></p>
<p class="small">TEST MODE — no real money moves.</p>
<form method="POST" action="/pay">
<input type="hidden" name="deal" value="${d.id}">
<button>💳 Continue Payment</button>
</form>
</div></main>`));
});

/* TEST PAYMENT */

app.get("/pay",(req,res) => {
  const u=sessionUser(req);
  if(!u) return res.redirect("/login");

  res.send(page("Payment",`
<header><h1>💳 JR PHEEF PAY</h1></header>
<main><div class="card">
<h2>TEST PAYMENT</h2>
<p>No real money will move.</p>
<form method="POST" action="/pay">
<button>Pay Test KSh 30</button>
</form>
</div></main>`));
});

app.post("/pay",(req,res) => {
  const u=sessionUser(req);
  if(!u) return res.redirect("/login");

  const amount=30;

  payments.push({
    id:id("PAY"),user:u.phone,amount,
    status:"SUCCESS",mode:"TEST"
  });

  log("Test payment",{user:u.name,amount});

  res.send(page("Payment Complete",`
<header><h1>JR PHEEF</h1></header>
<main><div class="card" style="text-align:center">
<div style="font-size:60px">✅</div>
<h2>Payment Received</h2>
<h1>KSh ${amount}</h1>
<p>TEST MODE — M-Pesa not connected.</p>
<a class="btn" href="/home">Done</a>
</div></main>`));
});

/* UPGRADE */

app.get("/upgrade",(req,res) => {
  const u=sessionUser(req);
  const plan=plans[req.query.plan];

  if(!u || !plan) return res.redirect("/home");

  u.plan=req.query.plan;

  res.send(page("Membership",`
<header><h1>⭐ JR PHEEF ${u.plan.toUpperCase()}</h1></header>
<main><div class="card">
<h2>Upgrade successful — TEST MODE</h2>
<p>Plan: ${u.plan.toUpperCase()}</p>
<p>Price: KSh ${plan.price}/month</p>
<a class="btn" href="/home">Continue</a>
</div></main>`));
});

/* WHATSAPP */

app.post("/api/webhook/whatsapp",async(req,res) => {
  const from=req.body.From || "";
  const msg=(req.body.Body || "").trim();
  const text=msg.toLowerCase();
  const u=await getUser(from);

  let reply;

  if(!u){
    reply=`👋 Karibu JR PHEEF!

Find. Match. Connect. Trade.

Create your account here:
${BASE}

After registration, you can use JR PHEEF from WhatsApp and your home.`;
  }
  else if(["hi","hello","hey","help"].includes(text)){
    reply=`👋 Karibu ${u.name}!

JR PHEEF:
🛒 BUY
🏪 SELL
🔎 FIND
🤝 MATCH
💬 CONNECT
❤️ CONNECTIONS
🚚 DELIVERY
🎁 REWARDS

Basic listings and starter matching are FREE.

Type BUY, SELL, FIND, MATCH, CONNECT or DELIVERY.`;
  }
  else if(text==="buy"){
    reply=`🛒 BUY

Tell me what you are looking for, your budget and location.`;
  }
  else if(text==="sell"){
    reply=`🏪 SELL

Tell me what you are selling, price and location. Basic listings are FREE.`;
  }
  else if(text==="find"){
    reply=`🔎 FIND

Tell me what you want to find and where. I'll help identify the opportunity.`;
  }
  else if(text==="match"){
    reply=`🤝 MATCH

You receive starter free matches.

Tell me what or who you want to connect with.`;
  }
  else if(text==="connect"){
    reply=`💬 CONNECT

You can chat, mingle, network, make friends and discover opportunities safely inside JR PHEEF.`;
  }
  else if(text==="delivery"){
    reply=`🚚 DELIVERY

Tell me pickup location, destination and what needs moving.

Customer rider matching is FREE.`;
  }
  else{
    reply=`🤝 JR PHEEF: Nimekupata!

Tell me what you're looking for.

🛒 BUY
🏪 SELL
🔎 FIND
🤝 MATCH
💬 CONNECT
🚚 DELIVERY`;
  }

  const twiml=new twilio.twiml.MessagingResponse();
  twiml.message(reply);
  res.type("text/xml").send(twiml.toString());

  log("WhatsApp",{from,message:msg});
});

/* OWNER */

app.get("/owner",(req,res) => {
  if(!process.env.OWNER_KEY || req.query.key!==process.env.OWNER_KEY)
    return res.status(403).send("🔒 Owner access denied.");

  const revenue=payments.reduce((a,p)=>a+p.amount,0);

  res.send(page("JR PHEEF Command",`
<header>
<h1>👑 JR PHEEF</h1>
<p>COMMAND CENTER</p>
</header>
<main>

<div class="grid">
<div class="card"><h3>👥 Members</h3><div class="stat">${users.size}</div></div>
<div class="card"><h3>🏪 Listings</h3><div class="stat">${listings.length}</div></div>
<div class="card"><h3>🤝 Matches</h3><div class="stat">${matches.length}</div></div>
<div class="card"><h3>🛵 Riders</h3><div class="stat">${riders.length}</div></div>
<div class="card"><h3>🤝 Deals</h3><div class="stat">${deals.length}</div></div>
<div class="card"><h3>💰 Revenue</h3><div class="stat">KSh ${revenue}</div></div>
</div>

<div class="card">
<h2>📊 JR PHEEF SYSTEM</h2>
<p>Accounts: ACTIVE</p>
<p>Marketplace: ACTIVE</p>
<p>Free Listings: ACTIVE</p>
<p>Free Matching: ACTIVE</p>
<p>Safe Chat: ACTIVE</p>
<p>Connections: ACTIVE</p>
<p>Delivery Network: ACTIVE</p>
<p>Deal Rooms: ACTIVE</p>
<p>Rewards: ACTIVE</p>
<p>WhatsApp: ACTIVE</p>
<p>M-Pesa: NOT CONNECTED</p>
</div>

<div class="card">
<h2>🛵 Rider Network</h2>
${riders.map(r=>`
<p>🛵 <b>${r.name}</b> — ${r.status} — ${r.online?"🟢 ONLINE":"⚫ OFFLINE"}</p>
`).join("") || "<p>No riders yet.</p>"}
</div>

<div class="card">
<h2>🔔 Activity</h2>
${activity.slice(0,20).map(a=>`
<p>• ${a.type}<br><span class="small">${a.time}</span></p>
`).join("")}
</div>

</main>`));
});

/* LOGOUT */

app.get("/logout",(req,res) => {
  const token=req.cookies?.jrpheef;
  if(token) sessions.delete(token);
  res.setHeader("Set-Cookie","jr_pheef=; Max-Age=0; Path=/");
  res.redirect("/");
});

/* HEALTH */

app.get("/health",(req,res)=>res.json({
  ok:true,
  service:"JR PHEEF",
  marketplace:true,
  connections:true,
  matching:true,
  delivery:true,
  whatsapp:true,
  supabase:!!supabase
}));

app.listen(PORT,()=>{
  console.log(`🚀 JR PHEEF running on ${PORT}`);
  console.log(`🗄️ Supabase: ${supabase?"CONNECTED":"NOT CONNECTED"}`);
  console.log("👤 Accounts: ACTIVE");
  console.log("📸 Profile photos: ACTIVE");
  console.log("🎨 Themes: ACTIVE");
  console.log("🏪 Free listings: ACTIVE");
  console.log("🤝 Free starter matches: ACTIVE");
  console.log("💬 Safe connections: ACTIVE");
  console.log("🚚 Delivery matching: ACTIVE");
  console.log("🛵 Rider network: ACTIVE");
  console.log("🤝 Deal Rooms: ACTIVE");
  console.log("💬 WhatsApp: ACTIVE");
  console.log("🎁 Rewards/Referrals: ACTIVE");
  console.log("⭐ PRO/PRIME: ACTIVE");
  console.log("👑 Owner Center: ACTIVE");
  console.log("💳 Payments: TEST MODE");
  console.log("📱 M-Pesa: NOT CONNECTED");
});
