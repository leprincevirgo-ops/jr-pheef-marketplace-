const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 10000;

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM = process.env.TWILIO_WHATSAPP_NUMBER;

/* =========================
   JR PHEEF CORE SETTINGS
========================= */

const PLANS = {
  FREE:  { price: 0,   match: 30, photos: 5 },
  PRO:   { price: 99,  match: 20, photos: 10 },
  PRIME: { price: 149, match: 20, photos: 20 }
};

const REWARD = {
  withdrawable: .50,
  credits: .30,
  revenue: .20
};

const MIN_WITHDRAWAL = {
  INDIVIDUAL: 200,
  BUSINESS: 1000
};

const clean = v => String(v || "")
  .replace(/^whatsapp:/i, "")
  .trim();

const money = n =>
  Number(n || 0).toLocaleString("en-KE");

const reply = text =>
  `<Response><Message>${String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}</Message></Response>`;

/* =========================
   LANGUAGE / STYLE
========================= */

function language(text) {
  const t = text.toLowerCase();

  if (/\b(natafuta|nauza|bei|pesa|sawa|tafuta|hii|hii ni|uko|wapi|mtu|mteja|huduma)\b/.test(t))
    return "sw";

  if (/\b(niko|bro|maze|manze|uko aje|si poa|imeweza|dem|rada|sai|kuomoka|msee|form|buda|chali)\b/.test(t))
    return "sheng";

  return "en";
}

const say = {
  en: {
    welcome: "👋 Welcome to JR PHEEF.\n\nFind, match and trade legal opportunities — goods, services, jobs, transport, business and more.\n\nTell me naturally what you need or what you have.",
    noMatch: "🔎 I haven't found a suitable match yet. I'll keep looking.",
    room: "🔐 Deal Room opened.\n\nTalk normally. No AGREE, DONE or PAID commands are required.",
    sent: "☑️ Sent.",
    listing: "📣 Send your opportunity like this:\n\nOPPORTUNITY\nItem/service\nPrice\nLocation\n\nThen send your photos together.",
    noRoom: "🔐 You don't have an active Deal Room yet."
  },

  sw: {
    welcome: "👋 Karibu JR PHEEF.\n\nTafuta, pata match na fanya biashara ya opportunities halali — bidhaa, huduma, kazi, transport, biashara na zaidi.\n\nNiambie tu unachotafuta au ulicho nacho.",
    noMatch: "🔎 Bado sijapata match inayofaa. Nitaendelea kutafuta.",
    room: "🔐 Deal Room imefunguliwa.\n\nOngea kawaida. Hakuna haja ya kuandika AGREE, DONE au PAID.",
    sent: "☑️ Imetumwa.",
    listing: "📣 Tuma opportunity yako hivi:\n\nOPPORTUNITY\nBidhaa/huduma\nBei\nLocation\n\nHalafu tuma picha zote pamoja.",
    noRoom: "🔐 Huna Deal Room active kwa sasa."
  },

  sheng: {
    welcome: "👋 Karibu JR PHEEF.\n\nTuko hapa kukumatch na opportunities za biashara legit — goods, services, jobs, transport na zingine.\n\nNiambie tu unatafuta nini ama uko na nini.",
    noMatch: "🔎 Bado sijapata match fiti. Nitaendelea kusaka.",
    room: "🔐 Deal Room imefunguka.\n\nOngea kawaida tu. Hakuna haja ya AGREE, DONE ama PAID.",
    sent: "☑️ Imetumwa.",
    listing: "📣 Tuma opportunity yako hivi:\n\nOPPORTUNITY\nItem/service\nPrice\nLocation\n\nHalafu tuma picha zote pamoja.",
    noRoom: "🔐 Bado huna Deal Room active."
  }
};

/* =========================
   USER
========================= */

async function getUser(phone) {
  const { data } = await db
    .from("users")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();

  return data;
}

async function ensureUser(phone) {
  let u = await getUser(phone);
  if (u) return u;

  const { data } = await db
    .from("users")
    .insert({
      phone,
      plan: "FREE",
      identity_status: "UNVERIFIED",
      reward_balance: 0,
      withdrawable_balance: 0,
      credit_balance: 0,
      reward_revenue: 0
    })
    .select()
    .single();

  return data;
}

/* =========================
   OPPORTUNITIES
========================= */

