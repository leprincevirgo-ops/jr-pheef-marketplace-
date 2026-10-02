const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 10000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 6 * 1024 * 1024,
    files: 20
  }
});

const ACCESS_PRICE = 30;
const ACCESS_HOURS = 5;
const FREE_START_HOUR = 2;
const FREE_END_HOUR = 6;

function clean(v) {
  return String(v || "").trim();
}

function hash(value) {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
}

function normalizePhone(phone) {
  let p = clean(phone).replace(/^whatsapp:/i, "").replace(/\s+/g, "");

  if (p.startsWith("+254")) return p;
  if (p.startsWith("254")) return "+" + p;
  if (p.startsWith("07")) return "+254" + p.substring(1);
  if (p.startsWith("01")) return "+254" + p.substring(1);

  return p;
}

function validPhone(phone) {
  return /^\+254\d{9}$/.test(phone);
}

function money(v) {
  return Number(v || 0).toLocaleString("en-KE");
}

function now() {
  return new Date();
}

function freeWindow() {
  const d = new Date(
    now().toLocaleString("en-US", {
      timeZone: "Africa/Nairobi"
    })
  );

  const h = d.getHours();

  return h >= FREE_START_HOUR && h < FREE_END_HOUR;
}

function contactBlocked(text) {
  const s = clean(text);

  const patterns = [
    /\b\d{9,13}\b/,
    /\+254\d{9}/i,
    /\b07\d{8}\b/i,
    /\b01\d{8}\b/i,
    /https?:\/\//i,
    /www\./i,
    /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i,
    /\.com\b/i,
    /\.co\.ke\b/i,
    /\bwhatsapp\b/i,
    /\btelegram\b/i,
    /\bcall me\b/i,
    /\btext me\b/i
  ];

  return patterns.some((r) => r.test(s));
}

function sessionCookie(token) {
  return `jr_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`;
}

async function getMember(req) {
  const raw = req.headers.cookie || "";
  const match = raw.match(/jr_session=([^;]+)/);

  if (!match) return null;

  const token = match[1];

  const { data } = await db
    .from("sessions")
    .select("member_id,expires_at")
    .eq("token_hash", hash(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!data) return null;

  const { data: member } = await db
    .from("members")
    .select("*")
    .eq("id", data.member_id)
    .maybeSingle();

  return member || null;
}

async function requireMember(req, res) {
  const member = await getMember(req);

  if (!member) {
    res.status(401).json({
      ok: false,
      error: "LOGIN_REQUIRED"
    });
    return null;
  }

  return member;
}

async function logActivity(memberId, action, details = {}) {
  await db.from("activity_log").insert({
    member_id: String(memberId),
    action,
    details
  });
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    app: "JR PHEEF",
    version: "3.3.0",
    access: "KSh 30 / 5 hours",
    free_window: "02:00-06:00 EAT",
    points: true,
    pheef_flex: "prepared_not_active",
    daraja: "not_connected"
  });
});

/* =========================================================
   HOME
========================================================= */

app.get("/", (req, res) => {
  res.sendFile(require("path").join(__dirname, "public", "index.html"));
});

/* =========================================================
   REGISTER
========================================================= */

