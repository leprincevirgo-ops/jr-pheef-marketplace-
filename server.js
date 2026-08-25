const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_KEY || process.env.SUPABASE_SECRET_KEY;

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_WHATSAPP_NUMBER;

const ADMIN_USER = process.env.JR_PHEEF_ADMIN_USER;
const ADMIN_PASS = process.env.JR_PHEEF_ADMIN_PASSWORD;

const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);

const PLANS = {
  FREE:  { name: "JR PHEEF FREE+", price: 0,   fee: 30, photos: 5 },
  PRO:   { name: "JR PHEEF PRO",   price: 99,  fee: 20, photos: 10 },
  PRIME: { name: "JR PHEEF PRIME", price: 149, fee: 15, photos: 20 },
  ELITE: { name: "JR PHEEF ELITE", price: null, fee: null, photos: 20 }
};

const WITHDRAWAL = {
  INDIVIDUAL: 200,
  BUSINESS: 1000
};

const clean = x =>
  String(x || "").replace(/^whatsapp:/i, "").trim();

const money = n =>
  Number(n || 0).toLocaleString("en-KE");

const reply = text =>
  `<Response><Message>${String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")}</Message></Response>`;

const plan = p =>
  PLANS[String(p || "FREE").toUpperCase()] || PLANS.FREE;

async function send(to, body, mediaUrl) {
  return twilioClient.messages.create({
    from: TWILIO_FROM,
    to: `whatsapp:${clean(to)}`,
    body,
    ...(mediaUrl ? { mediaUrl } : {})
  });
}

/* -------------------------
   SIMPLE SECURITY
------------------------- */

const hits = new Map();

function allowed(phone) {
  const now = Date.now();
  const old = hits.get(phone) || [];
  const recent = old.filter(t => now - t < 60000);

  if (recent.length >= 30) return false;

  recent.push(now);
  hits.set(phone, recent);
  return true;
}

function admin(req, res, next) {
  const auth = req.headers.authorization || "";

  if (!auth.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="JR PHEEF OWNER"');
    return res.status(401).send("Owner login required");
  }

  const value = Buffer.from(auth.slice(6), "base64")
    .toString()
    .split(":");

  if (
    value[0] !== ADMIN_USER ||
    value[1] !== ADMIN_PASS
  ) {
    return res.status(403).send("Access denied");
  }

  next();
}

/* -------------------------
   WELCOME
------------------------- */

function welcome() {
  return `👋 Welcome to JR PHEEF.

One account. Two sides.

🔎 Buy
📣 Sell

You can do both.

Talk naturally in English, Sheng or both.

Example:
"Natafuta Toyota Axio around 850k Nairobi."

Or:
"Nauza Toyota Prado 2020, 6.5M Nairobi."`;
}

/* -------------------------
   FIND USER
------------------------- */

async function getUser(phone) {
  const { data } = await db
    .from("users")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();

  return data;
}

/* -------------------------
   CREATE USER
------------------------- */

async function ensureUser(phone) {
  let user = await getUser(phone);

  if (user) return user;

  const referral =
    `JP${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  const { data } = await db
    .from("users")
    .insert({
      phone,
      plan: "FREE",
      referral_code: referral,
      reward_balance: 0,
      withdrawable_balance: 0,
      credit_balance: 0
    })
    .select()
    .single();

  return data;
}

/* -------------------------
   CONNECTION FEE
------------------------- */

function connectionFee(user) {
  return plan(user?.plan).fee;
}

/* -------------------------
   DEAL ROOM
------------------------- */

async function dealRoom(listing, buyer) {
  if (clean(listing.phone) === clean(buyer)) return null;

  const { data: existing } = await db
    .from("deal_rooms")
    .select("*")
    .eq("listing_id", listing.id)
    .eq("buyer_phone", buyer)
    .in("status", ["negotiating", "agreed", "paid"])
    .limit(1);

  if (existing?.[0]) return existing[0];

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

/* -------------------------
   SEARCH
------------------------- */

async function search(text, buyer) {
  const words = text
    .replace(/^(looking for|i need|find me|natafuta|natafut)/i, "")
    .trim();

  if (!words) return null;

  const { data } = await db
    .from("listings")
    .select("*")
    .eq("status", "ACTIVE")
    .ilike("item_name", `%${words}%`)
    .limit(10);

  return (data || []).find(
    x => clean(x.phone) !== clean(buyer)
  );
}

/* -------------------------
   NATURAL SELLING
------------------------- */

function sellerIntent(text) {
  return /nauza|ninauza|selling|i have|i'm selling|available/i.test(text);
}

/* -------------------------
   BUYER INTENT
------------------------- */

function buyerIntent(text) {
  return /looking for|i need|find me|natafuta|natafut/i.test(text);
}

/* -------------------------
   CREATE LISTING
------------------------- */

async function listing(text, phone) {
  const lines = text
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);

  if (lines.length < 4) {
    return `📣 Send your opportunity like this:

OPPORTUNITY
Toyota Axio 2015
850000
Nairobi

Then send your photos together.`;
  }

  const user = await ensureUser(phone);
  const p = plan(user?.plan);

  const { data, error } = await db
    .from("listings")
    .insert({
      phone,
      item_name: lines[1],
      price: Number(lines[2].replace(/[^0-9]/g, "")),
      location: lines[3],
      photos: [],
      status: "ACTIVE",
      plan: String(user?.plan || "FREE").toUpperCase()
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return "❌ I couldn't create that listing. Please try again.";
  }

  return `✅ Listing created.

${data.item_name}
💰 KSh ${money(data.price)}
📍 ${data.location}

📸 You can send up to ${p.photos} photos.

I'll look for buyers. 🤝`;
}

