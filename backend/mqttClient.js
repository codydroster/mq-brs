require('dotenv').config();
const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');

// MQTT connection config
const client = mqtt.connect(process.env.MQTT_BROKER, {
  port: Number(process.env.MQTT_PORT),
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
});

let broadcast = () => {};
function setBroadcast(fn) { broadcast = fn; }

// Path to bin category files
const BINS_DIR = path.join(__dirname, 'bins');

client.on('connect', () => {
  console.log('✅ Connected to MQTT broker');
  client.subscribe('bins/update', err => {
    if (err) {
      console.error('❌ Failed to subscribe:', err);
    } else {
      console.log('📡 Subscribed to bins/update');
    }
  });
});

client.on('message', (topic, message) => {
  if (topic === 'bins/update') {
    try {
      const payload = JSON.parse(message.toString());
      const { barcode, status, request, store } = payload;

      if (typeof barcode !== 'string') {
        console.warn('⚠️ Invalid barcode format. Skipping update.');
        return;
      }

      const validStatus = ['in', 'out'].includes(status);
      const validRequest = ['yes', 'no'].includes(request);
      const validStore = ['yes', 'no'].includes(store);

      const fields = {
        ...(validStatus ? { status } : {}),
        ...(validRequest ? { request } : {}),
        ...(validStore ? { store } : {})
      };
      updateBinFields(barcode.trim(), fields);
      broadcast({ barcode, ...fields });
    } catch (err) {
      console.error('❌ MQTT message parse error:', err);
    }
  }
});

function reorderFields(bin) {
  return {
    name: bin.name || '',
    subcategory: bin.subcategory || '',
    barcode: bin.barcode || '',
    status: bin.status || 'in',
    request: bin.request || 'no',
    store: bin.store || 'no'
  };
}

function updateBinFields(barcode, fieldsToUpdate) {
  const files = fs.readdirSync(BINS_DIR).filter(f => f.endsWith('.json'));
  console.log(`🔍 Searching for barcode "${barcode}" in:`, files);

  for (const file of files) {
    const filePath = path.join(BINS_DIR, file);
    let bins;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      bins = JSON.parse(raw);
    } catch (err) {
      console.error(`❌ Failed to read ${file}:`, err);
      continue;
    }

    bins.forEach(b => console.log(`   ↪︎ Found in file: ${b.name} [${b.barcode}]`));

    const index = bins.findIndex(b => b.barcode === barcode);
    if (index !== -1) {
      let updated = false;

      for (const key in fieldsToUpdate) {
        if (bins[index][key] !== fieldsToUpdate[key]) {
          bins[index][key] = fieldsToUpdate[key];
          updated = true;
        }
      }

      if (updated) {
        try {
          bins[index] = reorderFields(bins[index]);
          fs.writeFileSync(filePath, JSON.stringify(bins, null, 2));
          console.log(`✅ Updated bin "${barcode}" in ${file}:`, fieldsToUpdate);
        } catch (err) {
          console.error(`❌ Failed to write to ${file}:`, err);
        }
      } else {
        console.log(`ℹ️ Bin "${barcode}" already has up-to-date fields.`);
      }

      return;
    }
  }

  console.warn(`⚠️ Barcode "${barcode}" not found in any category file.`);
}

module.exports = { client, setBroadcast };