app.post("/api/register", async (req, res) => {
  try {
    const name = clean(req.body.full_name);
    const phone = normalizePhone(req.body.phone);
    const email = clean(req.body.email).toLowerCase();
    const birthYear = Number(req.body.birth_year);
    const password = clean(req.body.password);

    if (!name || !validPhone(phone) || !password) {
      return res.status(400).json({
        ok: false,
        error: "Name, valid Kenyan phone and password are required."
      });
    }

    const { data: existing } = await db
      .from("members")
      .select("id")
      .or(`phone.eq.${phone},email.eq.${email}`)
      .limit(1);

    if (existing && existing.length) {
      return res.status(409).json({
        ok: false,
        error: "An account already exists."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { data: dgbo } = await db.rpc("next_dgbo_id");

    const dgboId =
      dgbo ||
      `DGBO-${String(Date.now()).slice(-6)}`;

    const { data: member, error } = await db
      .from("members")
      .insert({
        dgbo_id: dgboId,
        full_name: name,
        phone,
        email: email || null,
        birth_year: birthYear || null,
        password_hash: passwordHash,
        verified: false,
        status: "active",
        plan: "FREE",
        reward_points: 0,
        credits: 0,
        rewards: 0,
        referrals: 0,
        theme: "ocean",
        account_type: "individual"
      })
      .select()
      .single();

    if (error) {
      console.error("REGISTER:", error);
      return res.status(400).json({
        ok: false,
        error: error.message
      });
    }

    await logActivity(member.id, "REGISTER", {
      dgbo_id: dgboId
    });

    res.json({
      ok: true,
      message: "Account created.",
      member: {
        id: member.id,
        dgbo_id: member.dgbo_id,
        full_name: member.full_name
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      ok: false,
      error: "Registration failed."
    });
  }
});

/* =========================================================
   LOGIN
========================================================= */

app.post("/api/login", async (req, res) => {
  try {
    const identifier = clean(req.body.identifier);
    const password = clean(req.body.password);

    const phone = normalizePhone(identifier);

    const query = validPhone(phone)
      ? `phone.eq.${phone}`
      : `email.eq.${identifier.toLowerCase()}`;

    const { data: member } = await db
      .from("members")
      .select("*")
      .or(query)
      .maybeSingle();

    if (!member || !member.password_hash) {
      return res.status(401).json({
        ok: false,
        error: "Invalid login details."
      });
    }

    const valid = await bcrypt.compare(
      password,
      member.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        ok: false,
        error: "Invalid login details."
      });
    }

    const token = crypto.randomBytes(48).toString("hex");

    await db.from("sessions").insert({
      member_id: String(member.id),
      token_hash: hash(token),
      expires_at: new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      ).toISOString()
    });

    res.setHeader("Set-Cookie", sessionCookie(token));

    await db
      .from("members")
      .update({
        last_seen_at: new Date().toISOString(),
        is_online: true
      })
      .eq("id", member.id);

    res.json({
      ok: true,
      member
    });
  } catch (e) {
    console.error("LOGIN:", e);

    res.status(500).json({
      ok: false,
      error: "Login failed."
    });
  }
});

/* =========================================================
   ME
========================================================= */

app.get("/api/me", async (req, res) => {
  const member = await getMember(req);

  if (!member) {
    return res.json({
      ok: true,
      logged_in: false
    });
  }

  res.json({
    ok: true,
    logged_in: true,
    member
  });
});

/* =========================================================
   LOGOUT
========================================================= */

app.post("/api/logout", async (req, res) => {
  const raw = req.headers.cookie || "";
  const match = raw.match(/jr_session=([^;]+)/);

  if (match) {
    await db
      .from("sessions")
      .delete()
      .eq("token_hash", hash(match[1]));
  }

  res.setHeader(
    "Set-Cookie",
    "jr_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
  );

  res.json({ ok: true });
});

/* =========================================================
   ACCESS STATUS
========================================================= */

async function accessStatus(memberId) {
  if (freeWindow()) {
    return {
      allowed: true,
      reason: "FREE_WINDOW",
      message: "Free access between 02:00 and 06:00 EAT."
    };
  }

  const { data } = await db
    .from("access_passes")
    .select("*")
    .eq("member_id", String(memberId))
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data) {
    return {
      allowed: true,
      reason: "ACTIVE_PASS",
      expires_at: data.expires_at
    };
  }

  return {
    allowed: false,
    reason: "PAYMENT_REQUIRED",
    price: ACCESS_PRICE,
    hours: ACCESS_HOURS
  };
}

app.get("/api/access", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;

  res.json({
    ok: true,
    ...(await accessStatus(member.id)),
    points: Number(member.reward_points || 0),
    points_needed: ACCESS_PRICE
  });
});

