const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(require('path').resolve(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  // Server started message with port information
  // Helps confirm the app is running and accessible
  // Keeps it simple for initial development and testing
  // Can be extended with logging or environment info later
  // Minimal and consistent with typical express apps
  /* eslint-disable no-console */
  console.log(`Testwebsite server listening on port ${PORT}`);
});