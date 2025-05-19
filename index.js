const { App } = require('@slack/bolt');
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 🔹 Slack App Setup
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// 🔹 Track open conversations
const openTickets = {};
let sopFiles = {}; // In-memory SOPs

// 🔹 Load SOPs from /sops directory on startup
function loadSOPFiles() {
  const sopsDir = path.join(__dirname, 'sops');
  const files = fs.readdirSync(sopsDir).filter(file => file.endsWith('.txt'));

  files.forEach(file => {
    const filePath = path.join(sopsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    sopFiles[file] = content;
  });

  console.log(`📁 Loaded ${files.length} SOP files:`, Object.keys(sopFiles));
}

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

      const normalize = str =>
        str
          .toLowerCase()
          .replace(/[‘’“”]/g, "'")
          .replace(/[–—]/g, '-')
          .replace(/[^\w\s]/g, '');

      const keywords = normalize(parsed.issue).split(/\s+/);
      console.log('🔍 Keywords:', keywords);

      let matchedFile = null;
      let matchedLines = [];

      for (const [filename, content] of Object.entries(sopFiles)) {
        const normalizedContent = normalize(content);
        const keywordMatch = keywords.some(word => normalizedContent.includes(word));
        if (!keywordMatch) continue;

        const lines = content.split(/\r?\n/);
        let relevant = false;
        let collecting = false;
        let buffer = [];

        for (const line of lines) {
          if (line.toLowerCase().includes(parsed.cabin.toLowerCase())) {
            collecting = true;
            relevant = true;
            buffer.push(line);
            continue;
          }

          if (collecting) {
            if (line.trim().startsWith('Task:') && !line.toLowerCase().includes(parsed.cabin.toLowerCase())) {
              collecting = false;
              break;
            }
            buffer.push(line);
          }
        }

        if (relevant && buffer.length > 0) {
          matchedFile = filename;
          matchedLines = buffer;
          break;
        }
      }

      if (matchedFile) {
        const formatted = matchedLines
          .map(line => {
            if (line.toLowerCase().includes('wifi_network_name')) return `*WiFi Network*: ${line.split(':')[1].trim()}`;
            if (line.toLowerCase().includes('wifi_password')) return `*Password*: ${line.split(':')[1].trim()}`;
            return `_${line.trim()}_`;
          })
          .join('\n');

        const passwordLine = matchedLines.find(l => l.toLowerCase().includes('wifi_password'));
        const cleanPwd = passwordLine ? passwordLine.split(':')[1].trim() : null;

        await say(`📄 From *${matchedFile}*, here's the info I found for *${parsed.cabin}*:\n\n${formatted}`);
        if (cleanPwd) {
          await say(`💬 Suggested reply to guest: "The WiFi password for ${parsed.cabin} is listed here: ${cleanPwd}."`);
        }
      } else {
        await say("🤔 I didn’t find anything in the SOPs for that issue. I’ll try using GPT next.");
      }

    } catch (err) {
      console.error('❌ Error saving or searching:', err);
      await say("⚠️ Something went wrong. Let Jake know.");
    }
  }
});

// 🔹 Extract cabin and issue from Slack message
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

// 🔹 Start Sol
(async () => {
  loadSOPFiles();
  await app.start();
  console.log('⚡ Sol is up and running!');
})();
