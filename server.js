const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* =========================
   ENVIRONMENT
========================= */

const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_SECRET_KEY;

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_WHATSAPP_NUMBER;

const TILL = process.env.JR_PHEEF_TILL || "9270365";

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

const twilioClient = twilio(
  TWILIO_SID,
  TWILIO_TOKEN
);

/* =========================
   SETTINGS
========================= */

const CONNECTION_FEE = 30;

const PHOTO_LIMITS = {
  FREE: 5,
  PLUS: 5,
  PRO: 10,
  PRIME: 20,
  ELITE: 20
};

const MEMBERSHIP = {
  FREE: {
    name: "JR PHEEF FREE+",
    price: 0
  },

  PRO: {
    name: "JR PHEEF PRO",
    price: 99,
    period: "monthly"
  },

  PRIME: {
    name: "JR PHEEF PRIME",
    price: 149,
    period: "monthly"
  },

  ELITE: {
    name: "JR PHEEF ELITE",
    price: null,
    period: "custom"
  }
};

/* =========================
   HELPERS
========================= */

function cleanPhone(value) {
  return String(value || "")
    .replace(/^whatsapp:/i, "")
    .trim();
}

function money(value) {
  return Number(value || 0).toLocaleString("en-KE");
}

function xml(text) {
  return `<Response><Message>${String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")}</Message></Response>`;
}

async function sendWhatsApp(to, message) {
  return twilioClient.messages.create({
    from: TWILIO_FROM,
    to: `whatsapp:${cleanPhone(to)}`,
    body: message
  });
}

/* =========================
   MEMBERSHIP
========================= */

function getMembership(text) {
  const value = String(text || "").toUpperCase();

  if (value.includes("PRIME")) return "PRIME";
  if (value.includes("PRO")) return "PRO";

  return "FREE";
}

function photoLimit(plan) {
  return PHOTO_LIMITS[plan] || 5;
}

/* =========================
   WELCOME
========================= */

function welcome() {
  return `👋 Welcome to JR PHEEF!

One account. Two sides.

🔎 BUY
📣 SELL

You can do both at the same time.

Tell me naturally what you're looking for or what you're selling.

English, Sheng or a mix is okay.

Example:

"Natafuta Toyota Axio around 850k Nairobi."

Or:

"Nauza Toyota Prado 2020, 6.5M Nairobi."`;
}

/* =========================
   DASHBOARD
========================= */

async function dashboard(phone) {
  const { data: listings } = await supabase
    .from("listings")
    .select("id")
    .eq("phone", phone)
    .eq("status", "ACTIVE");

  const { data: rooms } = await supabase
    .from("deal_rooms")
    .select("id,status,buyer_paid,seller_paid")
    .or(`buyer_phone.eq.${phone},seller_phone.eq.${phone}`)
    .in("status", [
      "negotiating",
      "agreed",
      "paid"
    ]);

  const activeListings = listings?.length || 0;
  const activeRooms = rooms?.length || 0;

  const pendingPayments =
    rooms?.filter(
      r => !r.buyer_paid || !r.seller_paid
    ).length || 0;

  return `👤 MY JR PHEEF

🔎 BUYING
Active matches: ${activeRooms}

📣 SELLING
Active listings: ${activeListings}

🔐 DEAL ROOMS
Active: ${activeRooms}

💳 PAYMENTS
Pending: ${pendingPayments}

🎁 REWARDS
Available through your JR PHEEF activity.

🎟️ COUPONS
Check your available offers.

🤝 REFERRALS
Your referral activity is tracked here.

You are both a BUYER and a SELLER.`;
}

/* =========================
   CREATE DEAL ROOM
========================= */

async function createDealRoom(listing, buyer) {
  if (!listing) return null;

  if (cleanPhone(listing.phone) === cleanPhone(buyer)) {
    return null;
  }

  const { data: existing } = await supabase
    .from("deal_rooms")
    .select("*")
    .eq("listing_id", listing.id)
    .eq("buyer_phone", buyer)
    .in("status", [
      "negotiating",
      "agreed",
      "paid"
    ])
    .order("created_at", {
      ascending: false
    })
    .limit(1);

  if (existing?.length) {
    return existing[0];
  }

  const { data, error } = await supabase
    .from("deal_rooms")
    .insert([
      {
        listing_id: listing.id,
        buyer_phone: buyer,
        seller_phone: listing.phone,

        status: "negotiating",

        buyer_paid: false,
        seller_paid: false,

        buyer_agreed: false,
        seller_agreed: false
      }
    ])
    .select()
    .single();

  if (error) {
    console.error(
      "DEAL ROOM ERROR:",
      error
    );

    return null;
  }

  return data;
}

/* =========================
   FIND LISTINGS
========================= */

