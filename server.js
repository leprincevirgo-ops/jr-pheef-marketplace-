const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);
async function saveListing(item, location, phone) {
  const { error } = await supabase
    
  .from('listings')
  .insert([
    {
      item_name: item,
      phone: phone
    }
  ]); 
  if (error) {
    console.error(error);
  }
}
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('🚀 JR PHEEF IS LIVE - Find. Match. Trade.');
});

app.post('/api/webhook/whatsapp', async (req, res) => {
  console.log("WEBHOOK HIT!");
  console.log(req.body);

  const incomingMessage = req.body.Body || '';

  console.log('WhatsApp Message:', incomingMessage);

  let reply =
    '👋 Welcome to JR PHEEF.\n\nFind. Match. Trade.\n\nSend:\nBUY - if you are looking for something\nSELL - if you are selling something';
if (incomingMessage.toUpperCase().includes('BUY')) {
  reply =
    '🛒 What are you looking for? Tell JR PHEEF the item and your location.';
      }
if (incomingMessage.toUpperCase().includes('SELL')) {
  const phone = req.body.From;
  await saveListing(incomingMessage, "Unknown", phone);

  reply =
    '✅ Your item has been received by JR PHEEF!\n\nOur marketplace is matching you with buyers.';
}
  res.set('Content-Type', 'text/xml');

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
