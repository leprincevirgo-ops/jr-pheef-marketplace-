const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "10mb" }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or Supabase key");
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
const FREE_START = 2;
const FREE_END = 6;

/* =========================================================
   HELPERS
========================================================= */

function clean(v) {
  return String(v ?? "").trim();
}

function normalizeEmail(v) {
  return clean(v).toLowerCase();
}

function normalizePhone(v) {
  let p = clean(v)
    .replace(/^whatsapp:/i, "")
    .replace(/\s+/g, "")
    .replace(/-/g, "");

  if (p.startsWith("+254")) return p;
  if (p.startsWith("254")) return "+" + p;
  if (p.startsWith("00254")) return "+" + p.substring(2);

  if (p.startsWith("07") || p.startsWith("01")) {
    return "+254" + p.substring(1);
  }

  return p;
}

function phoneVariants(v) {
  const n = normalizePhone(v);

  if (!n.startsWith("+254") || n.length !== 13) {
    return [...new Set([clean(v)])];
  }

  const local = "0" + n.substring(4);
  const international = "254" + n.substring(1);

  return [...new Set([
    n,
    international,
    local,
    "+" + international
  ])];
}

function validPhone(v) {
  return /^\+254\d{9}$/.test(normalizePhone(v));
}

function hash(v) {
  return crypto
    .createHash("sha256")
    .update(String(v))
    .digest("hex");
}

