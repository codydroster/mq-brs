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
const PARENTS_FILE = path.join(__dirname, 'parents.json');

function isValidName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_-]+$/.test(name);
}

function isValidParentName(name) {
  return typeof name === 'string' && name.trim().length > 0 && name.length <= 50;
}

function readCategory(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function readParents() {
  try {
    return JSON.parse(fs.readFileSync(PARENTS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

// Get parent assignments
app.get('/parents', (req, res) => {
  res.json(readParents());
});

// Set a category's parent
app.post('/parents', (req, res) => {
  const { category, parent } = req.body;
  if (!isValidName(category)) return res.status(400).json({ error: 'Invalid category name' });
  if (parent && !isValidParentName(parent)) return res.status(400).json({ error: 'Invalid parent name' });
  const parents = readParents();
  if (parent) {
    parents[category] = parent.trim();
  } else {
    delete parents[category];
  }
  fs.writeFileSync(PARENTS_FILE, JSON.stringify(parents, null, 2));
  res.json({ success: true });
});

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

// Rename category and/or update its parent
app.patch('/category/:name', (req, res) => {
  if (!isValidName(req.params.name)) return res.status(400).json({ error: 'Invalid category name' });
  const { newName, parent } = req.body;
  let currentName = req.params.name;

  if (newName !== undefined) {
    if (!isValidName(newName)) return res.status(400).json({ error: 'Invalid new name' });
    const oldPath = path.join(DATA_DIR, `${currentName}.json`);
    const newPath = path.join(DATA_DIR, `${newName}.json`);
    if (fs.existsSync(newPath)) return res.status(409).json({ error: 'Category already exists' });
    fs.renameSync(oldPath, newPath);
    const parents = readParents();
    if (parents[currentName] !== undefined) {
      parents[newName] = parents[currentName];
      delete parents[currentName];
      fs.writeFileSync(PARENTS_FILE, JSON.stringify(parents, null, 2));
    }
    currentName = newName;
  }

  if (parent !== undefined) {
    const parents = readParents();
    if (parent) {
      if (!isValidParentName(parent)) return res.status(400).json({ error: 'Invalid parent name' });
      parents[currentName] = parent.trim();
    } else {
      delete parents[currentName];
    }
    fs.writeFileSync(PARENTS_FILE, JSON.stringify(parents, null, 2));
  }

  res.json({ success: true, name: currentName });
});

// Rename a subcategory across all bins in a category
app.patch('/category/:name/subcategory', (req, res) => {
  if (!isValidName(req.params.name)) return res.status(400).json({ error: 'Invalid category name' });
  const { from, to } = req.body;
  if (typeof from !== 'string' || typeof to !== 'string' || !to.trim()) {
    return res.status(400).json({ error: 'Invalid subcategory names' });
  }
  const filePath = path.join(DATA_DIR, `${req.params.name}.json`);
  const bins = readCategory(filePath);
  if (bins === null) return res.status(404).json({ error: 'Category not found' });
  const updated = bins.map(bin =>
    (bin.subcategory || 'Uncategorized') === from ? { ...bin, subcategory: to.trim() } : bin
  );
  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
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
  console.log('WS client connected');
  ws.on('message', (raw) => {
    try {
      const { topic, payload } = JSON.parse(raw);
      console.log(`WS → MQTT: ${topic}`, payload);
      if (typeof topic === 'string' && payload) {
        mqttClient.publish(topic, JSON.stringify(payload));
      }
    } catch (e) {
      console.error('WS message parse error:', e);
    }
  });
  ws.on('close', () => console.log('WS client disconnected'));
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
