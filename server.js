const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// =========================
// TWILIO
// =========================

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// =========================
// SUPABASE
// =========================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// =========================
// HELPERS
// =========================

// Make phone numbers consistent
function normalizePhone(phone) {
  if (!phone) return "";

  return phone
    .replace(/^whatsapp:/i, "")
    .replace(/\s+/g, "")
    .replace(/^\+/, "");
}

// Send Twilio WhatsApp message
async function sendWhatsApp(to, body) {
  const normalized = normalizePhone(to);

  console.log("================================");
  console.log("SENDING WHATSAPP");
  console.log("To:", normalized);
  console.log("From:", process.env.TWILIO_WHATSAPP_NUMBER);
  console.log("Message:", body);
  console.log("================================");

  try {
    const result = await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: `whatsapp:+${normalized}`,
      body
    });

    console.log("TWILIO MESSAGE SENT:", result.sid);

    return true;
  } catch (error) {
    console.error("TWILIO SEND ERROR:");
    console.error(error);
    return false;
  }
}

// Proper Twilio response
function twiml(res, message) {
  const safeMessage = String(message)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  res.type("text/xml");

  res.send(`
<Response>
  <Message>${safeMessage}</Message>
</Response>
`);
}

// =========================
// SAVE LISTING
// =========================

async function saveListing(message, phone) {
  try {
    console.log("================================");
    console.log("SAVING LISTING");
    console.log("Phone:", phone);
    console.log("Message:", message);
    console.log("================================");

    const lines = message
      .split("\n")
      .map(line => line.trim());

    const item = lines[1] || "";
    const priceText = lines[2] || "";
    const town = lines[3] || "";

    const price =
      parseInt(priceText.replace(/[^0-9]/g, ""), 10) || null;

    if (!item) {
      console.log("LISTING ERROR: Missing item");
      return false;
    }

    const { data, error } = await supabase
      .from("listings")
      .insert([
        {
          seller_name: phone,
          phone: normalizePhone(phone),
          item_name: item,
          price: price,
          location: town,
          status: "ACTIVE"
        }
      ])
      .select()
      .single();

    if (error) {
      console.error("SUPABASE LISTING ERROR:");
      console.error(error);
      return false;
    }

    console.log("LISTING CREATED:");
    console.log(data);

    return true;

  } catch (error) {
    console.error("SAVE LISTING CRASH:");
    console.error(error);
    return false;
  }
}

// =========================
// FIND LISTINGS
// =========================

async function findListings(item, location, budget) {
  console.log("================================");
  console.log("FIND LISTINGS");
  console.log("Item:", item);
  console.log("Location:", location);
  console.log("Budget:", budget);
  console.log("================================");

  try {
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

    const { data, error } = await query;

    if (error) {
      console.error("FIND LISTINGS SUPABASE ERROR:");
      console.error(error);
      return [];
    }

    console.log("MATCHING LISTINGS:");
    console.log(data);

    return data || [];

  } catch (error) {
    console.error("FIND LISTINGS CRASH:");
    console.error(error);
    return [];
  }
}

// =========================
// CREATE DEAL ROOM
// =========================

async function createDealRoom(listing, buyerPhone) {
  console.log("================================");
  console.log("CREATING DEAL ROOM");
  console.log("================================");

  try {
    if (!listing) {
      console.error("DEAL ROOM ERROR: Listing is missing");
      return null;
    }

    const buyer = normalizePhone(buyerPhone);
    const seller = normalizePhone(listing.phone);

    console.log("Listing ID:", listing.id);
    console.log("Buyer:", buyer);
    console.log("Seller:", seller);

    if (!listing.id) {
      console.error("DEAL ROOM ERROR: listing.id is missing");
      return null;
    }

    if (!buyer) {
      console.error("DEAL ROOM ERROR: buyer phone missing");
      return null;
    }

    if (!seller) {
      console.error("DEAL ROOM ERROR: seller phone missing");
      return null;
    }

    // Prevent the same buyer from creating
    // duplicate active rooms for the same listing
    const { data: existing, error: existingError } =
      await supabase
        .from("deal_rooms")
        .select("*")
        .eq("listing_id", listing.id)
        .eq("buyer_phone", buyer)
        .in("status", [
          "negotiating",
          "active"
        ])
        .limit(1);

    if (existingError) {
      console.error("CHECK EXISTING ROOM ERROR:");
      console.error(existingError);
    }

    if (existing && existing.length > 0) {
      console.log("EXISTING DEAL ROOM FOUND:");
      console.log(existing[0]);

      return existing[0];
    }

    // Create new Deal Room
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
      console.error("================================");
      console.error("DEAL ROOM SUPABASE ERROR");
      console.error("================================");
      console.error(error);
      return null;
    }

    console.log("================================");
    console.log("DEAL ROOM CREATED SUCCESSFULLY");
    console.log("ROOM:");
    console.log(data);
    console.log("================================");

    return data;

  } catch (error) {
    console.error("DEAL ROOM CRASH:");
    console.error(error);
    return null;
  }
}

