const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 10000;
const BASE = "https://jr-pheef-marketplace.onrender.com";

const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY;
const db = process.env.SUPABASE_URL && KEY
  ? createClient(process.env.SUPABASE_URL, KEY)
  : null;

const plans = {
  free: { price: 0, match: 30 },
  pro: { price: 99, match: 20 },
  prime: { price: 149, match: 20 }
};

const deals = new Map();
const payments = new Map();
const activity = [];

const log = (type, data = {}) => {
  activity.unshift({ type, ...data, time: new Date().toISOString() });
  activity.splice(50);
};

const clean = x => String(x || "").replace(/^whatsapp:/, "").trim();

function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function passwordOK(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, oldHash] = stored.split(":");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(oldHash, "hex")
  );
}

async function getUser(phone) {
  if (!db) return null;

  const { data, error } = await db
    .from("members")
    .select("*")
    .eq("phone", clean(phone))
    .maybeSingle();

  if (error) console.log("DB:", error.message);
  return data || null;
}

function page(title, body) {
  return `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{--c:#08783c;--bg:#f3f8f5}
*{box-sizing:border-box}body{margin:0;font-family:Arial;background:var(--bg)}
header{background:#063d20;color:white;padding:24px}
main{max-width:700px;margin:auto;padding:15px}
.card{background:white;margin:14px 0;padding:20px;border-radius:18px;
box-shadow:0 2px 10px #0001}
input,select{width:100%;padding:12px;margin:6px 0;border:1px solid #ccc;border-radius:9px}
button,.btn{background:var(--c);color:white;border:0;padding:12px 18px;
border-radius:10px;text-decoration:none;display:inline-block;margin:4px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.stat{font-size:25px;font-weight:bold}.small{opacity:.7;font-size:13px}
</style></head><body>${body}</body></html>`;
}

/* WELCOME */

app.get("/", (_, res) => res.send(page("JR PHEEF", `
<header><h1>JR PHEEF</h1><p>Find. Match. Trade.</p></header>
<main>
<div class="card">
<h2>👋 Karibu JR PHEEF</h2>
<p>Buy, sell, find opportunities and connect safely.</p>
<form method="POST" action="/signup">
<input name="name" placeholder="Full name" required>
<input name="year" type="number" placeholder="Birth year" required>
<input name="phone" placeholder="Phone e.g. +2547..." required>
<input name="password" type="password" placeholder="Create password" required>
<button>Create JR PHEEF Account</button>
</form>
</div>

<div class="card">
<h3>🔐 Already a member?</h3>
<form method="POST" action="/login">
<input name="phone" placeholder="Phone number" required>
<input name="password" type="password" placeholder="Password" required>
<button>Sign In</button>
</form>
</div>
</main>`)));

/* SIGN UP */

app.post("/signup", async (req, res) => {
  if (!db) return res.status(503).send("Supabase is not connected.");

  const name = String(req.body.name || "").trim();
  const birth_year = Number(req.body.year);
  const phone = clean(req.body.phone);
  const password = String(req.body.password || "");

  if (!name || !birth_year || !phone || password.length < 6)
    return res.status(400).send("Complete all fields. Password must be at least 6 characters.");

  const existing = await getUser(phone);

  if (existing) {
    if (existing.password_hash)
      return res.send("Account already exists. <a href='/'>Sign in</a>");

    const { error } = await db.from("members").update({
      full_name: name,
      birth_year,
      password_hash: passwordHash(password),
      plan: "free",
      rewards: 0,
      credits: 0,
      referrals: 0,
      theme: "jr-green",
      account_type: "individual"
    }).eq("id", existing.id);

    if (error) return res.status(500).send(error.message);
  } else {
    const { error } = await db.from("members").insert({
      full_name: name,
      phone,
      birth_year,
      password_hash: passwordHash(password),
      plan: "free",
      rewards: 0,
      credits: 0,
      referrals: 0,
      theme: "jr-green",
      account_type: "individual",
      verified: false,
      status: "active"
    });

    if (error) return res.status(500).send(error.message);
  }

  log("New account", { name, phone });
  res.redirect(`/home?phone=${encodeURIComponent(phone)}`);
});

/* LOGIN */

app.post("/login", async (req, res) => {
  const phone = clean(req.body.phone);
  const u = await getUser(phone);

  if (!u || !passwordOK(req.body.password, u.password_hash))
    return res.status(401).send("❌ Incorrect phone number or password. <a href='/'>Try again</a>");

  log("Login", { phone });
  res.redirect(`/home?phone=${encodeURIComponent(phone)}`);
});

/* HOME */

