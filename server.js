const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 10000;
const BASE = "https://jr-pheef-marketplace.onrender.com";

const supabase =
  process.env.SUPABASE_URL &&
  (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY)
    ? createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY
      )
    : null;

const sessions = new Map();
const activity = [];

const plans = {
  free: { price: 0, match: 30 },
  pro: { price: 99, match: 20 },
  prime: { price: 149, match: 20 }
};

const log = (type, data = {}) => {
  activity.unshift({ type, ...data, time: new Date().toISOString() });
  activity.splice(50);
};

const uid = p => `${p}-${crypto.randomBytes(4).toString("hex")}`;

const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, x =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[x])
  );

const html = (title, body) => `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--c:#08783c;--bg:#f3f8f5;--card:#fff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);
font-family:Arial;color:#111}header{background:#063d20;color:white;padding:24px}
main{max-width:900px;margin:auto;padding:15px}.card{background:var(--card);
padding:18px;margin:12px 0;border-radius:18px;box-shadow:0 2px 10px #0001}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
input,textarea,select{width:100%;padding:12px;margin:5px 0;border:1px solid #ccc;border-radius:9px}
button,.btn{background:var(--c);color:white;border:0;padding:11px 16px;
border-radius:9px;text-decoration:none;display:inline-block;margin:4px;cursor:pointer}
img.avatar{width:90px;height:90px;border-radius:50%;object-fit:cover}
.small{font-size:13px;opacity:.7}.pill{padding:6px 10px;border-radius:20px;background:#e5f5ec}
</style></head><body>${body}</body></html>`;

async function findUser(phone) {
  if (!supabase || !phone) return null;

  const { data } = await supabase
    .from("members")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();

  return data || null;
}

async function saveUser(phone, updates) {
  if (!supabase) return null;

  const { data } = await supabase
    .from("members")
    .update(updates)
    .eq("phone", phone)
    .select()
    .maybeSingle();

  return data;
}

function sessionUser(req) {
  const token = req.headers.cookie
    ?.split(";")
    .map(x => x.trim())
    .find(x => x.startsWith("jrp_session="))
    ?.split("=")[1];

  return token ? sessions.get(token) : null;
}

function login(res, user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, user.phone);
  res.setHeader(
    "Set-Cookie",
    `jrp_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`
  );
}

function blockedMessage(text) {
  const t = String(text || "");

  const patterns = [
    /\b(?:\+?254|0)?7\d{8}\b/,
    /\b\d{3}[-.\s]\d{3}[-.\s]\d{3,4}\b/,
    /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/i,
    /\b(?:https?:\/\/|www\.)\S+/i,
    /\b(?:instagram|facebook|telegram|whatsapp|tiktok|snapchat)\b/i
  ];

  return patterns.some(p => p.test(t));
}

async function notify(memberId, title, message, type = "system") {
  if (!supabase || !memberId) return;

  await supabase.from("jr_notifications").insert({
    member_id: memberId,
    title,
    message,
    type
  });
}

/* HOME */

app.get("/", async (req, res) => {
  const u = sessionUser(req);

  if (u) return res.redirect("/home");

  res.send(html("JR PHEEF", `
<header>
<h1>JR PHEEF</h1>
<p>Find. Match. Connect. Trade.</p>
</header>
<main>
<div class="card">
<h2>Karibu 👋</h2>
<p>One place for people, opportunities, businesses, connections and trade.</p>

<form method="POST" action="/signup">
<input name="name" placeholder="Full name" required>
<input name="phone" placeholder="Phone number" required>
<input name="city" placeholder="City / location">
<input name="country" value="Kenya" placeholder="Country">
<button>Create account</button>
</form>
</div>

<div class="card">
<h3>Already registered?</h3>
<form method="POST" action="/login">
<input name="phone" placeholder="Your phone number" required>
<button>Continue</button>
</form>
</div>
</main>`));
});

/* SIGN UP */