/* =========================================================
   REDEEM POINTS
========================================================= */

app.post("/api/points/redeem-access", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;

  const points = Number(member.reward_points || 0);

  if (freeWindow()) {
    return res.json({
      ok: true,
      message: "You already have free access right now.",
      free: true
    });
  }

  if (points < ACCESS_PRICE) {
    return res.status(400).json({
      ok: false,
      error: `You need ${ACCESS_PRICE} points for 5-hour access.`,
      points,
      needed: ACCESS_PRICE
    });
  }

  const starts = new Date();
  const expires = new Date(
    starts.getTime() + ACCESS_HOURS * 60 * 60 * 1000
  );

  const { data: updated, error } = await db
    .from("members")
    .update({
      reward_points: points - ACCESS_PRICE
    })
    .eq("id", member.id)
    .gte("reward_points", ACCESS_PRICE)
    .select("reward_points")
    .maybeSingle();

  if (error || !updated) {
    return res.status(409).json({
      ok: false,
      error: "Points could not be redeemed. Please try again."
    });
  }

  const { error: passError } = await db
    .from("access_passes")
    .insert({
      member_id: String(member.id),
      amount: ACCESS_PRICE,
      hours: ACCESS_HOURS,
      payment_method: "points",
      source: "points",
      status: "active",
      starts_at: starts.toISOString(),
      expires_at: expires.toISOString()
    });

  if (passError) {
    await db
      .from("members")
      .update({
        reward_points: points
      })
      .eq("id", member.id);

    return res.status(500).json({
      ok: false,
      error: "Access pass could not be created."
    });
  }

  await db.from("point_transactions").insert({
    member_id: String(member.id),
    amount: -ACCESS_PRICE,
    transaction_type: "REDEEM_ACCESS",
    description: "Redeemed 30 points for 5-hour marketplace access"
  });

  await logActivity(member.id, "POINTS_REDEEMED", {
    points: ACCESS_PRICE,
    access_hours: ACCESS_HOURS
  });

  res.json({
    ok: true,
    message: "30 points redeemed. You now have 5-hour access.",
    points_remaining: Number(updated.reward_points || 0),
    expires_at: expires.toISOString()
  });
});

/* =========================================================
   OWNER POINT CONTROL
========================================================= */

app.post("/api/owner/points", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;

  const owner =
    String(member.account_type || "").toLowerCase() === "owner" ||
    String(member.role || "").toLowerCase() === "owner";

  if (!owner) {
    return res.status(403).json({
      ok: false,
      error: "Owner access required."
    });
  }

  const targetId = clean(req.body.member_id);
  const amount = Number(req.body.amount);
  const description =
    clean(req.body.description) || "Owner point adjustment";

  if (!targetId || !Number.isInteger(amount) || amount === 0) {
    return res.status(400).json({
      ok: false,
      error: "member_id and non-zero integer amount required."
    });
  }

  const { data: target } = await db
    .from("members")
    .select("id,reward_points")
    .eq("id", targetId)
    .single();

  if (!target) {
    return res.status(404).json({
      ok: false,
      error: "Member not found."
    });
  }

  const newPoints =
    Math.max(0, Number(target.reward_points || 0) + amount);

  await db
    .from("members")
    .update({
      reward_points: newPoints
    })
    .eq("id", target.id);

  await db.from("point_transactions").insert({
    member_id: String(target.id),
    amount,
    transaction_type: amount > 0 ? "OWNER_AWARD" : "OWNER_DEDUCTION",
    description
  });

  res.json({
    ok: true,
    reward_points: newPoints
  });
});

/* =========================================================
   PHEEF FLEX / OKOA
   PREPARED BUT DISABLED
========================================================= */

app.get("/api/flex", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;

  const { data: account } = await db
    .from("pay_later_accounts")
    .select("*")
    .eq("member_id", String(member.id))
    .maybeSingle();

  res.json({
    ok: true,
    active: false,
    status: account?.status || "inactive",
    trust_level: account?.trust_level || 0,
    available_limit: account?.available_limit || 0,
    message:
      "PHEEF FLEX is being prepared. Real credit is not active yet."
  });
});

