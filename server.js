const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");

const { MessagingResponse } = twilio.twiml;

// ======================================================
// JR PHEEF MARKETPLACE
// Full server.js
// ======================================================

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ======================================================
// TWILIO
// ======================================================

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ======================================================
// SUPABASE
// ======================================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// ======================================================
// SETTINGS
// ======================================================

const CONNECTION_FEE = 30;

// Deal Rooms with these statuses are considered active.
const ACTIVE_ROOM_STATUSES = [
  "negotiating",
  "agreed"
];

// ======================================================
// HELPERS
// ======================================================

function cleanPhone(value) {
  return String(value || "")
    .replace(/^whatsapp:/i, "")
    .trim();
}

function escapeText(value) {
  return String(value || "").trim();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function formatMoney(amount) {
  if (amount === null || amount === undefined) {
    return "Not specified";
  }

  return Number(amount).toLocaleString("en-KE");
}

// ======================================================
// SEND WHATSAPP MESSAGE
// ======================================================

async function sendWhatsApp(to, body) {
  try {
    const recipient = cleanPhone(to);

    if (!recipient) {
      console.error("❌ Cannot send WhatsApp message: empty recipient");
      return null;
    }

    console.log("📤 Sending WhatsApp message");
    console.log("To:", recipient);

    const message = await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: `whatsapp:${recipient}`,
      body
    });

    console.log("✅ WhatsApp message sent:", message.sid);

    return message;
  } catch (error) {
    console.error("❌ TWILIO SEND ERROR:", error);
    return null;
  }
}

// ======================================================
// SAVE LISTING
// ======================================================

async function saveListing(message, phone) {
  try {
    const lines = message
      .split("\n")
      .map(line => line.trim());

    const item = lines[1] || "";
    const priceText = lines[2] || "";
    const town = lines[3] || "";

    if (!item) {
      console.log("❌ Listing rejected: missing item");
      return false;
    }

    const price =
      parseInt(
        priceText.replace(/[^0-9]/g, ""),
        10
      ) || null;

    console.log("========== SAVE LISTING ==========");
    console.log("Seller:", phone);
    console.log("Item:", item);
    console.log("Price:", price);
    console.log("Location:", town);

    const { data, error } = await supabase
      .from("listings")
      .insert([
        {
          seller_name: phone,
          phone: phone,
          item_name: item,
          price: price,
          location: town,
          status: "ACTIVE"
        }
      ])
      .select()
      .single();

    if (error) {
      console.error("❌ SAVE LISTING ERROR:", error);
      return false;
    }

    console.log("✅ LISTING SAVED:", data);

    return true;

  } catch (error) {
    console.error("❌ SAVE LISTING EXCEPTION:", error);
    return false;
  }
}

// ======================================================
// FIND LISTINGS
// ======================================================

async function findListings(item, location, budget) {
  try {
    console.log("");
    console.log("========== FIND LISTINGS ==========");
    console.log("Item:", item);
    console.log("Location:", location);
    console.log("Budget:", budget);

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

    const {
      data,
      error
    } = await query;

    if (error) {
      console.error(
        "❌ FIND LISTINGS ERROR:",
        error
      );

      return [];
    }

    console.log(
      "✅ MATCHING LISTINGS:",
      data
    );

    return data || [];

  } catch (error) {
    console.error(
      "❌ FIND LISTINGS EXCEPTION:",
      error
    );

    return [];
  }
}

// ======================================================
// GET ACTIVE DEAL ROOMS FOR A USER
// ======================================================

async function getActiveDealRooms(phone) {
  try {
    const clean = cleanPhone(phone);

    console.log("");
    console.log("========== ACTIVE DEAL ROOMS ==========");
    console.log("Phone:", clean);

    // Get rooms where user is buyer
    const {
      data: buyerRooms,
      error: buyerError
    } = await supabase
      .from("deal_rooms")
      .select("*")
      .eq("buyer_phone", clean)
      .in("status", ACTIVE_ROOM_STATUSES)
      .order("created_at", {
        ascending: false
      });

    if (buyerError) {
      console.error(
        "❌ BUYER ROOM LOOKUP ERROR:",
        buyerError
      );
    }

    // Get rooms where user is seller
    const {
      data: sellerRooms,
      error: sellerError
    } = await supabase
      .from("deal_rooms")
      .select("*")
      .eq("seller_phone", clean)
      .in("status", ACTIVE_ROOM_STATUSES)
      .order("created_at", {
        ascending: false
      });

    if (sellerError) {
      console.error(
        "❌ SELLER ROOM LOOKUP ERROR:",
        sellerError
      );
    }

    const rooms = [
      ...(buyerRooms || []),
      ...(sellerRooms || [])
    ];

    // Remove duplicates
    const uniqueRooms = [];

    for (const room of rooms) {
      if (
        !uniqueRooms.some(
          existing =>
            existing.id === room.id
        )
      ) {
        uniqueRooms.push(room);
      }
    }

    // Sort newest first
    uniqueRooms.sort(
      (a, b) =>
        new Date(b.created_at || 0) -
        new Date(a.created_at || 0)
    );

    console.log(
      "Active rooms found:",
      uniqueRooms.length
    );

    return uniqueRooms;

  } catch (error) {
    console.error(
      "❌ ACTIVE ROOM EXCEPTION:",
      error
    );

    return [];
  }
}

