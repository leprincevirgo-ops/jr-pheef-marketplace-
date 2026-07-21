const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// Save a listing to Supabase
async function saveListing(message, phone) {
  try {
    const lines = message.split("\n");

    const item = lines[1] || "";
    const priceText = lines[2] || "";
    const town = lines[3] || "";

    const price = parseInt(priceText.replace(/[^0-9]/g, "")) || null;

    const { error } = await supabase
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
      ]);

    if (error) {
      console.error(error);
      return false;
    }

    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}
    // End of saveListing()
async function findListings(item, location, budget) {
  let query = supabase
    .from("listings")
    .select("*")
    .eq("status", "ACTIVE");

  if (item) {
    query = query.ilike("item_name", `%${item}%`);
  }

  if (location) {
    query = query.ilike("location", `%${location}%`);
  }

  if (budget) {
    query = query.lte("price", budget);
  }

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return [];
  }

  return data;
      }
async function createDealRoom(listing, buyerPhone) {
  const { data, error } = await supabase
    .from("deal_rooms")
    .insert([
      {
        listing_id: listing.id,
        buyer_phone: buyerPhone,
        seller_phone: listing.phone,
        status: "negotiating",
        buyer_paid: false,
        seller_paid: false
      }
    ])
    .select()
    .single();

  if (error) {
    console.error(error);
    return null;
  }

  return data;
}
async function getDealRoom(roomId) {
  const { data, error } = await supabase
    .from("deal_rooms")
    .select("*")
    .eq("id", roomId)
    .single();

  if (error) {
    console.error(error);
    return null;
  }

  return data;
}
async function saveMessage(roomId, senderPhone, message) {
  const { error } = await supabase
    .from("messages")
    .insert([{
      room_id: roomId,
      sender_phone: senderPhone,
      message: message
    }]);

  if (error) {
    console.error(error);
    return false;
  }

  return true;
}
async function updateAgreement(roomId, phone) {
  const room = await getDealRoom(roomId);

  if (!room) return null;

  const updates = {};

  if (phone === room.buyer_phone) {
    updates.buyer_agreed = true;
  } else if (phone === room.seller_phone) {
    updates.seller_agreed = true;
  }

  const { data, error } = await supabase
    .from("deal_rooms")
    .update(updates)
    .eq("id", roomId)
    .select()
    .single();

  if (error) {
    console.error(error);
    return null;
  }

  return data;
            }
async function updatePayment(roomId, phone) {
  const room = await getDealRoom(roomId);

  if (!room) return null;

  const updates = {};

  if (phone === room.buyer_phone) {
    updates.buyer_paid = true;
  } else if (phone === room.seller_phone) {
    updates.seller_paid = true;
  }

  const { data, error } = await supabase
    .from("deal_rooms")
    .update(updates)
    .eq("id", roomId)
    .select()
    .single();

  if (error) {
    console.error(error);
    return null;
  }

  return data;
  }
app.get("/", (req, res) => {
  res.send("🚀 JR PHEEF Marketplace is LIVE");
});

app.post("/api/webhook/whatsapp", async (req, res) => {

  console.log("Webhook received");

  const message = (req.body.Body || "").trim();
  const phone = (req.body.From || "").replace("whatsapp:", "");
if (message.toUpperCase().startsWith("CHAT ")) {
  const lines = message.split("\n");
  const roomId = lines[0].replace(/^CHAT\s+/i, "").trim();
  const chatMessage = lines.slice(1).join("\n").trim();

  if (!chatMessage) {
    return res.send("Please type your message after the room ID.");
  }

const room = await getDealRoom(roomId);

if (!room) {
  return res.send("Deal Room not found.");
}

await saveMessage(roomId, phone, chatMessage);
const recipient =
  phone === room.buyer_phone
    ? room.seller_phone
    : room.buyer_phone;
  console.log("Sender:", phone);
console.log("Buyer:", room.buyer_phone);
console.log("Seller:", room.seller_phone);
console.log("Recipient:", recipient);
await client.messages.create({
  from: process.env.TWILIO_WHATSAPP_NUMBER,
  to: `whatsapp:${recipient}`, 
  body:
`💬 Deal Room

${chatMessage}

Reply:

CHAT ${roomId}`
});

return res.send("✅ Message sent.");
}
  if (message.toUpperCase().startsWith("AGREE ")) {

  const roomId = message.replace(/^AGREE\s+/i, "").trim();

  const room = await updateAgreement(roomId, phone);

  if (!room) {
    return res.send("Deal Room not found.");
  }

  if (room.buyer_agreed && room.seller_agreed) {

    return res.send(`
🎉 Both buyer and seller have agreed!

To unlock each other's contact details:

💰 Pay KSh 30 via M-Pesa.

Reply with:

PAID ${roomId}

after payment.
`);
  }

  return res.send(`
✅ Your agreement has been recorded.

Waiting for the other party to agree.
`);
            }
  if (message.toUpperCase().startsWith("PAID ")) {

  const roomId = message.replace(/^PAID\s+/i, "").trim();

  const room = await updatePayment(roomId, phone);

  if (!room) {
    return res.send("Deal Room not found.");
  }

  if (room.buyer_paid && room.seller_paid) {

    return res.send(`
🎉 Payment confirmed!

Buyer: ${room.buyer_phone}

Seller: ${room.seller_phone}

You may now continue your transaction directly.

Thank you for using JR PHEEF Marketplace.
`);
  }

  return res.send(`
✅ Payment recorded.

Waiting for the other party to pay.
`);
  }
  let reply =
`👋 Welcome to JR PHEEF Marketplace

Reply with:

SELL
BUY`;

if (message.toUpperCase().startsWith("BUY")) {

    const lines = message.split("\n");

    const item = lines[1] || "";
    const location = lines[2] || "";
    const budget = parseInt((lines[3] || "").replace(/[^0-9]/g, "")) || null;

    const results = await findListings(item, location, budget);

    if (results.length > 0) {
        const first = results[0];

  const room = await createDealRoom(first, phone);
if (room) {
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to: `whatsapp:${first.phone}`,
    body: `🎉 A buyer has been matched with your listing.

Your secure Deal Room is ready.

Reply:

CHAT ${room.id}

to start negotiating safely.`
  });
}
if (room) {
  reply = `
✅ Match Found!

Item: ${first.item_name}
Price: KSh ${first.price}
Location: ${first.location}

A secure Deal Room has been created.

Reply:

CHAT ${room.id}

to begin negotiating safely.

🔒 JR PHEEF will keep both buyer and seller anonymous until both pay the KSh 30 connection fee.
`;
} else {
  reply = `
❌ We found a seller but could not create a Deal Room.

Please try again.
`;
          }
    } else {
        reply =
`😔 No matching items found.

We will notify you when a seller lists one.`;
    }
  } else if (message.toUpperCase().startsWith("SELL")) {

    const saved = await saveListing(message, phone);

    if (saved) {

      reply =
`✅ Your item has been received!

JR PHEEF is now matching you with buyers.

Thank you for using JR PHEEF Marketplace.`;

    } else {

      reply =
`❌ Sorry.

We could not save your listing.

Please try again.`;
    }
  }

  res.set("Content-Type", "text/xml");

  res.send(`
<Response>
<Message>${reply}</Message>
</Response>
`);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`JR PHEEF running on port ${PORT}`);
});
