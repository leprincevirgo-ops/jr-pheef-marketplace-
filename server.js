const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");

const app = express();

app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
const OWNER_KEY = process.env.OWNER_KEY || "";

if (!SUPABASE_URL || !SUPABASE_KEY || !JWT_SECRET) {
  console.error("Missing SUPABASE_URL, SUPABASE_KEY or JWT_SECRET");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use("/api/", rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 150,
  standardHeaders: true
}));

const id = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

const cleanPhone = p => String(p || "").replace(/[^\d+]/g, "");

const token = (u, role = "user") =>
  jwt.sign({ id: u.id, role }, JWT_SECRET, { expiresIn: "7d" });

const plans = {
  free:  { name: "FREE+", price: 0,   connection: 30 },
  pro:   { name: "PRO",   price: 99,  connection: 20 },
  prime: { name: "PRIME", price: 149, connection: 15 },
  elite: { name: "ELITE", price: null, connection: null }
};

const skills = [
  "plumbing","electrical","construction","painting","carpentry",
  "welding","cleaning","driving","moving","delivery","technology",
  "software","it","graphic design","photography","video",
  "marketing","sales","accounting","consulting","repair","installation"
];

const skillMatch = text => {
  const t = String(text || "").toLowerCase();
  return skills.find(s => t.includes(s)) || "general";
};

const containsPhone = text =>
  /(?:\+?254|0)?7\d{8}/.test(String(text || "").replace(/\s/g, ""));

const kenyaTime = () =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());

const nightFree = () => {
  const h = Number(kenyaTime().split(":")[0]);
  return h >= 2 && h < 6;
};

async function getUser(uid) {
  const { data, error } = await db
    .from("members")
    .select("*")
    .eq("id", uid)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || "";

    if (!h.startsWith("Bearer "))
      return res.status(401).json({ error: "Login required" });

    const decoded = jwt.verify(h.slice(7), JWT_SECRET);

    if (decoded.role === "owner") {
      req.owner = true;
      return next();
    }

    const u = await getUser(decoded.id);

    if (!u)
      return res.status(401).json({ error: "Account not found" });

    req.user = u;
    next();
  } catch {
    res.status(401).json({ error: "Session expired" });
  }
}

function ownerOnly(req, res, next) {
  try {
    const h = req.headers.authorization || "";

    if (!h.startsWith("Bearer "))
      return res.status(401).json({ error: "Owner login required" });

    const x = jwt.verify(h.slice(7), JWT_SECRET);

    if (x.role !== "owner")
      return res.status(403).json({ error: "Owner access denied" });

    req.owner = true;
    next();
  } catch {
    res.status(401).json({ error: "Owner session expired" });
  }
}

async function audit(action, actor, details = {}) {
  await db.from("audit_logs").insert({
    id: id(),
    actor_id: actor || null,
    action,
    details
  });
}

async function notify(userId, title, message, type = "system") {
  if (!userId) return;

  await db.from("notifications").insert({
    id: id(),
    user_id: userId,
    title,
    message,
    type,
    read: false
  });
}

/* =========================
   HEALTH
========================= */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "JR PHEEF",
    tagline: "Find. Match. Trade.",
    mode: "operational",
    payments: "provider_pending"
  });
});

/* =========================
   AUTH
========================= */