// ======================================================
// GET ONE DEAL ROOM BY UUID
// ======================================================

async function getDealRoom(roomId) {
  try {
    const {
      data,
      error
    } = await supabase
      .from("deal_rooms")
      .select("*")
      .eq("id", roomId)
      .single();

    if (error) {
      console.error(
        "❌ GET DEAL ROOM ERROR:",
        error
      );

      return null;
    }

    return data;

  } catch (error) {
    console.error(
      "❌ GET DEAL ROOM EXCEPTION:",
      error
    );

    return null;
  }
}

// ======================================================
// VERIFY PARTICIPANT
// ======================================================

function isRoomParticipant(room, phone) {
  const clean = cleanPhone(phone);

  return (
    clean === cleanPhone(room.buyer_phone) ||
    clean === cleanPhone(room.seller_phone)
  );
}

// ======================================================
// CREATE DEAL ROOM
// ======================================================

async function createDealRoom(listing, buyerPhone) {
  try {
    const cleanBuyer = cleanPhone(buyerPhone);
    const sellerPhone = cleanPhone(listing.phone);

    console.log("");
    console.log("========== CREATE DEAL ROOM ==========");
    console.log("Listing:", listing.id);
    console.log("Buyer:", cleanBuyer);
    console.log("Seller:", sellerPhone);

    // --------------------------------------------------
    // DUPLICATE ROOM PROTECTION
    // --------------------------------------------------

    const {
      data: existingRooms,
      error: existingError
    } = await supabase
      .from("deal_rooms")
      .select("*")
      .eq("listing_id", listing.id)
      .eq("buyer_phone", cleanBuyer)
      .in("status", ACTIVE_ROOM_STATUSES)
      .order("created_at", {
        ascending: false
      });

    if (existingError) {
      console.error(
        "❌ DUPLICATE ROOM CHECK ERROR:",
        existingError
      );
    }

    if (
      existingRooms &&
      existingRooms.length > 0
    ) {
      console.log(
        "⚠️ Existing Deal Room found:",
        existingRooms[0].id
      );

      return existingRooms[0];
    }

    // --------------------------------------------------
    // CREATE NEW ROOM
    // --------------------------------------------------

    const {
      data,
      error
    } = await supabase
      .from("deal_rooms")
      .insert([
        {
          listing_id: listing.id,

          buyer_phone: cleanBuyer,

          seller_phone: sellerPhone,

          status: "negotiating",

          buyer_agreed: false,

          seller_agreed: false,

          buyer_paid: false,

          seller_paid: false
        }
      ])
      .select()
      .single();

    if (error) {
      console.error(
        "❌ CREATE DEAL ROOM ERROR:",
        error
      );

      return null;
    }

    console.log(
      "🎉 DEAL ROOM CREATED:",
      data.id
    );

    return data;

  } catch (error) {
    console.error(
      "❌ CREATE DEAL ROOM EXCEPTION:",
      error
    );

    return null;
  }
}

// ======================================================
// FIND ROOM FROM USER COMMAND
//
// Examples:
//
// CHAT hello
// CHAT 1 hello
// CHAT UUID hello
// AGREE
// AGREE 1
// AGREE UUID
// PAID
// PAID 1
// PAID UUID
// ======================================================