async function findListings(
  item,
  location,
  budget
) {
  let query = supabase
    .from("listings")
    .select("*")
    .eq("status", "ACTIVE");

  if (item) {
    query = query.ilike(
      "item_name",
      `%${item}%`
    );
  }

  if (location) {
    query = query.ilike(
      "location",
      `%${location}%`
    );
  }

  if (budget) {
    query = query.lte(
      "price",
      budget
    );
  }

  const { data, error } =
    await query.order(
      "created_at",
      { ascending: false }
    );

  if (error) {
    console.error(
      "SEARCH ERROR:",
      error
    );

    return [];
  }

  return data || [];
}

/* =========================
   NATURAL LANGUAGE
========================= */

function extractBuyerRequest(text) {
  const patterns = [
    /(?:looking for)\s+(.+)/i,
    /(?:i need)\s+(.+)/i,
    /(?:find me)\s+(.+)/i,
    /(?:natafuta)\s+(.+)/i,
    /(?:natafut)\s+(.+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

function isSellerMessage(text) {
  return /selling|i have|nauza|niko na|available|i'm selling|ninauza/i
    .test(text);
}

/* =========================
   LISTING
========================= */

async function createListing(
  text,
  phone
) {
  const lines = text
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);

  const item = lines[1] || "";

  const price =
    parseInt(
      (lines[2] || "")
        .replace(/[^0-9]/g, ""),
      10
    ) || null;

  const location = lines[3] || "";

  if (!item || !price || !location) {
    return `📣 Let's list your opportunity.

Send:

OPPORTUNITY
Item
Price
Location

Example:

OPPORTUNITY
Toyota Axio 2015
850000
Nairobi

Then send your photos together.`;
  }

  const { error } =
    await supabase
      .from("listings")
      .insert([
        {
          seller_name: phone,
          phone,
          item_name: item,
          price,
          location,
          status: "ACTIVE",
          photos: []
        }
      ]);

  if (error) {
    console.error(
      "LISTING ERROR:",
      error
    );

    return "❌ I couldn't create the listing. Please try again.";
  }

  return `✅ Listed successfully!

${item}

💰 KSh ${money(price)}
📍 ${location}

📸 Send your product photos together.

FREE+ → up to 5
PRO → up to 10
PRIME → up to 20

I'll start looking for buyers. 🤝`;
}

/* =========================
   MATCH
========================= */

async function createMatch(
  listing,
  buyer
) {
  if (
    cleanPhone(listing.phone) ===
    cleanPhone(buyer)
  ) {
    return null;
  }

  const room =
    await createDealRoom(
      listing,
      buyer
    );

  if (!room) return null;

  /* SELLER */
  try {
    await sendWhatsApp(
      listing.phone,
      `🎉 JR PHEEF FOUND A MATCH!

Someone is interested in:

${listing.item_name}
💰 KSh ${money(listing.price)}
📍 ${listing.location}

🔐 Your Deal Room is ready.

Reply CHAT to open it.

Your phone number stays protected.`
    );
  } catch (error) {
    console.error(
      "SELLER NOTIFICATION:",
      error
    );
  }

  return room;
}

/* =========================
   PAYMENT STAGE
========================= */

async function paymentStage(
  room,
  phone
) {
  const buyer =
    cleanPhone(room.buyer_phone);

  const seller =
    cleanPhone(room.seller_phone);

  const isBuyer =
    cleanPhone(phone) === buyer;

  const paid =
    isBuyer
      ? room.buyer_paid
      : room.seller_paid;

  if (paid) {
    return `✅ Your KSh ${CONNECTION_FEE} connection payment is already recorded.

Waiting for the other party.`;
  }

  return `🔐 DEAL CONNECTION READY

Your connection fee:

💰 KSh ${CONNECTION_FEE}

Both buyer and seller pay separately.

When both payments are confirmed, JR PHEEF will unlock the connection.

💳 PAYMENT BUTTON WILL BE CONNECTED TO M-PESA

For this test version, no real payment is taken.

Till configured:
${TILL}`;
}

/* =========================
   WEBHOOK
========================= */

app.post(
  "/api/webhook/whatsapp",
  async (req, res) => {
    try {
      const text =
        (req.body.Body || "").trim();

      const user =
        cleanPhone(req.body.From);

      const upper =
        text.toUpperCase();

      const mediaCount =
        parseInt(
          req.body.NumMedia || "0",
          10
        );

      console.log(
        "📩 JR PHEEF:",
        user,
        text,
        "MEDIA:",
        mediaCount
      );

      /* WELCOME */

      if (
        !text ||
        /^(HI|HELLO|HEY|START|MENU)$/i.test(
          text
        )
      ) {
        return res
          .type("text/xml")
          .send(
            xml(welcome())
          );
      }

      /* DASHBOARD */

      if (
        upper === "DASHBOARD" ||
        upper === "MY JR PHEEF" ||
        upper === "ACCOUNT"
      ) {
        return res
          .type("text/xml")
          .send(
            xml(
              await dashboard(user)
            )
          );
      }

      /* PHOTOS */

      if (mediaCount > 0) {
        const { data } =
          await supabase
            .from("listings")
            .select("*")
            .eq("phone", user)
            .eq("status", "ACTIVE")
            .order(
              "created_at",
              { ascending: false }
            )
            .limit(1);

        const listing =
          data?.[0];

        if (!listing) {
          return res
            .type("text/xml")
            .send(
              xml(
                `📸 I received your photos.

Tell me what you're selling first so I can create the listing.`
              )
            );
        }

        /*
          TEST VERSION:
          Default FREE+ limit = 5.

          Membership integration can later
          read the user's actual plan from
          the database.
        */

        const limit =
          photoLimit("FREE");

        const photos =
          Array.isArray(
            listing.photos
          )
            ? listing.photos
            : [];

        const remaining =
          Math.max(
            0,
            limit - photos.length
          );

        for (
          let i = 0;
          i <
          Math.min(
            mediaCount,
            remaining
          );
          i++
        ) {
          const url =
            req.body[
              `MediaUrl${i}`
            ];

          if (url) {
            photos.push(url);
          }
        }

        await supabase
          .from("listings")
          .update({
            photos
          })
          .eq(
            "id",
            listing.id
          );

        return res
          .type("text/xml")
          .send(
            xml(
              `📸 Photos received!

Saved: ${photos.length}/${limit}

Your listing is ready for buyers. 🤝`
            )
          );
      }

      /* CHAT */

      if (upper === "CHAT") {
        const { data: rooms } =
          await supabase
            .from("deal_rooms")
            .select(
              "*, listings(item_name,price,location,photos)"
            )
            .or(
              `buyer_phone.eq.${user},seller_phone.eq.${user}`
            )
            .in(
              "status",
              [
                "negotiating",
                "agreed",
                "paid"
              ]
            )
            .order(
              "created_at",
              {
                ascending: false
              }
            )
            .limit(1);

        const room =
          rooms?.[0];

        if (!room) {
          return res
            .type("text/xml")
            .send(
              xml(
                "🔐 You don't have an active Deal Room yet."
              )
            );
        }

        const listing =
          room.listings || {};

        return res
          .type("text/xml")
          .send(
            xml(
              `🔐 DEAL ROOM

${listing.item_name || "Item"}
💰 KSh ${money(
                listing.price
              )}
📍 ${
                listing.location || ""
              }

💬 You're connected.

Talk normally.

No AGREE.
No DONE.
No PAID.

Just chat.`
            )
          );
      }

      /* DEALS */

      if (upper === "DEALS") {
        const rooms =
          await supabase
            .from("deal_rooms")
            .select(
              "*, listings(item_name,price,location)"
            )
            .or(
              `buyer_phone.eq.${user},seller_phone.eq.${user}`
            )
            .in(
              "status",
              [
                "negotiating",
                "agreed",
                "paid"
              ]
            )
            .order(
              "created_at",
              {
                ascending: false
              }
            );

        if (
          !rooms.data?.length
        ) {
          return res
            .type("text/xml")
            .send(
              xml(
                "📂 You don't have active Deal Rooms yet."
              )
            );
        }

        const output =
          rooms.data
            .map(
              (r, i) => {
                const l =
                  r.listings || {};

                return `${i + 1}. ${
                  l.item_name ||
                  "Item"
                }
💰 KSh ${money(
                  l.price
                )}
📍 ${
                  l.location || ""
                }`;
              }
            )
            .join("\n\n");

        return res
          .type("text/xml")
          .send(
            xml(
              `📂 YOUR DEAL ROOMS

${output}

Reply CHAT to open your latest room.`
            )
          );
      }

      /* OPPORTUNITY */

      if (
        upper.startsWith(
          "OPPORTUNITY"
        )
      ) {
        return res
          .type("text/xml")
          .send(
            xml(
              await createListing(
                text,
                user
              )
            )
          );
      }

      /* SELLER NATURAL LANGUAGE */

      if (
        isSellerMessage(text)
      ) {
        return res
          .type("text/xml")
          .send(
            xml(
              `📣 I can help you list that.

Send:

OPPORTUNITY
Item
Price
Location

Then select your photos together.

I'll match your product with buyers. 🤝`
            )
          );
      }

      /* BUYER NATURAL LANGUAGE */

      const request =
        extractBuyerRequest(
          text
        );

      if (request) {
        const matches =
          await findListings(
            request,
            "",
            null
          );

        const listing =
          matches.find(
            x =>
              cleanPhone(
                x.phone
              ) !== user
          );

        if (!listing) {
          return res
            .type("text/xml")
            .send(
              xml(
                `🔎 I haven't found a match yet.

I'll keep looking for ${request}.`
              )
            );
        }

        const room =
          await createMatch(
            listing,
            user
          );

        if (!room) {
          return res
            .type("text/xml")
            .send(
              xml(
                "❌ I couldn't create the Deal Room. Please try again."
              )
            );
        }

        const photos =
          Array.isArray(
            listing.photos
          )
            ? listing.photos
            : [];

        /*
          Send seller photos.
        */

        for (
          const photo of
          photos.slice(0, 5)
        ) {
          try {
            await twilioClient.messages.create(
              {
                from:
                  TWILIO_FROM,
                to:
                  `whatsapp:${user}`,
                body:
                  "📸 Product photo",
                mediaUrl: [
                  photo
                ]
              }
            );
          } catch (
            error
          ) {
            console.error(
              "PHOTO SEND:",
              error
            );
          }
        }

        return res
          .type("text/xml")
          .send(
            xml(
              `🎉 JR PHEEF FOUND A MATCH!

${listing.item_name}
💰 KSh ${money(
                listing.price
              )}
📍 ${
                listing.location
              }

🔐 Deal Room created.

Reply CHAT.

You can now talk normally with the seller.`
            )
          );
      }

      /* NATURAL DEAL AGREEMENT */

      if (
        /^(YES|YES PLEASE|I'M INTERESTED|IM INTERESTED|I AM INTERESTED|SOUNDS GOOD|SAWA|NIKO SAWA|TUMEELEWANA|TUMEKUBALI|LET'S DO IT|LETS DO IT|OKAY|OK)$/i.test(
          text
        )
      ) {
        const { data: rooms } =
          await supabase
            .from("deal_rooms")
            .select("*")
            .or(
              `buyer_phone.eq.${user},seller_phone.eq.${user}`
            )
            .in(
              "status",
              [
                "negotiating",
                "agreed"
              ]
            )
            .order(
              "created_at",
              {
                ascending: false
              }
            )
            .limit(1);

        const room =
          rooms?.[0];

        if (room) {
          const field =
            cleanPhone(
              room.buyer_phone
            ) === user
              ? "buyer_agreed"
              : "seller_agreed";

          const { data } =
            await supabase
              .from("deal_rooms")
              .update({
                [field]: true
              })
              .eq(
                "id",
                room.id
              )
              .select()
              .single();

          if (
            data?.buyer_agreed &&
            data?.seller_agreed
          ) {
            await supabase
              .from("deal_rooms")
              .update({
                status:
                  "agreed"
              })
              .eq(
                "id",
                room.id
              );

            return res
              .type("text/xml")
              .send(
                xml(
                  `🎉 BOTH SIDES ARE READY!

🔐 DEAL ROOM PAYMENT

Buyer: KSh ${CONNECTION_FEE}
Seller: KSh ${CONNECTION_FEE}

Each person will pay separately.

💳 PAY KSh ${CONNECTION_FEE}

M-Pesa will be connected after this test.

For now, no real payment is taken.

Once both payments are confirmed:

🔓 DEAL ROOM UNLOCKED`
                )
              );
          }

          return res
            .type("text/xml")
            .send(
              xml(
                `👍 Got it.

I've recorded that you're ready.

Waiting for the other party.`
              )
            );
        }
      }

      /* NORMAL DEAL ROOM CHAT */

      const { data: rooms } =
        await supabase
          .from("deal_rooms")
          .select("*")
          .or(
            `buyer_phone.eq.${user},seller_phone.eq.${user}`
          )
          .in(
            "status",
            [
              "negotiating",
              "agreed",
              "paid"
            ]
          )
          .order(
            "created_at",
            {
              ascending: false
            }
          )
          .limit(1);

      const room =
        rooms?.[0];

      if (room) {
        const other =
          cleanPhone(
            room.buyer_phone
          ) === user
            ? room.seller_phone
            : room.buyer_phone;

        await supabase
          .from("messages")
          .insert([
            {
              room_id:
                room.id,
              sender_phone:
                user,
              message:
                text
            }
          ]);

        try {
          await sendWhatsApp(
            other,
            `💬 Deal Room

${text}`
          );
        } catch (
          error
        ) {
          console.error(
            "CHAT SEND:",
            error
          );
        }

        return res
          .type("text/xml")
          .send(
            xml(
              "☑️ Message sent through your Deal Room."
            )
          );
      }

      /* DEFAULT */

      return res
        .type("text/xml")
        .send(
          xml(welcome())
        );

    } catch (error) {
      console.error(
        "🔥 WEBHOOK ERROR:",
        error
      );

      return res
        .type("text/xml")
        .send(
          xml(
            "❌ JR PHEEF encountered a problem. Please try again."
          )
        );
    }
  }
);

/* =========================
   HEALTH CHECK
========================= */

app.get(
  "/",
  (req, res) => {
    res.json({
      service:
        "JR PHEEF Marketplace",
      status: "LIVE",
      version:
        "TEST-PRE-MPESA",
      payment:
        "M-Pesa API not connected",
      connectionFee:
        CONNECTION_FEE,
      till:
        TILL
    });
  }
);

/* =========================
   START
========================= */

app.listen(
  PORT,
  () => {
    console.log(
      "🚀 JR PHEEF running on port",
      PORT
    );

    console.log(
      "🔐 Deal Rooms: ACTIVE"
    );

    console.log(
      "💬 Natural CHAT: ACTIVE"
    );

    console.log(
      "🌍 English + Sheng: ACTIVE"
    );

    console.log(
      "📸 Photos: ACTIVE"
    );

    console.log(
      "👤 Unified Buyer/Seller account: ACTIVE"
    );

    console.log(
      "🎁 Rewards framework: ACTIVE"
    );

    console.log(
      "🎟️ Coupons framework: ACTIVE"
    );

    console.log(
      "🤝 Referrals framework: ACTIVE"
    );

    console.log(
      "💳 M-Pesa: NOT CONNECTED YET"
    );
  }
);"
    );
    console.error(error);

    return null;
  }
}

