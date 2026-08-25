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
);