app.get("/home", async (req, res) => {
  const u = await getUser(req.query.phone);
  if (!u) return res.redirect("/");

  const plan = plans[u.plan] || plans.free;

  res.send(page("JR PHEEF", `
<header>
<h1>JR PHEEF</h1>
<p>Welcome, ${u.full_name} 👋</p>
<b>${String(u.plan || "free").toUpperCase()}</b>
</header>

<main>

<div class="card">
<h2>🏠 Your JR PHEEF</h2>
<p>One account. Buyer + Seller.</p>
<select>
<option>JR PHEEF Green</option>
<option>Black</option>
<option>Blue</option>
<option>Purple</option>
<option>Gold</option>
</select>
</div>

<div class="grid">
<div class="card"><h3>🛒 BUY</h3><p>Products, services, jobs & opportunities.</p></div>
<div class="card"><h3>🏪 SELL</h3><p>List and manage what you sell.</p></div>
<div class="card"><h3>🤝 MATCHES</h3><p>Buyer and seller connections.</p></div>
<div class="card"><h3>💬 DEAL</h3>
<a class="btn" href="/deal?phone=${encodeURIComponent(u.phone)}">Open</a></div>
<div class="card"><h3>🚚 DELIVERY</h3><p>Riders, movers & transport.</p></div>
<div class="card"><h3>💳 PAY</h3><p>Payments & transaction history.</p></div>
</div>

<div class="card">
<h3>🎁 REWARDS</h3>
<p>Rewards: <b>KSh ${u.rewards || 0}</b></p>
<p>JR PHEEF Credits: <b>${u.credits || 0}</b></p>
<p>Referrals: ${u.referrals || 0}</p>
<p>Minimum individual withdrawal: <b>KSh 200</b></p>
</div>

<div class="card">
<h3>🎟️ COUPONS & DISCOUNTS</h3>
<p>Your available offers will appear here.</p>
</div>

<div class="card">
<h3>👥 REFER & EARN</h3>
<p>Your referral code: <b>JRP-${String(u.id).slice(-6)}</b></p>
</div>

<div class="card">
<h3>⭐ MEMBERSHIP</h3>
<p>FREE — First month free — KSh 30 match</p>
<p>PRO — KSh 99/month — KSh 20 match</p>
<p>PRIME — KSh 149/month — KSh 20 match</p>
<a class="btn" href="/upgrade?phone=${encodeURIComponent(u.phone)}&plan=pro">PRO</a>
<a class="btn" href="/upgrade?phone=${encodeURIComponent(u.phone)}&plan=prime">PRIME</a>
</div>

</main>`));
});

/* UPGRADE — TEST */

app.get("/upgrade", async (req, res) => {
  const u = await getUser(req.query.phone);
  const plan = plans[req.query.plan];

  if (!u || !plan) return res.status(400).send("Invalid upgrade.");

  await db.from("members")
    .update({ plan: req.query.plan })
    .eq("id", u.id);

  log("Upgrade", { phone: u.phone, plan: req.query.plan });
  res.redirect(`/home?phone=${encodeURIComponent(u.phone)}`);
});

/* DEAL ROOM */

app.get("/deal", async (req, res) => {
  const u = await getUser(req.query.phone);
  if (!u) return res.redirect("/");

  const fee = (plans[u.plan] || plans.free).match;

  const d = {
    id: `DEAL-${Date.now()}`,
    buyer: u.phone,
    amount: fee,
    status: "awaiting_payment"
  };

  deals.set(d.id, d);
  log("Deal opened", { deal: d.id });

  res.send(page("JR PHEEF Deal", `
<header><h1>🤝 Deal Room</h1></header>
<main><div class="card">
<h2>JR PHEEF Match</h2>
<p>Customer: ${u.full_name}</p>
<p>Plan: ${String(u.plan).toUpperCase()}</p>
<p>Match fee: <b>KSh ${fee}</b></p>
<p class="small">TEST MODE — no real money moves.</p>
<form method="POST" action="/pay">
<input type="hidden" name="deal" value="${d.id}">
<button>💳 Test Payment</button>
</form>
</div></main>`));
});

/* TEST PAYMENT */

app.post("/pay", (req, res) => {
  const d = deals.get(req.body.deal);
  if (!d) return res.status(404).send("Deal not found.");

  const p = {
    id: `PAY-${Date.now()}`,
    deal: d.id,
    amount: d.amount,
    status: "SUCCESS",
    mode: "TEST",
    time: new Date().toISOString()
  };

  payments.set(p.id, p);
  d.status = "paid";
  log("Payment", { payment: p.id, amount: p.amount });

  res.send(page("JR PHEEF Payment", `
<header><h1>JR PHEEF</h1></header>
<main><div class="card" style="text-align:center">
<div style="font-size:60px">✅</div>
<h2>Payment Received</h2>
<h1>KSh ${p.amount}</h1>
<p>Deal Room payment confirmed.</p>
<p>${p.id}</p>
<p class="small">TEST MODE — M-Pesa not connected.</p>
<a class="btn" href="/">Done</a>
</div></main>`));
});

/* WHATSAPP */

