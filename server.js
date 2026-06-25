const express = require('express');

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('🚀 JR PHEEF IS LIVE - Find. Match. Trade.');
});

app.post('/api/webhook/whatsapp', (req, res) => {
  const incomingMessage = req.body.Body || '';

  console.log('WhatsApp Message:', incomingMessage);

  let reply =
    '👋 Welcome to JR PHEEF.\n\nFind. Match. Trade.\n\nSend:\nBUY - if you are looking for something\nSELL - if you are selling something';

  if (incomingMessage.toUpperCase().includes('BUY')) {
    reply =
      '🛒 What are you looking for? Tell JR PHEEF the item and your location.';
  }

  if (incomingMessage.toUpperCase().includes('SELL')) {
    reply =
      '📦 What are you selling? Send item name, price and location.';
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
