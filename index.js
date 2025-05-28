const { App } = require('@slack/bolt');
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai'); // ✅ Correct SDK v4 import

// 🔹 Slack App Setup
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// 🔹 OpenAI Setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
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

  // Always try to parse input with GPT
  let parsed;
  try {
    const gptRes = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: "Extract the 'cabin' and 'issue' from the message. Respond ONLY in JSON like this:\n\n{ \"cabin\": \"Casa Amore\", \"issue\": \"Fireplace won’t turn on\" }"
        },
        { role: 'user', content: text }
      ]
    });

    parsed = JSON.parse(gptRes.choices[0].message.content);

    if (parsed?.cabin && parsed?.issue) {
      openTickets[userId] = {
        step: 'submitted',
        cabin: parsed.cabin,
        issue: parsed.issue
      };
    }
  } catch (err) {
    console.log('❌ GPT failed to parse message:', err);
  }

  if (!openTickets[userId]) {
    openTickets[userId] = { step: 'awaiting_details' };
    await say(`Hi there <@${userId}>! 👋 Please paste the guest's message and let me know which cabin this is for.`);
    return;
  }

  if (openTickets[userId].step === 'awaiting_details') {
    await say("Hmm... I couldn’t extract details. Please try something like:\n\n*Cabin:* Casa Amore\n*Issue:* Guest said fireplace won’t turn on.");
    return;
  }

  if (openTickets[userId].step === 'submitted') {
    const ticket = openTickets[userId];

    try {
      await axios.post('https://script.google.com/macros/s/AKfycbwKlvjSioT753iSqy7TI0zd3Tc4KiefbhPxudRAa6Xgl88whFmtUU3dqyD1Nntz680g/exec', {
        issueDetails: ticket.issue,
        cabinName: ticket.cabin,
        userEmail: `${userId}@slack.user`
      });

      await say(`📝 Got it. I’ve saved this issue under *${ticket.cabin}* and will check SOPs now...`);

      const normalize = str =>
        str.toLowerCase()
           .replace(/[‘’“”]/g, "'")
           .replace(/[–—]/g, '-')
           .replace(/[^\w\s]/g, '');

      const keywords = normalize(ticket.issue).split(/\s+/);
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
          if (line.toLowerCase().includes(ticket.cabin.toLowerCase())) {
            collecting = true;
            relevant = true;
            buffer.push(line);
            continue;
          }

          if (collecting) {
            if (line.trim().startsWith('Task:') && !line.toLowerCase().includes(ticket.cabin.toLowerCase())) {
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

        await say(`📄 From *${matchedFile}*, here’s the info I found for *${ticket.cabin}*:\n\n${formatted}`);
        if (cleanPwd) {
          await say(`💬 Suggested reply to guest: "The WiFi password for ${ticket.cabin} is listed here: ${cleanPwd}."`);
        }
      } else {
        const gptResponse = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: 'You are a helpful, inquisitive customer support assistant for a short-term rental company. Ask follow-up questions and try to guide the CSR toward a resolution.' },
            { role: 'user', content: `A guest at ${ticket.cabin} reported: "${ticket.issue}". No SOPs were found. Ask the CSR clarifying questions or suggest what they should try first.` }
          ]
        });

        const reply = gptResponse.choices[0].message.content;
        await say(`🤖 GPT Suggestion:\n${reply}`);
      }

    } catch (err) {
      console.error('❌ Error saving or searching:', err);
      await say("⚠️ Something went wrong. Let Jake know.");
    }
  }
});

// 🔹 Start Sol
(async () => {
  loadSOPFiles();
  await app.start();
  console.log('⚡ Sol is up and running!');
})();