async function resolveRoom(
  phone,
  suppliedRoomId = null,
  roomNumber = null
) {
  const clean = cleanPhone(phone);

  // --------------------------------------------------
  // FULL UUID PROVIDED
  // --------------------------------------------------

  if (
    suppliedRoomId &&
    isUuid(suppliedRoomId)
  ) {
    const room =
      await getDealRoom(
        suppliedRoomId
      );

    if (!room) {
      return {
        room: null,
        error: "Deal Room not found."
      };
    }

    if (
      !isRoomParticipant(
        room,
        clean
      )
    ) {
      return {
        room: null,
        error:
          "🔒 You are not a participant in this Deal Room."
      };
    }

    return {
      room,
      error: null
    };
  }

  // --------------------------------------------------
  // ACTIVE ROOMS
  // --------------------------------------------------

  const rooms =
    await getActiveDealRooms(
      clean
    );

  if (rooms.length === 0) {
    return {
      room: null,
      error:
        "You do not have an active Deal Room."
    };
  }

  // --------------------------------------------------
  // ROOM NUMBER
  // --------------------------------------------------

  if (roomNumber !== null) {
    const index =
      Number(roomNumber) - 1;

    if (
      Number.isNaN(index) ||
      index < 0 ||
      index >= rooms.length
    ) {
      return {
        room: null,
        error:
          `❌ Deal Room ${roomNumber} was not found.\n\nReply ROOMS to see your active rooms.`
      };
    }

    return {
      room: rooms[index],
      error: null
    };
  }

  // --------------------------------------------------
  // ONLY ONE ROOM
  // --------------------------------------------------

  if (rooms.length === 1) {
    return {
      room: rooms[0],
      error: null
    };
  }

  // --------------------------------------------------
  // MULTIPLE ROOMS
  // --------------------------------------------------

  return {
    room: null,

    multiple: true,

    rooms,

    error:
      `You have ${rooms.length} active Deal Rooms.\n\nReply:\n\nROOMS\n\nto choose one.`
  };
}

// ======================================================
// SAVE MESSAGE
// ======================================================

async function saveMessage(
  roomId,
  senderPhone,
  message
) {
  try {
    const {
      error
    } = await supabase
      .from("messages")
      .insert([
        {
          room_id: roomId,
          sender_phone: cleanPhone(
            senderPhone
          ),
          message: message
        }
      ]);

    if (error) {
      console.error(
        "❌ SAVE MESSAGE ERROR:",
        error
      );

      return false;
    }

    return true;

  } catch (error) {
    console.error(
      "❌ SAVE MESSAGE EXCEPTION:",
      error
    );

    return false;
  }
}

// ======================================================
// UPDATE AGREEMENT
// ======================================================

async function updateAgreement(
  roomId,
  phone
) {
  try {
    const room =
      await getDealRoom(roomId);

    if (!room) {
      return null;
    }

    const clean =
      cleanPhone(phone);

    // Security
    if (
      !isRoomParticipant(
        room,
        clean
      )
    ) {
      console.log(
        "🔒 Unauthorized agreement attempt:",
        clean
      );

      return null;
    }

    const updates = {};

    if (
      clean ===
      cleanPhone(room.buyer_phone)
    ) {
      updates.buyer_agreed = true;
    }

    if (
      clean ===
      cleanPhone(room.seller_phone)
    ) {
      updates.seller_agreed = true;
    }

    // If both already agreed
    const buyerAgreed =
      updates.buyer_agreed === true ||
      room.buyer_agreed === true;

    const sellerAgreed =
      updates.seller_agreed === true ||
      room.seller_agreed === true;

    if (
      buyerAgreed &&
      sellerAgreed
    ) {
      updates.status = "agreed";
    }

    const {
      data,
      error
    } = await supabase
      .from("deal_rooms")
      .update(updates)
      .eq("id", roomId)
      .select()
      .single();

    if (error) {
      console.error(
        "❌ UPDATE AGREEMENT ERROR:",
        error
      );

      return null;
    }

    return data;

  } catch (error) {
    console.error(
      "❌ UPDATE AGREEMENT EXCEPTION:",
      error
    );

    return null;
  }
}

// ======================================================
// UPDATE PAYMENT
// ======================================================

