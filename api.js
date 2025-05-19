const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const webApp = express();
webApp.use(bodyParser.json({ limit: '10mb' }));

const SOP_FILE_PATH = path.join(__dirname, 'sops.json');

webApp.post('/sync-sops', (req, res) => {
  const files = req.body.files;

  if (!files || !Array.isArray(files)) {
    return res.status(400).json({ error: 'Invalid file data' });
  }

  fs.writeFileSync(SOP_FILE_PATH, JSON.stringify(files, null, 2));
  console.log(`✅ Stored ${files.length} SOPs to sops.json`);
  res.json({ message: 'SOPs saved successfully' });
});

webApp.get('/sync-sops', (req, res) => {
  try {
    const data = fs.readFileSync(SOP_FILE_PATH, 'utf8');
    const files = JSON.parse(data);
    res.json(files);
  } catch (err) {
    console.error("❌ Failed to read SOPs:", err);
    res.status(500).json({ error: 'Failed to load SOPs' });
  }
});

webApp.listen(process.env.PORT || 3000, () => {
  console.log('✅ Web API server is running...');
});