app.post("/api/webhook/whatsapp", async (req, res) => {
  const from = clean(req.body.From);
  const msg = String(req.body.Body || "").trim();
  const text = msg.toLowerCase();
  const u = await getUser(from);

  let reply;

  if (!u) {
    reply = `👋 Karibu JR PHEEF!

Find. Match. Trade.

First create your JR PHEEF account:

${BASE}

Then you can BUY, SELL, MATCH and use Deal Rooms.

Type HELP anytime.`;
  } else if (["hi","hello","hey","help"].includes(text)) {
    reply = `👋 Karibu ${u.full_name}!

JR PHEEF iko ready:

🛒 BUY
🏪 SELL
🔎 FIND
🤝 MATCH
💬 DEAL
🚚 DELIVERY
🎁 REWARDS
⭐ UPGRADE

Your home:
${BASE}/home?phone=${encodeURIComponent(u.phone)}`;
  } else if (text === "buy") {
    reply = `🛒 BUY

Tell me what you're looking for, your budget and location.

JR PHEEF itafute match yako.`;
  } else if (text === "sell") {
    reply = `🏪 SELL

Tell me what you're selling, price and location.

Unaweza kuongeza photos kupitia JR PHEEF.`;
  } else if (text === "deal") {
    reply = `🤝 DEAL ROOM

Your ${String(u.plan).toUpperCase()} match fee is KSh ${(plans[u.plan] || plans.free).match}.

Open:
${BASE}/deal?phone=${encodeURIComponent(u.phone)}

TEST MODE only.`;
  } else if (text === "delivery") {
    reply = `🚚 JR PHEEF DELIVERY

Tell me:
• What needs moving
• Pickup
• Destination
• Preferred transport`;
  } else if (text === "rewards") {
    reply = `🎁 REWARDS

Rewards: KSh ${u.rewards || 0}
JR PHEEF Credits: ${u.credits || 0}
Referrals: ${u.referrals || 0}

Minimum withdrawal: KSh 200.`;
  } else {
    reply = `🤝 Nimekupata!

JR PHEEF handles legal products, services, jobs, opportunities and transport.

Type BUY, SELL, DEAL, DELIVERY, REWARDS or HELP.`;
  }

  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(reply);
  res.type("text/xml").send(twiml.toString());

  log("WhatsApp", { from, message: msg });
});

/* OWNER COMMAND CENTER */

app.get("/owner", async (req, res) => {
  if (!process.env.OWNER_KEY || req.query.key !== process.env.OWNER_KEY)
    return res.status(403).send("🔒 Owner access denied.");

  let members = [];

  if (db) {
    const { data } = await db
      .from("members")
      .select("*")
      .order("created_at", { ascending: false });

    members = data || [];
  }

  const revenue = [...payments.values()]
    .filter(p => p.status === "SUCCESS")
    .reduce((n, p) => n + p.amount, 0);

  res.send(page("JR PHEEF Owner", `
<header>
<h1>👑 JR PHEEF</h1>
<p>OWNER COMMAND CENTER</p>
</header>

<main>

<div class="grid">
<div class="card"><h3>👥 Members</h3><div class="stat">${members.length}</div></div>
<div class="card"><h3>🤝 Deals</h3><div class="stat">${deals.size}</div></div>
<div class="card"><h3>💳 Payments</h3><div class="stat">${payments.size}</div></div>
<div class="card"><h3>💰 Test Revenue</h3><div class="stat">KSh ${revenue}</div></div>
</div>

<div class="card">
<h2>📊 JR PHEEF</h2>
<p>🛒 Marketplace: ACTIVE</p>
<p>🤝 Matching: ACTIVE</p>
<p>💬 Deal Rooms: ACTIVE</p>
<p>🎁 Rewards: ACTIVE</p>
<p>👥 Referrals: ACTIVE</p>
<p>🎟️ Coupons: READY</p>
<p>🚚 Delivery: READY</p>
<p>⭐ PRO / PRIME: ACTIVE</p>
<p>💳 M-Pesa: NOT CONNECTED</p>
<p>🌍 International payments: NOT CONNECTED</p>
</div>

<div class="card">
<h2>👥 MEMBERS</h2>
${members.map(u => `
<p><b>${u.full_name}</b> — ${String(u.plan || "free").toUpperCase()}
<br>${u.phone}
<br>Status: ${u.status || "unknown"} | Verified: ${u.verified ? "YES" : "NO"}</p>
`).join("") || "<p>No members yet.</p>"}
</div>

<div class="card">
<h2>🔔 ACTIVITY</h2>
${activity.map(a => `
<p>• <b>${a.type}</b>
<br><span class="small">${a.time}</span></p>
`).join("") || "<p>No activity yet.</p>"}

</div>

</main>`));
});

/* HEALTH */

app.get("/health", (_, res) => res.json({
  ok: true,
  service: "JR PHEEF",
  database: !!db,
  mode: "TEST",
  deals: deals.size,
  payments: payments.size
}));

app.listen(PORT, () => {
  console.log(`🚀 JR PHEEF running on ${PORT}`);
  console.log(`🗄️ Supabase: ${db ? "CONNECTED" : "NOT CONNECTED"}`);
  console.log("🔐 Persistent accounts: ACTIVE");
  console.log("🏠 Unified home: ACTIVE");
  console.log("🤝 Deal Rooms: ACTIVE");
  console.log("💬 WhatsApp: ACTIVE");
  console.log("👑 Owner Center: ACTIVE");
  console.log("🎁 Rewards/Referrals: ACTIVE");
  console.log("⭐ PRO/PRIME: ACTIVE");
  console.log("🚚 Delivery: READY");
  console.log("💳 M-Pesa: NOT CONNECTED");
});
