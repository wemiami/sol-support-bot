const { App } = require('@slack/bolt');
require('dotenv').config();
const axios = require('axios');
const express = require('express');
const bodyParser = require('body-parser');

// 🔹 Slack App Setup
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// 🔹 Track open conversations
const openTickets = {};

// 🔹 In-memory SOP file store
let sopFiles = {};

// 🔹 Slack Message Handler
app.message(async ({ message, say }) => {
  const userId = message.user;
  const text = message.text.trim();

  if (!openTickets[userId]) {
    openTickets[userId] = { step: 'awaiting_details' };
    await say(`Hi there <@${userId}>! 👋 Please paste the guest's message and tell me which cabin this is for.`);
    return;
  }

  if (openTickets[userId].step === 'awaiting_details') {
    const parsed = parseIssueInput(text);
    if (!parsed) {
      await say("Hmm... I couldn't understand that. Please format like this:\n\n*Cabin:* Casa Amore\n*Issue:* Guest said fireplace won't turn on.");
      return;
    }

    openTickets[userId] = {
      ...openTickets[userId],
      step: 'submitted',
      issue: parsed.issue,
      cabin: parsed.cabin
    };

    try {
      await axios.post('https://script.google.com/macros/s/AKfycbwKlvjSioT753iSqy7TI0zd3Tc4KiefbhPxudRAa6Xgl88whFmtUU3dqyD1Nntz680g/exec', {
        issueDetails: parsed.issue,
        cabinName: parsed.cabin,
        userEmail: `${userId}@slack.user`
      });

      await say(`📝 Got it. I’ve saved this issue under *${parsed.cabin}* and will check SOPs now...`);

      // SOP Search
      console.log("🗂️ Loaded SOP files:", Object.keys(sopFiles));
      let matchedFile = null;
      let matchText = '';

      const normalize = str => str.toLowerCase().replace(/[\u2018\u2019\u201C\u201D]/g, "'");
      const keywords = normalize(parsed.issue).split(/\s+/);

      for (const [filename, content] of Object.entries(sopFiles)) {
        const normalizedContent = normalize(content);
        const matchFound = keywords.some(word => normalizedContent.includes(word));
        if (matchFound) {
          matchedFile = filename;
          matchText = content;
          break;
        }
      }

      if (matchedFile) {
        await say(`📄 I found something in *${matchedFile}* that might help:\n\n\`\`\`${matchText.substring(0, 500)}...\`\`\``);
      } else {
        await say("🤔 I didn’t find anything in the SOPs for that issue. I’ll try using GPT next.");
      }

    } catch (err) {
      console.error('❌ Error saving or searching:', err);
      await say("⚠️ Something went wrong. Let Jake know.");
    }

    return;
  }
});

// 🔹 Parse cabin + issue from message
function parseIssueInput(text) {
  const cabinMatch = text.match(/Cabin:\s*(.+)/i);
  const issueMatch = text.match(/Issue:\s*(.+)/i);

  if (cabinMatch && issueMatch) {
    return {
      cabin: cabinMatch[1].trim(),
      issue: issueMatch[1].trim()
    };
  }
  return null;
}

// 🔹 Express Server for syncing SOPs
const webApp = express();
webApp.use(bodyParser.json({ limit: '10mb' }));

webApp.post('/sync-sops', (req, res) => {
  const files = req.body.files;

  if (!files || !Array.isArray(files)) {
    return res.status(400).json({ error: 'Invalid file data' });
  }

  sopFiles = {};
  files.forEach(file => {
    sopFiles[file.filename] = file.content;
  });

  console.log(`✅ Stored ${files.length} SOPs to memory`);
  res.json({ message: 'SOPs synced successfully' });
});

webApp.get('/sync-sops', (req, res) => {
  res.json(sopFiles);
});

// 🔹 Start everything
(async () => {
  await app.start();
  console.log('⚡ Sol is up and running!');
  webApp.listen(process.env.PORT || 3000, () => {
    console.log('✅ Web API server is running...');
  });
})();
