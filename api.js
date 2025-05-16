const express = require('express');
const bodyParser = require('body-parser');

const webApp = express();
webApp.use(bodyParser.json({ limit: '10mb' }));

let sopFiles = {}; // In-memory SOP storage

webApp.post('/sync-sops', (req, res) => {
  const files = req.body.files;

  if (!files || !Array.isArray(files)) {
    return res.status(400).json({ error: 'Invalid file data' });
  }

  sopFiles = {};
  files.forEach(file => {
    sopFiles[file.filename] = file.content;
  });

  console.log(`✅ Received ${files.length} SOP files`);
  res.json({ message: 'SOPs synced successfully' });
});

webApp.listen(process.env.PORT || 3000, () => {
  console.log('✅ Web API server is running...');
});
