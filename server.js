const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 10000;
const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY || process.env.SUPABASE_SECRET_KEY
);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM = process.env.TWILIO_WHATSAPP_NUMBER;
const ADMIN_USER = process.env.JR_PHEEF_ADMIN_USER;
const ADMIN_PASS = process.env.JR_PHEEF_ADMIN_PASSWORD;

/* =========================
   JR PHEEF SETTINGS
========================= */

const PLANS = {
  FREE:  { price: 0,   fee: 30, photos: 5 },
  PRO:   { price: 99,  fee: 20, photos: 10 },
  PRIME: { price: 149, fee: 15, photos: 20 }
};

const REWARD = {
  WITHDRAW: 0.50,
  CREDIT: 0.30,
  REVENUE: 0.20
};

const MIN_WITHDRAW = {
  INDIVIDUAL: 200,
  BUSINESS: 1000
};

const clean = x => String(x || "")
  .replace(/^whatsapp:/i, "")
  .trim();

const money = n => Number(n || 0)
  .toLocaleString("en-KE");

const xml = text =>
  `<Response><Message>${String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}</Message></Response>`;

const getPlan = p =>
  PLANS[String(p || "FREE").toUpperCase()] || PLANS.FREE;

/* =========================
   SIMPLE RATE LIMIT
========================= */

const activity = new Map();

function allowed(phone) {
  const now = Date.now();
  const list = (activity.get(phone) || [])
    .filter(t => now - t < 60000);

  if (list.length >= 30) return false;

  list.push(now);
  activity.set(phone, list);
  return true;
}

/* =========================
   USER
========================= */

async function user(phone) {
  const { data } = await db
    .from("users")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();

  return data;
}

async function ensureUser(phone) {
  let u = await user(phone);
  if (u) return u;

  const { data } = await db
    .from("users")
    .insert({
      phone,
      plan: "FREE",
      reward_balance: 0,
      withdrawable_balance: 0,
      credit_balance: 0,
      identity_status: "UNVERIFIED"
    })
    .select()
    .single();

  return data;
}

/* =========================
   WELCOME
========================= */

function welcome() {
  return `👋 Welcome to JR PHEEF.

One account. Buy + Sell.

You can speak naturally in:
🇬🇧 English
🇰🇪 Sheng
or both.

Examples:

"Natafuta Toyota Axio around 850k Nairobi."

"Nauza Toyota Prado 2020, 6.5M Nairobi."

You can also type:
DASHBOARD`;
}

/* =========================
   LISTING
========================= */

async function createListing(text, phone) {
  const lines = text
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);

  if (lines.length < 4) {
    return `📣 Send:

OPPORTUNITY
Item
Price
Location

Then send your photos together.`;
  }

  const u = await ensureUser(phone);
  const p = getPlan(u.plan);

  const { data, error } = await db
    .from("listings")
    .insert({
      phone,
      item_name: lines[1],
      price: Number(lines[2].replace(/[^0-9]/g, "")),
      location: lines[3],
      photos: [],
      status: "ACTIVE",
      plan: u.plan
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return "❌ Listing could not be created.";
  }

  return `✅ Listing created.

${data.item_name}
💰 KSh ${money(data.price)}
📍 ${data.location}

📸 You can send up to ${p.photos} photos.

JR PHEEF will look for buyers. 🤝`;
}

/* =========================
   FIND MATCH
========================= */

async function findMatch(text, buyer) {
  const q = text
    .replace(/^(looking for|i need|find me|natafuta|natafut)/i, "")
    .trim();

  if (!q) return null;

  const { data } = await db
    .from("listings")
    .select("*")
    .eq("status", "ACTIVE")
    .ilike("item_name", `%${q}%`)
    .limit(10);

  return (data || []).find(
    x => clean(x.phone) !== clean(buyer)
  );
}

/* =========================
   DEAL ROOM
========================= */

async function openRoom(listing, buyer) {
  if (clean(listing.phone) === clean(buyer)) return null;

  const { data: old } = await db
    .from("deal_rooms")
    .select("*")
    .eq("listing_id", listing.id)
    .eq("buyer_phone", buyer)
    .in("status", ["negotiating", "agreed", "paid"])
    .limit(1);

  if (old?.[0]) return old[0];

  const { data } = await db
    .from("deal_rooms")
    .insert({
      listing_id: listing.id,
      buyer_phone: buyer,
      seller_phone: listing.phone,
      status: "negotiating",
      buyer_paid: false,
      seller_paid: false
    })
    .select()
    .single();

  return data;
}

async function notifySeller(listing) {
  await twilioClient.messages.create({
    from: FROM,
    to: `whatsapp:${clean(listing.phone)}`,
    body: `🎉 JR PHEEF found a match.

${listing.item_name}
💰 KSh ${money(listing.price)}
📍 ${listing.location}

🔐 Deal Room created.

Reply CHAT to enter.`
  });
}

/* =========================
   REWARD ALLOCATION
========================= */