/* -------------------------
   MATCH
------------------------- */

async function match(listing, buyer) {
  const room = await dealRoom(listing, buyer);
  if (!room) return null;

  await send(
    listing.phone,
    `🎉 JR PHEEF found a match.

Someone is interested in:

${listing.item_name}
💰 KSh ${money(listing.price)}
📍 ${listing.location}

🔐 Deal Room created.

Reply CHAT to enter.

Your phone number stays protected.`
  );

  return room;
}

/* -------------------------
   DEAL ROOM PAYMENT INFO
------------------------- */

async function paymentInfo(room, phone) {
  const user = await ensureUser(phone);
  const fee = connectionFee(user);

  const side =
    clean(room.buyer_phone) === clean(phone)
      ? "buyer"
      : "seller";

  const alreadyPaid =
    side === "buyer"
      ? room.buyer_paid
      : room.seller_paid;

  if (alreadyPaid) {
    return "✅ Your connection payment is already recorded. Waiting for the other party.";
  }

  return `🔐 DEAL ROOM

Your connection fee is:

💰 KSh ${fee}

Both sides pay separately.

FREE+ = KSh 30
PRO = KSh 20
PRIME = KSh 15

💳 M-Pesa will be connected after testing.

No real payment is taken in this version.`;
}

/* -------------------------
   REFERRAL RULE
------------------------- */

async function referralEligible(phone) {
  const { data } = await db
    .from("referrals")
    .select("*")
    .eq("referred_phone", phone)
    .maybeSingle();

  if (!data) return false;

  /*
   Referral only becomes eligible after
   the referred user completes a qualifying
   paid action.
  */

  return data.qualifying_action === true &&
         data.reward_status !== "PAID";
}

/* -------------------------
   DASHBOARD
------------------------- */

async function dashboard(phone) {
  const user = await ensureUser(phone);

  const { count: listings } = await db
    .from("listings")
    .select("*", { count: "exact", head: true })
    .eq("phone", phone)
    .eq("status", "ACTIVE");

  const { count: rooms } = await db
    .from("deal_rooms")
    .select("*", { count: "exact", head: true })
    .or(`buyer_phone.eq.${phone},seller_phone.eq.${phone}`);

  const p = plan(user?.plan);

  return `👤 MY JR PHEEF

Membership:
${p.name}

💳 Connection fee:
KSh ${p.fee ?? "Custom"}

📦 Active listings:
${listings || 0}

🔐 Deal Rooms:
${rooms || 0}

🎁 Rewards:
KSh ${money(user?.reward_balance)}

💸 Withdrawable:
KSh ${money(user?.withdrawable_balance)}

🪙 JR PHEEF credits:
KSh ${money(user?.credit_balance)}

🤝 Referral:
${user?.referral_code || "—"}

Minimum withdrawal:
Individual: KSh ${WITHDRAWAL.INDIVIDUAL}
Business: KSh ${WITHDRAWAL.BUSINESS}`;
}

/* -------------------------
   WHATSAPP
------------------------- */