function sessionCookie(token) {
  return [
    `jr_session=${token}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=604800"
  ].join("; ");
}

function freeWindow() {
  const d = new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Africa/Nairobi"
    })
  );

  const h = d.getHours();
  return h >= FREE_START && h < FREE_END;
}

function contactBlocked(text) {
  const s = clean(text);

  return [
    /\b\d{9,13}\b/,
    /\+254\d{9}/i,
    /\b07\d{8}\b/,
    /\b01\d{8}\b/,
    /https?:\/\//i,
    /www\./i,
    /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i,
    /\.com\b/i,
    /\.co\.ke\b/i,
    /\bwhatsapp\b/i,
    /\btelegram\b/i,
    /\bcall me\b/i,
    /\btext me\b/i
  ].some(r => r.test(s));
}

async function logActivity(memberId, action, details = {}) {
  await db.from("activity_log").insert({
    member_id: String(memberId),
    action,
    details
  });
}

/* =========================================================
   SESSION / MEMBER
========================================================= */

async function getMember(req) {
  const cookies = req.headers.cookie || "";
  const match = cookies.match(/(?:^|;\s*)jr_session=([^;]+)/);

  if (!match) return null;

  const token = match[1];

  const { data: session } = await db
    .from("sessions")
    .select("member_id,expires_at")
    .eq("token_hash", hash(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (!session) return null;

  const { data: member } = await db
    .from("members")
    .select("*")
    .eq("id", session.member_id)
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

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    app: "JR PHEEF",
    version: "3.4.0",
    login: "PHONE_OR_EMAIL",
    password_hash: "BCRYPT",
    access: "KSh 30 / 5 hours",
    free_window: "02:00-06:00 EAT",
    points: "ACTIVE",
    flex: "PREPARED / INACTIVE",
    daraja: "NOT CONNECTED"
  });
});

/* =========================================================
   FRONTEND
========================================================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =========================================================
   REGISTER
========================================================= */

app.post("/api/register", async (req, res) => {
  try {
    const name = clean(req.body.full_name);
    const phone = normalizePhone(req.body.phone);
    const email = normalizeEmail(req.body.email);
    const birthYear = Number(req.body.birth_year);
    const password = clean(req.body.password);

    if (!name) {
      return res.status(400).json({
        ok: false,
        error: "Full name is required."
      });
    }

    if (!validPhone(phone)) {
      return res.status(400).json({
        ok: false,
        error: "Enter a valid Kenyan phone number."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        ok: false,
        error: "Password must be at least 6 characters."
      });
    }

    /*
      IMPORTANT:
      Check phone and email separately.
      This avoids failures caused by Supabase .or()
      and prevents duplicate accounts.
    */

    const variants = phoneVariants(phone);

    let existing = null;

    for (const p of variants) {
      const { data } = await db
        .from("members")
        .select("id,dgbo_id,phone,email")
        .eq("phone", p)
        .limit(1);

      if (data && data.length) {
        existing = data[0];
        break;
      }
    }

    if (!existing && email) {
      const { data } = await db
        .from("members")
        .select("id,dgbo_id,phone,email")
        .eq("email", email)
        .limit(1);

      if (data && data.length) {
        existing = data[0];
      }
    }

    if (existing) {
      return res.status(409).json({
        ok: false,
        error:
          "An account already exists with this phone or email. Please login instead."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    let dgboId;

    const { data: generatedId } =
      await db.rpc("next_dgbo_id");

    dgboId =
      generatedId ||
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
        cash_balance: 0,
        theme: "ocean",
        account_type: "individual"
      })
      .select()
      .single();

    if (error) {
      console.error("REGISTER ERROR:", error);

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
      message: "Account created successfully.",
      member: {
        id: member.id,
        dgbo_id: member.dgbo_id,
        full_name: member.full_name
      }
    });

  } catch (e) {
    console.error("REGISTER:", e);

    res.status(500).json({
      ok: false,
      error: "Registration failed."
    });
  }
});

/* =========================================================
   LOGIN — FIXED
========================================================= */

app.post("/api/login", async (req, res) => {
  try {
    const identifier = clean(req.body.identifier);
    const password = clean(req.body.password);

    if (!identifier || !password) {
      return res.status(400).json({
        ok: false,
        error: "Enter your phone/email and password."
      });
    }

    let member = null;

    /*
      STEP 1:
      If identifier looks like an email,
      search email directly.
    */

    if (identifier.includes("@")) {
      const email = normalizeEmail(identifier);

      const { data } = await db
        .from("members")
        .select("*")
        .eq("email", email)
        .limit(1);

      if (data && data.length) {
        member = data[0];
      }
    }

    /*
      STEP 2:
      Otherwise search every known Kenyan
      phone representation.
    */

    if (!member) {
      const variants = phoneVariants(identifier);

      for (const p of variants) {
        const { data } = await db
          .from("members")
          .select("*")
          .eq("phone", p)
          .limit(1);

        if (data && data.length) {
          member = data[0];
          break;
        }
      }
    }

    /*
      STEP 3:
      Fallback email search even if identifier
      did not contain @.
    */

    if (!member) {
      const email = normalizeEmail(identifier);

      if (email.includes("@")) {
        const { data } = await db
          .from("members")
          .select("*")
          .eq("email", email)
          .limit(1);

        if (data && data.length) {
          member = data[0];
        }
      }
    }

    if (!member) {
      return res.status(401).json({
        ok: false,
        error: "No JR PHEEF account was found with that phone or email."
      });
    }

    /*
      THIS IS THE IMPORTANT PASSWORD-HASH FIX.
      Never compare password text directly with the hash.
    */

    if (!member.password_hash) {
      return res.status(401).json({
        ok: false,
        error:
          "This account does not have a valid password yet. Use password reset to create one."
      });
    }

    const passwordOK = await bcrypt.compare(
      password,
      member.password_hash
    );

    if (!passwordOK) {
      return res.status(401).json({
        ok: false,
        error: "Incorrect password."
      });
    }

    /*
      Do not allow disabled accounts into the platform.
    */

    const status =
      String(member.status || "active").toLowerCase();

    if (
      status === "blocked" ||
      status === "suspended" ||
      status === "disabled"
    ) {
      return res.status(403).json({
        ok: false,
        error: "This JR PHEEF account is currently restricted."
      });
    }

    /*
      CREATE SECURE SESSION
    */

    const token = crypto
      .randomBytes(48)
      .toString("hex");

    const expires = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    );

    const { error: sessionError } = await db
      .from("sessions")
      .insert({
        member_id: String(member.id),
        token_hash: hash(token),
        expires_at: expires.toISOString()
      });

    if (sessionError) {
      console.error("SESSION ERROR:", sessionError);

      return res.status(500).json({
        ok: false,
        error: "Could not create login session."
      });
    }

    res.setHeader(
      "Set-Cookie",
      sessionCookie(token)
    );

    await db
      .from("members")
      .update({
        last_seen_at: new Date().toISOString(),
        is_online: true
      })
      .eq("id", member.id);

    await logActivity(member.id, "LOGIN");

    res.json({
      ok: true,
      message: "Login successful.",
      member
    });

  } catch (e) {
    console.error("LOGIN ERROR:", e);

    res.status(500).json({
      ok: false,
      error: "Login failed. Please try again."
    });
  }
});

/* =========================================================
   PASSWORD RESET REQUEST
========================================================= */

app.post("/api/password-reset/request", async (req, res) => {
  try {
    const identifier = clean(req.body.identifier);

    if (!identifier) {
      return res.status(400).json({
        ok: false,
        error: "Enter your phone or email."
      });
    }

    let member = null;

    if (identifier.includes("@")) {
      const { data } = await db
        .from("members")
        .select("id,email,phone")
        .eq("email", normalizeEmail(identifier))
        .limit(1);

      member = data?.[0] || null;
    } else {
      for (const p of phoneVariants(identifier)) {
        const { data } = await db
          .from("members")
          .select("id,email,phone")
          .eq("phone", p)
          .limit(1);

        if (data?.length) {
          member = data[0];
          break;
        }
      }
    }

    /*
      Do not reveal whether an account exists
      in a production password-reset response.
    */

    if (!member) {
      return res.json({
        ok: true,
        message:
          "If an account exists, password recovery can continue."
      });
    }

    const rawToken = crypto
      .randomBytes(32)
      .toString("hex");

    await db
      .from("password_resets")
      .insert({
        member_id: String(member.id),
        token_hash: hash(rawToken),
        expires_at: new Date(
          Date.now() + 30 * 60 * 1000
        ).toISOString(),
        used: false
      });

    console.log(
      `PASSWORD RESET CREATED FOR MEMBER ${member.id}`
    );

    res.json({
      ok: true,
      message:
        "Password reset request created. A recovery delivery method can be connected next."
    });

  } catch (e) {
    console.error("RESET:", e);

    res.status(500).json({
      ok: false,
      error: "Password reset request failed."
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
  const cookies = req.headers.cookie || "";
  const match = cookies.match(/(?:^|;\s*)jr_session=([^;]+)/);

  if (match) {
    const token = match[1];

    const { data: session } = await db
      .from("sessions")
      .select("member_id")
      .eq("token_hash", hash(token))
      .maybeSingle();

    await db
      .from("sessions")
      .delete()
      .eq("token_hash", hash(token));

    if (session?.member_id) {
      await db
        .from("members")
        .update({
          is_online: false
        })
        .eq("id", session.member_id);
    }
  }

  res.setHeader(
    "Set-Cookie",
    "jr_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
  );

  res.json({ ok: true });
});

/* =========================================================
   ACCESS
========================================================= */

async function accessStatus(memberId) {
  if (freeWindow()) {
    return {
      allowed: true,
      reason: "FREE_WINDOW",
      message: "Free access from 02:00 to 06:00 EAT."
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
   POINTS
========================================================= */

app.post("/api/points/redeem-access", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;

  if (freeWindow()) {
    return res.json({
      ok: true,
      free: true,
      message: "You already have free access right now."
    });
  }

  const points = Number(member.reward_points || 0);

  if (points < ACCESS_PRICE) {
    return res.status(400).json({
      ok: false,
      error:
        `You need ${ACCESS_PRICE} points for 5-hour access.`,
      points
    });
  }

  const starts = new Date();
  const expires = new Date(
    starts.getTime() +
    ACCESS_HOURS * 60 * 60 * 1000
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
      error: "Points could not be redeemed."
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
    description:
      "30 points redeemed for 5-hour access"
  });

  res.json({
    ok: true,
    message:
      "30 points redeemed. You now have 5-hour access.",
    points_remaining:
      Number(updated.reward_points || 0),
    expires_at: expires.toISOString()
  });
});

/* =========================================================
   OWNER POINTS
========================================================= */

app.post("/api/owner/points", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;

  const owner =
    String(member.account_type).toLowerCase() === "owner" ||
    String(member.role || "").toLowerCase() === "owner";

  if (!owner) {
    return res.status(403).json({
      ok: false,
      error: "Owner access required."
    });
  }

  const targetId = clean(req.body.member_id);
  const amount = Number(req.body.amount);

  if (
    !targetId ||
    !Number.isInteger(amount) ||
    amount === 0
  ) {
    return res.status(400).json({
      ok: false,
      error: "Valid member_id and point amount required."
    });
  }

  const { data: target } = await db
    .from("members")
    .select("id,reward_points")
    .eq("id", targetId)
    .maybeSingle();

  if (!target) {
    return res.status(404).json({
      ok: false,
      error: "Member not found."
    });
  }

  const newPoints = Math.max(
    0,
    Number(target.reward_points || 0) + amount
  );

  await db
    .from("members")
    .update({
      reward_points: newPoints
    })
    .eq("id", target.id);

  await db.from("point_transactions").insert({
    member_id: String(target.id),
    amount,
    transaction_type:
      amount > 0
        ? "OWNER_AWARD"
        : "OWNER_DEDUCTION",
    description:
      clean(req.body.description) ||
      "Owner point adjustment"
  });

  res.json({
    ok: true,
    reward_points: newPoints
  });
});

/* =========================================================
   FLEX
========================================================= */

app.get("/api/flex", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;

  const { data } = await db
    .from("pay_later_accounts")
    .select("*")
    .eq("member_id", String(member.id))
    .maybeSingle();

  res.json({
    ok: true,
    active: false,
    status: data?.status || "inactive",
    trust_level: data?.trust_level || 0,
    available_limit: data?.available_limit || 0,
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

  const fields = [
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

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      update[field] =
        field === "email"
          ? normalizeEmail(req.body[field])
          : req.body[field];
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
    .order("created_at", {
      ascending: false
    })
    .limit(50);

  const q = clean(req.query.q);

  if (q) {
    query = query.ilike(
      "item_name",
      `%${q}%`
    );
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

    const access =
      await accessStatus(member.id);

    if (!access.allowed) {
      return res.status(402).json({
        ok: false,
        error: "MARKETPLACE_ACCESS_REQUIRED",
        price: ACCESS_PRICE,
        hours: ACCESS_HOURS
      });
    }

    const name = clean(req.body.item_name);
    const description =
      clean(req.body.description);

    if (!name) {
      return res.status(400).json({
        ok: false,
        error: "Listing title is required."
      });
    }

    if (
      contactBlocked(name) ||
      contactBlocked(description)
    ) {
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

      const { error } =
        await db.storage
          .from("jr-pheef-media")
          .upload(
            filename,
            file.buffer,
            {
              contentType:
                file.mimetype,
              upsert: false
            }
          );

      if (!error) {
        const { data } =
          db.storage
            .from("jr-pheef-media")
            .getPublicUrl(filename);

        photos.push(
          data.publicUrl
        );
      }
    }

    const { data, error } =
      await db
        .from("jr_listings")
        .insert({
          member_id: String(member.id),
          item_name: name,
          description,
          category:
            clean(req.body.category),
          price:
            Number(req.body.price || 0),
          location:
            clean(req.body.location),
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

    await logActivity(
      member.id,
      "CREATE_LISTING",
      {
        listing_id: data.id
      }
    );

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

  const receiverId =
    clean(req.body.receiver_id);

  if (
    !receiverId ||
    receiverId === String(member.id)
  ) {
    return res.status(400).json({
      ok: false,
      error: "Invalid connection."
    });
  }

  const { data, error } =
    await db
      .from("connections")
      .upsert(
        {
          requester_id:
            String(member.id),
          receiver_id:
            receiverId,
          status: "pending",
          updated_at:
            new Date().toISOString()
        },
        {
          onConflict:
            "requester_id,receiver_id"
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
  const upper = message.toUpperCase();

  let response =
    "👋 Welcome to JR PHEEF.\n\n" +
    "Find opportunities.\n" +
    "Create opportunities.\n" +
    "Match.\n" +
    "Connect.\n\n" +
    "You can speak naturally.";

  try {
    if (upper === "POINTS") {
      const { data } =
        await db
          .from("members")
          .select("reward_points")
          .eq("phone", phone)
          .maybeSingle();

      const points =
        Number(data?.reward_points || 0);

      response =
        `⭐ JR PHEEF POINTS\n\n` +
        `${points} points\n\n` +
        `30 points = 5-hour marketplace access.`;
    }

    else if (
      upper === "OKOA" ||
      upper === "FLEX" ||
      upper === "PAY LATER"
    ) {
      response =
        "💙 PHEEF FLEX\n\n" +
        "PHEEF FLEX is being prepared for eligible members.\n\n" +
        "Real credit is not active yet.\n\n" +
        "For now use JR PHEEF Points or the normal KSh 30 access pass.";
    }

    else if (upper === "ACCESS") {
      response =
        "🔓 JR PHEEF ACCESS\n\n" +
        "KSh 30 = 5 hours.\n\n" +
        "02:00–06:00 EAT = FREE.\n\n" +
        "30 JR PHEEF Points can also be redeemed.";
    }

    else if (upper === "HELP") {
      response =
        "JR PHEEF\n\n" +
        "🔎 FIND\n" +
        "➕ CREATE\n" +
        "🤝 CONNECT\n" +
        "⭐ POINTS\n" +
        "🔓 ACCESS\n" +
        "💙 FLEX / OKOA\n\n" +
        "You can also speak normally.";
    }

    const safe = response
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    res
      .type("text/xml")
      .send(
        `<Response><Message>${safe}</Message></Response>`
      );

  } catch (e) {
    console.error("WHATSAPP:", e);

    res
      .type("text/xml")
      .send(
        "<Response><Message>JR PHEEF is temporarily unavailable.</Message></Response>"
      );
  }
});

/* =========================================================
   FALLBACK
========================================================= */

app.use((req, res) => {
  if (req.method === "GET") {
    return res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }

  res.status(404).json({
    ok: false,
    error: "Not found"
  });
});

/* =========================================================
   START
========================================================= */

app.listen(PORT, () => {
  console.log(`JR PHEEF 3.4 running on ${PORT}`);
  console.log("Login: PHONE OR EMAIL");
  console.log("Password: BCRYPT HASH");
  console.log("Access: KSh 30 / 5 hours");
  console.log("Free window: 02:00-06:00 EAT");
  console.log("Points redemption: ACTIVE");
  console.log("PHEEF FLEX: PREPARED / INACTIVE");
  console.log("Daraja: NOT CONNECTED");
});