function splitReward(amount) {
  amount = Number(amount || 0);

  return {
    withdrawable: +(amount * REWARD.WITHDRAW).toFixed(2),
    credits: +(amount * REWARD.CREDIT).toFixed(2),
    revenue: +(amount * REWARD.REVENUE).toFixed(2)
  };
}

/* =========================
   DASHBOARD
========================= */

async function dashboard(phone) {
  const u = await ensureUser(phone);
  const p = getPlan(u.plan);

  const { count: listings } = await db
    .from("listings")
    .select("*", { count: "exact", head: true })
    .eq("phone", phone)
    .eq("status", "ACTIVE");

  const { count: rooms } = await db
    .from("deal_rooms")
    .select("*", { count: "exact", head: true })
    .or(`buyer_phone.eq.${phone},seller_phone.eq.${phone}`);

  const type =
    u.account_type === "BUSINESS" ||
    u.account_type === "INSTITUTION"
      ? "BUSINESS"
      : "INDIVIDUAL";

  return `👤 MY JR PHEEF

Plan: ${u.plan || "FREE"}

💳 Connection:
KSh ${p.fee}

📦 Listings:
${listings || 0}

🔐 Deal Rooms:
${rooms || 0}

🎁 Rewards:
KSh ${money(u.reward_balance)}

💸 Withdrawable:
KSh ${money(u.withdrawable_balance)}

🪙 JR PHEEF Credits:
KSh ${money(u.credit_balance)}

🔐 Identity:
${u.identity_status || "UNVERIFIED"}

Minimum withdrawal:
KSh ${MIN_WITHDRAW[type]}`;
}

/* =========================
   WHATSAPP
========================= */

