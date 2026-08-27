const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 10000;
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  : null;

const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

const users = new Map();
const deals = new Map();
const payments = new Map();

const plans = {
  free: { price: 0, matchFee: 30 },
  pro: { price: 99, matchFee: 20 },
  prime: { price: 149, matchFee: 20 }
};

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function home(req, res) {
  res.send(`
  <html><head><title>JR PHEEF</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
  body{font-family:Arial;margin:0;background:#f4f8f5;text-align:center}
  header{background:#073b20;color:white;padding:28px}
  .box{max-width:500px;margin:35px auto;background:white;padding:30px;border-radius:18px;box-shadow:0 3px 15px #ccc}
  button{padding:13px 22px;margin:7px;border:0;border-radius:10px;background:#168a45;color:white}
  input{padding:13px;width:85%;margin:7px;border:1px solid #ccc;border-radius:8px}
  </style></head>
  <body>
  <header><h1>JR PHEEF</h1><p>Find. Match. Trade.</p></header>
  <div class="box">
    <h2>Welcome to JR PHEEF 👋</h2>
    <p>Buy, sell, find services, opportunities and delivery.</p>
    <form method="POST" action="/signup">
      <input name="name" placeholder="Real name" required><br>
      <input name="year" type="number" placeholder="Birth year" required><br>
      <input name="phone" placeholder="Phone number" required><br>
      <button>Create Account</button>
    </form>
    <p>Already registered?</p>
    <form method="GET" action="/dashboard">
      <input name="phone" placeholder="Phone number" required><br>
      <button>Sign In</button>
    </form>
  </div></body></html>`);
}

app.get("/", home);

app.post("/signup", async (req, res) => {
  const { name, year, phone } = req.body;
  const user = {
    id: id("USR"),
    name,
    birthYear: year,
    phone,
    plan: "free",
    credits: 0,
    rewards: 0,
    referrals: 0,
    createdAt: new Date().toISOString()
  };

  users.set(phone, user);

  if (supabase) {
    await supabase.from("users").insert({
      name, birth_year: year, phone, plan: "free"
    }).catch(() => {});
  }

  res.redirect(`/dashboard?phone=${encodeURIComponent(phone)}`);
});

app.get("/dashboard", (req, res) => {
  const user = users.get(req.query.phone);

  if (!user)
    return res.status(401).send("Account not found. Please create an account first.");

  res.send(`
  <html><head><title>JR PHEEF Dashboard</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
  body{font-family:Arial;background:#f4f8f5;margin:0}
  .top{background:#073b20;color:white;padding:22px}
  .card{background:white;margin:15px;padding:20px;border-radius:15px}
  button{padding:12px;border:0;border-radius:9px;background:#168a45;color:white}
  </style></head>
  <body>
  <div class="top"><h2>JR PHEEF Dashboard</h2>
  Welcome, ${user.name} 👋<br>Plan: <b>${user.plan.toUpperCase()}</b></div>

  <div class="card">
    <h3>🛒 Buy</h3>
    Find products, services and opportunities.
  </div>

  <div class="card">
    <h3>🏪 Sell</h3>
    List your products and services.
  </div>

  <div class="card">
    <h3>🤝 Deal Rooms</h3>
    Agree, chat and pay securely.
    <p><a href="/deal?phone=${encodeURIComponent(user.phone)}">
    <button>Open Test Deal</button></a></p>
  </div>

  <div class="card">
    <h3>🎁 Rewards</h3>
    Rewards: KSh ${user.rewards}<br>
    JR PHEEF Credits: ${user.credits}
  </div>

  <div class="card">
    <h3>⭐ Upgrade</h3>
    <p>PRO — KSh 99/month</p>
    <p>PRIME — KSh 149/month</p>
    <a href="/upgrade?phone=${encodeURIComponent(user.phone)}&plan=pro">
    <button>Test PRO</button></a>
    <a href="/upgrade?phone=${encodeURIComponent(user.phone)}&plan=prime">
    <button>Test PRIME</button></a>
  </div>
  </body></html>`);
});

