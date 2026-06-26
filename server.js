const express = require("express");
const { createClient } = require("@supabase/supabase-js");

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

app.get("/", (req, res) => {
  res.send("🚀 JR PHEEF Marketplace is LIVE");
});

app.post("/api/webhook/whatsapp", async (req, res) => {

  console.log("Webhook received");

  const message = (req.body.Body || "").trim();
  const phone = req.body.From || "";

  let reply =
`👋 Welcome to JR PHEEF Marketplace

Reply with:

SELL
BUY`;

  if (message.toUpperCase() === "BUY") {

    reply =
`🛒 Tell us what you are looking for.

Example:

Toyota Axio
Nairobi`;

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
