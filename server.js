const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 10000;
const BASE = "https://jr-pheef-marketplace.onrender.com";

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
    : null;

const plans = {
  free: { price: 0, match: 30 },
  pro: { price: 99, match: 20 },
  prime: { price: 149, match: 20 }
};

const mem = {
  users: new Map(),
  listings: new Map(),
  deals: new Map(),
  transactions: new Map(),
  deliveries: new Map(),
  referrals: new Map(),
  coupons: new Map([
    ["WELCOME10", { discount: 10, active: true }]
  ]),
  activity: []
};

const id = p =>
  `${p}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

const hash = password =>
  crypto.createHash("sha256").update(password).digest("hex");

const log = (type, data = {}) => {
  mem.activity.unshift({ type, ...data, time: new Date().toISOString() });
  mem.activity.length = Math.min(mem.activity.length, 100);
};

async function db(table, action, data) {
  if (!supabase) return null;

  try {
    if (action === "insert")
      return await supabase.from(table).insert(data).select().single();

    if (action === "upsert")
      return await supabase.from(table).upsert(data).select().single();

    if (action === "select")
      return await supabase.from(table).select("*");

    if (action === "one")
      return await supabase.from(table).select("*").eq(data.key, data.value).maybeSingle();
  } catch (e) {
    console.log("DB:", e.message);
  }

  return null;
}

async function findUser(phone) {
  if (mem.users.has(phone)) return mem.users.get(phone);

  const r = await db("members", "one", {
    key: "phone",
    value: phone
  });

  if (r?.data) {
    const u = r.data;
    mem.users.set(phone, u);
    return u;
  }

  return null;
}

function esc(x = "") {
  return String(x)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function page(title, body) {
  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--c:#08783c;--bg:#f4f7f5;--card:#fff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);font-family:Arial;color:#111}
header{background:#063d20;color:white;padding:22px}
main{max-width:850px;margin:auto;padding:15px}
.card{background:var(--card);padding:18px;margin:12px 0;
border-radius:16px;box-shadow:0 2px 9px #0001}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
button,.btn{background:var(--c);color:#fff;border:0;border-radius:10px;
padding:11px 15px;text-decoration:none;display:inline-block;margin:4px}
input,select,textarea{width:100%;padding:11px;margin:5px 0;
border:1px solid #ccc;border-radius:9px}
.stat{font-size:26px;font-weight:bold}
.small{font-size:12px;opacity:.65}
</style>
</head>
<body>${body}</body></html>`;
}

/* WELCOME / LOGIN */

app.get("/", (req, res) => res.send(page("JR PHEEF", `
<header>
<h1>JR PHEEF</h1>
<p>Find. Match. Trade.</p>
</header>
<main>
<div class="card">
<h2>👋 Karibu JR PHEEF</h2>
<p>Buy • Sell • Services • Jobs • Transport • Opportunities</p>

<form method="POST" action="/signup">
<input name="name" placeholder="Full real name" required>
<input name="year" type="number" placeholder="Birth year" required>
<input name="phone" placeholder="Phone number" required>
<input name="password" type="password" placeholder="Create password" required>
<select name="type">
<option value="individual">Individual</option>
<option value="business">Business / Institution</option>
</select>
<button>Create account</button>
</form>
</div>

<div class="card">
<h3>Already a member?</h3>
<form method="POST" action="/login">
<input name="phone" placeholder="Phone number" required>
<input name="password" type="password" placeholder="Password" required>
<button>Sign in</button>
</form>
</div>
</main>`)));

/* SIGN UP */