app.post("/api/signup", async (req, res) => {
  try {
    const {
      name,
      phone,
      password,
      birth_year,
      referral_code,
      terms
    } = req.body;

    if (!name || !phone || !password)
      return res.status(400).json({ error: "Name, phone and password required" });

    if (!terms)
      return res.status(400).json({ error: "You must accept the Terms & Conditions" });

    if (password.length < 6)
      return res.status(400).json({ error: "Password must be at least 6 characters" });

    const p = cleanPhone(phone);

    const existing = await db
      .from("members")
      .select("id")
      .eq("phone", p)
      .maybeSingle();

    if (existing.data)
      return res.status(409).json({ error: "Phone already registered" });

    let referredBy = null;

    if (referral_code) {
      const ref = await db
        .from("members")
        .select("id")
        .eq("referral_code", String(referral_code).toUpperCase())
        .maybeSingle();

      if (ref.data) referredBy = ref.data.id;
    }

    const uid = id();

    const { data, error } = await db.from("members").insert({
      id: uid,
      name: String(name).trim(),
      phone: p,
      password_hash: await bcrypt.hash(password, 12),
      birth_year: birth_year ? Number(birth_year) : null,
      membership: "free",
      credits: 0,
      rewards: 0,
      referral_code: `JRP-${uid.slice(-5).toUpperCase()}`,
      referred_by: referredBy,
      terms_agreed_at: new Date().toISOString()
    }).select("*").single();

    if (error) throw error;

    if (referredBy) {
      await db.from("referrals").insert({
        id: id(),
        referrer_id: referredBy,
        referred_user_id: uid,
        status: "REGISTERED",
        reward: 0
      });

      await notify(
        referredBy,
        "New referral",
        `${data.name} joined JR PHEEF using your referral code.`,
        "referral"
      );
    }

    await audit("USER_SIGNUP", uid);

    res.json({
      ok: true,
      token: token(data),
      user: safeUser(data)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Signup failed" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const p = cleanPhone(req.body.phone);

    const { data } = await db
      .from("members")
      .select("*")
      .eq("phone", p)
      .maybeSingle();

    if (!data)
      return res.status(401).json({ error: "Invalid phone or password" });

    const good = await bcrypt.compare(
      String(req.body.password || ""),
      data.password_hash
    );

    if (!good)
      return res.status(401).json({ error: "Invalid phone or password" });

    await audit("USER_LOGIN", data.id);

    res.json({
      ok: true,
      token: token(data),
      user: safeUser(data)
    });
  } catch {
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/me", auth, async (req, res) => {
  if (!req.user)
    return res.json({ owner: true });

  res.json({
    user: safeUser(req.user),
    night_free_access: nightFree()
  });
});

function safeUser(u) {
  if (!u) return null;

  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    birth_year: u.birth_year,
    membership: u.membership,
    credits: Number(u.credits || 0),
    rewards: Number(u.rewards || 0),
    referral_code: u.referral_code,
    created_at: u.created_at
  };
}

/* =========================
   MARKETPLACE
========================= */

app.get("/api/listings", async (req, res) => {
  try {
    let q = db
      .from("listings")
      .select("*")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(100);

    if (req.query.category)
      q = q.ilike("category", `%${req.query.category}%`);

    if (req.query.location)
      q = q.ilike("location", `%${req.query.location}%`);

    if (req.query.search)
      q = q.or(
        `title.ilike.%${req.query.search}%,description.ilike.%${req.query.search}%`
      );

    const { data, error } = await q;

    if (error) throw error;

    res.json({ listings: data || [] });
  } catch (e) {
    res.status(500).json({ error: "Could not load marketplace" });
  }
});

app.post("/api/listings", auth, async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      location,
      category,
      images,
      market_scope
    } = req.body;

    const amount = Number(price);
    const photos = Array.isArray(images) ? images : [];

    if (!title || !description || !location || !category)
      return res.status(400).json({ error: "Complete listing details required" });

    if (!Number.isFinite(amount) || amount <= 100)
      return res.status(400).json({ error: "Listing price must be above KSh 100" });

    if (photos.length < 3)
      return res.status(400).json({ error: "At least 3 photos are required" });

    if (photos.length > 20)
      return res.status(400).json({ error: "Maximum 20 photos allowed" });

    const listing = {
      id: id(),
      user_id: req.user.id,
      title: String(title).trim(),
      description: String(description).trim(),
      price: amount,
      location: String(location).trim(),
      category: String(category).trim(),
      market_scope: market_scope || "local",
      images: photos,
      status: "active"
    };

    const { data, error } = await db
      .from("listings")
      .insert(listing)
      .select("*")
      .single();

    if (error) throw error;

    await audit("LISTING_CREATED", req.user.id, {
      listing_id: data.id
    });

    res.json({ ok: true, listing: data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Listing failed" });
  }
});

app.patch("/api/listings/:id", auth, async (req, res) => {
  const { data: existing } = await db
    .from("listings")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (!existing || existing.user_id !== req.user.id)
    return res.status(403).json({ error: "Not your listing" });

  const allowed = [
    "title",
    "description",
    "price",
    "location",
    "category",
    "images",
    "status"
  ];

  const update = {};

  allowed.forEach(k => {
    if (req.body[k] !== undefined) update[k] = req.body[k];
  });

  const { data, error } = await db
    .from("listings")
    .update(update)
    .eq("id", existing.id)
    .select("*")
    .single();

  if (error)
    return res.status(500).json({ error: "Update failed" });

  res.json({ ok: true, listing: data });
});

/* =========================
   MATCH ENGINE
========================= */

app.get("/api/matches", auth, async (req, res) => {
  try {
    const { data: listings } = await db
      .from("listings")
      .select("*")
      .eq("status", "active")
      .neq("user_id", req.user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    const query = String(req.query.q || "").toLowerCase();

    const results = (listings || []).filter(x => {
      const text =
        `${x.title} ${x.description} ${x.category} ${x.location}`.toLowerCase();

      return !query || text.includes(query);
    });

    res.json({
      matches: results.slice(0, 30),
      count: results.length
    });
  } catch {
    res.status(500).json({ error: "Matching failed" });
  }
});

/* =========================
   WORK / TASKBRIDGE
========================= */

app.post("/api/work", auth, async (req, res) => {
  try {
    const {
      title,
      description,
      location,
      budget,
      urgency
    } = req.body;

    if (!title || !description || !location)
      return res.status(400).json({ error: "Complete task details required" });

    const skill = skillMatch(`${title} ${description}`);

    const task = {
      id: id(),
      owner_id: req.user.id,
      title,
      description,
      location,
      budget: Number(budget || 0),
      urgency: urgency || "normal",
      skill,
      status: "MATCHING"
    };

    const { data, error } = await db
      .from("tasks")
      .insert(task)
      .select("*")
      .single();

    if (error) throw error;

    const { data: workers } = await db
      .from("workers")
      .select("*")
      .eq("status", "available")
      .limit(100);

    const match = (workers || []).find(w =>
      String(w.skills || "").toLowerCase().includes(skill)
    );

    if (match) {
      await db
        .from("tasks")
        .update({
          worker_id: match.id,
          status: "ROUTED"
        })
        .eq("id", task.id);

      await notify(
        match.user_id,
        "JR PHEEF WORK opportunity",
        `A ${skill} task may match your skills.`,
        "work"
      );
    }

    await audit("TASK_CREATED", req.user.id, {
      task_id: task.id,
      skill
    });

    res.json({
      ok: true,
      task: {
        ...task,
        worker_id: match ? match.id : null,
        status: match ? "ROUTED" : "MATCHING"
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Task creation failed" });
  }
});

app.post("/api/workers", auth, async (req, res) => {
  try {
    const {
      skills: workerSkills,
      location,
      experience
    } = req.body;

    if (!workerSkills)
      return res.status(400).json({ error: "Skills required" });

    const { data, error } = await db
      .from("workers")
      .upsert({
        id: id(),
        user_id: req.user.id,
        skills: String(workerSkills).toLowerCase(),
        location: location || "",
        experience: experience || "",
        status: "available"
      })
      .select("*")
      .single();

    if (error) throw error;

    await audit("WORKER_PROFILE_UPDATED", req.user.id);

    res.json({ ok: true, worker: data });
  } catch {
    res.status(500).json({ error: "Worker profile failed" });
  }
});

app.get("/api/work", auth, async (req, res) => {
  const { data, error } = await db
    .from("tasks")
    .select("*")
    .or(`owner_id.eq.${req.user.id}`);

  if (error)
    return res.status(500).json({ error: "Could not load work" });

  res.json({ tasks: data || [] });
});

app.post("/api/work/:id/status", auth, async (req, res) => {
  const allowed = [
    "MATCHING",
    "ROUTED",
    "ACCEPTED",
    "IN PROGRESS",
    "SUBMITTED FOR VERIFICATION",
    "VERIFIED",
    "PAYMENT",
    "COMPLETED",
    "CANCELLED",
    "DISPUTED",
    "REASSIGNED"
  ];

  if (!allowed.includes(req.body.status))
    return res.status(400).json({ error: "Invalid work status" });

  const { data: task } = await db
    .from("tasks")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (!task)
    return res.status(404).json({ error: "Task not found" });

  const { data, error } = await db
    .from("tasks")
    .update({ status: req.body.status })
    .eq("id", task.id)
    .select("*")
    .single();

  if (error)
    return res.status(500).json({ error: "Status update failed" });

  await audit("TASK_STATUS", req.user.id, {
    task_id: task.id,
    status: req.body.status
  });

  res.json({ ok: true, task: data });
});

/* =========================
   DEAL ROOMS
========================= */

app.post("/api/dealrooms", auth, async (req, res) => {
  try {
    const {
      seller_id,
      listing_id,
      task_id
    } = req.body;

    if (!seller_id)
      return res.status(400).json({ error: "Other party required" });

    if (seller_id === req.user.id)
      return res.status(400).json({ error: "Cannot create a room with yourself" });

    const { data: existing } = await db
      .from("deal_rooms")
      .select("*")
      .eq("buyer_id", req.user.id)
      .eq("seller_id", seller_id)
      .eq("listing_id", listing_id || null)
      .eq("task_id", task_id || null)
      .maybeSingle();

    if (existing)
      return res.json({ ok: true, room: existing });

    const room = {
      id: id(),
      buyer_id: req.user.id,
      seller_id,
      listing_id: listing_id || null,
      task_id: task_id || null,
      status: "OPEN",
      connection_status: "WAITING"
    };

    const { data, error } = await db
      .from("deal_rooms")
      .insert(room)
      .select("*")
      .single();

    if (error) throw error;

    await notify(
      seller_id,
      "New Deal Room",
      `${req.user.name} opened a Deal Room with you.`,
      "deal"
    );

    await audit("DEAL_ROOM_CREATED", req.user.id, {
      room_id: data.id
    });

    res.json({ ok: true, room: data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Deal Room failed" });
  }
});

app.get("/api/dealrooms", auth, async (req, res) => {
  const { data, error } = await db
    .from("deal_rooms")
    .select("*")
    .or(`buyer_id.eq.${req.user.id},seller_id.eq.${req.user.id}`)
    .order("created_at", { ascending: false });

  if (error)
    return res.status(500).json({ error: "Could not load Deal Rooms" });

  res.json({ rooms: data || [] });
});

app.get("/api/dealrooms/:id/messages", auth, async (req, res) => {
  const { data: room } = await db
    .from("deal_rooms")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (!room)
    return res.status(404).json({ error: "Deal Room not found" });

  if (![room.buyer_id, room.seller_id].includes(req.user.id))
    return res.status(403).json({ error: "Access denied" });

  const { data, error } = await db
    .from("messages")
    .select("*")
    .eq("room_id", room.id)
    .order("created_at", { ascending: true });

  if (error)
    return res.status(500).json({ error: "Could not load messages" });

  res.json({ room, messages: data || [] });
});

app.post("/api/dealrooms/:id/messages", auth, async (req, res) => {
  const text = String(req.body.message || "").trim();

  if (!text)
    return res.status(400).json({ error: "Message required" });

  const { data: room } = await db
    .from("deal_rooms")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (!room)
    return res.status(404).json({ error: "Deal Room not found" });

  if (![room.buyer_id, room.seller_id].includes(req.user.id))
    return res.status(403).json({ error: "Access denied" });

  if (containsPhone(text) && room.connection_status !== "CONNECTED") {
    return res.status(400).json({
      error: "Contact details are protected until the JR PHEEF connection is completed."
    });
  }

  const { data, error } = await db
    .from("messages")
    .insert({
      id: id(),
      room_id: room.id,
      sender_id: req.user.id,
      message: text
    })
    .select("*")
    .single();

  if (error)
    return res.status(500).json({ error: "Message failed" });

  const other =
    room.buyer_id === req.user.id
      ? room.seller_id
      : room.buyer_id;

  await notify(other, "New message", `${req.user.name} sent you a message.`, "chat");

  res.json({ ok: true, message: data });
});

/* =========================
   CONNECTION + PAYMENT
========================= */

app.post("/api/connections", auth, async (req, res) => {
  try {
    const { room_id } = req.body;

    const { data: room } = await db
      .from("deal_rooms")
      .select("*")
      .eq("id", room_id)
      .maybeSingle();

    if (!room)
      return res.status(404).json({ error: "Deal Room not found" });

    if (![room.buyer_id, room.seller_id].includes(req.user.id))
      return res.status(403).json({ error: "Access denied" });

    const { data: existing } = await db
      .from("connections")
      .select("*")
      .eq("room_id", room.id)
      .maybeSingle();

    if (existing)
      return res.json({ connection: existing });

    const { data: connection, error } = await db
      .from("connections")
      .insert({
        id: id(),
        room_id: room.id,
        buyer_id: room.buyer_id,
        seller_id: room.seller_id,
        buyer_status: "PENDING",
        seller_status: "PENDING",
        status: "PENDING"
      })
      .select("*")
      .single();

    if (error) throw error;

    res.json({
      ok: true,
      connection,
      message: "Connection created. Payment confirmation is required."
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Connection failed" });
  }
});

app.post("/api/payments", auth, async (req, res) => {
  try {
    const {
      room_id,
      role,
      purpose = "connection"
    } = req.body;

    const { data: room } = await db
      .from("deal_rooms")
      .select("*")
      .eq("id", room_id)
      .maybeSingle();

    if (!room)
      return res.status(404).json({ error: "Deal Room not found" });

    if (![room.buyer_id, room.seller_id].includes(req.user.id))
      return res.status(403).json({ error: "Access denied" });

    const membership =
      plans[req.user.membership] || plans.free;

    const amount =
      purpose === "connection"
        ? membership.connection
        : Number(req.body.amount || 0);

    if (!amount)
      return res.status(400).json({ error: "Payment amount unavailable" });

    const { data, error } = await db
      .from("payments")
      .insert({
        id: id(),
        user_id: req.user.id,
        room_id,
        amount,
        purpose,
        role: role || (
          room.buyer_id === req.user.id ? "buyer" : "seller"
        ),
        status: "PENDING"
      })
      .select("*")
      .single();

    if (error) throw error;

    await audit("PAYMENT_CREATED", req.user.id, {
      payment_id: data.id,
      amount,
      purpose
    });

    res.json({
      ok: true,
      payment: data,
      message: "Payment request created. Awaiting real payment confirmation."
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Payment request failed" });
  }
});

/*
  REAL PAYMENT PROVIDER CALLBACK

  M-Pesa will eventually call this endpoint.
  Until the provider is connected, nothing is marked PAID automatically.
*/

app.post("/api/payments/callback", async (req, res) => {
  try {
    const secret = req.headers["x-payment-secret"];

    if (!process.env.PAYMENT_CALLBACK_SECRET ||
        secret !== process.env.PAYMENT_CALLBACK_SECRET) {
      return res.status(401).json({ error: "Unauthorized callback" });
    }

    const {
      payment_id,
      status,
      provider_reference
    } = req.body;

    if (!["PAID", "FAILED", "CANCELLED"].includes(status))
      return res.status(400).json({ error: "Invalid payment status" });

    const { data: payment } = await db
      .from("payments")
      .select("*")
      .eq("id", payment_id)
      .maybeSingle();

    if (!payment)
      return res.status(404).json({ error: "Payment not found" });

    const { data: updated } = await db
      .from("payments")
      .update({
        status,
        provider_reference: provider_reference || null,
        confirmed_at: status === "PAID"
          ? new Date().toISOString()
          : null
      })
      .eq("id", payment.id)
      .select("*")
      .single();

    if (status === "PAID" && payment.purpose === "connection") {
      const role = payment.role || "buyer";

      const update =
        role === "buyer"
          ? { buyer_status: "PAID", buyer_payment_id: payment.id }
          : { seller_status: "PAID", seller_payment_id: payment.id };

      await db
        .from("connections")
        .update(update)
        .eq("room_id", payment.room_id);

      const { data: c } = await db
        .from("connections")
        .select("*")
        .eq("room_id", payment.room_id)
        .maybeSingle();

      if (c && c.buyer_status === "PAID" && c.seller_status === "PAID") {
        await db
          .from("connections")
          .update({ status: "CONNECTED" })
          .eq("id", c.id);

        await db
          .from("deal_rooms")
          .update({ connection_status: "CONNECTED" })
          .eq("id", payment.room_id);

        await notify(
          c.buyer_id,
          "Connection completed",
          "Both parties have completed the JR PHEEF connection.",
          "deal"
        );

        await notify(
          c.seller_id,
          "Connection completed",
          "Both parties have completed the JR PHEEF connection.",
          "deal"
        );
      }
    }

    await audit("PAYMENT_CALLBACK", null, {
      payment_id,
      status
    });

    res.json({ ok: true, payment: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Callback processing failed" });
  }
});

/* =========================
   REFERRALS
========================= */

app.get("/api/referrals", auth, async (req, res) => {
  const { data } = await db
    .from("referrals")
    .select("*")
    .eq("referrer_id", req.user.id)
    .order("created_at", { ascending: false });

  res.json({
    code: req.user.referral_code,
    referrals: data || []
  });
});

/* =========================
   COUPONS
========================= */

app.post("/api/coupons/check", auth, async (req, res) => {
  const code = String(req.body.code || "").trim().toUpperCase();

  const { data } = await db
    .from("coupons")
    .select("*")
    .eq("code", code)
    .eq("active", true)
    .maybeSingle();

  if (!data)
    return res.status(404).json({ error: "Coupon not found or inactive" });

  if (data.expires_at && new Date(data.expires_at) < new Date())
    return res.status(400).json({ error: "Coupon has expired" });

  res.json({
    ok: true,
    coupon: data
  });
});

/* =========================
   WALLET
========================= */

app.get("/api/wallet", auth, async (req, res) => {
  const { data: transactions } = await db
    .from("wallet_transactions")
    .select("*")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const { data: withdrawals } = await db
    .from("withdrawals")
    .select("*")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });

  res.json({
    credits: Number(req.user.credits || 0),
    rewards: Number(req.user.rewards || 0),
    minimum_withdrawal: 200,
    transactions: transactions || [],
    withdrawals: withdrawals || []
  });
});

app.post("/api/wallet/withdraw", auth, async (req, res) => {
  const amount = Number(req.body.amount);

  if (!Number.isFinite(amount) || amount < 200)
    return res.status(400).json({
      error: "Minimum individual withdrawal is KSh 200"
    });

  if (Number(req.user.rewards || 0) < amount)
    return res.status(400).json({ error: "Insufficient withdrawable rewards" });

  const { data, error } = await db
    .from("withdrawals")
    .insert({
      id: id(),
      user_id: req.user.id,
      amount,
      destination: cleanPhone(req.body.phone || req.user.phone),
      status: "PENDING"
    })
    .select("*")
    .single();

  if (error)
    return res.status(500).json({ error: "Withdrawal request failed" });

  await audit("WITHDRAWAL_REQUESTED", req.user.id, {
    withdrawal_id: data.id,
    amount
  });

  res.json({
    ok: true,
    withdrawal: data,
    message: "Withdrawal request submitted. Awaiting payout processing."
  });
});

/* =========================
   NOTIFICATIONS
========================= */

app.get("/api/notifications", auth, async (req, res) => {
  const { data } = await db
    .from("notifications")
    .select("*")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  res.json({ notifications: data || [] });
});

app.post("/api/notifications/read", auth, async (req, res) => {
  await db
    .from("notifications")
    .update({ read: true })
    .eq("user_id", req.user.id);

  res.json({ ok: true });
});

/* =========================
   DELIVERY
========================= */

app.post("/api/delivery", auth, async (req, res) => {
  const {
    room_id,
    pickup,
    destination,
    description
  } = req.body;

  if (!pickup || !destination)
    return res.status(400).json({ error: "Pickup and destination required" });

  const { data, error } = await db
    .from("deliveries")
    .insert({
      id: id(),
      requester_id: req.user.id,
      room_id: room_id || null,
      pickup,
      destination,
      description: description || "",
      status: "REQUESTED",
      provider: "JR_PHEEF_NETWORK"
    })
    .select("*")
    .single();

  if (error)
    return res.status(500).json({ error: "Delivery request failed" });

  await audit("DELIVERY_REQUESTED", req.user.id, {
    delivery_id: data.id
  });

  res.json({
    ok: true,
    delivery: data,
    message: "Delivery request is now in the JR PHEEF delivery queue."
  });
});

app.post("/api/riders", auth, async (req, res) => {
  const {
    vehicle,
    location,
    provider
  } = req.body;

  if (!vehicle || !location)
    return res.status(400).json({ error: "Vehicle and location required" });

  const { data, error } = await db
    .from("riders")
    .upsert({
      id: id(),
      user_id: req.user.id,
      vehicle,
      location,
      provider: provider || "JR_PHEEF",
      status: "AVAILABLE"
    })
    .select("*")
    .single();

  if (error)
    return res.status(500).json({ error: "Rider registration failed" });

  res.json({ ok: true, rider: data });
});

/* =========================
   OWNER COMMAND CENTER
========================= */

app.post("/api/owner/login", (req, res) => {
  if (!OWNER_KEY)
    return res.status(503).json({ error: "OWNER_KEY is not configured" });

  if (String(req.body.key || "") !== OWNER_KEY)
    return res.status(401).json({ error: "Invalid owner credentials" });

  res.json({
    ok: true,
    token: token({ id: "OWNER" }, "owner")
  });
});

app.get("/api/owner/stats", ownerOnly, async (req, res) => {
  try {
    const tables = [
      "members",
      "listings",
      "tasks",
      "workers",
      "deal_rooms",
      "payments",
      "withdrawals",
      "deliveries",
      "referrals"
    ];

    const stats = {};

    for (const table of tables) {
      const { count } = await db
        .from(table)
        .select("*", { count: "exact", head: true });

      stats[table] = count || 0;
    }

    const { data: pendingPayments } = await db
      .from("payments")
      .select("amount")
      .eq("status", "PENDING");

    const { data: pendingWithdrawals } = await db
      .from("withdrawals")
      .select("amount")
      .eq("status", "PENDING");

    stats.pending_payment_value =
      (pendingPayments || []).reduce((a, x) => a + Number(x.amount || 0), 0);

    stats.pending_withdrawal_value =
      (pendingWithdrawals || []).reduce((a, x) => a + Number(x.amount || 0), 0);

    res.json({ stats });
  } catch (e) {
    res.status(500).json({ error: "Owner statistics failed" });
  }
});

app.get("/api/owner/:table", ownerOnly, async (req, res) => {
  const allowed = [
    "members",
    "listings",
    "tasks",
    "workers",
    "deal_rooms",
    "payments",
    "withdrawals",
    "deliveries",
    "referrals",
    "coupons",
    "notifications",
    "audit_logs"
  ];

  if (!allowed.includes(req.params.table))
    return res.status(400).json({ error: "Invalid owner table" });

  const { data, error } = await db
    .from(req.params.table)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error)
    return res.status(500).json({ error: "Could not load owner data" });

  res.json({ rows: data || [] });
});

app.post("/api/owner/coupon", ownerOnly, async (req, res) => {
  const {
    code,
    description,
    discount_type,
    discount_value,
    expires_at
  } = req.body;

  if (!code || !discount_value)
    return res.status(400).json({ error: "Coupon details required" });

  const { data, error } = await db
    .from("coupons")
    .insert({
      id: id(),
      code: String(code).toUpperCase(),
      description: description || "",
      discount_type: discount_type || "percent",
      discount_value: Number(discount_value),
      active: true,
      expires_at: expires_at || null
    })
    .select("*")
    .single();

  if (error)
    return res.status(500).json({ error: "Coupon creation failed" });

  await audit("OWNER_CREATED_COUPON", "OWNER", {
    coupon_id: data.id
  });

  res.json({ ok: true, coupon: data });
});

app.post("/api/owner/withdrawal/:id", ownerOnly, async (req, res) => {
  const status = req.body.status;

  if (!["PROCESSING", "PAID", "REJECTED"].includes(status))
    return res.status(400).json({ error: "Invalid withdrawal status" });

  const { data: withdrawal } = await db
    .from("withdrawals")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();

  if (!withdrawal)
    return res.status(404).json({ error: "Withdrawal not found" });

  const { data, error } = await db
    .from("withdrawals")
    .update({
      status,
      processed_at: status === "PAID"
        ? new Date().toISOString()
        : null
    })
    .eq("id", withdrawal.id)
    .select("*")
    .single();

  if (error)
    return res.status(500).json({ error: "Withdrawal update failed" });

  await notify(
    withdrawal.user_id,
    "Withdrawal update",
    `Your withdrawal is now ${status}.`,
    "wallet"
  );

  await audit("OWNER_WITHDRAWAL_STATUS", "OWNER", {
    withdrawal_id: withdrawal.id,
    status
  });

  res.json({ ok: true, withdrawal: data });
});

/* =========================
   WHATSAPP
========================= */

app.post("/api/webhook/whatsapp", async (req, res) => {
  try {
    const incoming = String(req.body.Body || "").trim();
    const from = cleanPhone(req.body.From || "");

    const twiml = new twilio.twiml.MessagingResponse();

    let reply;

    const lower = incoming.toLowerCase();

    if (lower.includes("buy")) {
      reply =
        "JR PHEEF 👋\nTell me what you are looking for, your budget and location. I will help you find a match.";
    } else if (lower.includes("sell")) {
      reply =
        "JR PHEEF 👋\nSend the item/service name, price, location and at least 3 photos.";
    } else if (lower.includes("work") || lower.includes("job")) {
      reply =
        "JR PHEEF WORK 👷\nTell me the job you need done, location and budget.";
    } else {
      reply =
        "Welcome to JR PHEEF — Find. Match. Trade. 👋\n\nYou can tell me what you want to buy, sell or get done.";
    }

    twiml.message(reply);

    await db.from("whatsapp_events").insert({
      id: id(),
      phone: from,
      incoming,
      reply
    });

    res.type("text/xml").send(twiml.toString());
  } catch (e) {
    console.error(e);
    res.status(500).send("Webhook error");
  }
});

/* =========================
   SPA
========================= */

app.use((req, res) => {
  if (req.method === "GET") {
    return res.sendFile(
      path.join(__dirname, "public", "index.html")
    );
  }

  res.status(404).json({ error: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`JR PHEEF running on port ${PORT}`);
}); 