app.post("/api/flex/request", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;

  const amount = Number(req.body.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({
      ok: false,
      error: "Enter a valid amount."
    });
  }

  /*
    IMPORTANT:
    This does NOT issue credit.
    It only records interest/request information.
  */

  const { data, error } = await db
    .from("credit_requests")
    .insert({
      member_id: String(member.id),
      requested_amount: amount,
      approved_amount: 0,
      principal: 0,
      interest_amount: 0,
      fees: 0,
      total_payable: 0,
      status: "disabled",
      provider: "JR_PHEEF_PENDING_PARTNER",
      purpose: "marketplace_access"
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }

  await logActivity(member.id, "FLEX_REQUEST", {
    amount,
    status: "disabled"
  });

  res.json({
    ok: true,
    active: false,
    request_id: data.id,
    message:
      "Your PHEEF FLEX request was recorded, but credit is not currently enabled."
  });
});

/* =========================================================
   PROFILE
========================================================= */

app.put("/api/profile", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;

  const allowed = [
    "full_name",
    "email",
    "bio",
    "location",
    "theme",
    "profile_visibility",
    "show_email",
    "show_birth_year",
    "show_location"
  ];

  const update = {};

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      update[key] = req.body[key];
    }
  }

  const { data, error } = await db
    .from("members")
    .update(update)
    .eq("id", member.id)
    .select()
    .single();

  if (error) {
    return res.status(400).json({
      ok: false,
      error: error.message
    });
  }

  res.json({
    ok: true,
    member: data
  });
});

/* =========================================================
   LISTINGS
========================================================= */

app.get("/api/listings", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;

  const access = await accessStatus(member.id);

  if (!access.allowed) {
    return res.status(402).json({
      ok: false,
      error: "MARKETPLACE_ACCESS_REQUIRED",
      price: ACCESS_PRICE,
      hours: ACCESS_HOURS,
      points: Number(member.reward_points || 0)
    });
  }

  let query = db
    .from("jr_listings")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(50);

  const q = clean(req.query.q);

  if (q) {
    query = query.ilike("item_name", `%${q}%`);
  }

  const { data, error } = await query;

  if (error) {
    return res.status(400).json({
      ok: false,
      error: error.message
    });
  }

  res.json({
    ok: true,
    listings: data || []
  });
});

app.post(
  "/api/listings",
  upload.array("photos", 20),
  async (req, res) => {
    const member = await requireMember(req, res);
    if (!member) return;

    const access = await accessStatus(member.id);

    if (!access.allowed) {
      return res.status(402).json({
        ok: false,
        error: "MARKETPLACE_ACCESS_REQUIRED",
        price: ACCESS_PRICE,
        hours: ACCESS_HOURS,
        points: Number(member.reward_points || 0)
      });
    }

    const name = clean(req.body.item_name);
    const description = clean(req.body.description);

    if (!name) {
      return res.status(400).json({
        ok: false,
        error: "Listing title is required."
      });
    }

    if (contactBlocked(description) || contactBlocked(name)) {
      return res.status(400).json({
        ok: false,
        error:
          "Direct contact information cannot be shared in listings."
      });
    }

    const photos = [];

    for (const file of req.files || []) {
      const filename =
        `${member.id}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${file.originalname}`
          .replace(/\s+/g, "-");

      const { error } = await db.storage
        .from("jr-pheef-media")
        .upload(filename, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (!error) {
        const { data } = db.storage
          .from("jr-pheef-media")
          .getPublicUrl(filename);

        photos.push(data.publicUrl);
      }
    }

    const { data, error } = await db
      .from("jr_listings")
      .insert({
        member_id: String(member.id),
        item_name: name,
        description,
        category: clean(req.body.category),
        price: Number(req.body.price || 0),
        location: clean(req.body.location),
        photos,
        status: "active"
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message
      });
    }

    await logActivity(member.id, "CREATE_LISTING", {
      listing_id: data.id
    });

    res.json({
      ok: true,
      listing: data
    });
  }
);

