const http = require('node:http');

const { createApp } = require('./app');

const port = Number(process.env.PORT || 3000);
const server = http.createServer(createApp());

server.listen(port, () => {
  console.log(`Jiangjiu API listening on http://localhost:${port}`);
});