async function updatePayment(
  roomId,
  phone
) {
  try {
    const room =
      await getDealRoom(roomId);

    if (!room) {
      return null;
    }

    const clean =
      cleanPhone(phone);

    // Security
    if (
      !isRoomParticipant(
        room,
        clean
      )
    ) {
      console.log(
        "🔒 Unauthorized payment attempt:",
        clean
      );

      return null;
    }

    const updates = {};

    if (
      clean ===
      cleanPhone(room.buyer_phone)
    ) {
      updates.buyer_paid = true;
    }

    if (
      clean ===
      cleanPhone(room.seller_phone)
    ) {
      updates.seller_paid = true;
    }

    const buyerPaid =
      updates.buyer_paid === true ||
      room.buyer_paid === true;

    const sellerPaid =
      updates.seller_paid === true ||
      room.seller_paid === true;

    if (
      buyerPaid &&
      sellerPaid
    ) {
      updates.status = "completed";
    }

    const {
      data,
      error
    } = await supabase
      .from("deal_rooms")
      .update(updates)
      .eq("id", roomId)
      .select()
      .single();

    if (error) {
      console.error(
        "❌ UPDATE PAYMENT ERROR:",
        error
      );

      return null;
    }

    return data;

  } catch (error) {
    console.error(
      "❌ UPDATE PAYMENT EXCEPTION:",
      error
    );

    return null;
  }
}

// ======================================================
// GET LISTING FOR DEAL ROOM
// ======================================================

async function getListingForRoom(room) {
  try {
    const {
      data,
      error
    } = await supabase
      .from("listings")
      .select("*")
      .eq("id", room.listing_id)
      .single();

    if (error) {
      console.error(
        "❌ GET LISTING FOR ROOM ERROR:",
        error
      );

      return null;
    }

    return data;

  } catch (error) {
    console.error(
      "❌ GET LISTING EXCEPTION:",
      error
    );

    return null;
  }
}

// ======================================================
// LIST ACTIVE ROOMS
// ======================================================

async function roomsReply(phone) {
  const rooms =
    await getActiveDealRooms(phone);

  if (rooms.length === 0) {
    return `
📭 You currently have no active Deal Rooms.

When JR PHEEF matches you with someone, your Deal Room will appear here.
`;
  }

  let reply =
    `📂 YOUR ACTIVE DEAL ROOMS\n\n`;

  for (
    let i = 0;
    i < rooms.length;
    i++
  ) {
    const room = rooms[i];

    const listing =
      await getListingForRoom(
        room
      );

    const item =
      listing?.item_name ||
      "Marketplace item";

    const price =
      listing?.price;

    const location =
      listing?.location ||
      "Location not specified";

    const role =
      cleanPhone(room.buyer_phone) ===
      cleanPhone(phone)
        ? "BUYER"
        : "SELLER";

    reply +=
      `━━━━━━━━━━━━━━\n` +
      `ROOM ${i + 1}\n` +
      `Role: ${role}\n` +
      `Item: ${item}\n` +
      `Price: KSh ${formatMoney(price)}\n` +
      `Location: ${location}\n\n`;

    reply +=
      `CHAT ${i + 1} <your message>\n`;
  }

  reply +=
    `\nExample:\n\nCHAT 1 Is the car still available?\n`;

  return reply;
}

// ======================================================
// CHAT HELP
// ======================================================

function chatHelp() {
  return `
💬 JR PHEEF DEAL ROOM

You don't need to copy the long Deal Room ID.

If you have ONE active Deal Room:

CHAT Is the item still available?

If you have MULTIPLE Deal Rooms:

ROOMS

Then use:

CHAT 1 Is the item still available?

Your phone number remains protected.
`;
}

// ======================================================
// AGREEMENT HELP
// ======================================================

function agreeHelp() {
  return `
🤝 DEAL AGREEMENT

If you have ONE active Deal Room:

AGREE

If you have MULTIPLE Deal Rooms:

AGREE 1

Reply ROOMS to see your active rooms.
`;
}

// ======================================================
// PAYMENT HELP
// ======================================================

function paidHelp() {
  return `
💰 PAYMENT CONFIRMATION

If you have ONE active Deal Room:

PAID

If you have MULTIPLE Deal Rooms:

PAID 1

Reply ROOMS to see your active rooms.
`;
}

// ======================================================
// HOME
// ======================================================

app.get("/", (req, res) => {
  res.send(
    "🚀 JR PHEEF Marketplace is LIVE"
  );
});

// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "JR PHEEF Marketplace"
  });
});

// ======================================================
// WHATSAPP WEBHOOK
// ======================================================

