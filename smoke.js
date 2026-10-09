require('dotenv').config();
const http = require('http');
const PORT = process.env.PORT || 3010;

const server = require('./src/index.js');

function ping(path, cb) {
  http.get({ host: '127.0.0.1', port: PORT, path }, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => cb(null, res.statusCode, d));
  }).on('error', cb);
}

setTimeout(() => {
  ping('/health', (e, s, b) => {
    console.log('HEALTH', s, b.slice(0, 120));
    if (e) { console.log('ERR', e.message); process.exit(1); }
    process.exit(s === 200 ? 0 : 1);
  });
}, 1200);