app.get("/deal", (req, res) => {
  const phone = req.query.phone;
  const user = users.get(phone);

  if (!user) return res.status(401).send("Please sign in first.");

  const deal = {
    id: id("DEAL"),
    buyer: user.phone,
    seller: "TEST-SELLER",
    amount: 30,
    status: "awaiting_payment"
  };

  deals.set(deal.id, deal);

  res.send(`
  <html><body style="font-family:Arial;text-align:center;padding:30px">
  <h1>🤝 JR PHEEF Deal Room</h1>
  <p>Buyer: ${user.name}</p>
  <p>Match fee: <b>KSh 30</b></p>
  <p>TEST MODE — no real money will move.</p>
  <form method="POST" action="/pay">
    <input type="hidden" name="deal" value="${deal.id}">
    <button style="padding:15px 30px;background:#168a45;color:white;border:0;border-radius:10px">
    💳 Pay KSh 30
    </button>
  </form>
  </body></html>`);
});

app.post("/pay", (req, res) => {
  const deal = deals.get(req.body.deal);
  if (!deal) return res.status(404).send("Deal not found.");

  const payment = {
    id: id("PAY"),
    deal: deal.id,
    amount: deal.amount,
    status: "SUCCESS",
    mode: "TEST",
    createdAt: new Date().toISOString()
  };

  payments.set(payment.id, payment);
  deal.status = "paid";

  res.send(`
  <html><body style="font-family:Arial;text-align:center;padding:40px">
  <div style="font-size:70px">✅</div>
  <h1>Payment Successful</h1>
  <h2>KSh ${payment.amount}</h2>
  <p>JR PHEEF Deal Room payment confirmed.</p>
  <p><b>Transaction:</b> ${payment.id}</p>
  <p>TEST MODE — no real M-Pesa transaction was made.</p>
  <a href="/"><button style="padding:14px 25px">Done</button></a>
  </body></html>`);
});

app.get("/upgrade", (req, res) => {
  const user = users.get(req.query.phone);
  const plan = plans[req.query.plan];

  if (!user || !plan) return res.status(400).send("Invalid upgrade.");

  user.plan = req.query.plan;
  user.matchFee = plan.matchFee;

  res.send(`
  <html><body style="font-family:Arial;text-align:center;padding:40px">
  <h1>⭐ JR PHEEF ${req.query.plan.toUpperCase()}</h1>
  <h2>TEST UPGRADE COMPLETE</h2>
  <p>Monthly price: KSh ${plan.price}</p>
  <p>Your match fee is now KSh ${plan.matchFee}</p>
  <a href="/dashboard?phone=${encodeURIComponent(user.phone)}">
  <button style="padding:14px 25px">Return to Dashboard</button></a>
  </body></html>`);
});

app.get("/owner", (req, res) => {
  if (req.query.key !== process.env.OWNER_KEY)
    return res.status(403).send("Access denied.");

  res.json({
    platform: "JR PHEEF",
    users: users.size,
    deals: deals.size,
    payments: payments.size,
    plans,
    testMode: true,
    mpesa: "NOT CONNECTED"
  });
});

app.post("/api/webhook/whatsapp", (req, res) => {
  const from = req.body.From || "";
  const message = (req.body.Body || "").trim();

  const reply =
    message.toLowerCase() === "buy"
      ? "🛒 JR PHEEF: Sawa! What are you looking for and your budget?"
      : message.toLowerCase() === "sell"
      ? "🏪 JR PHEEF: Sawa! Tell me what you're selling, price and location."
      : `🤝 JR PHEEF: ${message ? "Nimekupata! Let's find the right opportunity." : "Karibu JR PHEEF! Type BUY or SELL to begin."}`;

  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(reply);
  res.type("text/xml").send(twiml.toString());
});

app.get("/health", (req, res) =>
  res.json({ ok: true, service: "JR PHEEF", mode: "TEST" })
);

app.listen(PORT, () => {
  console.log(`🚀 JR PHEEF running on port ${PORT}`);
  console.log("🛒 Marketplace: ACTIVE");
  console.log("🤝 Deal Rooms: ACTIVE");
  console.log("👤 Unified accounts: ACTIVE");
  console.log("💳 TEST payments: ACTIVE");
  console.log("💰 Real M-Pesa: NOT CONNECTED");
  console.log("🔔 Notifications: READY");
}); 
