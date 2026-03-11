const http = require('http');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { client: mqttClient, setBroadcast } = require('./mqttClient');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const DATA_DIR = path.join(__dirname, 'bins');

function isValidName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_-]+$/.test(name);
}

function readCategory(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

// List all categories
app.get('/categories', (req, res) => {
  fs.readdir(DATA_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: 'Failed to read categories' });
    const categories = files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
    res.json(categories);
  });
});

// Add new category
app.post('/categories', (req, res) => {
  const { name } = req.body;
  if (!isValidName(name)) return res.status(400).json({ error: 'Invalid category name' });
  const filePath = path.join(DATA_DIR, `${name}.json`);
  if (readCategory(filePath) !== null) return res.status(409).json({ error: 'Category already exists' });
  fs.writeFileSync(filePath, JSON.stringify([], null, 2));
  res.json({ success: true });
});

// Get bins in category
app.get('/category/:name', (req, res) => {
  if (!isValidName(req.params.name)) return res.status(400).json({ error: 'Invalid category name' });
  const bins = readCategory(path.join(DATA_DIR, `${req.params.name}.json`));
  res.json(bins ?? []);
});

// Add new bin to category
app.post('/category/:name', (req, res) => {
  if (!isValidName(req.params.name)) return res.status(400).json({ error: 'Invalid category name' });
  const filePath = path.join(DATA_DIR, `${req.params.name}.json`);
  const newBin = req.body;
  if (!('request' in newBin)) newBin.request = 'no';
  if (!('store' in newBin)) newBin.store = 'no';
  const bins = readCategory(filePath) ?? [];
  bins.push(newBin);
  fs.writeFileSync(filePath, JSON.stringify(bins, null, 2));
  res.json({ success: true });
});

// Update all bins in category
app.put('/category/:name', (req, res) => {
  if (!isValidName(req.params.name)) return res.status(400).json({ error: 'Invalid category name' });
  const filePath = path.join(DATA_DIR, `${req.params.name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});

// WebSocket server (shares port with Express)
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

setBroadcast(broadcast);

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try {
      const { topic, payload } = JSON.parse(raw);
      if (typeof topic === 'string' && payload) {
        mqttClient.publish(topic, JSON.stringify(payload));
      }
    } catch (e) {
      console.error('WS message parse error:', e);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