app.post("/signup", async (req, res) => {
  const { name, year, phone, password, type } = req.body;

  if (!name || !year || !phone || !password)
    return res.status(400).send("Missing account information.");

  if (await findUser(phone))
    return res.send(`Account already exists.<br><a href="/">Sign in</a>`);

  const u = {
    id: id("USR"),
    full_name: name,
    name,
    birth_year: Number(year),
    phone,
    password_hash: hash(password),
    plan: "free",
    rewards: 0,
    credits: 0,
    referrals: 0,
    account_type: type || "individual",
    referral_code: `JRP-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    theme: "green",
    status: "active",
    verified: false,
    created_at: new Date().toISOString()
  };

  mem.users.set(phone, u);

  if (supabase) {
    const r = await db("members", "upsert", {
      full_name: name,
      phone,
      birth_year: Number(year),
      password_hash: u.password_hash,
      plan: "free",
      status: "active",
      verified: false,
      reputation: 0,
      referral_code: u.referral_code
    });

    if (r?.data) {
      u.id = r.data.id;
      mem.users.set(phone, u);
    }
  }

  log("ACCOUNT_CREATED", { phone, name });

  res.redirect(`/home?phone=${encodeURIComponent(phone)}`);
});

/* LOGIN */

app.post("/login", async (req, res) => {
  const { phone, password } = req.body;
  const u = await findUser(phone);

  if (!u || u.password_hash !== hash(password))
    return res.status(401).send(`
      <h2>Login failed</h2>
      <p>Phone number or password is incorrect.</p>
      <a href="/">Try again</a>
    `);

  u.last_login = new Date().toISOString();
  log("LOGIN", { phone });

  res.redirect(`/home?phone=${encodeURIComponent(phone)}`);
});

/* USER HOME */

app.get("/home", async (req, res) => {
  const u = await findUser(req.query.phone);
  if (!u) return res.redirect("/");

  const plan = plans[u.plan] || plans.free;

  res.send(page("JR PHEEF", `
<header>
<h1>JR PHEEF</h1>
<p>Welcome, ${esc(u.full_name || u.name)} 👋</p>
<b>${u.plan.toUpperCase()}</b>
</header>

<main>

<div class="grid">
<div class="card"><h3>🔎 Find</h3><p>Products, services, jobs and opportunities.</p></div>
<div class="card"><h3>🏪 Sell</h3><a class="btn" href="/list?phone=${encodeURIComponent(u.phone)}">Create listing</a></div>
<div class="card"><h3>🤝 Matches</h3><p>Find the right people and opportunities.</p></div>
<div class="card"><h3>💬 Deal Rooms</h3><a class="btn" href="/deal?phone=${encodeURIComponent(u.phone)}">Open</a></div>
<div class="card"><h3>🚚 Delivery</h3><a class="btn" href="/delivery?phone=${encodeURIComponent(u.phone)}">Request</a></div>
<div class="card"><h3>💳 Payments</h3><p>Secure payment flow — TEST MODE.</p></div>
</div>

<div class="card">
<h2>🎁 Your JR PHEEF Wallet</h2>
<p>Rewards: <b>KSh ${u.rewards || 0}</b></p>
<p>JR PHEEF Credits: <b>KSh ${u.credits || 0}</b></p>
<p>Referrals: <b>${u.referrals || 0}</b></p>
<p>Individual minimum withdrawal: KSh 200</p>
<p class="small">Rewards withdrawal and real M-Pesa transfers will activate after payment integration.</p>
</div>

<div class="card">
<h2>⭐ Membership</h2>
<p>FREE — first month free — KSh 30 match</p>
<p>PRO — KSh 99/month — KSh 20 match</p>
<p>PRIME — KSh 149/month — KSh 20 match</p>
<a class="btn" href="/upgrade?phone=${encodeURIComponent(u.phone)}&plan=pro">Try PRO</a>
<a class="btn" href="/upgrade?phone=${encodeURIComponent(u.phone)}&plan=prime">Try PRIME</a>
</div>

<div class="card">
<h2>🎟️ Coupons & Discounts</h2>
<form method="POST" action="/coupon">
<input type="hidden" name="phone" value="${esc(u.phone)}">
<input name="code" placeholder="Enter coupon">
<button>Apply</button>
</form>
</div>

<div class="card">
<h2>👥 Refer & Earn</h2>
<p>Your code: <b>${esc(u.referral_code || "JRP-NEW")}</b></p>
<p>Share your code with friends and businesses.</p>
</div>

<div class="card">
<h2>🎨 Theme</h2>
<select onchange="document.documentElement.style.setProperty('--c',this.value)">
<option value="#08783c">JR PHEEF</option>
<option value="#111">Black</option>
<option value="#2563eb">Blue</option>
<option value="#7c3aed">Purple</option>
<option value="#b8860b">Gold</option>
</select>
</div>

<a class="btn" href="/">Sign out</a>

</main>`));
});

/* LISTING */

app.get("/list", async (req, res) => {
  const u = await findUser(req.query.phone);
  if (!u) return res.redirect("/");

  res.send(page("Create Listing", `
<header><h1>🏪 JR PHEEF</h1></header>
<main>
<div class="card">
<h2>Create a listing</h2>
<form method="POST" action="/list">
<input type="hidden" name="phone" value="${esc(u.phone)}">
<input name="title" placeholder="What are you offering?" required>
<textarea name="description" placeholder="Description"></textarea>
<input name="price" type="number" placeholder="Price" min="100" required>
<input name="location" placeholder="Location" required>
<input name="category" placeholder="Category">
<input name="photos" placeholder="Photo URLs, separated by commas">
<button>Publish</button>
</form>
<p class="small">
Individuals may add multiple photos. Businesses can use up to 20 photos.
</p>
</div>
</main>`));
});

app.post("/list", async (req, res) => {
  const u = await findUser(req.body.phone);
  if (!u) return res.status(401).send("Sign in first.");

  const l = {
    id: id("LIST"),
    member_id: u.id,
    title: req.body.title,
    description: req.body.description || "",
    price: Number(req.body.price),
    location: req.body.location,
    category: req.body.category || "General",
    photos: (req.body.photos || "").split(",").map(x => x.trim()).filter(Boolean),
    status: "active",
    created_at: new Date().toISOString()
  };

  if (u.account_type === "business" && l.photos.length > 20)
    l.photos = l.photos.slice(0, 20);

  mem.listings.set(l.id, l);

  await db("jr_listings", "insert", l);

  log("LISTING_CREATED", { listing: l.id, phone: u.phone });

  res.send(page("Listing Published", `
<header><h1>JR PHEEF</h1></header>
<main><div class="card">
<h2>✅ Listing published</h2>
<p>${esc(l.title)}</p>
<p>KSh ${l.price}</p>
<p>${esc(l.location)}</p>
<a class="btn" href="/home?phone=${encodeURIComponent(u.phone)}">Return</a>
</div></main>`));
});

/* SEARCH */

app.get("/find", async (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  const list = [...mem.listings.values()].filter(x =>
    `${x.title} ${x.description} ${x.category} ${x.location}`
      .toLowerCase().includes(q)
  );

  res.send(page("JR PHEEF Find", `
<header><h1>🔎 Find</h1></header>
<main>
<div class="card">
<form>
<input name="q" value="${esc(q)}" placeholder="What are you looking for?">
<button>Search</button>
</form>
</div>

${list.map(x => `
<div class="card">
<h3>${esc(x.title)}</h3>
<p>${esc(x.description)}</p>
<b>KSh ${x.price}</b>
<p>${esc(x.location)}</p>
<a class="btn" href="/deal?listing=${encodeURIComponent(x.id)}">Match</a>
</div>`).join("") || `<div class="card"><p>No matches yet.</p></div>`}
</main>`));
});

/* DEAL ROOM */

app.get("/deal", async (req, res) => {
  const u = await findUser(req.query.phone);
  if (!u) return res.redirect("/");

  const fee = plans[u.plan]?.match || 30;

  const d = {
    id: id("DEAL"),
    buyer_id: u.id,
    buyer_phone: u.phone,
    seller_id: null,
    listing_id: req.query.listing || null,
    buyer_paid: 0,
    seller_paid: 0,
    status: "open",
    created_at: new Date().toISOString()
  };

  mem.deals.set(d.id, d);
  await db("jr_deals", "insert", d);

  log("DEAL_OPENED", { deal: d.id });

  res.send(page("Deal Room", `
<header><h1>🤝 JR PHEEF Deal Room</h1></header>
<main>
<div class="card">
<h2>Deal ${d.id}</h2>
<p>Match fee: <b>KSh ${fee}</b></p>
<p>Both parties can pay inside the Deal Room.</p>

<form method="POST" action="/deal/pay">
<input type="hidden" name="deal" value="${d.id}">
<input type="hidden" name="phone" value="${esc(u.phone)}">
<select name="side">
<option value="buyer">Buyer</option>
<option value="seller">Seller</option>
</select>
<button>💳 Pay KSh ${fee}</button>
</form>

<p class="small">
TEST PAYMENT ONLY. No real money is moved until M-Pesa/international payment APIs are connected.
</p>
</div>
</main>`));
});

/* TEST PAYMENT */

app.post("/deal/pay", async (req, res) => {
  const d = mem.deals.get(req.body.deal);
  const u = await findUser(req.body.phone);

  if (!d || !u) return res.status(404).send("Deal not found.");

  const fee = plans[u.plan]?.match || 30;

  const t = {
    id: id("PAY"),
    member_id: u.id,
    deal_id: d.id,
    type: req.body.side === "seller" ? "seller_match_fee" : "buyer_match_fee",
    amount: fee,
    status: "SUCCESS",
    method: "TEST",
    created_at: new Date().toISOString()
  };

  if (req.body.side === "seller") d.seller_paid = fee;
  else d.buyer_paid = fee;

  d.status =
    d.buyer_paid && d.seller_paid ? "paid_by_both" : "awaiting_other_party";

  mem.transactions.set(t.id, t);

  await db("jr_transactions", "insert", t);

  log("PAYMENT", { deal: d.id, amount: fee, side: req.body.side });

  res.send(page("Payment", `
<header><h1>JR PHEEF</h1></header>
<main><div class="card">
<h2>✅ Payment recorded</h2>
<p>KSh ${fee}</p>
<p>Side: ${esc(req.body.side)}</p>
<p>Status: ${d.status}</p>
<p class="small">TEST MODE — no real money moved.</p>
<a class="btn" href="/home?phone=${encodeURIComponent(u.phone)}">Return Home</a>
</div></main>`));
});

/* UPGRADE */

app.get("/upgrade", async (req, res) => {
  const u = await findUser(req.query.phone);
  const p = plans[req.query.plan];

  if (!u || !p) return res.status(400).send("Invalid upgrade.");

  u.plan = req.query.plan;

  if (supabase)
    await supabase.from("members")
      .update({ plan: u.plan })
      .eq("id", u.id);

  log("UPGRADE", { phone: u.phone, plan: u.plan });

  res.redirect(`/home?phone=${encodeURIComponent(u.phone)}`);
});

/* COUPON */

app.post("/coupon", async (req, res) => {
  const u = await findUser(req.body.phone);
  const c = mem.coupons.get((req.body.code || "").toUpperCase());

  if (!u || !c || !c.active)
    return res.send("Invalid or inactive coupon.");

  res.send(page("Coupon", `
<header><h1>🎟️ JR PHEEF</h1></header>
<main><div class="card">
<h2>✅ Coupon accepted</h2>
<p>Discount: ${c.discount}%</p>
<a class="btn" href="/home?phone=${encodeURIComponent(u.phone)}">Continue</a>
</div></main>`));
});

/* DELIVERY */

app.get("/delivery", async (req, res) => {
  const u = await findUser(req.query.phone);
  if (!u) return res.redirect("/");

  res.send(page("JR PHEEF Delivery", `
<header><h1>🚚 JR PHEEF DELIVERY</h1></header>
<main><div class="card">
<form method="POST" action="/delivery">
<input type="hidden" name="phone" value="${esc(u.phone)}">
<input name="item" placeholder="What needs moving?" required>
<input name="pickup" placeholder="Pickup location" required>
<input name="destination" placeholder="Destination" required>
<select name="transport">
<option>Rider</option>
<option>Motorbike</option>
<option>Car</option>
<option>Van</option>
<option>Truck</option>
<option>Other</option>
</select>
<button>Request delivery</button>
</form>
</div></main>`));
});

app.post("/delivery", async (req, res) => {
  const u = await findUser(req.body.phone);
  if (!u) return res.status(401).send("Sign in first.");

  const d = {
    id: id("DEL"),
    member_id: u.id,
    item: req.body.item,
    pickup: req.body.pickup,
    destination: req.body.destination,
    transport: req.body.transport,
    status: "requested",
    created_at: new Date().toISOString()
  };

  mem.deliveries.set(d.id, d);
  await db("jr_delivery", "insert", d);
  log("DELIVERY_REQUEST", { delivery: d.id });

  res.send(`<h2>🚚 Delivery requested</h2>
<p>JR PHEEF will match the request with an available transport provider.</p>
<a href="/home?phone=${encodeURIComponent(u.phone)}">Home</a>`);
});

/* WHATSAPP */

app.post("/api/webhook/whatsapp", async (req, res) => {
  const from = req.body.From || "";
  const msg = (req.body.Body || "").trim();
  const text = msg.toLowerCase();
  const u = await findUser(from);

  let reply;

  if (!u) {
    reply = `👋 Karibu JR PHEEF!

Find. Match. Trade.

Create your account first:
${BASE}

Then you can BUY, SELL, FIND, MATCH, use Deal Rooms and request DELIVERY.`;
  } else if (text === "buy") {
    reply = `🛒 Sawa ${u.name}!

Tell me what you're looking for, your budget and location.`;
  } else if (text === "sell") {
    reply = `🏪 Sawa!

Tell me what you're selling, price and location.

You can add your listing here:
${BASE}/list?phone=${encodeURIComponent(u.phone)}`;
  } else if (text === "deal") {
    reply = `🤝 Your JR PHEEF Deal Room:

${BASE}/deal?phone=${encodeURIComponent(u.phone)}

Your ${u.plan.toUpperCase()} match fee is KSh ${plans[u.plan]?.match || 30}.`;
  } else if (text === "delivery") {
    reply = `🚚 JR PHEEF DELIVERY

Tell me:
1. What is being moved?
2. Pickup
3. Destination
4. Preferred transport`;
  } else if (text === "rewards") {
    reply = `🎁 Your JR PHEEF rewards:

Rewards: KSh ${u.rewards || 0}
Credits: KSh ${u.credits || 0}
Referrals: ${u.referrals || 0}

Minimum individual withdrawal: KSh 200.`;
  } else if (["hi","hello","hey","help"].includes(text)) {
    reply = `👋 Karibu ${u.name}!

JR PHEEF:
🛒 BUY
🏪 SELL
🔎 FIND
🤝 MATCH
💬 DEAL
🚚 DELIVERY
🎁 REWARDS
⭐ UPGRADE

Open your JR PHEEF:
${BASE}/home?phone=${encodeURIComponent(u.phone)}`;
  } else {
    reply = `🤝 JR PHEEF imekupata!

Tell me what you need or type:
BUY
SELL
DEAL
DELIVERY
REWARDS
HELP`;
  }

  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(reply);

  log("WHATSAPP", { from, message: msg });

  res.type("text/xml").send(twiml.toString());
});

