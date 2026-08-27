const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 10000;
const BASE = "https://jr-pheef-marketplace.onrender.com";

const sbKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_ANON_KEY;

const supabase =
  process.env.SUPABASE_URL && sbKey
    ? createClient(process.env.SUPABASE_URL, sbKey)
    : null;

const users = new Map();
const deals = new Map();
const payments = new Map();
const activity = [];

const plans = {
  free:  { price: 0,   match: 30 },
  pro:   { price: 99,  match: 20 },
  prime: { price: 149, match: 20 }
};

const log = (type, data = {}) => {
  activity.unshift({
    type,
    ...data,
    time: new Date().toISOString()
  });
  activity.splice(50);
};

const id = p =>
  `${p}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;

function user(phone) {
  return users.get(phone);
}

function page(title, body) {
  return `
  <!doctype html>
  <html>
  <head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
  :root{--c:#08783c;--bg:#f3f8f5;--card:#fff;--txt:#111}
  *{box-sizing:border-box}
  body{margin:0;font-family:Arial;background:var(--bg);color:var(--txt)}
  header{background:#063d20;color:white;padding:24px}
  main{max-width:650px;margin:auto;padding:15px}
  .card{background:var(--card);margin:14px 0;padding:20px;border-radius:18px;
        box-shadow:0 2px 10px #0001}
  button,.btn{background:var(--c);color:white;border:0;padding:12px 18px;
        border-radius:10px;text-decoration:none;display:inline-block;margin:4px}
  input,select{padding:12px;width:100%;margin:6px 0;border:1px solid #ccc;
        border-radius:9px}
  a{color:var(--c)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .stat{font-size:25px;font-weight:bold}
  .small{opacity:.7;font-size:13px}
  </style>
  </head><body>${body}</body></html>`;
}

/* WELCOME */

app.get("/", (req,res) => res.send(page("JR PHEEF",`
<header>
<h1>JR PHEEF</h1>
<p>Find. Match. Trade.</p>
</header>
<main>
<div class="card">
<h2>Welcome 👋</h2>
<p>Buy, sell, discover opportunities, services and delivery.</p>
<form method="POST" action="/signup">
<input name="name" placeholder="Real name" required>
<input name="year" type="number" placeholder="Birth year" required>
<input name="phone" placeholder="Phone number" required>
<button>Create JR PHEEF Account</button>
</form>
</div>

<div class="card">
<h3>Already have an account?</h3>
<form method="GET" action="/home">
<input name="phone" placeholder="Phone number" required>
<button>Sign In</button>
</form>
</div>
</main>`)));

/* ACCOUNT */

app.post("/signup", async (req,res) => {
  const {name,year,phone} = req.body;

  const u = {
    id:id("USR"), name, year, phone,
    plan:"free", rewards:0, credits:0,
    referrals:0, theme:"jr-green",
    joined:new Date().toISOString()
  };

  users.set(phone,u);
  log("New account", {name,phone});

  if(supabase){
    await supabase.from("users").insert({
      name, birth_year:year, phone, plan:"free"
    }).catch(()=>{});
  }

  res.redirect(`/home?phone=${encodeURIComponent(phone)}`);
});

/* USER HOME */

app.get("/home",(req,res) => {
  const u=user(req.query.phone);
  if(!u) return res.redirect("/");

  res.send(page("JR PHEEF",`
<header>
<h1>JR PHEEF</h1>
<p>Welcome, ${u.name} 👋</p>
<b>${u.plan.toUpperCase()}</b>
</header>

<main>

<div class="card">
<h2>🏠 Your JR PHEEF</h2>
<p>Everything you need in one place.</p>
<select onchange="document.documentElement.style.setProperty('--c',this.value)">
<option value="#08783c">JR PHEEF Green</option>
<option value="#111">Black</option>
<option value="#2563eb">Blue</option>
<option value="#7c3aed">Purple</option>
<option value="#b8860b">Gold</option>
</select>
</div>

<div class="grid">

<div class="card">
<h3>🔎 Find</h3>
<p>Products, services, jobs & opportunities.</p>
</div>

<div class="card">
<h3>🏪 Sell</h3>
<p>Create and manage listings.</p>
</div>

<div class="card">
<h3>🤝 Matches</h3>
<p>Your buyer & seller matches.</p>
</div>

<div class="card">
<h3>💬 Deal Rooms</h3>
<a class="btn" href="/deal?phone=${encodeURIComponent(u.phone)}">Open Deal</a>
</div>

<div class="card">
<h3>🚚 Delivery</h3>
<p>Request riders, movers or transport.</p>
</div>

<div class="card">
<h3>💳 JR PHEEF Pay</h3>
<p>Payments & transaction history.</p>
</div>

</div>

<div class="card">
<h3>🎁 Rewards</h3>
<p>Rewards: <b>KSh ${u.rewards}</b></p>
<p>JR PHEEF Credits: <b>${u.credits}</b></p>
<p>Referral rewards: ${u.referrals}</p>
<p>Minimum individual withdrawal: KSh 200</p>
</div>

<div class="card">
<h3>🎟️ Coupons & Discounts</h3>
<p>Available coupons, promotions and discounts.</p>
</div>

<div class="card">
<h3>👥 Refer & Earn</h3>
<p>Your referral code: <b>JRP-${u.id.slice(-5)}</b></p>
</div>

<div class="card">
<h3>⭐ Membership</h3>
<p>FREE — First month free</p>
<p>PRO — KSh 99/month → KSh 20 match fee</p>
<p>PRIME — KSh 149/month → KSh 20 match fee</p>
<a class="btn" href="/upgrade?phone=${encodeURIComponent(u.phone)}&plan=pro">Test PRO</a>
<a class="btn" href="/upgrade?phone=${encodeURIComponent(u.phone)}&plan=prime">Test PRIME</a>
</div>

</main>`));
});

/* DEAL ROOM */

app.get("/deal",(req,res) => {
  const u=user(req.query.phone);
  if(!u) return res.redirect("/");

  const fee=plans[u.plan].match;

  const d={
    id:id("DEAL"),
    buyer:u.phone,
    seller:"TEST-SELLER",
    amount:fee,
    status:"awaiting_payment"
  };

  deals.set(d.id,d);
  log("Deal Room opened",{deal:d.id});

  res.send(page("JR PHEEF Deal Room",`
<header><h1>🤝 Deal Room</h1></header>
<main>
<div class="card">
<h2>JR PHEEF Match</h2>
<p>Buyer: ${u.name}</p>
<p>Plan: ${u.plan.toUpperCase()}</p>
<p>Match fee: <b>KSh ${fee}</b></p>
<p>Both parties can agree and pay inside JR PHEEF.</p>
<p class="small">TEST MODE — no real money moves.</p>

<form method="POST" action="/pay">
<input type="hidden" name="deal" value="${d.id}">
<button>💳 Pay KSh ${fee}</button>
</form>
</div>
</main>`));
});

/* TEST PAYMENT */

app.post("/pay",(req,res) => {
  const d=deals.get(req.body.deal);
  if(!d) return res.status(404).send("Deal not found");

  const p={
    id:id("PAY"),
    deal:d.id,
    amount:d.amount,
    status:"SUCCESS",
    mode:"TEST",
    time:new Date().toISOString()
  };

  payments.set(p.id,p);
  d.status="paid";
  log("Payment successful",{payment:p.id,amount:p.amount});

  res.send(page("Payment Complete",`
<header><h1>JR PHEEF</h1></header>
<main>
<div class="card" style="text-align:center">
<div style="font-size:65px">✅</div>
<h2>Payment Received</h2>
<h1>KSh ${p.amount}</h1>
<p>Deal Room payment confirmed.</p>
<p><b>${p.id}</b></p>
<p class="small">TEST MODE — M-Pesa is not connected.</p>
<a class="btn" href="/">Done</a>
</div>
</main>`));
});

/* UPGRADE */

app.get("/upgrade",(req,res) => {
  const u=user(req.query.phone);
  const plan=plans[req.query.plan];

  if(!u || !plan) return res.status(400).send("Invalid upgrade");

  u.plan=req.query.plan;
  log("Plan upgraded",{phone:u.phone,plan:u.plan});

  res.send(page("JR PHEEF Upgrade",`
<header><h1>⭐ JR PHEEF ${u.plan.toUpperCase()}</h1></header>
<main>
<div class="card">
<h2>Upgrade successful — TEST MODE</h2>
<p>Plan: ${u.plan.toUpperCase()}</p>
<p>Price: KSh ${plan.price}</p>
<p>Match fee: KSh ${plan.match}</p>
<a class="btn" href="/home?phone=${encodeURIComponent(u.phone)}">Return Home</a>
</div>
</main>`));
});

/* WHATSAPP */

app.post("/api/webhook/whatsapp",(req,res) => {
  const from=req.body.From || "";
  const msg=(req.body.Body || "").trim();
  const text=msg.toLowerCase();

  let u=user(from);
  let reply;

  if(!u){
    reply=
`👋 Karibu JR PHEEF!

Find. Match. Trade.

Before you can buy, sell or enter a Deal Room, create your JR PHEEF account.

Create your account here:
${BASE}

Type HELP anytime for assistance.`;
  }
  else if(["help","hi","hello","hey"].includes(text)){
    reply=
`👋 Karibu ${u.name}!

JR PHEEF can help you:
🛒 BUY
🏪 SELL
🔎 FIND
🤝 MATCH
💬 DEAL
🚚 DELIVERY
🎁 REWARDS
⭐ UPGRADE

Your home:
${BASE}/home?phone=${encodeURIComponent(u.phone)}

Type BUY, SELL, DEAL, DELIVERY or REWARDS.`;
  }
  else if(text==="buy"){
    reply=`🛒 JR PHEEF BUY

Sawa ${u.name}! Tell me what you're looking for, your budget and location.`;
  }
  else if(text==="sell"){
    reply=`🏪 JR PHEEF SELL

Sawa! Tell me what you're selling, price and location. You can later add photos through your JR PHEEF home.`;
  }
  else if(text==="deal"){
    reply=`🤝 Your test Deal Room:

${BASE}/deal?phone=${encodeURIComponent(u.phone)}

Your current ${u.plan.toUpperCase()} match fee is KSh ${plans[u.plan].match}.`;
  }
  else if(text==="delivery"){
    reply=`🚚 JR PHEEF DELIVERY

Tell me what needs to be moved, pickup location, destination and preferred transport.`;
  }
  else if(text==="rewards"){
    reply=`🎁 JR PHEEF REWARDS

Rewards: KSh ${u.rewards}
Credits: ${u.credits}
Referrals: ${u.referrals}

Minimum individual withdrawal: KSh 200.`;
  }
  else{
    reply=`🤝 JR PHEEF: Nimekupata!

Let's find the right opportunity.

Type BUY, SELL, DEAL, DELIVERY, REWARDS or HELP.`;
  }

  const twiml=new twilio.twiml.MessagingResponse();
  twiml.message(reply);
  res.type("text/xml").send(twiml.toString());

  log("WhatsApp message",{from,message:msg});
});

/* OWNER COMMAND CENTER */

app.get("/owner",(req,res) => {
  if(!process.env.OWNER_KEY || req.query.key!==process.env.OWNER_KEY)
    return res.status(403).send("🔒 Owner access denied.");

  const revenue=[...payments.values()]
    .filter(x=>x.status==="SUCCESS")
    .reduce((a,x)=>a+x.amount,0);

  res.send(page("JR PHEEF Command Center",`
<header>
<h1>👑 JR PHEEF</h1>
<p>COMMAND CENTER</p>
</header>

<main>

<div class="grid">

<div class="card">
<h3>👥 Users</h3>
<div class="stat">${users.size}</div>
</div>

<div class="card">
<h3>🤝 Deals</h3>
<div class="stat">${deals.size}</div>
</div>

<div class="card">
<h3>💳 Payments</h3>
<div class="stat">${payments.size}</div>
</div>

<div class="card">
<h3>💰 Test Revenue</h3>
<div class="stat">KSh ${revenue}</div>
</div>

</div>

<div class="card">
<h2>📊 Platform</h2>
<p>Marketplace: ACTIVE</p>
<p>Deal Rooms: ACTIVE</p>
<p>Rewards: ACTIVE</p>
<p>Referrals: ACTIVE</p>
<p>Coupons: ACTIVE</p>
<p>Delivery: READY</p>
<p>M-Pesa: NOT CONNECTED</p>
<p>International payments: NOT CONNECTED</p>
</div>

<div class="card">
<h2>👤 Users</h2>
${[...users.values()].map(u=>`
<p>
<b>${u.name}</b> — ${u.plan.toUpperCase()}
<br><span class="small">${u.phone}</span>
</p>`).join("") || "<p>No users yet.</p>"}
</div>

<div class="card">
<h2>🤝 Deal Rooms</h2>
${[...deals.values()].map(d=>`
<p><b>${d.id}</b> — ${d.status} — KSh ${d.amount}</p>
`).join("") || "<p>No deals yet.</p>"}
</div>

<div class="card">
<h2>🔔 Live Activity</h2>
${activity.map(a=>`
<p>• <b>${a.type}</b>
<br><span class="small">${a.time}</span></p>
`).join("") || "<p>No activity yet.</p>"}
</div>

<div class="card">
<h2>⚙️ Plans</h2>
<p>FREE — first month free — KSh 30 match</p>
<p>PRO — KSh 99/month — KSh 20 match</p>
<p>PRIME — KSh 149/month — KSh 20 match</p>
</div>

</main>`));
});

/* HEALTH */

app.get("/health",(req,res)=>res.json({
  ok:true,
  service:"JR PHEEF",
  mode:"TEST",
  users:users.size,
  deals:deals.size,
  payments:payments.size
}));

app.listen(PORT,()=>{
  console.log(`🚀 JR PHEEF running on ${PORT}`);
  console.log("🏠 Unified Home: ACTIVE");
  console.log("🤝 Deal Rooms: ACTIVE");
  console.log("💳 Test Payments: ACTIVE");
  console.log("💬 WhatsApp: ACTIVE");
  console.log("👑 Owner Center: ACTIVE");
  console.log("🎁 Rewards/Referrals: ACTIVE");
  console.log("🚚 Delivery: READY");
  console.log("💰 M-Pesa: NOT CONNECTED");
});