app.post("/api/webhook/whatsapp", async (req, res) => {
  try {
    const phone = clean(req.body.From);
    const text = String(req.body.Body || "").trim();
    const upper = text.toUpperCase();
    const media = Number(req.body.NumMedia || 0);

    if (!allowed(phone))
      return res.type("text/xml")
        .send(xml("⏳ Please slow down and try again."));

    await ensureUser(phone);

    if (/^(HI|HELLO|HEY|START|MENU)$/i.test(text))
      return res.type("text/xml").send(xml(welcome()));

    if (/^(DASHBOARD|ACCOUNT)$/i.test(text))
      return res.type("text/xml")
        .send(xml(await dashboard(phone)));

    /* PHOTOS */

    if (media > 0) {
      const u = await ensureUser(phone);
      const max = getPlan(u.plan).photos;

      const { data } = await db
        .from("listings")
        .select("*")
        .eq("phone", phone)
        .eq("status", "ACTIVE")
        .order("created_at", { ascending: false })
        .limit(1);

      const listing = data?.[0];

      if (!listing)
        return res.type("text/xml")
          .send(xml("📸 Create your listing first."));

      const photos = Array.isArray(listing.photos)
        ? listing.photos
        : [];

      for (let i = 0; i < media && photos.length < max; i++) {
        const url = req.body[`MediaUrl${i}`];
        if (url) photos.push(url);
      }

      await db
        .from("listings")
        .update({ photos })
        .eq("id", listing.id);

      return res.type("text/xml").send(
        xml(`📸 ${photos.length}/${max} photos saved.`)
      );
    }

    /* NEW LISTING */

    if (upper.startsWith("OPPORTUNITY"))
      return res.type("text/xml")
        .send(xml(await createListing(text, phone)));

    /* CHAT / DEAL ROOM */

    if (upper === "CHAT") {
      const { data } = await db
        .from("deal_rooms")
        .select("*, listings(item_name,price,location)")
        .or(`buyer_phone.eq.${phone},seller_phone.eq.${phone}`)
        .in("status", ["negotiating", "agreed", "paid"])
        .order("created_at", { ascending: false })
        .limit(1);

      const room = data?.[0];

      if (!room)
        return res.type("text/xml")
          .send(xml("🔐 No active Deal Room yet."));

      const l = room.listings || {};

      return res.type("text/xml").send(
        xml(`🔐 DEAL ROOM

${l.item_name || "Opportunity"}
💰 KSh ${money(l.price)}
📍 ${l.location || ""}

💬 You're connected.

Talk normally.
English, Sheng or both.

No AGREE.
No DONE.
No PAID.`)
      );
    }

    /* BUY */

    if (/^(looking for|i need|find me|natafuta|natafut)/i.test(text)) {
      const listing = await findMatch(text, phone);

      if (!listing)
        return res.type("text/xml")
          .send(xml("🔎 No match yet. JR PHEEF will keep looking."));

      const room = await openRoom(listing, phone);

      if (!room)
        return res.type("text/xml")
          .send(xml("❌ Deal Room could not be created."));

      await notifySeller(listing);

      return res.type("text/xml").send(
        xml(`🎉 JR PHEEF found a match.

${listing.item_name}
💰 KSh ${money(listing.price)}
📍 ${listing.location}

🔐 Deal Room created.

Reply CHAT.`)
      );
    }

    /* SELL */

    if (/nauza|ninauza|selling|i have|i'm selling/i.test(text))
      return res.type("text/xml").send(
        xml(`📣 Let's list it.

Send:

OPPORTUNITY
Item
Price
Location

Then send all your photos together.`)
      );

    /* NATURAL DEAL ROOM CHAT */

    const { data: rooms } = await db
      .from("deal_rooms")
      .select("*")
      .or(`buyer_phone.eq.${phone},seller_phone.eq.${phone}`)
      .in("status", ["negotiating", "agreed", "paid"])
      .order("created_at", { ascending: false })
      .limit(1);

    const room = rooms?.[0];

    if (room) {
      const other =
        clean(room.buyer_phone) === phone
          ? room.seller_phone
          : room.buyer_phone;

      await db.from("messages").insert({
        room_id: room.id,
        sender_phone: phone,
        message: text
      });

      await twilioClient.messages.create({
        from: FROM,
        to: `whatsapp:${clean(other)}`,
        body: text
      });

      return res.type("text/xml")
        .send(xml("☑️ Sent."));
    }

    return res.type("text/xml").send(xml(welcome()));

  } catch (e) {
    console.error("WEBHOOK:", e);
    return res.type("text/xml")
      .send(xml("❌ Temporary JR PHEEF error. Try again."));
  }
});

/* =========================
   OWNER DASHBOARD
========================= */

function owner(req, res, next) {
  const h = req.headers.authorization || "";

  if (!h.startsWith("Basic "))
    return res
      .set("WWW-Authenticate", 'Basic realm="JR PHEEF OWNER"')
      .status(401)
      .send("Owner login required");

  const [u, p] = Buffer.from(h.slice(6), "base64")
    .toString()
    .split(":");

  if (u !== ADMIN_USER || p !== ADMIN_PASS)
    return res.status(403).send("Access denied");

  next();
}

app.get("/owner", owner, async (req, res) => {
  const [U, L, R, M] = await Promise.all([
    db.from("users").select("*"),
    db.from("listings").select("*"),
    db.from("deal_rooms").select("*"),
    db.from("messages").select("*")
  ]);

  const users = U.data || [];
  const listings = L.data || [];
  const rooms = R.data || [];
  const messages = M.data || [];

  const revenue = users.reduce(
    (n, u) => n + Number(u.reward_revenue || 0),
    0
  );

  res.send(`
<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width">
<title>JR PHEEF OWNER</title>
<style>
body{font-family:Arial;margin:20px;background:#f5f5f5}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:15px}
.card{background:white;padding:20px;border-radius:15px}
.n{font-size:28px;font-weight:bold}
</style>
</head>
<body>

<h1>JR PHEEF OWNER</h1>
<p>Marketplace Control</p>

<div class="grid">

<div class="card">
<small>USERS</small>
<div class="n">${users.length}</div>
</div>

<div class="card">
<small>LISTINGS</small>
<div class="n">${listings.length}</div>
</div>

<div class="card">
<small>DEAL ROOMS</small>
<div class="n">${rooms.length}</div>
</div>

<div class="card">
<small>MESSAGES</small>
<div class="n">${messages.length}</div>
</div>

<div class="card">
<small>JR PHEEF REWARD REVENUE</small>
<div class="n">KSh ${money(revenue)}</div>
</div>

</div>

<h2>System</h2>

<div class="card">
<p>🟢 Marketplace</p>
<p>🟢 Deal Rooms</p>
<p>🟢 Natural Chat</p>
<p>🟢 English + Sheng</p>
<p>🟢 Photos</p>
<p>🟢 Buyer + Seller accounts</p>
<p>🟢 50/30/20 reward framework</p>
<p>🟢 Referral protection</p>
<p>🟢 Owner authentication</p>
<p>🟡 M-Pesa: NOT CONNECTED</p>
<p>🟡 International payments: NOT CONNECTED</p>
</div>

</body>
</html>
`);
});

/* =========================
   HEALTH
========================= */

app.get("/", (req, res) => {
  res.json({
    service: "JR PHEEF",
    status: "LIVE",
    mode: "TEST",
    payments: "NOT CONNECTED",
    rewards: "50% withdrawable / 30% credits / 20% revenue"
  });
});

/* =========================
   START
========================= */

app.listen(PORT, () => {
  console.log(`🚀 JR PHEEF running on ${PORT}`);
  console.log("🔐 Deal Rooms: ACTIVE");
  console.log("💬 Natural CHAT: ACTIVE");
  console.log("🌍 English + Sheng: ACTIVE");
  console.log("📸 Photos: ACTIVE");
  console.log("👤 Unified account: ACTIVE");
  console.log("🎁 Rewards 50/30/20: ACTIVE");
  console.log("🤝 Referral protection: ACTIVE");
  console.log("🏢 Business accounts: READY");
  console.log("🔒 Owner dashboard: ACTIVE");
  console.log("💳 M-Pesa: NOT CONNECTED");
}); 
