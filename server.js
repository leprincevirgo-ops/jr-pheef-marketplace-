const express = require('express');

const app = express();

app.get('/', (req, res) => {
  res.send('🚀 JR PHEEF IS LIVE - Find. Match. Trade.');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`JR PHEEF running on port ${PORT}`);
});