app.post("/signup", async (req, res) => {
  if (!supabase)
    return res.status(503).send("Supabase is not connected.");

  const { name, phone, city, country } = req.body;

  const existing = await findUser(phone);
  if (existing) {
    login(res, existing);
    return res.redirect("/home");
  }

  const dgboId = `JRP-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

  const { data, error } = await supabase
    .from("members")
    .insert({
      full_name: name,
      phone,
      dgbo_id: dgboId,
      reputation: 0,
      verified: false,
      status: "active",
      city: city || null,
      country: country || "Kenya",
      account_type: "person",
      public_profile: true,
      public_phone: false,
      public_email: false,
      online: true
    })
    .select()
    .single();

  if (error)
    return res.status(500).send("Account creation failed: " + esc(error.message));

  await supabase.from("jr_wallets").upsert({
    member_id: data.id,
    balance: 0,
    credits: 0
  });

  await supabase.from("jr_memberships").upsert({
    member_id: data.id,
    plan: "free",
    price: 0,
    match_fee: 30
  });

  log("New member", { phone, name });

  login(res, data);
  res.redirect("/home");
});

/* LOGIN */

app.post("/login", async (req, res) => {
  const u = await findUser(req.body.phone);

  if (!u)
    return res.status(401).send(
      html("JR PHEEF", `<main><div class="card">
      <h2>Account not found</h2>
      <p>Please create your JR PHEEF account first.</p>
      <a class="btn" href="/">Create account</a>
      </div></main>`)
    );

  await saveUser(u.phone, {
    online: true,
    last_login: new Date().toISOString()
  });

  login(res, u);
  res.redirect("/home");
});

/* HOME */

app.get("/home", async (req, res) => {
  const phone = sessionUser(req);
  const u = await findUser(phone);

  if (!u) return res.redirect("/");

  const membership =
    supabase &&
    (await supabase.from("jr_memberships").select("*")
      .eq("member_id", u.id).maybeSingle());

  const plan = membership?.data?.plan || "free";

  res.send(html("JR PHEEF", `
<header>
<h1>JR PHEEF</h1>
<p>Welcome, ${esc(u.full_name)} 👋</p>
<span class="pill">${plan.toUpperCase()}</span>
</header>

<main>

<div class="card">
<h2>👤 Your Profile</h2>
${u.avatar_url
  ? `<img class="avatar" src="${esc(u.avatar_url)}">`
  : `<div class="avatar" style="background:#ddd;border-radius:50%;
     display:flex;align-items:center;justify-content:center">👤</div>`}
<p><b>${esc(u.full_name)}</b></p>
<p>${esc(u.bio || "Tell people a little about yourself.")}</p>

<form method="POST" action="/profile">
<textarea name="bio" placeholder="Your bio">${esc(u.bio || "")}</textarea>
<input name="city" value="${esc(u.city || "")}" placeholder="City">
<input name="country" value="${esc(u.country || "Kenya")}" placeholder="Country">

<label>
<input type="checkbox" name="public_profile"
${u.public_profile ? "checked" : ""}>
 Show profile publicly
</label>

<label>
<input type="checkbox" name="public_phone"
${u.public_phone ? "checked" : ""}>
 Show phone publicly
</label>

<button>Save profile</button>
</form>
</div>

<div class="grid">

<div class="card">
<h2>🔎 Find</h2>
<p>People, products, services and opportunities.</p>
<a class="btn" href="/find">Explore</a>
</div>

<div class="card">
<h2>🏪 Sell</h2>
<p>Listings are FREE.</p>
<a class="btn" href="/sell">Create listing</a>
</div>

<div class="card">
<h2>🤝 Matches</h2>
<p>People and opportunities matched around you and internationally.</p>
<a class="btn" href="/matches">View matches</a>
</div>

<div class="card">
<h2>💬 Connections</h2>
<p>Talk, mingle, build friendships and make real connections.</p>
<a class="btn" href="/connections">Open</a>
</div>

<div class="card">
<h2>💞 Love & Friendship</h2>
<p>Discover people looking for genuine connections.</p>
<a class="btn" href="/matches?type=friendship">Discover</a>
</div>

<div class="card">
<h2>🤝 Deal Rooms</h2>
<p>Keep business conversations and agreements inside JR PHEEF.</p>
<a class="btn" href="/deal">Open</a>
</div>

<div class="card">
<h2>🚚 Delivery</h2>
<p>Connect with approved riders and delivery providers.</p>
<a class="btn" href="/delivery">Request</a>
</div>

<div class="card">
<h2>🏢 Organizations</h2>
<p>Businesses, institutions and organizations can operate here.</p>
<a class="btn" href="/organization">Manage</a>
</div>

</div>

<div class="card">
<h2>🎁 Wallet</h2>
<p>Rewards and JR PHEEF Credits.</p>
<a class="btn" href="/wallet">Open wallet</a>
</div>

<div class="card">
<h2>⭐ Membership</h2>
<p>FREE — listings + normal connections</p>
<p>PRO — KSh 99/month</p>
<p>PRIME — KSh 149/month</p>
<a class="btn" href="/upgrade?plan=pro">Try PRO</a>
<a class="btn" href="/upgrade?plan=prime">Try PRIME</a>
</div>

<div class="card">
<h2>🎨 Theme</h2>
<form method="POST" action="/theme">
<select name="theme">
<option value="green">JR PHEEF Green</option>
<option value="blue">Ocean Blue</option>
<option value="purple">Royal Purple</option>
<option value="black">Classic Black</option>
<option value="gold">Gold</option>
</select>
<button>Save theme</button>
</form>
</div>

<div class="card">
<a class="btn" href="/logout">Sign out</a>
</div>

</main>`));
});

/* PROFILE */

app.post("/profile", async (req, res) => {
  const phone = sessionUser(req);
  if (!phone) return res.redirect("/");

  await saveUser(phone, {
    bio: req.body.bio || null,
    city: req.body.city || null,
    country: req.body.country || "Kenya",
    public_profile: !!req.body.public_profile,
    public_phone: !!req.body.public_phone
  });

  res.redirect("/home");
});

/* PHOTO */

app.post("/profile/photo", async (req, res) => {
  const phone = sessionUser(req);
  if (!phone || !supabase) return res.status(401).send("Not signed in.");

  const { image } = req.body;
  if (!image || !image.startsWith("data:image/"))
    return res.status(400).send("Invalid image.");

  const u = await findUser(phone);
  const base64 = image.split(",")[1];
  const buffer = Buffer.from(base64, "base64");
  const path = `${u.id}-${Date.now()}.jpg`;

  const upload = await supabase.storage
    .from("profiles")
    .upload(path, buffer, { contentType: "image/jpeg", upsert: true });

  if (upload.error)
    return res.status(500).send("Photo upload failed. Create a public 'profiles' bucket in Supabase Storage.");

  const { data } = supabase.storage.from("profiles").getPublicUrl(path);

  await saveUser(phone, { avatar_url: data.publicUrl });

  res.redirect("/home");
});

/* THEME */

app.post("/theme", async (req, res) => {
  const phone = sessionUser(req);
  if (!phone) return res.redirect("/");

  await saveUser(phone, { theme: req.body.theme || "green" });
  res.redirect("/home");
});

/* SELL */

app.get("/sell", async (req, res) => {
  const phone = sessionUser(req);
  const u = await findUser(phone);
  if (!u) return res.redirect("/");

  res.send(html("Sell", `
<header><h1>🏪 Sell on JR PHEEF</h1></header>
<main><div class="card">
<p>Listing is FREE.</p>
<form method="POST" action="/sell">
<input name="title" placeholder="What are you selling?" required>
<textarea name="description" placeholder="Describe it"></textarea>
<input name="price" type="number" placeholder="Price">
<input name="location" value="${esc(u.city || "")}" placeholder="Location">
<input name="category" placeholder="Category">
<button>Create listing</button>
</form>
</div></main>`));
});

app.post("/sell", async (req, res) => {
  const u = await findUser(sessionUser(req));
  if (!u || !supabase) return res.redirect("/");

  await supabase.from("jr_listings").insert({
    member_id: u.id,
    title: req.body.title,
    description: req.body.description,
    price: Number(req.body.price || 0),
    location: req.body.location,
    category: req.body.category,
    status: "active"
  });

  log("Listing created", { member: u.id });
  res.redirect("/find");
});

/* FIND */

app.get("/find", async (req, res) => {
  const u = await findUser(sessionUser(req));
  if (!u || !supabase) return res.redirect("/");

  const { data } = await supabase
    .from("jr_listings")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(50);

  res.send(html("Find", `
<header><h1>🔎 Find</h1>
<p>Products • Services • Opportunities</p></header>
<main>
${(data || []).map(x => `
<div class="card">
<h2>${esc(x.title)}</h2>
<p>${esc(x.description)}</p>
<p><b>KSh ${esc(x.price)}</b></p>
<p>📍 ${esc(x.location)}</p>
<p>${esc(x.category || "")}</p>
<a class="btn" href="/connect?listing=${x.id}">Connect</a>
</div>`).join("") || "<div class='card'>Nothing listed yet.</div>"}
</main>`));
});

/* MATCHES */

app.get("/matches", async (req, res) => {
  const u = await findUser(sessionUser(req));
  if (!u || !supabase) return res.redirect("/");

  const { data } = await supabase
    .from("members")
    .select("*")
    .eq("status", "active")
    .neq("id", u.id)
    .eq("public_profile", true)
    .limit(30);

  const shuffled = (data || [])
    .sort(() => Math.random() - 0.5)
    .slice(0, 12);

  res.send(html("Matches", `
<header><h1>🤝 JR PHEEF Matches</h1>
<p>Discover new people and opportunities.</p></header>
<main>
<div class="grid">
${shuffled.map(x => `
<div class="card">
${x.avatar_url
 ? `<img class="avatar" src="${esc(x.avatar_url)}">`
 : "👤"}
<h3>${esc(x.full_name)}</h3>
<p>${esc(x.bio || "JR PHEEF member")}</p>
<p>📍 ${esc(x.city || "Location available on connection")}</p>
<a class="btn" href="/connect?person=${x.id}">Connect</a>
</div>`).join("")}
</div>
</main>`));
});

/* CONNECTION */

app.get("/connect", async (req, res) => {
  const u = await findUser(sessionUser(req));
  if (!u || !supabase) return res.redirect("/");

  const target = req.query.person
    ? await supabase.from("members").select("*").eq("id", req.query.person).maybeSingle()
    : null;

  if (!target?.data)
    return res.redirect("/find");

  const x = target.data;

  const { data: connection } = await supabase
    .from("jr_connections")
    .insert({
      member_a: u.id,
      member_b: x.id,
      type: req.query.type || "connection",
      score: 1,
      status: "pending"
    })
    .select()
    .maybeSingle();

  await notify(
    x.id,
    "New JR PHEEF connection",
    `${u.full_name} would like to connect with you.`,
    "connection"
  );

  res.send(html("Connection", `
<header><h1>🤝 Connection sent</h1></header>
<main><div class="card">
<h2>${esc(x.full_name)}</h2>
<p>Your connection request has been sent.</p>
<p>Once accepted, you can communicate inside JR PHEEF.</p>
<a class="btn" href="/home">Back home</a>
</div></main>`));
});

/* CONNECTIONS */

app.get("/connections", async (req, res) => {
  const u = await findUser(sessionUser(req));
  if (!u || !supabase) return res.redirect("/");

  const { data } = await supabase
    .from("jr_connections")
    .select("*")
    .or(`member_a.eq.${u.id},member_b.eq.${u.id}`)
    .order("created_at", { ascending: false });

  res.send(html("Connections", `
<header><h1>💬 Connections</h1></header>
<main>
<div class="card">
<h3>Real conversations happen here.</h3>
<p>JR PHEEF keeps normal social interaction free while protecting users from contact harvesting.</p>
</div>
${(data || []).map(c => `
<div class="card">
<p>🤝 Connection: <b>${esc(c.type)}</b></p>
<p>Status: ${esc(c.status)}</p>
<a class="btn" href="/chat?id=${c.id}">Open conversation</a>
</div>`).join("") || "<div class='card'>No connections yet.</div>"}
</main>`));
});

/* CHAT */

app.get("/chat", async (req, res) => {
  const u = await findUser(sessionUser(req));
  if (!u || !supabase) return res.redirect("/");

  const id = req.query.id;

  const { data } = await supabase
    .from("jr_messages")
    .select("*")
    .eq("connection_id", id)
    .order("created_at");

  res.send(html("Chat", `
<header><h1>💬 JR PHEEF Chat</h1>
<p>Connect safely.</p></header>
<main>
<div class="card">
${(data || []).map(m => `
<p><b>${m.sender_id === u.id ? "You" : "Member"}:</b>
${m.blocked ? "🛡️ Message protected by JR PHEEF" : esc(m.message)}</p>
`).join("") || "<p>No messages yet.</p>"}
</div>

<div class="card">
<form method="POST" action="/chat">
<input type="hidden" name="connection_id" value="${esc(id)}">
<textarea name="message" placeholder="Write a message..." required></textarea>
<button>Send</button>
</form>
<p class="small">
For everyone's safety, JR PHEEF blocks phone numbers, emails and external links.
</p>
</div>
</main>`));
});

app.post("/chat", async (req, res) => {
  const u = await findUser(sessionUser(req));
  if (!u || !supabase) return res.redirect("/");

  const blocked = blockedMessage(req.body.message);

  const { data: c } = await supabase
    .from("jr_connections")
    .select("*")
    .eq("id", req.body.connection_id)
    .maybeSingle();

  if (!c) return res.status(404).send("Connection not found.");

  const receiver = c.member_a === u.id ? c.member_b : c.member_a;

  await supabase.from("jr_messages").insert({
    sender_id: u.id,
    receiver_id: receiver,
    connection_id: c.id,
    message: blocked
      ? "🛡️ JR PHEEF protected this message because it appears to contain contact information or an external contact request."
      : req.body.message,
    blocked,
    block_reason: blocked ? "contact_or_external_link" : null
  });

  if (!blocked)
    await notify(receiver, "New message", "You have a new JR PHEEF message.", "message");

  res.redirect("/chat?id=" + encodeURIComponent(req.body.connection_id));
});

/* DELIVERY */

app.get("/delivery", async (req, res) => {
  const u = await findUser(sessionUser(req));
  if (!u) return res.redirect("/");

  res.send(html("Delivery", `
<header><h1>🚚 JR PHEEF Delivery</h1></header>
<main>

<div class="card">
<h2>Request delivery</h2>
<p>Rider matching is FREE for the customer.</p>

<form method="POST" action="/delivery">
<input name="pickup" placeholder="Pickup location" required>
<input name="destination" placeholder="Destination" required>
<textarea name="description" placeholder="What needs to be delivered?"></textarea>
<button>Find rider</button>
</form>
</div>

<div class="card">
<h2>🛵 Become a JR PHEEF Rider</h2>
<p>Approved riders can receive delivery opportunities.</p>
<a class="btn" href="/rider">Register as rider</a>
</div>

</main>`));
});

app.post("/delivery", async (req, res) => {
  const u = await findUser(sessionUser(req));
  if (!u || !supabase) return res.redirect("/");

  await supabase.from("jr_delivery_requests").insert({
    requester_id: u.id,
    pickup: req.body.pickup,
    destination: req.body.destination,
    description: req.body.description,
    status: "requested"
  });

  res.send(html("Delivery", `
<header><h1>🚚 Request received</h1></header>
<main><div class="card">
<h2>Searching for a rider...</h2>
<p>JR PHEEF will match available approved riders around the request.</p>
<a class="btn" href="/home">Done</a>
</div></main>`));
});

/* RIDER */

app.get("/rider", async (req, res) => {
  if (!sessionUser(req)) return res.redirect("/");

  res.send(html("Rider", `
<header><h1>🛵 JR PHEEF Rider</h1></header>
<main><div class="card">
<form method="POST" action="/rider">
<input name="company_name" placeholder="Company / individual">
<input name="vehicle_type" placeholder="Motorbike, car, van..." required>
<input name="vehicle_number" placeholder="Vehicle registration">
<input name="location" placeholder="Operating location">
<button>Apply as rider</button>
</form>
</div></main>`));
});

app.post("/rider", async (req, res) => {
  const u = await findUser(sessionUser(req));
  if (!u || !supabase) return res.redirect("/");

  await supabase.from("jr_riders").insert({
    member_id: u.id,
    company_name: req.body.company_name,
    vehicle_type: req.body.vehicle_type,
    vehicle_number: req.body.vehicle_number,
    location: req.body.location,
    approved: false,
    verified: false,
    online: false
  });

  res.send(html("Rider", `
<header><h1>🛵 Application received</h1></header>
<main><div class="card">
<p>Your rider application is awaiting JR PHEEF approval.</p>
<a class="btn" href="/home">Return home</a>
</div></main>`));
});

/* ORGANIZATION */

app.get("/organization", async (req, res) => {
  const u = await findUser(sessionUser(req));
  if (!u) return res.redirect("/");

  res.send(html("Organization", `
<header><h1>🏢 Organization</h1></header>
<main><div class="card">
<form method="POST" action="/organization">
<input name="name" placeholder="Company / Institution / Organization" required>
<input name="type" placeholder="Type">
<textarea name="description" placeholder="About the organization"></textarea>
<input name="location" placeholder="Location">
<button>Create organization</button>
</form>
</div></main>`));
});

app.post("/organization", async (req, res) => {
  const u = await findUser(sessionUser(req));
  if (!u || !supabase) return res.redirect("/");

  await supabase.from("jr_organizations").insert({
    owner_id: u.id,
    name: req.body.name,
    type: req.body.type,
    description: req.body.description,
    location: req.body.location,
    country: u.country,
    status: "pending"
  });

  res.redirect("/home");
});

/* WALLET */

app.get("/wallet", async (req, res) => {
  const u = await findUser(sessionUser(req));
  if (!u || !supabase) return res.redirect("/");

  const { data } = await supabase
    .from("jr_wallets")
    .select("*")
    .eq("member_id", u.id)
    .maybeSingle();

  res.send(html("Wallet", `
<header><h1>🎁 JR PHEEF Wallet</h1></header>
<main><div class="card">
<h2>KSh ${esc(data?.balance || 0)}</h2>
<p>JR PHEEF Credits: ${esc(data?.credits || 0)}</p>
<p>Minimum individual withdrawal: KSh 200</p>
<p class="small">Real M-Pesa withdrawals activate after payment integration.</p>
</div></main>`));
});

/* DEAL ROOM */

app.get("/deal", async (req, res) => {
  const u = await findUser(sessionUser(req));
  if (!u) return res.redirect("/");

  res.send(html("Deal Room", `
<header><h1>🤝 Deal Room</h1></header>
<main><div class="card">
<h2>Secure JR PHEEF Deal</h2>
<p>Agree, communicate and complete the transaction inside JR PHEEF.</p>
<p class="small">Payments are currently TEST MODE.</p>
<form method="POST" action="/deal">
<input name="amount" type="number" placeholder="Deal amount">
<button>Create test Deal Room</button>
</form>
</div></main>`));
});

app.post("/deal", async (req, res) => {
  const u = await findUser(sessionUser(req));
  if (!u || !supabase) return res.redirect("/");

  const { data } = await supabase
    .from("jr_deal_rooms")
    .insert({
      buyer_id: u.id,
      amount: Number(req.body.amount || 0),
      fee: 30,
      status: "open"
    })
    .select()
    .single();

  res.send(html("Deal Room", `
<header><h1>🤝 Deal Room created</h1></header>
<main><div class="card">
<p>Deal ID:</p>
<h3>${esc(data.id)}</h3>
<p>TEST MODE — M-Pesa is not connected.</p>
<a class="btn" href="/home">Done</a>
</div></main>`));
});

/* UPGRADE */

app.get("/upgrade", async (req, res) => {
  const u = await findUser(sessionUser(req));
  if (!u || !supabase) return res.redirect("/");

  const plan = plans[req.query.plan];
  if (!plan) return res.redirect("/home");

  await supabase.from("jr_memberships").upsert({
    member_id: u.id,
    plan: req.query.plan,
    price: plan.price,
    match_fee: plan.match
  });

  res.redirect("/home");
});

/* WHATSAPP — NATURAL LANGUAGE */

app.post("/api/webhook/whatsapp", async (req, res) => {
  const from = req.body.From || "";
  const msg = (req.body.Body || "").trim();
  const text = msg.toLowerCase();

  const u = await findUser(from);

  let reply;

  if (!u) {
    reply =
`👋 Karibu JR PHEEF!

Find. Match. Connect. Trade.

I can help you discover:
🛒 Products
🏪 Sellers
🤝 People
💼 Opportunities
💞 Connections
🚚 Delivery
🏢 Businesses

Create your JR PHEEF account here:
${BASE}

Once registered, you can use JR PHEEF naturally — no commands required.`;
  } else if (/sell|selling|sell.*item/.test(text)) {
    reply =
`🏪 Sawa ${u.full_name}!

Tell me what you're selling, the price and location.

Your listing can be created FREE on JR PHEEF:
${BASE}/sell`;
  } else if (/buy|looking for|need|searching/.test(text)) {
    reply =
`🔎 Nimekupata ${u.full_name}!

Tell me what you're looking for, your budget and location.

JR PHEEF will look for suitable matches around you and beyond.`;
  } else if (/love|relationship|dating|friend|friendship/.test(text)) {
    reply =
`💞 JR PHEEF Connections

You can discover genuine friendship, social and relationship connections.

Open your connections:
${BASE}/matches?type=friendship`;
  } else if (/delivery|rider|transport|move/.test(text)) {
    reply =
`🚚 Sawa!

JR PHEEF can match your delivery request with approved riders.

Open delivery:
${BASE}/delivery`;
  } else if (/hello|hi|hey|help|karibu/.test(text)) {
    reply =
`👋 Karibu ${u.full_name}!

Tell me naturally what you need.

You can ask JR PHEEF to:
🔎 Find something
🏪 Sell something
🤝 Find people
💞 Make connections
💼 Find opportunities
🚚 Arrange delivery
💬 Start a conversation`;
  } else {
    reply =
`🤝 Nimekupata!

Tell me in your own words what you are looking for or what you want to offer.

JR PHEEF will help find the right people, products or opportunities.`;
  }

  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(reply);
  res.type("text/xml").send(twiml.toString());

  log("WhatsApp", { from, message: msg });
});

/* LOGOUT */

app.get("/logout", (req, res) => {
  const token = req.headers.cookie
    ?.split(";")
    .map(x => x.trim())
    .find(x => x.startsWith("jrp_session="))
    ?.split("=")[1];

  if (token) sessions.delete(token);

  res.setHeader(
    "Set-Cookie",
    "jrp_session=; HttpOnly; Path=/; Max-Age=0"
  );

  res.redirect("/");
});

/* OWNER */

app.get("/owner", async (req, res) => {
  if (!process.env.OWNER_KEY || req.query.key !== process.env.OWNER_KEY)
    return res.status(403).send("🔒 Owner access denied.");

  let members = [];

  if (supabase) {
    const { data } = await supabase
      .from("members")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    members = data || [];
  }

  res.send(html("JR PHEEF Command Center", `
<header>
<h1>👑 JR PHEEF</h1>
<p>COMMAND CENTER</p>
</header>
<main>

<div class="grid">

<div class="card"><h2>👥 Members</h2>
<h1>${members.length}</h1></div>

<div class="card"><h2>🗄️ Supabase</h2>
<h3>${supabase ? "CONNECTED" : "NOT CONNECTED"}</h3></div>

<div class="card"><h2>🏪 Marketplace</h2>
<h3>ACTIVE</h3></div>

<div class="card"><h2>🤝 Connections</h2>
<h3>ACTIVE</h3></div>

<div class="card"><h2>🚚 Delivery</h2>
<h3>ACTIVE</h3></div>

<div class="card"><h2>💳 Payments</h2>
<h3>TEST MODE</h3></div>

</div>

<div class="card">
<h2>👤 Members</h2>
${members.map(x => `
<p><b>${esc(x.full_name)}</b>
<br>${esc(x.phone)}
<br>${esc(x.city || "")}
<br>Status: ${esc(x.status)}</p>
<hr>`).join("")}
</div>

<div class="card">
<h2>📊 Live Activity</h2>
${activity.map(x => `
<p>• ${esc(x.type)}
<br><span class="small">${esc(x.time)}</span></p>
`).join("")}
</div>

</main>`));
});

/* HEALTH */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "JR PHEEF",
    supabase: !!supabase,
    marketplace: true,
    connections: true,
    messaging: true,
    delivery: true,
    organizations: true,
    dealRooms: true,
    payments: "TEST",
    mpesa: false
  });
});

/* START */

app.listen(PORT, () => {
  console.log(`🚀 JR PHEEF running on ${PORT}`);
  console.log(`🗄️ Supabase: ${supabase ? "CONNECTED" : "NOT CONNECTED"}`);
  console.log("👤 Accounts: ACTIVE");
  console.log("🏠 Unified home: ACTIVE");
  console.log("👤 Profiles/photos/privacy: ACTIVE");
  console.log("🏪 Free marketplace listings: ACTIVE");
  console.log("🔎 Local/international discovery: ACTIVE");
  console.log("🤝 Rotating connections/matches: ACTIVE");
  console.log("💬 Natural conversations: ACTIVE");
  console.log("🛡️ Contact/link protection: ACTIVE");
  console.log("💞 Friendship/love connections: ACTIVE");
  console.log("🚚 Rider/delivery matching: ACTIVE");
  console.log("🏢 Organization accounts: ACTIVE");
  console.log("🤝 Deal Rooms: ACTIVE");
  console.log("🎁 Wallet/rewards: ACTIVE");
  console.log("📱 WhatsApp: ACTIVE");
  console.log("👑 Owner Center: ACTIVE");
  console.log("💳 Payments: TEST MODE");
  console.log("📱 M-Pesa: NOT CONNECTED");
});