/* OWNER COMMAND CENTER */

app.get("/owner", (req, res) => {
  if (!process.env.OWNER_KEY || req.query.key !== process.env.OWNER_KEY)
    return res.status(403).send("🔒 Owner access denied.");

  const revenue = [...mem.transactions.values()]
    .filter(x => x.status === "SUCCESS")
    .reduce((a, x) => a + Number(x.amount || 0), 0);

  res.send(page("JR PHEEF Command Center", `
<header>
<h1>👑 JR PHEEF</h1>
<p>COMMAND CENTER</p>
</header>
<main>

<div class="grid">
<div class="card"><h3>👥 Members</h3><div class="stat">${mem.users.size}</div></div>
<div class="card"><h3>🏪 Listings</h3><div class="stat">${mem.listings.size}</div></div>
<div class="card"><h3>🤝 Deals</h3><div class="stat">${mem.deals.size}</div></div>
<div class="card"><h3>💳 Transactions</h3><div class="stat">${mem.transactions.size}</div></div>
<div class="card"><h3>🚚 Deliveries</h3><div class="stat">${mem.deliveries.size}</div></div>
<div class="card"><h3>💰 TEST REVENUE</h3><div class="stat">KSh ${revenue}</div></div>
</div>

<div class="card">
<h2>⚙️ JR PHEEF Systems</h2>
<p>🟢 Accounts</p>
<p>🟢 Buyer/Seller unified system</p>
<p>🟢 Listings</p>
<p>🟢 Matching</p>
<p>🟢 Deal Rooms</p>
<p>🟢 WhatsApp</p>
<p>🟢 Rewards / Credits</p>
<p>🟢 Referrals</p>
<p>🟢 Coupons</p>
<p>🟢 PRO / PRIME</p>
<p>🟢 Delivery requests</p>
<p>🟡 M-Pesa — waiting for API</p>
<p>🟡 International payments — waiting for provider</p>
</div>

<div class="card">
<h2>👥 Members</h2>
${[...mem.users.values()].map(u => `
<p>
<b>${esc(u.full_name || u.name)}</b>
— ${esc(u.plan || "free").toUpperCase()}
<br>${esc(u.phone)}
<br><span class="small">${esc(u.account_type || "individual")}</span>
</p>`).join("") || "<p>No members yet.</p>"}
</div>

<div class="card">
<h2>🏪 Listings</h2>
${[...mem.listings.values()].map(x => `
<p><b>${esc(x.title)}</b> — KSh ${x.price} — ${esc(x.location)}</p>
`).join("") || "<p>No listings yet.</p>"}
</div>

<div class="card">
<h2>🤝 Deal Rooms</h2>
${[...mem.deals.values()].map(d => `
<p><b>${d.id}</b> — ${d.status}</p>
`).join("") || "<p>No deals yet.</p>"}
</div>

<div class="card">
<h2>🔔 Activity</h2>
${mem.activity.map(a => `
<p>• <b>${esc(a.type)}</b>
<br><span class="small">${esc(a.time)}</span></p>
`).join("") || "<p>No activity yet.</p>"}
</div>

</main>`));
});

