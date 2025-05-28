const { App } = require('@slack/bolt');
require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

// 🔹 Slack App Setup
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// 🔹 OpenAI Setup (SDK v4)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const openTickets = {};
let sopFiles = {};

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

app.message(async ({ message, say }) => {
  const userId = message.user;
  const text = message.text.trim();

  if (!openTickets[userId]) {
    // Let GPT try to extract intent
    try {
      const gptRes = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: "Extract the 'cabin' and 'issue' from the message. Respond ONLY in JSON like this: { \"cabin\": \"Casa Amore\", \"issue\": \"Fireplace won’t turn on\" }"
          },
          { role: 'user', content: text }
        ]
      });

      const parsed = JSON.parse(gptRes.choices[0].message.content);

      if (parsed?.cabin && parsed?.issue) {
        openTickets[userId] = {
          step: 'submitted',
          cabin: parsed.cabin,
          issue: parsed.issue,
          context: [
            { role: 'system', content: 'You are a helpful, conversational assistant that helps CSRs troubleshoot guest issues. Only ask 1–2 questions at a time. Reference SOPs if possible, and otherwise ask helpful probing questions.' },
            { role: 'user', content: `Guest at ${parsed.cabin} says: ${parsed.issue}` }
          ]
        };
      }
    } catch (err) {
      console.error('❌ GPT failed to parse:', err);
      openTickets[userId] = { step: 'awaiting_details' };
      await say(`Hi <@${userId}>! I didn’t catch the cabin or issue. Could you let me know what guest issue you're working on?`);
      return;
    }
  }

  const ticket = openTickets[userId];

  if (ticket.step === 'submitted') {
    try {
      await axios.post('https://script.google.com/macros/s/AKfycbwKlvjSioT753iSqy7TI0zd3Tc4KiefbhPxudRAa6Xgl88whFmtUU3dqyD1Nntz680g/exec', {
        issueDetails: ticket.issue,
        cabinName: ticket.cabin,
        userEmail: `${userId}@slack.user`
      });

      await say(`📝 Got it. I’ve saved this issue under *${ticket.cabin}* and will check SOPs now...`);

      const normalize = str =>
        str.toLowerCase().replace(/[‘’“”]/g, "'").replace(/[–—]/g, '-').replace(/[^\w\s]/g, '');
      const keywords = normalize(ticket.issue).split(/\s+/);
      let matchedFile = null;
      let matchedLines = [];

      for (const [filename, content] of Object.entries(sopFiles)) {
        const normalizedContent = normalize(content);
        const keywordMatch = keywords.some(word => normalizedContent.includes(word));
        if (!keywordMatch) continue;

        const lines = content.split(/\r?\n/);
        let buffer = [], relevant = false, collecting = false;

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

        await say(`📄 From *${matchedFile}*, here’s the info I found for *${ticket.cabin}*:

${formatted}`);
      } else {
        await say(`🕵️ I couldn’t find any SOP files regarding the issue. Let’s see if we can figure this out together.`);

        const gptResponse = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: ticket.context
        });

        const reply = gptResponse.choices[0].message.content;
        ticket.context.push({ role: 'assistant', content: reply });
        await say(reply);
      }
    } catch (err) {
      console.error('❌ Error handling message:', err);
      await say("⚠️ Something went wrong. Let Jake know.");
    }
  } else if (ticket.step === 'awaiting_details') {
    await say("I couldn’t extract details. Please format it like this:\n*Cabin:* Casa Amore\n*Issue:* Fireplace won’t turn on.");
  } else {
    // Continuing the conversation if it's already started
    ticket.context.push({ role: 'user', content: text });
    const followup = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: ticket.context
    });
    const reply = followup.choices[0].message.content;
    ticket.context.push({ role: 'assistant', content: reply });
    await say(reply);
  }
});

(async () => {
  loadSOPFiles();
  await app.start();
  console.log('⚡ Sol is up and running!');
})();