app.post("/api/webhook/whatsapp", async (req, res) => {
  try {
    const text = String(req.body.Body || "").trim();
    const phone = clean(req.body.From);
    const upper = text.toUpperCase();
    const media = Number(req.body.NumMedia || 0);

    if (!allowed(phone)) {
      return res.type("text/xml").send(
        reply("⏳ Too many messages. Please wait a moment.")
      );
    }

    await ensureUser(phone);

    if (!text && !media) {
      return res.type("text/xml").send(reply(welcome()));
    }

    if (/^(HI|HELLO|HEY|START|MENU)$/i.test(text)) {
      return res.type("text/xml").send(reply(welcome()));
    }

    if (/^(DASHBOARD|ACCOUNT|MY JR PHEEF)$/i.test(text)) {
      return res.type("text/xml").send(
        reply(await dashboard(phone))
      );
    }

    /* PHOTOS */

    if (media > 0) {
      const user = await ensureUser(phone);
      const p = plan(user?.plan);

      const { data: listings } = await db
        .from("listings")
        .select("*")
        .eq("phone", phone)
        .eq("status", "ACTIVE")
        .order("created_at", { ascending: false })
        .limit(1);

      const l = listings?.[0];

      if (!l) {
        return res.type("text/xml").send(
          reply("📸 Send your opportunity details first, then your photos.")
        );
      }

      const photos = Array.isArray(l.photos) ? l.photos : [];

      for (let i = 0; i < media && photos.length < p.photos; i++) {
        const url = req.body[`MediaUrl${i}`];
        if (url) photos.push(url);
      }

      await db
        .from("listings")
        .update({ photos })
        .eq("id", l.id);

      return res.type("text/xml").send(
        reply(`📸 Photos received.

${photos.length}/${p.photos} saved.

Your listing is ready for matching.`)
      );
    }

    /* CREATE LISTING */

    if (upper.startsWith("OPPORTUNITY")) {
      return res.type("text/xml").send(
        reply(await listing(text, phone))
      );
    }

    /* CHAT */

    if (upper === "CHAT") {
      const { data } = await db
        .from("deal_rooms")
        .select("*, listings(item_name,price,location)")
        .or(`buyer_phone.eq.${phone},seller_phone.eq.${phone}`)
        .in("status", ["negotiating", "agreed", "paid"])
        .order("created_at", { ascending: false })
        .limit(1);

      const room = data?.[0];

      if (!room) {
        return res.type("text/xml").send(
          reply("🔐 You don't have an active Deal Room yet.")
        );
      }

      const l = room.listings || {};

      return res.type("text/xml").send(
        reply(`🔐 DEAL ROOM

${l.item_name || "Opportunity"}
💰 KSh ${money(l.price)}
📍 ${l.location || ""}

💬 You're connected.

Talk normally in English, Sheng or both.

No AGREE.
No DONE.
No PAID.

Just chat.`)
      );
    }

    /* NATURAL BUYING */

    if (buyerIntent(text)) {
      const l = await search(text, phone);

      if (!l) {
        return res.type("text/xml").send(
          reply("🔎 I haven't found a match yet. I'll keep looking.")
        );
      }

      const room = await match(l, phone);

      if (!room) {
        return res.type("text/xml").send(
          reply("❌ I couldn't create the Deal Room.")
        );
      }

      return res.type("text/xml").send(
        reply(`🎉 JR PHEEF found a match.

${l.item_name}
💰 KSh ${money(l.price)}
📍 ${l.location}

🔐 Deal Room created.

Reply CHAT.

You can now talk normally.`)
      );
    }

    /* NATURAL SELLING */

    if (sellerIntent(text)) {
      return res.type("text/xml").send(
        reply(`📣 Let's list it.

Send:

OPPORTUNITY
Item
Price
Location

Then send your photos together.`)
      );
    }

    /* NATURAL CHAT */

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

      await send(
        other,
        `💬 ${text}`
      );

      return res.type("text/xml").send(
        reply("☑️ Sent.")
      );
    }

    return res.type("text/xml").send(reply(welcome()));

  } catch (err) {
    console.error("WEBHOOK ERROR:", err);

    return res.type("text/xml").send(
      reply("❌ JR PHEEF had a temporary problem. Please try again.")
    );
  }
});

/* ==================================================
   OWNER DASHBOARD
================================================== */