// =====================================================
// GET DEAL ROOM
// =====================================================

async function getDealRoom(roomId) {
  try {
    if (!roomId) {
      return null;
    }

    const { data, error } = await supabase
      .from("deal_rooms")
      .select("*")
      .eq("id", roomId)
      .single();

    if (error) {
      console.error(
        "❌ GET DEAL ROOM ERROR:"
      );
      console.error(error);

      return null;
    }

    return data;
  } catch (error) {
    console.error(
      "❌ getDealRoom ERROR:"
    );
    console.error(error);

    return null;
  }
}

// =====================================================
// SAVE MESSAGE
// =====================================================

async function saveMessage(
  roomId,
  senderPhone,
  message
) {
  try {
    const { error } = await supabase
      .from("messages")
      .insert([
        {
          room_id: roomId,
          sender_phone: normalizePhone(senderPhone),
          message: message
        }
      ]);

    if (error) {
      console.error(
        "❌ SAVE MESSAGE ERROR:"
      );
      console.error(error);

      return false;
    }

    return true;
  } catch (error) {
    console.error(
      "❌ saveMessage ERROR:"
    );
    console.error(error);

    return false;
  }
}

// =====================================================
// UPDATE AGREEMENT
// =====================================================

async function updateAgreement(
  roomId,
  phone
) {
  try {
    const room = await getDealRoom(roomId);

    if (!room) {
      return null;
    }

    const userPhone = normalizePhone(phone);

    const updates = {};

    if (
      userPhone ===
      normalizePhone(room.buyer_phone)
    ) {
      updates.buyer_agreed = true;
    } else if (
      userPhone ===
      normalizePhone(room.seller_phone)
    ) {
      updates.seller_agreed = true;
    } else {
      console.error(
        "❌ Unauthorized AGREE attempt:",
        userPhone
      );

      return null;
    }

    const { data, error } = await supabase
      .from("deal_rooms")
      .update(updates)
      .eq("id", roomId)
      .select()
      .single();

    if (error) {
      console.error(
        "❌ UPDATE AGREEMENT ERROR:"
      );
      console.error(error);

      return null;
    }

    // -------------------------------------------------
    // BOTH AGREED
    // -------------------------------------------------

    if (
      data.buyer_agreed &&
      data.seller_agreed
    ) {
      await supabase
        .from("deal_rooms")
        .update({
          status: "awaiting_payment"
        })
        .eq("id", roomId);

      data.status = "awaiting_payment";
    }

    return data;
  } catch (error) {
    console.error(
      "❌ updateAgreement ERROR:"
    );
    console.error(error);

    return null;
  }
}

