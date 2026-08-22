const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");

const app = express();

// =====================================================
// TWILIO
// =====================================================

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// =====================================================
// EXPRESS
// =====================================================

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// =====================================================
// SUPABASE
// =====================================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// =====================================================
// HELPERS
// =====================================================

// Normalize WhatsApp phone numbers
function normalizePhone(phone) {
  if (!phone) return "";

  return phone
    .replace(/^whatsapp:/i, "")
    .replace(/[^\d+]/g, "")
    .trim();
}

// Escape XML characters for Twilio response
function escapeXml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Send WhatsApp message
async function sendWhatsApp(to, body) {
  const recipient = normalizePhone(to);

  if (!recipient) {
    console.error("❌ Cannot send WhatsApp message: empty recipient");
    return false;
  }

  if (!process.env.TWILIO_WHATSAPP_NUMBER) {
    console.error(
      "❌ TWILIO_WHATSAPP_NUMBER is missing from environment variables."
    );
    return false;
  }

  try {
    console.log("========================================");
    console.log("📤 SENDING WHATSAPP MESSAGE");
    console.log("To:", recipient);
    console.log("From:", process.env.TWILIO_WHATSAPP_NUMBER);
    console.log("========================================");

    const message = await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: `whatsapp:${recipient}`,
      body
    });

    console.log("✅ WhatsApp message sent.");
    console.log("Twilio SID:", message.sid);

    return true;
  } catch (error) {
    console.error("❌ TWILIO SEND ERROR:");
    console.error(error);

    return false;
  }
}

// =====================================================
// SAVE LISTING
// =====================================================

async function saveListing(message, phone) {
  try {
    const lines = message.split("\n");

    const item = (lines[1] || "").trim();
    const priceText = (lines[2] || "").trim();
    const town = (lines[3] || "").trim();

    const price =
      parseInt(priceText.replace(/[^0-9]/g, ""), 10) || null;

    const sellerPhone = normalizePhone(phone);

    if (!item) {
      console.log("❌ Listing rejected: missing item.");
      return false;
    }

    if (!price) {
      console.log("❌ Listing rejected: missing price.");
      return false;
    }

    if (!town) {
      console.log("❌ Listing rejected: missing location.");
      return false;
    }

    console.log("========================================");
    console.log("📝 SAVING LISTING");
    console.log("Seller:", sellerPhone);
    console.log("Item:", item);
    console.log("Price:", price);
    console.log("Location:", town);
    console.log("========================================");

    const { error } = await supabase
      .from("listings")
      .insert([
        {
          seller_name: sellerPhone,
          phone: sellerPhone,
          item_name: item,
          price: price,
          location: town,
          status: "ACTIVE"
        }
      ]);

    if (error) {
      console.error("❌ SAVE LISTING ERROR:");
      console.error(error);
      return false;
    }

    console.log("✅ Listing saved successfully.");

    return true;
  } catch (error) {
    console.error("❌ saveListing ERROR:");
    console.error(error);

    return false;
  }
}

// =====================================================
// FIND LISTINGS
// =====================================================

async function findListings(item, location, budget, buyerPhone) {
  try {
    const buyer = normalizePhone(buyerPhone);

    console.log("========================================");
    console.log("🔎 FIND LISTINGS");
    console.log("Item:", item);
    console.log("Location:", location);
    console.log("Budget:", budget);
    console.log("Buyer:", buyer);
    console.log("========================================");

    let query = supabase
      .from("listings")
      .select("*")
      .eq("status", "ACTIVE");

    // -------------------------------------------------
    // VERY IMPORTANT:
    // NEVER MATCH BUYER WITH THEIR OWN LISTING
    // -------------------------------------------------

    if (buyer) {
      query = query.neq("phone", buyer);
    }

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

    const { data, error } = await query;

    if (error) {
      console.error("❌ FIND LISTINGS ERROR:");
      console.error(error);
      return [];
    }

    console.log("🔎 Listings found:", data ? data.length : 0);

    if (data && data.length > 0) {
      data.forEach((listing, index) => {
        console.log(
          `#${index + 1}`,
          "ID:",
          listing.id,
          "| Seller:",
          listing.phone,
          "| Item:",
          listing.item_name,
          "| Price:",
          listing.price,
          "| Location:",
          listing.location
        );
      });
    }

    return data || [];
  } catch (error) {
    console.error("❌ findListings ERROR:");
    console.error(error);

    return [];
  }
}