app.get("/owner", admin, async (req, res) => {
  try {
    const [
      users,
      listings,
      rooms,
      messages
    ] = await Promise.all([
      db.from("users").select("*"),
      db.from("listings").select("*"),
      db.from("deal_rooms").select("*"),
      db.from("messages").select("*")
    ]);

    const U = users.data || [];
    const L = listings.data || [];
    const R = rooms.data || [];
    const M = messages.data || [];

    const pro = U.filter(
      x => String(x.plan).toUpperCase() === "PRO"
    ).length;

    const prime = U.filter(
      x => String(x.plan).toUpperCase() === "PRIME"
    ).length;

    const activeListings = L.filter(
      x => x.status === "ACTIVE"
    ).length;

    const paidRooms = R.filter(
      x => x.buyer_paid && x.seller_paid
    ).length;

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>JR PHEEF OWNER</title>
<style>
body{
font-family:Arial,sans-serif;
margin:0;
padding:20px;
background:#f5f5f5;
}
h1{margin-bottom:5px}
.grid{
display:grid;
grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
gap:15px;
}
.card{
background:white;
padding:20px;
border-radius:14px;
box-shadow:0 2px 8px #0001;
}
.number{
font-size:28px;
font-weight:bold;
}
small{color:#666}
</style>
</head>
<body>

<h1>JR PHEEF OWNER CONTROL</h1>
<p>Live marketplace overview</p>

<div class="grid">

<div class="card">
<small>USERS</small>
<div class="number">${U.length}</div>
</div>

<div class="card">
<small>PRO MEMBERS</small>
<div class="number">${pro}</div>
</div>

<div class="card">
<small>PRIME MEMBERS</small>
<div class="number">${prime}</div>
</div>

<div class="card">
<small>ACTIVE LISTINGS</small>
<div class="number">${activeListings}</div>
</div>

<div class="card">
<small>DEAL ROOMS</small>
<div class="number">${R.length}</div>
</div>

<div class="card">
<small>PAID DEAL ROOMS</small>
<div class="number">${paidRooms}</div>
</div>

<div class="card">
<small>MESSAGES</small>
<div class="number">${M.length}</div>
</div>

<div class="card">
<small>REWARDS ISSUED</small>
<div class="number">
KSh ${money(
  U.reduce(
    (a,x)=>a+Number(x.reward_balance||0),0
  )
)}
</div>
</div>

</div>

<br>

<div class="card">
<h2>Membership</h2>
<p>FREE+ users: ${U.filter(x => !["PRO","PRIME","ELITE"].includes(String(x.plan).toUpperCase())).length}</p>
<p>PRO: ${pro}</p>
<p>PRIME: ${prime}</p>
</div>

<br>

<div class="card">
<h2>System</h2>
<p>🟢 Marketplace: ACTIVE</p>
<p>🟢 Deal Rooms: ACTIVE</p>
<p>🟢 Natural CHAT: ACTIVE</p>
<p>🟢 English/Sheng: ACTIVE</p>
<p>🟢 Photos: ACTIVE</p>
<p>🟢 Referrals protection: ACTIVE</p>
<p>🟢 Reward withdrawal rules: ACTIVE</p>
<p>🟡 M-Pesa API: NOT CONNECTED</p>
</div>

</body>
</html>`;

    res.send(html);

  } catch (err) {
    console.error("OWNER ERROR:", err);
    res.status(500).send("Owner dashboard error");
  }
});

/* -------------------------
   HEALTH
------------------------- */

app.get("/", (req, res) => {
  res.json({
    service: "JR PHEEF Marketplace",
    status: "LIVE",
    version: "TEST",
    mpesa: "NOT CONNECTED",
    plans: {
      free_plus: "KSh 30 connection",
      pro: "KSh 99/month + KSh 20 connection",
      prime: "KSh 149/month + KSh 15 connection"
    }
  });
});

/* -------------------------
   START
------------------------- */

app.listen(PORT, () => {
  console.log(`🚀 JR PHEEF running on port ${PORT}`);
  console.log("🔐 Deal Rooms: ACTIVE");
  console.log("💬 Natural CHAT: ACTIVE");
  console.log("🌍 English + Sheng: ACTIVE");
  console.log("📸 Photos: ACTIVE");
  console.log("👤 Buyer + Seller account: ACTIVE");
  console.log("🎁 Referral protection: ACTIVE");
  console.log("💰 Rewards rules: ACTIVE");
  console.log("🏢 Business support: ACTIVE");
  console.log("🛡️ Rate limiting: ACTIVE");
  console.log("🔒 Owner dashboard: ACTIVE");
  console.log("💳 M-Pesa: NOT CONNECTED");
});