/* HEALTH */

app.get("/health", (req, res) => res.json({
  ok: true,
  service: "JR PHEEF",
  supabase: !!supabase,
  mode: "TEST",
  users: mem.users.size,
  listings: mem.listings.size,
  deals: mem.deals.size,
  transactions: mem.transactions.size,
  deliveries: mem.deliveries.size
}));

app.listen(PORT, () => {
  console.log(`🚀 JR PHEEF running on ${PORT}`);
  console.log(`🗄️ Supabase: ${supabase ? "CONNECTED" : "NOT CONNECTED"}`);
  console.log("👤 Accounts/Login: ACTIVE");
  console.log("🏠 Unified Buyer/Seller Home: ACTIVE");
  console.log("🏪 Marketplace Listings: ACTIVE");
  console.log("🔎 Search/Matching: ACTIVE");
  console.log("🤝 Deal Rooms: ACTIVE");
  console.log("💬 WhatsApp: ACTIVE");
  console.log("🎁 Rewards/Referrals/Coupons: ACTIVE");
  console.log("⭐ PRO/PRIME: ACTIVE");
  console.log("🚚 Delivery: ACTIVE");
  console.log("👑 Owner Command Center: ACTIVE");
  console.log("💳 Payments: TEST MODE");
  console.log("📱 M-Pesa: NOT CONNECTED");
}); 