// =====================================================
// GET ACTIVE DEAL ROOM FOR USER
// =====================================================

async function getActiveRoomForUser(phone) {
  try {
    const userPhone = normalizePhone(phone);

    console.log("🔎 Looking for active Deal Room for:", userPhone);

    const { data, error } = await supabase
      .from("deal_rooms")
      .select("*")
      .or(
        `buyer_phone.eq.${userPhone},seller_phone.eq.${userPhone}`
      )
      .in("status", [
        "negotiating",
        "agreed",
        "awaiting_payment"
      ])
      .order("created_at", {
        ascending: false
      })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("❌ ACTIVE ROOM LOOKUP ERROR:");
      console.error(error);
      return null;
    }

    if (data) {
      console.log(
        "✅ Active Deal Room found:",
        data.id
      );
    } else {
      console.log(
        "ℹ️ No active Deal Room found for:",
        userPhone
      );
    }

    return data || null;
  } catch (error) {
    console.error("❌ getActiveRoomForUser ERROR:");
    console.error(error);

    return null;
  }
}

// =====================================================
// CREATE DEAL ROOM
// =====================================================

async function createDealRoom(listing, buyerPhone) {
  try {
    const buyer = normalizePhone(buyerPhone);
    const seller = normalizePhone(listing.phone);

    console.log("========================================");
    console.log("🤝 CREATE DEAL ROOM");
    console.log("Listing ID:", listing.id);
    console.log("Buyer:", buyer);
    console.log("Seller:", seller);
    console.log("========================================");

    // -------------------------------------------------
    // SECURITY CHECK
    // -------------------------------------------------

    if (!buyer || !seller) {
      console.error(
        "❌ Cannot create Deal Room: missing phone."
      );

      return null;
    }

    // -------------------------------------------------
    // NEVER CREATE A ROOM BETWEEN SAME NUMBER
    // -------------------------------------------------

    if (buyer === seller) {
      console.error(
        "❌ BLOCKED: buyer and seller are the same phone number."
      );

      return null;
    }

    // -------------------------------------------------
    // CHECK FOR EXISTING ACTIVE ROOM
    // -------------------------------------------------

    const { data: existingRooms, error: existingError } =
      await supabase
        .from("deal_rooms")
        .select("*")
        .eq("listing_id", listing.id)
        .eq("buyer_phone", buyer)
        .in("status", [
          "negotiating",
          "agreed",
          "awaiting_payment"
        ])
        .limit(1);

    if (existingError) {
      console.error(
        "❌ EXISTING ROOM CHECK ERROR:"
      );
      console.error(existingError);
    }

    if (
      existingRooms &&
      existingRooms.length > 0
    ) {
      console.log(
        "ℹ️ Existing Deal Room found:",
        existingRooms[0].id
      );

      return existingRooms[0];
    }

    // -------------------------------------------------
    // CREATE NEW ROOM
    // -------------------------------------------------

    const { data, error } = await supabase
      .from("deal_rooms")
      .insert([
        {
          listing_id: listing.id,
          buyer_phone: buyer,
          seller_phone: seller,

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
        "❌ CREATE DEAL ROOM ERROR:"
      );
      console.error(error);

      return null;
    }

    console.log(
      "✅ DEAL ROOM CREATED:",
      data.id
    );

    return data;
  } catch (error) {
    console.error(
      "❌ createDealRoom ERROR:"
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