// =========================
// GET DEAL ROOM
// =========================

async function getDealRoom(roomId) {
  try {
    const { data, error } = await supabase
      .from("deal_rooms")
      .select("*")
      .eq("id", roomId)
      .single();

    if (error) {
      console.error("GET DEAL ROOM ERROR:");
      console.error(error);
      return null;
    }

    return data;

  } catch (error) {
    console.error("GET DEAL ROOM CRASH:");
    console.error(error);
    return null;
  }
}

// =========================
// SAVE MESSAGE
// =========================

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
      console.error("SAVE MESSAGE ERROR:");
      console.error(error);
      return false;
    }

    return true;

  } catch (error) {
    console.error("SAVE MESSAGE CRASH:");
    console.error(error);
    return false;
  }
}

// =========================
// UPDATE AGREEMENT
// =========================

async function updateAgreement(roomId, phone) {
  const room = await getDealRoom(roomId);

  if (!room) {
    return null;
  }

  const normalizedPhone = normalizePhone(phone);

  const updates = {};

  if (
    normalizedPhone ===
    normalizePhone(room.buyer_phone)
  ) {
    updates.buyer_agreed = true;

  } else if (
    normalizedPhone ===
    normalizePhone(room.seller_phone)
  ) {
    updates.seller_agreed = true;

  } else {
    console.log(
      "AGREE ERROR: Phone does not belong to room"
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
    console.error("UPDATE AGREEMENT ERROR:");
    console.error(error);
    return null;
  }

  return data;
}

// =========================
// UPDATE PAYMENT
// =========================

async function updatePayment(roomId, phone) {
  const room = await getDealRoom(roomId);

  if (!room) {
    return null;
  }

  const normalizedPhone = normalizePhone(phone);

  const updates = {};

  if (
    normalizedPhone ===
    normalizePhone(room.buyer_phone)
  ) {
    updates.buyer_paid = true;

  } else if (
    normalizedPhone ===
    normalizePhone(room.seller_phone)
  ) {
    updates.seller_paid = true;

  } else {
    console.log(
      "PAYMENT ERROR: Phone does not belong to room"
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
    console.error("UPDATE PAYMENT ERROR:");
    console.error(error);
    return null;
  }

  return data;
}

// =========================
// HOME
// =========================

app.get("/", (req, res) => {
  res.send(
    "🚀 JR PHEEF Marketplace is LIVE"
  );
});

// =========================
// WHATSAPP WEBHOOK
// =========================

app.post(
  "/api/webhook/whatsapp",
  async (req, res) => {

    console.log("");
    console.log("================================");
    console.log("WHATSAPP WEBHOOK RECEIVED");
    console.log("================================");

    const message =
      (req.body.Body || "").trim();

    const phone =
      normalizePhone(req.body.From || "");

    console.log("PHONE:", phone);
    console.log("MESSAGE:", message);

    // =========================
    // CHAT
    // =========================

    if (
      message
        .toUpperCase()
        .startsWith("CHAT ")
    ) {

      const lines = message.split("\n");

      const roomId = lines[0]
        .replace(/^CHAT\s+/i, "")
        .trim();

      const chatMessage = lines
        .slice(1)
        .join("\n")
        .trim();

      if (!chatMessage) {
        return twiml(
          res,
          "Please type your message after the room ID."
        );
      }

      const room =
        await getDealRoom(roomId);

      if (!room) {
        return twiml(
          res,
          "❌ Deal Room not found."
        );
      }

      const isBuyer =
        normalizePhone(room.buyer_phone) ===
        normalizePhone(phone);

      const isSeller =
        normalizePhone(room.seller_phone) ===
        normalizePhone(phone);

      if (!isBuyer && !isSeller) {
        return twiml(
          res,
          "❌ You are not a participant in this Deal Room."
        );
      }

      await saveMessage(
        roomId,
        phone,
        chatMessage
      );

      const recipient =
        isBuyer
          ? room.seller_phone
          : room.buyer_phone;

      await sendWhatsApp(
        recipient,
        `💬 JR PHEEF DEAL ROOM

${chatMessage}

Reply:

CHAT ${roomId}
`
      );

      return twiml(
        res,
        "☑ Message sent through the Deal Room."
      );
    }

    // =========================
    // AGREE
    // =========================

    if (
      message
        .toUpperCase()
        .startsWith("AGREE ")
    ) {

      const roomId =
        message
          .replace(/^AGREE\s+/i, "")
          .trim();

      const room =
        await updateAgreement(
          roomId,
          phone
        );

      if (!room) {
        return twiml(
          res,
          "❌ Deal Room not found or you are not a participant."
        );
      }

      if (
        room.buyer_agreed &&
        room.seller_agreed
      ) {

        const notice = `
🎉 BOTH PARTIES AGREED!

The buyer and seller have agreed on the deal.

To unlock the connection:

💰 KSh 30 from buyer
💰 KSh 30 from seller

Reply:

PAID ${roomId}

after making your payment.
`;

        await sendWhatsApp(
          room.buyer_phone,
          notice
        );

        await sendWhatsApp(
          room.seller_phone,
          notice
        );

        return twiml(
          res,
          notice
        );
      }

      return twiml(
        res,
        `
✅ Your agreement has been recorded.

Waiting for the other party to agree.

Deal Room:
${roomId}
`
      );
    }

    // =========================
    // PAID
    // =========================

    if (
      message
        .toUpperCase()
        .startsWith("PAID ")
    ) {

      const roomId =
        message
          .replace(/^PAID\s+/i, "")
          .trim();

      const room =
        await updatePayment(
          roomId,
          phone
        );

      if (!room) {
        return twiml(
          res,
          "❌ Deal Room not found or you are not a participant."
        );
      }

      if (
        room.buyer_paid &&
        room.seller_paid
      ) {

        const successMessage = `
🎉 CONNECTION UNLOCKED!

Both parties have paid the KSh 30 connection fee.

Buyer:
+${room.buyer_phone}

Seller:
+${room.seller_phone}

You may now continue the transaction directly.

Thank you for using JR PHEEF Marketplace.
`;

        await sendWhatsApp(
          room.buyer_phone,
          successMessage
        );

        await sendWhatsApp(
          room.seller_phone,
          successMessage
        );

        return twiml(
          res,
          successMessage
        );
      }

      return twiml(
        res,
        `
✅ Your payment has been recorded.

Waiting for the other party to pay.

Deal Room:
${roomId}
`
      );
    }

    // =========================
    // FIND
    // =========================

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

      console.log("================================");
      console.log("BUYER SEARCH");
      console.log("Buyer:", phone);
      console.log("Item:", item);
      console.log("Location:", location);
      console.log("Budget:", budget);
      console.log("================================");

      const results =
        await findListings(
          item,
          location,
          budget
        );

      if (!results.length) {

        return twiml(
          res,
          `
😔 No matching items found.

JR PHEEF will keep looking for a match.

Thank you for using JR PHEEF Marketplace.
`
        );
      }

      const first = results[0];

      console.log("SELECTED LISTING:");
      console.log(first);

      // =========================
      // CREATE DEAL ROOM
      // =========================

      const room =
        await createDealRoom(
          first,
          phone
        );

      if (!room) {

        console.error(
          "❌ DEAL ROOM CREATION FAILED"
        );

        return twiml(
          res,
          `
❌ We found a matching seller, but the secure Deal Room could not be created.

The JR PHEEF team needs to check the database.

Please try again.
`
        );
      }

      console.log(
        "✅ DEAL ROOM ID:",
        room.id
      );

      // =========================
      // NOTIFY SELLER
      // =========================

      const sellerMessage = `
🎉 JR PHEEF MATCH FOUND!

A buyer is interested in:

Item: ${first.item_name}
Price: KSh ${first.price}
Location: ${first.location}

🔐 Secure Deal Room created.

Deal Room ID:

${room.id}

To communicate with the buyer, reply:

CHAT ${room.id}

Your phone number remains protected.

To agree to the deal, reply:

AGREE ${room.id}

JR PHEEF Marketplace
`;

      const sellerSent =
        await sendWhatsApp(
          first.phone,
          sellerMessage
        );

      console.log(
        "SELLER NOTIFICATION SENT:",
        sellerSent
      );

      // =========================
      // BUYER RESPONSE
      // =========================

      return twiml(
        res,
        `
✅ MATCH FOUND!

Item:
${first.item_name}

Price:
KSh ${first.price}

Location:
${first.location}

🔐 SECURE DEAL ROOM CREATED

Deal Room ID:

${room.id}

The seller has been notified.

Start negotiating with:

CHAT ${room.id}

Agree to the deal with:

AGREE ${room.id}

💰 Connection fee:
KSh 30 buyer
KSh 30 seller

JR PHEEF keeps the connection secure.
`
      );
    }

    // =========================
    // OPPORTUNITY
    // =========================

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

      if (!saved) {

        return twiml(
          res,
          `
❌ Sorry.

We could not save your opportunity.

Please try again.
`
        );
      }

      return twiml(
        res,
        `
✅ YOUR OPPORTUNITY HAS BEEN SUBMITTED!

JR PHEEF is now matching you with people looking for:

${message.split("\n")[1] || "your item"}

You will be notified when a buyer is found.

Thank you for using JR PHEEF Marketplace.
`
      );
    }

    // =========================
    // DEFAULT
    // =========================

    return twiml(
      res,
      `
👋 Welcome to JR PHEEF Marketplace!

We help buyers and sellers FIND and MATCH opportunities.

SELL something:

OPPORTUNITY
Item
Price
Location

FIND something:

FIND
Item
Location
Budget

Example:

FIND
Toyota Axio
Nairobi
900000
`
    );
  }
);

// =========================
// START SERVER
// =========================

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  () => {
    console.log(
      `🚀 JR PHEEF running on port ${PORT}`
    );
  }
);