app.post(
  "/api/webhook/whatsapp",
  async (req, res) => {

    console.log("");
    console.log(
      "======================================"
    );
    console.log(
      "📩 JR PHEEF WEBHOOK RECEIVED"
    );
    console.log(
      "======================================"
    );

    try {

      const message =
        String(
          req.body.Body || ""
        ).trim();

      const phone =
        cleanPhone(
          req.body.From
        );

      console.log(
        "📱 Phone:",
        phone
      );

      console.log(
        "💬 Message:",
        message
      );

      if (!phone) {
        const twiml =
          new MessagingResponse();

        twiml.message(
          "❌ Could not identify your WhatsApp number."
        );

        return res
          .type("text/xml")
          .send(
            twiml.toString()
          );
      }

      if (!message) {
        const twiml =
          new MessagingResponse();

        twiml.message(
          `👋 Welcome to JR PHEEF Marketplace.\n\nReply:\n\nFIND\nOPPORTUNITY\nROOMS\nCHAT\nAGREE\nPAID`
        );

        return res
          .type("text/xml")
          .send(
            twiml.toString()
          );
      }

      const upper =
        message.toUpperCase();

      // ==================================================
      // ROOMS
      // ==================================================

      if (
        upper === "ROOMS" ||
        upper === "MY ROOMS" ||
        upper === "DEAL ROOMS"
      ) {

        const reply =
          await roomsReply(
            phone
          );

        const twiml =
          new MessagingResponse();

        twiml.message(reply);

        return res
          .type("text/xml")
          .send(
            twiml.toString()
          );
      }

      // ==================================================
      // CHAT
      //
      // Supported:
      //
      // CHAT hello
      //
      // CHAT 1 hello
      //
      // CHAT UUID hello
      // ==================================================

      if (
        upper === "CHAT" ||
        upper.startsWith("CHAT ")
      ) {

        let content =
          message
            .replace(
              /^CHAT/i,
              ""
            )
            .trim();

        let roomId = null;
        let roomNumber = null;

        // ------------------------------------------------
        // FULL UUID
        // ------------------------------------------------

        if (content) {

          const firstSpace =
            content.indexOf(" ");

          const firstWord =
            firstSpace === -1
              ? content
              : content.slice(
                  0,
                  firstSpace
                );

          if (
            isUuid(firstWord)
          ) {
            roomId = firstWord;

            content =
              firstSpace === -1
                ? ""
                : content
                    .slice(
                      firstSpace + 1
                    )
                    .trim();
          }

          // ------------------------------------------------
          // ROOM NUMBER
          // ------------------------------------------------

          else if (
            /^\d+$/.test(
              firstWord
            )
          ) {
            roomNumber =
              Number(firstWord);

            content =
              firstSpace === -1
                ? ""
                : content
                    .slice(
                      firstSpace + 1
                    )
                    .trim();
          }
        }

        // ------------------------------------------------
        // NO MESSAGE
        // ------------------------------------------------

        if (!content) {
          const twiml =
            new MessagingResponse();

          twiml.message(
            chatHelp()
          );

          return res
            .type("text/xml")
            .send(
              twiml.toString()
            );
        }

        // ------------------------------------------------
        // FIND ROOM
        // ------------------------------------------------

        const result =
          await resolveRoom(
            phone,
            roomId,
            roomNumber
          );

        if (!result.room) {

          const twiml =
            new MessagingResponse();

          twiml.message(
            result.error ||
              chatHelp()
          );

          return res
            .type("text/xml")
            .send(
              twiml.toString()
            );
        }

        const room =
          result.room;

        // ------------------------------------------------
        // SAVE MESSAGE
        // ------------------------------------------------

        const saved =
          await saveMessage(
            room.id,
            phone,
            content
          );

        if (!saved) {
          console.error(
            "⚠️ Message could not be saved."
          );
        }

        // ------------------------------------------------
        // DETERMINE RECIPIENT
        // ------------------------------------------------

        const buyer =
          cleanPhone(
            room.buyer_phone
          );

        const seller =
          cleanPhone(
            room.seller_phone
          );

        const recipient =
          phone === buyer
            ? seller
            : buyer;

        console.log(
          "👤 Sender:",
          phone
        );

        console.log(
          "🛒 Buyer:",
          buyer
        );

        console.log(
          "🏪 Seller:",
          seller
        );

        console.log(
          "📨 Recipient:",
          recipient
        );

        // ------------------------------------------------
        // SEND TO OTHER PARTICIPANT
        // ------------------------------------------------

        await sendWhatsApp(
          recipient,
          `💬 JR PHEEF DEAL ROOM\n\n${content}\n\nReply:\n\nCHAT <your message>\n\nYour phone number remains protected.`
        );

        // ------------------------------------------------
        // RESPONSE TO SENDER
        // ------------------------------------------------

        const twiml =
          new MessagingResponse();

        twiml.message(
          `☑ Message sent through the Deal Room.\n\n🔒 Your phone number remains protected.`
        );

        return res
          .type("text/xml")
          .send(
            twiml.toString()
          );
      }

      // ==================================================
      // AGREE
      //
      // Supported:
      //
      // AGREE
      // AGREE 1
      // AGREE UUID
      // ==================================================

      if (
        upper === "AGREE" ||
        upper.startsWith("AGREE ")
      ) {

        let argument =
          message
            .replace(
              /^AGREE/i,
              ""
            )
            .trim();

        let roomId = null;
        let roomNumber = null;

        if (argument) {

          if (
            isUuid(argument)
          ) {
            roomId =
              argument;
          }

          else if (
            /^\d+$/.test(argument)
          ) {
            roomNumber =
              Number(argument);
          }
        }

        const result =
          await resolveRoom(
            phone,
            roomId,
            roomNumber
          );

        if (!result.room) {

          const twiml =
            new MessagingResponse();

          twiml.message(
            result.error ||
              agreeHelp()
          );

          return res
            .type("text/xml")
            .send(
              twiml.toString()
            );
        }

        const room =
          await updateAgreement(
            result.room.id,
            phone
          );

        if (!room) {

          const twiml =
            new MessagingResponse();

          twiml.message(
            "❌ We could not record your agreement. Please try again."
          );

          return res
            .type("text/xml")
            .send(
              twiml.toString()
            );
        }

        // ------------------------------------------------
        // BOTH AGREED
        // ------------------------------------------------

        if (
          room.buyer_agreed &&
          room.seller_agreed
        ) {

          const buyer =
            cleanPhone(
              room.buyer_phone
            );

          const seller =
            cleanPhone(
              room.seller_phone
            );

          await sendWhatsApp(
            buyer,
            `🎉 BOTH PARTIES AGREED!\n\nThe buyer and seller have agreed on the deal.\n\nTo unlock the connection:\n\n💰 KSh ${CONNECTION_FEE} from buyer\n💰 KSh ${CONNECTION_FEE} from seller\n\nAfter making your payment, reply:\n\nPAID\n\nYou don't need to copy the Deal Room ID.`
          );

          await sendWhatsApp(
            seller,
            `🎉 BOTH PARTIES AGREED!\n\nThe buyer and seller have agreed on the deal.\n\nTo unlock the connection:\n\n💰 KSh ${CONNECTION_FEE} from buyer\n💰 KSh ${CONNECTION_FEE} from seller\n\nAfter making your payment, reply:\n\nPAID\n\nYou don't need to copy the Deal Room ID.`
          );

          const twiml =
            new MessagingResponse();

          twiml.message(
            `🎉 BOTH PARTIES AGREED!\n\n💰 KSh ${CONNECTION_FEE} from buyer\n💰 KSh ${CONNECTION_FEE} from seller\n\nMake your payment and reply:\n\nPAID`
          );

          return res
            .type("text/xml")
            .send(
              twiml.toString()
            );
        }

        // ------------------------------------------------
        // ONLY ONE AGREED
        // ------------------------------------------------

        const otherParty =
          cleanPhone(
            room.buyer_phone
          ) === cleanPhone(phone)
            ? cleanPhone(
                room.seller_phone
              )
            : cleanPhone(
                room.buyer_phone
              );

        await sendWhatsApp(
          otherParty,
          `🤝 The other party has agreed to the deal.\n\nIf you also agree, reply:\n\nAGREE`
        );

        const twiml =
          new MessagingResponse();

        twiml.message(
          `✅ Your agreement has been recorded.\n\nWaiting for the other party to agree.\n\nYou don't need to copy the Deal Room ID.`
        );

        return res
          .type("text/xml")
          .send(
            twiml.toString()
          );
      }

      // ==================================================
      // PAID
      //
      // Supported:
      //
      // PAID
      // PAID 1
      // PAID UUID
      // ==================================================

      if (
        upper === "PAID" ||
        upper.startsWith("PAID ")
      ) {

        let argument =
          message
            .replace(
              /^PAID/i,
              ""
            )
            .trim();

        let roomId = null;
        let roomNumber = null;

        if (argument) {

          if (
            isUuid(argument)
          ) {
            roomId =
              argument;
          }

          else if (
            /^\d+$/.test(argument)
          ) {
            roomNumber =
              Number(argument);
          }
        }

        const result =
          await resolveRoom(
            phone,
            roomId,
            roomNumber
          );

        if (!result.room) {

          const twiml =
            new MessagingResponse();

          twiml.message(
            result.error ||
              paidHelp()
          );

          return res
            .type("text/xml")
            .send(
              twiml.toString()
            );
        }

        const room =
          await updatePayment(
            result.room.id,
            phone
          );

        if (!room) {

          const twiml =
            new MessagingResponse();

          twiml.message(
            "❌ We could not record your payment confirmation. Please try again."
          );

          return res
            .type("text/xml")
            .send(
              twiml.toString()
            );
        }

        // ------------------------------------------------
        // BOTH PAID
        // ------------------------------------------------

        if (
          room.buyer_paid &&
          room.seller_paid
        ) {

          const buyer =
            cleanPhone(
              room.buyer_phone
            );

          const seller =
            cleanPhone(
              room.seller_phone
            );

          // ------------------------------------------------
          // IMPORTANT:
          // Only now are contacts revealed.
          // ------------------------------------------------

          await sendWhatsApp(
            buyer,
            `🎉 PAYMENT CONFIRMED!\n\nBoth parties have paid the KSh ${CONNECTION_FEE} connection fee.\n\n🔓 CONNECTION UNLOCKED\n\nSeller contact:\n${seller}\n\nYou may now continue the transaction directly.\n\n⚠️ Please trade safely and verify the item before making any further payment.\n\nThank you for using JR PHEEF Marketplace.`
          );

          await sendWhatsApp(
            seller,
            `🎉 PAYMENT CONFIRMED!\n\nBoth parties have paid the KSh ${CONNECTION_FEE} connection fee.\n\n🔓 CONNECTION UNLOCKED\n\nBuyer contact:\n${buyer}\n\nYou may now continue the transaction directly.\n\n⚠️ Please trade safely and verify the item before making any further payment.\n\nThank you for using JR PHEEF Marketplace.`
          );

          const twiml =
            new MessagingResponse();

          twiml.message(
            `🎉 PAYMENT CONFIRMED!\n\nBoth parties have paid.\n\n🔓 The connection is now unlocked.\n\nThe other party's contact details have been sent to you privately.`
          );

          return res
            .type("text/xml")
            .send(
              twiml.toString()
            );
        }

        // ------------------------------------------------
        // ONLY ONE PAID
        // ------------------------------------------------

        const otherParty =
          cleanPhone(
            room.buyer_phone
          ) === cleanPhone(phone)
            ? cleanPhone(
                room.seller_phone
              )
            : cleanPhone(
                room.buyer_phone
              );

        await sendWhatsApp(
          otherParty,
          `💰 The other party has confirmed their KSh ${CONNECTION_FEE} connection fee.\n\nPlease make your payment and reply:\n\nPAID`
        );

        const twiml =
          new MessagingResponse();

        twiml.message(
          `✅ Payment confirmation recorded.\n\nWaiting for the other party to pay.\n\nOnce both parties have paid, the connection will be unlocked automatically.`
        );

        return res
          .type("text/xml")
          .send(
            twiml.toString()
          );
      }

      // ==================================================
      // FIND
      // ==================================================

      if (
        upper.startsWith("FIND")
      ) {

        const lines =
          message
            .split("\n")
            .map(line =>
              line.trim()
            );

        const item =
          lines[1] || "";

        const location =
          lines[2] || "";

        const budget =
          parseInt(
            (lines[3] || "")
              .replace(
                /[^0-9]/g,
                ""
              ),
            10
          ) || null;

        console.log(
          "🔎 FIND REQUEST"
        );

        console.log(
          "Item:",
          item
        );

        console.log(
          "Location:",
          location
        );

        console.log(
          "Budget:",
          budget
        );

        const results =
          await findListings(
            item,
            location,
            budget
          );

        if (
          results.length === 0
        ) {

          const twiml =
            new MessagingResponse();

          twiml.message(
            `😔 No matching items found.\n\nWe will keep your request in mind when new sellers list matching opportunities.`
          );

          return res
            .type("text/xml")
            .send(
              twiml.toString()
            );
        }

        // ------------------------------------------------
        // CURRENTLY USE FIRST MATCH
        // ------------------------------------------------

        const first =
          results[0];

        console.log(
          "🎯 SELECTED LISTING:",
          first
        );

        // ------------------------------------------------
        // CREATE DEAL ROOM
        // ------------------------------------------------

        const room =
          await createDealRoom(
            first,
            phone
          );

        if (!room) {

          const twiml =
            new MessagingResponse();

          twiml.message(
            `❌ We found a matching seller, but we could not create your secure Deal Room.\n\nPlease try again.`
          );

          return res
            .type("text/xml")
            .send(
              twiml.toString()
            );
        }

        // ------------------------------------------------
        // SELLER NOTIFICATION
        // ------------------------------------------------

        await sendWhatsApp(
          first.phone,
          `🎉 JR PHEEF MATCH FOUND!\n\nA buyer is interested in:\n\nItem: ${first.item_name}\nPrice: KSh ${formatMoney(first.price)}\nLocation: ${first.location}\n\n🔐 SECURE DEAL ROOM CREATED\n\nYou do NOT need to copy a long Deal Room ID.\n\nSimply reply:\n\nCHAT <your message>\n\nExample:\nCHAT Yes, the car is still available.\n\nTo agree:\nAGREE\n\nYour phone number remains protected.\n\n💰 Connection fee after both parties agree:\nKSh ${CONNECTION_FEE} buyer\nKSh ${CONNECTION_FEE} seller`
        );

        // ------------------------------------------------
        // BUYER RESPONSE
        // ------------------------------------------------

        const twiml =
          new MessagingResponse();

        twiml.message(
          `🎉 JR PHEEF MATCH FOUND!\n\nItem: ${first.item_name}\nPrice: KSh ${formatMoney(first.price)}\nLocation: ${first.location}\n\n🔐 SECURE DEAL ROOM CREATED\n\nThe seller has been notified.\n\nYou do NOT need to copy the long Deal Room ID.\n\nSimply reply:\n\nCHAT Is the item still available?\n\nTo agree:\nAGREE\n\n💰 Connection fee after both parties agree:\nKSh ${CONNECTION_FEE} buyer\nKSh ${CONNECTION_FEE} seller\n\n🔒 JR PHEEF keeps the connection secure.`
        );

        return res
          .type("text/xml")
          .send(
            twiml.toString()
          );
      }

      // ==================================================
      // OPPORTUNITY
      // ==================================================

      if (
        upper.startsWith(
          "OPPORTUNITY"
        )
      ) {

        const saved =
          await saveListing(
            message,
            phone
          );

        const twiml =
          new MessagingResponse();

        if (saved) {

          twiml.message(
            `✅ Your opportunity has been submitted!\n\nJR PHEEF is now matching you with people looking for this opportunity.\n\nThank you for using JR PHEEF Marketplace.`
          );

        } else {

          twiml.message(
            `❌ Sorry.\n\nWe could not save your listing.\n\nPlease try again using:\n\nOPPORTUNITY\nItem\nPrice\nLocation`
          );
        }

        return res
          .type("text/xml")
          .send(
            twiml.toString()
          );
      }

      // ==================================================
      // HELP
      // ==================================================

      const twiml =
        new MessagingResponse();

      twiml.message(
        `👋 Welcome to JR PHEEF Marketplace.\n\nWe help people FIND and CREATE opportunities.\n\nReply with:\n\nFIND\nOPPORTUNITY\nROOMS\nCHAT\nAGREE\nPAID\n\n💡 You no longer need to copy long Deal Room IDs.`
      );

      return res
        .type("text/xml")
        .send(
          twiml.toString()
        );

    } catch (error) {

      console.error(
        "🔥 WEBHOOK FATAL ERROR:",
        error
      );

      const twiml =
        new MessagingResponse();

      twiml.message(
        `❌ JR PHEEF encountered a temporary error.\n\nPlease try again in a moment.`
      );

      return res
        .type("text/xml")
        .send(
          twiml.toString()
        );
    }
  }
);

// ======================================================
// START SERVER
// ======================================================

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  () => {
    console.log(
      `🚀 JR PHEEF running on port ${PORT}`
    );

    console.log(
      `🌐 Port: ${PORT}`
    );

    console.log(
      `🔐 Deal Room system: ACTIVE`
    );

    console.log(
      `💬 Automatic CHAT room lookup: ACTIVE`
    );

    console.log(
      `🤝 Automatic AGREE room lookup: ACTIVE`
    );

    console.log(
      `💰 Automatic PAID room lookup: ACTIVE`
    );
  }
); 