async function createListing(text, phone, lang) {
  const l = text.split("\n").map(x => x.trim()).filter(Boolean);

  if (l.length < 4)
    return say[lang].listing;

  const u = await ensureUser(phone);
  const plan = PLANS[String(u.plan || "FREE").toUpperCase()];

  const price = Number(
    String(l[2]).replace(/[^0-9.]/g, "")
  ) || 0;

  const { data, error } = await db
    .from("listings")
    .insert({
      phone,
      item_name: l[1],
      price,
      location: l[3],
      photos: [],
      status: "ACTIVE",
      plan: u.plan || "FREE"
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    return "❌ Could not create the opportunity.";
  }

  return lang === "sheng"
    ? `✅ Opportunity iko live.\n\n${data.item_name}\n💰 KSh ${money(data.price)}\n📍 ${data.location}\n\n📸 Unaweza tuma hadi ${plan.photos} picha.`
    : lang === "sw"
    ? `✅ Opportunity yako iko live.\n\n${data.item_name}\n💰 KSh ${money(data.price)}\n📍 ${data.location}\n\n📸 Unaweza kutuma hadi picha ${plan.photos}.`
    : `✅ Opportunity is live.\n\n${data.item_name}\n💰 KSh ${money(data.price)}\n📍 ${data.location}\n\n📸 You can send up to ${plan.photos} photos.`;
}

/* =========================
   MATCHING
========================= */

async function findMatch(text, buyer) {
  const q = text
    .replace(/^(looking for|i need|find me|natafuta|natafut)\s*/i, "")
    .trim();

  if (!q) return null;

  const { data } = await db
    .from("listings")
    .select("*")
    .eq("status", "ACTIVE")
    .ilike("item_name", `%${q}%`)
    .limit(20);

  return (data || []).find(
    x => clean(x.phone) !== clean(buyer)
  );
}

/* =========================
   DEAL ROOM
========================= */

async function createRoom(listing, buyer) {
  if (clean(listing.phone) === clean(buyer))
    return null;

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

async function notifySeller(listing, lang) {
  const s = say[lang] || say.en;

  await twilioClient.messages.create({
    from: FROM,
    to: `whatsapp:${clean(listing.phone)}`,
    body: `🎉 JR PHEEF found a match.\n\n${listing.item_name}\n💰 KSh ${money(listing.price)}\n📍 ${listing.location}\n\n🔐 ${s.room}\n\nReply CHAT.`
  });
}

/* =========================
   REWARDS
========================= */

function rewardSplit(amount) {
  amount = Number(amount || 0);

  return {
    withdrawable: +(amount * REWARD.withdrawable).toFixed(2),
    credits: +(amount * REWARD.credits).toFixed(2),
    revenue: +(amount * REWARD.revenue).toFixed(2)
  };
}

/* =========================
   DASHBOARD
========================= */

async function dashboard(phone, lang) {
  const u = await ensureUser(phone);
  const plan = PLANS[String(u.plan || "FREE").toUpperCase()];

  const { count: listings } = await db
    .from("listings")
    .select("*", { count: "exact", head: true })
    .eq("phone", phone)
    .eq("status", "ACTIVE");

  const { count: rooms } = await db
    .from("deal_rooms")
    .select("*", { count: "exact", head: true })
    .or(`buyer_phone.eq.${phone},seller_phone.eq.${phone}`);

  const business =
    ["BUSINESS", "INSTITUTION"].includes(
      String(u.account_type || "").toUpperCase()
    );

  const min = business
    ? MIN_WITHDRAWAL.BUSINESS
    : MIN_WITHDRAWAL.INDIVIDUAL;

  return `👤 JR PHEEF

Plan: ${u.plan || "FREE"}
💳 Match fee: KSh ${plan.match}
📦 Listings: ${listings || 0}
🔐 Deal Rooms: ${rooms || 0}

🎁 Rewards: KSh ${money(u.reward_balance)}
💸 Withdrawable: KSh ${money(u.withdrawable_balance)}
🪙 JR PHEEF Credits: KSh ${money(u.credit_balance)}

🔐 Identity: ${u.identity_status || "UNVERIFIED"}

Minimum withdrawal: KSh ${min}`;
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

    const u = await ensureUser(phone);
    const lang = language(text);
    const s = say[lang];

    /* Photos */

    if (media > 0) {
      const max = PLANS[String(u.plan || "FREE").toUpperCase()].photos;

      const { data } = await db
        .from("listings")
        .select("*")
        .eq("phone", phone)
        .eq("status", "ACTIVE")
        .order("created_at", { ascending: false })
        .limit(1);

      const listing = data?.[0];

      if (!listing)
        return res.type("text/xml").send(
          reply(s.listing)
        );

      const photos = Array.isArray(listing.photos)
        ? [...listing.photos]
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
        reply(`📸 ${photos.length}/${max} photos saved.`)
      );
    }

    /* Welcome */

    if (/^(HI|HELLO|HEY|START|MENU)$/i.test(text))
      return res.type("text/xml").send(
        reply(s.welcome)
      );

    /* Dashboard */

    if (/^(DASHBOARD|ACCOUNT)$/i.test(text))
      return res.type("text/xml").send(
        reply(await dashboard(phone, lang))
      );

    /* Listing */

    if (upper.startsWith("OPPORTUNITY"))
      return res.type("text/xml").send(
        reply(await createListing(text, phone, lang))
      );

    /* Seller request */

    if (/^(nauza|ninauza|selling|i have|i'm selling)/i.test(text))
      return res.type("text/xml").send(
        reply(s.listing)
      );

    /* Buyer request */

    if (/^(looking for|i need|find me|natafuta|natafut)/i.test(text)) {
      const listing = await findMatch(text, phone);

      if (!listing)
        return res.type("text/xml").send(
          reply(s.noMatch)
        );

      const room = await createRoom(listing, phone);

      if (!room)
        return res.type("text/xml").send(
          reply("❌ Could not create Deal Room.")
        );

      await notifySeller(listing, lang);

      return res.type("text/xml").send(
        reply(
          `🎉 JR PHEEF found a match.\n\n${listing.item_name}\n💰 KSh ${money(listing.price)}\n📍 ${listing.location}\n\n${s.room}\n\nReply CHAT.`
        )
      );
    }

    /* Deal Room */

    const { data: rooms } = await db
      .from("deal_rooms")
      .select("*")
      .or(`buyer_phone.eq.${phone},seller_phone.eq.${phone}`)
      .in("status", ["negotiating", "agreed", "paid"])
      .order("created_at", { ascending: false })
      .limit(1);

    const room = rooms?.[0];

    if (room) {
      if (upper === "CHAT")
        return res.type("text/xml").send(
          reply(s.room)
        );

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

      return res.type("text/xml").send(
        reply(s.sent)
      );
    }

    return res.type("text/xml").send(
      reply(s.welcome)
    );

  } catch (e) {
    console.error("JR PHEEF ERROR:", e);

    return res.type("text/xml").send(
      reply("❌ JR PHEEF is temporarily unavailable. Please try again.")
    );
  }
});

/* =========================
   OWNER DASHBOARD
========================= */

function ownerAuth(req, res, next) {
  const h = req.headers.authorization || "";

  if (!h.startsWith("Basic "))
    return res
      .set("WWW-Authenticate", 'Basic realm="JR PHEEF OWNER"')
      .status(401)
      .send("Owner login required");

  const [u, p] = Buffer.from(h.slice(6), "base64")
    .toString()
    .split(":");

  if (
    u !== process.env.JR_PHEEF_ADMIN_USER ||
    p !== process.env.JR_PHEEF_ADMIN_PASSWORD
  )
    return res.status(403).send("Access denied");

  next();
}

app.get("/owner", ownerAuth, async (req, res) => {
  const [users, listings, rooms, messages] = await Promise.all([
    db.from("users").select("*"),
    db.from("listings").select("*"),
    db.from("deal_rooms").select("*"),
    db.from("messages").select("*")
  ]);

  const U = users.data || [];
  const L = listings.data || [];
  const R = rooms.data || [];
  const M = messages.data || [];

  const revenue = U.reduce(
    (n, x) => n + Number(x.reward_revenue || 0),
    0
  );

  res.send(`
<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width">
<title>JR PHEEF OWNER</title>
<style>
body{font-family:Arial;margin:20px;background:#f4f4f4}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:15px}
.card{background:#fff;padding:20px;border-radius:15px}
.n{font-size:28px;font-weight:bold}
</style>
</head>
<body>

<h1>JR PHEEF OWNER</h1>

<div class="grid">

<div class="card">
Users<div class="n">${U.length}</div>
</div>

<div class="card">
Opportunities<div class="n">${L.length}</div>
</div>

<div class="card">
Deal Rooms<div class="n">${R.length}</div>
</div>

<div class="card">
Messages<div class="n">${M.length}</div>
</div>

<div class="card">
Reward Revenue<div class="n">KSh ${money(revenue)}</div>
</div>

</div>

<h2>JR PHEEF Core</h2>

<div class="card">
🟢 Opportunities<br>
🟢 Matching<br>
🟢 Natural Chat<br>
🟢 Language matching<br>
🟢 English / Kiswahili / Sheng<br>
🟢 Photos<br>
🟢 Deal Rooms<br>
🟢 Buyer + Seller account<br>
🟢 Rewards 50/30/20<br>
🟢 Owner authentication<br>
🟡 M-Pesa: NOT CONNECTED<br>
🟡 International payments: NOT CONNECTED<br>
🟡 Delivery engine: NEXT PHASE
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
    mode: "CORE TEST",
    language: "AUTO",
    opportunities: "ACTIVE",
    dealRooms: "ACTIVE",
    payments: "NOT CONNECTED",
    delivery: "NEXT PHASE",
    rewards: "50% withdrawable / 30% credits / 20% revenue"
  });
});

app.listen(PORT, () => {
  console.log(`🚀 JR PHEEF running on port ${PORT}`);
  console.log("🌍 Automatic language matching: ACTIVE");
  console.log("💬 Natural CHAT: ACTIVE");
  console.log("🤝 Opportunity matching: ACTIVE");
  console.log("🔐 Deal Rooms: ACTIVE");
  console.log("📸 Multiple photos: ACTIVE");
  console.log("👤 Unified buyer/seller: ACTIVE");
  console.log("🎁 Rewards 50/30/20: ACTIVE");
  console.log("🏢 Business accounts: READY");
  console.log("🔒 Owner dashboard: ACTIVE");
  console.log("💳 M-Pesa: NOT CONNECTED");
}); 
