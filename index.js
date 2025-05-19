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

// 🔹 Normalize text for better matching
function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'") // curly quotes
    .replace(/[–—]/g, '-')                     // en/em dashes
    .replace(/[^\w\s]/g, '');                  // remove punctuation
}

// 🔹 Slack Message Handler
app.message(async ({ message, say }) => {
  const userId = message.user;
  const text = message.text.trim();

  // Reset flow on "Hi Sol", "Hello", etc.
  if (/^hi|hello|hey|sol/i.test(text)) {
    openTickets[userId] = { step: 'awaiting_details' };
    await say(`Hi there <@${userId}>! 👋 Please paste the guest's message and tell me which cabin this is for.`);
    return;
  }

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

      // Match issue keywords to SOP files
      let matchedFile = null;
      let matchText = '';
      const keywords = normalize(parsed.issue).split(/\s+/);
      const targetCabin = normalize(parsed.cabin);

      for (const [filename, content] of Object.entries(sopFiles)) {
        const normalizedContent = normalize(content);
        const hasKeyword = keywords.some(word => normalizedContent.includes(word));
        const mentionsCabin = normalizedContent.includes(targetCabin);

        if (hasKeyword && mentionsCabin) {
          matchedFile = filename;

          // Extract relevant section for the cabin only
          const regex = new RegExp(`(?<=Task:\\s*${parsed.cabin})([\\s\\S]*?)(?=Task:|$)`, 'i');
          const match = content.match(regex);
          matchText = match ? match[0].trim() : content;

          break;
        }
      }

      if (matchedFile) {
        await say(`📄 From *${matchedFile}*, here's the info I found for *${parsed.cabin}*:\n\n\`\`\`${matchText.substring(0, 500)}...\`\`\``);
        await say(`💬 Suggested reply to guest: "The WiFi password for ${parsed.cabin} is listed here: ${matchText.match(/wifi_password\d*:\s*([^\s]+)/i)?.[1] || '[not found]'}."`);
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