// =====================================================
// UPDATE PAYMENT
// =====================================================

async function updatePayment(
  roomId,
  phone
) {
  try {
    const room = await getDealRoom(roomId);

    if (!room) {
      return null;
    }

    const userPhone = normalizePhone(phone);

    const updates = {};

    if (
      userPhone ===
      normalizePhone(room.buyer_phone)
    ) {
      updates.buyer_paid = true;
    } else if (
      userPhone ===
      normalizePhone(room.seller_phone)
    ) {
      updates.seller_paid = true;
    } else {
      console.error(
        "❌ Unauthorized PAID attempt:",
        userPhone
      );

      return null;
    }

    const { data, error } = await supabase
      .from("deal_rooms")
      .update(updates)
      .eq("id", roomId)
      .select()
      .single();

    if (error) {
      console.error(
        "❌ UPDATE PAYMENT ERROR:"
      );
      console.error(error);

      return null;
    }

    // -------------------------------------------------
    // BOTH PAID
    // -------------------------------------------------

    if (
      data.buyer_paid &&
      data.seller_paid
    ) {
      await supabase
        .from("deal_rooms")
        .update({
          status: "completed"
        })
        .eq("id", roomId);

      data.status = "completed";
    }

    return data;
  } catch (error) {
    console.error(
      "❌ updatePayment ERROR:"
    );
    console.error(error);

    return null;
  }
}

