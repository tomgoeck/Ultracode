const http = require('http');

const PORT = process.env.PORT || 3000;

const requestHandler = (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Testwebsite läuft\n');
};

const server = http.createServer(requestHandler);

server.listen(PORT, () => {
  // Server is listening on specified port
  console.log(`Server läuft auf Port ${PORT}`);
});