/* =========================================================
   CONNECTIONS
========================================================= */

app.post("/api/connections", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;

  const receiverId = clean(req.body.receiver_id);

  if (!receiverId || receiverId === String(member.id)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid connection."
    });
  }

  const { data, error } = await db
    .from("connections")
    .upsert(
      {
        requester_id: String(member.id),
        receiver_id: receiverId,
        status: "pending",
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "requester_id,receiver_id"
      }
    )
    .select()
    .single();

  if (error) {
    return res.status(400).json({
      ok: false,
      error: error.message
    });
  }

  res.json({
    ok: true,
    connection: data
  });
});

/* =========================================================
   WHATSAPP
========================================================= */

app.post("/api/webhook/whatsapp", async (req, res) => {
  const message = clean(req.body.Body);
  const phone = normalizePhone(req.body.From);

  let response =
    "👋 Welcome to JR PHEEF.\n\n" +
    "Find opportunities.\n" +
    "Create opportunities.\n" +
    "Match.\n" +
    "Connect.\n\n" +
    "You can also chat naturally with JR PHEEF.";

  try {
    const upper = message.toUpperCase();

    if (upper === "POINTS") {
      const { data } = await db
        .from("members")
        .select("reward_points")
        .eq("phone", phone)
        .maybeSingle();

      const points = Number(data?.reward_points || 0);

      response =
        `⭐ YOUR JR PHEEF POINTS\n\n` +
        `${points} points\n\n` +
        `30 points = 5-hour marketplace access.\n\n` +
        `Redeem when you don't want to pay cash.`;
    }

    else if (
      upper === "OKOA" ||
      upper === "PAY LATER" ||
      upper === "FLEX"
    ) {
      response =
        "💙 PHEEF FLEX\n\n" +
        "Need marketplace access but don't have cash?\n\n" +
        "PHEEF FLEX is being prepared for eligible members.\n\n" +
        "Real credit is not active yet.\n\n" +
        "For now you can use JR PHEEF Points or the normal KSh 30 access pass.";
    }

    else if (upper === "ACCESS") {
      response =
        "🔓 JR PHEEF ACCESS\n\n" +
        "KSh 30 = 5 hours.\n\n" +
        "02:00–06:00 EAT = FREE.\n\n" +
        "You can also redeem 30 JR PHEEF Points instead of paying cash.";
    }

    else if (upper === "HELP") {
      response =
        "JR PHEEF\n\n" +
        "🔎 FIND opportunities\n" +
        "➕ CREATE opportunities\n" +
        "🤝 CONNECT with people\n" +
        "⭐ POINTS\n" +
        "🔓 ACCESS\n" +
        "💙 FLEX / OKOA\n\n" +
        "You can also speak normally and JR PHEEF will understand common requests.";
    }

    return res
      .type("text/xml")
      .send(
        `<Response><Message>${response
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")}</Message></Response>`
      );
  } catch (e) {
    console.error("WHATSAPP:", e);

    return res
      .type("text/xml")
      .send(
        "<Response><Message>JR PHEEF is temporarily unable to process that request.</Message></Response>"
      );
  }
});

/* =========================================================
   EXPRESS 5 FALLBACK
========================================================= */

app.use((req, res) => {
  if (req.method === "GET") {
    return res.sendFile(
      require("path").join(__dirname, "public", "index.html")
    );
  }

  res.status(404).json({
    ok: false,
    error: "Not found"
  });
});

app.listen(PORT, () => {
  console.log(`JR PHEEF 3.3 running on ${PORT}`);
  console.log("Access: KSh 30 / 5 hours");
  console.log("Free window: 02:00-06:00 EAT");
  console.log("Points redemption: ACTIVE");
  console.log("PHEEF FLEX: PREPARED / INACTIVE");
  console.log("Daraja: NOT CONNECTED");
}); 