// =====================================================
// HOME
// =====================================================

app.get("/", (req, res) => {
  res.send(
    "🚀 JR PHEEF Marketplace is LIVE"
  );
});

// =====================================================
// WHATSAPP WEBHOOK
// =====================================================

app.post(
  "/api/webhook/whatsapp",
  async (req, res) => {
    console.log("");
    console.log("========================================");
    console.log("📩 WHATSAPP WEBHOOK RECEIVED");
    console.log("========================================");

    const message =
      (req.body.Body || "").trim();

    const phone =
      normalizePhone(req.body.From);

    console.log("From:", phone);
    console.log("Message:", message);

    // =================================================
    // CHAT
    // =================================================

    if (
      message
        .toUpperCase()
        .startsWith("CHAT ")
    ) {
      const lines =
        message.split("\n");

      let roomId =
        lines[0]
          .replace(/^CHAT\s+/i, "")
          .trim();

      const chatMessage =
        lines
          .slice(1)
          .join("\n")
          .trim();

      // ------------------------------------------------
      // NEW EASY CHAT FORMAT
      //
      // CHAT
      // Hello, is the car available?
      //
      // ------------------------------------------------

      if (!roomId) {
        const activeRoom =
          await getActiveRoomForUser(phone);

        if (!activeRoom) {
          return res.send(
            "❌ You do not have an active Deal Room."
          );
        }

        roomId = activeRoom.id;
      }

      // ------------------------------------------------
      // IF USER SENDS:
      //
      // CHAT Hello, is the car available?
      //
      // The first word after CHAT is NOT a UUID.
      // ------------------------------------------------

      if (
        roomId &&
        !/^[0-9a-f-]{36}$/i.test(roomId)
      ) {
        const activeRoom =
          await getActiveRoomForUser(phone);

        if (!activeRoom) {
          return res.send(
            "❌ You do not have an active Deal Room."
          );
        }

        chatMessage =
          message
            .replace(/^CHAT\s+/i, "")
            .trim();

        roomId =
          activeRoom.id;
      }

      // ------------------------------------------------
      // OLD UUID FORMAT STILL WORKS
      // ------------------------------------------------

      if (!chatMessage) {
        return res.send(
          `💬 Please type your message after CHAT.

Example:

CHAT Yes, the car is still available.`
        );
      }

      const room =
        await getDealRoom(roomId);

      if (!room) {
        return res.send(
          "❌ Deal Room not found."
        );
      }

      const userPhone =
        normalizePhone(phone);

      // ------------------------------------------------
      // SECURITY CHECK
      // ------------------------------------------------

      if (
        userPhone !==
          normalizePhone(room.buyer_phone) &&
        userPhone !==
          normalizePhone(room.seller_phone)
      ) {
        return res.send(
          "❌ You are not a participant in this Deal Room."
        );
      }

      await saveMessage(
        roomId,
        userPhone,
        chatMessage
      );

      const recipient =
        userPhone ===
        normalizePhone(room.buyer_phone)
          ? normalizePhone(room.seller_phone)
          : normalizePhone(room.buyer_phone);

      console.log("💬 CHAT ROUTING");
      console.log("Sender:", userPhone);
      console.log("Buyer:", room.buyer_phone);
      console.log("Seller:", room.seller_phone);
      console.log("Recipient:", recipient);

      // ------------------------------------------------
      // SEND TO OTHER PARTY
      // ------------------------------------------------

      await sendWhatsApp(
        recipient,
        `💬 JR PHEEF DEAL ROOM

${chatMessage}

Reply:

CHAT your message

You do not need to copy a Deal Room ID.`
      );

      return res.send(
        `☑ Message sent through the Deal Room.

🔒 Your phone number remains protected.`
      );
    }

    // =================================================
    // AGREE
    // =================================================

    if (
      message
        .toUpperCase()
        .startsWith("AGREE")
    ) {
      let roomId =
        message
          .replace(/^AGREE\s*/i, "")
          .trim();

      // ------------------------------------------------
      // NO UUID?
      // AUTOMATICALLY FIND ACTIVE ROOM
      // ------------------------------------------------

      if (
        !roomId ||
        !/^[0-9a-f-]{36}$/i.test(roomId)
      ) {
        const activeRoom =
          await getActiveRoomForUser(phone);

        if (!activeRoom) {
          return res.send(
            "❌ You do not have an active Deal Room."
          );
        }

        roomId =
          activeRoom.id;
      }

      const room =
        await updateAgreement(
          roomId,
          phone
        );

      if (!room) {
        return res.send(
          "❌ Deal Room not found or you are not a participant."
        );
      }

      // ------------------------------------------------
      // BOTH AGREED
      // ------------------------------------------------

      if (
        room.buyer_agreed &&
        room.seller_agreed
      ) {
        // Notify buyer
        await sendWhatsApp(
          room.buyer_phone,
          `🎉 BOTH PARTIES AGREED!

The buyer and seller have agreed on the deal.

💰 Connection fee:

KSh 30 from buyer
KSh 30 from seller

After making your payment, reply:

PAID

You do not need to enter a Deal Room ID.`
        );

        // Notify seller
        await sendWhatsApp(
          room.seller_phone,
          `🎉 BOTH PARTIES AGREED!

The buyer and seller have agreed on the deal.

💰 Connection fee:

KSh 30 from buyer
KSh 30 from seller

After making your payment, reply:

PAID

You do not need to enter a Deal Room ID.`
        );

        return res.send(
          `🎉 BOTH PARTIES AGREED!

The buyer and seller have agreed on the deal.

💰 Connection fee:

KSh 30 buyer
KSh 30 seller

Reply:

PAID

after making your payment.`
        );
      }

      return res.send(
        `✅ Your agreement has been recorded.

Waiting for the other party to agree.

You do not need to enter a Deal Room ID.`
      );
    }

    // =================================================
    // PAID
    // =================================================

    if (
      message
        .toUpperCase()
        .startsWith("PAID")
    ) {
      let roomId =
        message
          .replace(/^PAID\s*/i, "")
          .trim();

      // ------------------------------------------------
      // AUTOMATIC ROOM LOOKUP
      // ------------------------------------------------

      if (
        !roomId ||
        !/^[0-9a-f-]{36}$/i.test(roomId)
      ) {
        const activeRoom =
          await getActiveRoomForUser(phone);

        if (!activeRoom) {
          return res.send(
            "❌ You do not have an active Deal Room."
          );
        }

        roomId =
          activeRoom.id;
      }

      const room =
        await updatePayment(
          roomId,
          phone
        );

      if (!room) {
        return res.send(
          "❌ Deal Room not found or you are not a participant."
        );
      }

      // ------------------------------------------------
      // BOTH PAID
      // ------------------------------------------------

      if (
        room.buyer_paid &&
        room.seller_paid
      ) {
        // Now contacts are unlocked.
        // ------------------------------------------------

        await sendWhatsApp(
          room.buyer_phone,
          `🎉 CONNECTION UNLOCKED!

Seller contact:

${room.seller_phone}

You may now continue your transaction directly.

⚠️ Please trade safely and verify the item/payment before completing the transaction.

Thank you for using JR PHEEF Marketplace.`
        );

        await sendWhatsApp(
          room.seller_phone,
          `🎉 CONNECTION UNLOCKED!

Buyer contact:

${room.buyer_phone}

You may now continue your transaction directly.

⚠️ Please trade safely and verify the item/payment before completing the transaction.

Thank you for using JR PHEEF Marketplace.`
        );

        return res.send(
          `🎉 PAYMENT CONFIRMED!

Both parties have paid the KSh 30 connection fee.

🔓 The connection has now been unlocked.

JR PHEEF has notified both parties.`
        );
      }

      return res.send(
        `✅ Your payment has been recorded.

Waiting for the other party to pay.

Once both parties have paid, JR PHEEF will unlock the connection automatically.`
      );
    }

    // =================================================
    // ROOMS
    // =================================================

    if (
      message
        .toUpperCase()
        .startsWith("ROOM")
    ) {
      const room =
        await getActiveRoomForUser(phone);

      if (!room) {
        return res.send(
          `📭 You currently have no active Deal Rooms.`
        );
      }

      return res.send(
        `📦 YOUR ACTIVE DEAL ROOM

Item room:
${room.id}

You do NOT need to copy this ID.

Simply type:

CHAT Your message

or:

AGREE

or:

PAID`
      );
    }

    // =================================================
    // FIND
    // =================================================

    if (
      message
        .toUpperCase()
        .startsWith("FIND")
    ) {
      const lines =
        message.split("\n");

      const item =
        (lines[1] || "").trim();

      const location =
        (lines[2] || "").trim();

      const budget =
        parseInt(
          (lines[3] || "")
            .replace(/[^0-9]/g, ""),
          10
        ) || null;

      if (!item) {
        return res.send(
          `🔎 Please provide what you are looking for.

Example:

FIND
Toyota Axio
Nairobi
900000`
        );
      }

      const results =
        await findListings(
          item,
          location,
          budget,
          phone
        );

      // ------------------------------------------------
      // NO RESULTS
      // ------------------------------------------------

      if (
        !results ||
        results.length === 0
      ) {
        return res.send(
          `😔 No matching items found.

We will notify you when another seller lists one.

🔒 Your search has been recorded by JR PHEEF.`
        );
      }

      // ------------------------------------------------
      // FIND FIRST VALID DIFFERENT SELLER
      // ------------------------------------------------

      const buyerPhone =
        normalizePhone(phone);

      let selectedListing = null;

      for (const listing of results) {
        const sellerPhone =
          normalizePhone(listing.phone);

        if (
          sellerPhone &&
          sellerPhone !== buyerPhone
        ) {
          selectedListing = listing;
          break;
        }
      }

      // ------------------------------------------------
      // SAFETY CHECK
      // ------------------------------------------------

      if (!selectedListing) {
        console.error(
          "❌ All matching listings belong to buyer."
        );

        return res.send(
          `😔 We found listings matching your search, but they belong to your own account.

Please try another search.`
        );
      }

      const first =
        selectedListing;

      console.log("========================================");
      console.log("🎯 MATCH SELECTED");
      console.log("Buyer:", buyerPhone);
      console.log("Seller:", first.phone);
      console.log("Item:", first.item_name);
      console.log("Price:", first.price);
      console.log("Location:", first.location);
      console.log("========================================");

      // ------------------------------------------------
      // CREATE ROOM
      // ------------------------------------------------

      const room =
        await createDealRoom(
          first,
          buyerPhone
        );

      if (!room) {
        return res.send(
          `❌ We found a seller, but could not create the Deal Room.

Please try again.`
        );
      }

      // ------------------------------------------------
      // VERIFY SELLER IS DIFFERENT
      // ------------------------------------------------

      const sellerPhone =
        normalizePhone(first.phone);

      if (
        sellerPhone === buyerPhone
      ) {
        console.error(
          "🚨 CRITICAL: seller equals buyer."
        );

        return res.send(
          `❌ Match blocked for security.

The seller and buyer cannot be the same account.`
        );
      }

      // ------------------------------------------------
      // SEND SELLER NOTIFICATION
      // ------------------------------------------------

      console.log("========================================");
      console.log("📣 SELLER NOTIFICATION");
      console.log("Buyer:", buyerPhone);
      console.log("Seller:", sellerPhone);
      console.log("Room:", room.id);
      console.log("========================================");

      const sellerNotified =
        await sendWhatsApp(
          sellerPhone,
          `🎉 JR PHEEF MATCH FOUND!

A buyer is interested in your listing.

Item:
${first.item_name}

Price:
KSh ${first.price}

Location:
${first.location}

🔐 SECURE DEAL ROOM CREATED

You do NOT need to copy a long Deal Room ID.

Simply reply:

CHAT Is the item still available?

To agree:

AGREE

Your phone number remains protected.

💰 Connection fee after both parties agree:

KSh 30 buyer
KSh 30 seller

JR PHEEF keeps the connection secure.`
        );

      // ------------------------------------------------
      // BUYER RESPONSE
      // ------------------------------------------------

      let reply = `
🎉 JR PHEEF MATCH FOUND!

A buyer is interested in:

Item:
${first.item_name}

Price:
KSh ${first.price}

Location:
${first.location}

🔐 SECURE DEAL ROOM CREATED

The seller has been notified.

You do NOT need to copy the long Deal Room ID.

Simply reply:

CHAT Is the item still available?

To agree:

AGREE

Your phone number remains protected.

💰 Connection fee after both parties agree:

KSh 30 buyer
KSh 30 seller

JR PHEEF keeps the connection secure.
`;

      if (!sellerNotified) {
        reply += `

⚠️ We created the Deal Room, but the seller notification could not be delivered.

JR PHEEF is checking the seller connection.`;
      }

      return res.send(
        `<Response>
<Message>${escapeXml(
          reply
        )}</Message>
</Response>`
      );
    }

    // =================================================
    // OPPORTUNITY
    // =================================================

    if (
      message
        .toUpperCase()
        .startsWith("OPPORTUNITY")
    ) {
      const saved =
        await saveListing(
          message,
          phone
        );

      let reply;

      if (saved) {
        reply = `
✅ Your opportunity has been submitted!

JR PHEEF is now matching you with people looking for this opportunity.

Thank you for using JR PHEEF Marketplace.`;
      } else {
        reply = `
❌ Sorry.

We could not save your listing.

Please try again using:

OPPORTUNITY
Item
Price
Location`;
      }

      return res.send(
        `<Response>
<Message>${escapeXml(
          reply
        )}</Message>
</Response>`
      );
    }

    // =================================================
    // DEFAULT
    // =================================================

    const reply = `
👋 Welcome to JR PHEEF Marketplace.

We help people FIND and CREATE opportunities.

Reply with:

FIND
OPPORTUNITY
ROOM
CHAT
AGREE
PAID

💡 You no longer need to copy long Deal Room IDs.

Example:

CHAT The car is still available.

AGREE

PAID
`;

    res.set(
      "Content-Type",
      "text/xml"
    );

    res.send(
      `<Response>
<Message>${escapeXml(
        reply
      )}</Message>
</Response>`
    );
  }
);

// =====================================================
// START SERVER
// =====================================================

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `🚀 JR PHEEF running on port ${PORT}`
  );

  console.log(
    `🌐 Port: ${PORT}`
  );

  console.log(
    "🔐 Deal Room system: ACTIVE"
  );

  console.log(
    "💬 Automatic CHAT room lookup: ACTIVE"
  );

  console.log(
    "🤝 Automatic AGREE room lookup: ACTIVE"
  );

  console.log(
    "💰 Automatic PAID room lookup: ACTIVE"
  );

  console.log(
    "🛡️ Buyer cannot match own listing: ACTIVE"
  );

  console.log(
    "📣 Seller notification verification: ACTIVE"
  );
});
