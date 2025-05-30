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

function normalize(str) {
  return str.toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[^     .replace(/[^\x20-~    .replace(/[^\x20-\x7E]+/g, '')
    .replace(/[^\w\s]/g, '');
}

app.message(async ({ message, say }) => {
  const userId = message.user;
  const text = message.text.trim();
  const ticket = openTickets[userId] || { step: 'awaiting_details', context: [] };

  try {
    if (!openTickets[userId] && /^hi\b|^hello\b|^hey\b/i.test(text)) {
      await say("Hey there! What issue can I assist with?");
      return;
    }

    if (!openTickets[userId]) {
      const gptRes = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: "Extract the guest issue and cabin from a casual support message. Respond conversationally. Just explain what you're able to extract. Do not use JSON." },
          { role: 'user', content: text }
        ]
      });

      const reply = gptRes.choices[0].message.content;
      ticket.context.push({ role: 'user', content: text });
      ticket.context.push({ role: 'assistant', content: reply });
      ticket.step = 'submitted';

      const cabinMatch = text.match(/(?:cabin|at)[:\-\s]*([a-zA-Z0-9' ]+)/i);
      const issueMatch = text.match(/issue[:\-\s]*(.*)/i);
      ticket.cabin = cabinMatch ? cabinMatch[1].trim() : 'Unknown';
      ticket.issue = issueMatch ? issueMatch[1] : text;

      openTickets[userId] = ticket;

      await axios.post('https://script.google.com/macros/s/AKfycbwKlvjSioT753iSqy7TI0zd3Tc4KiefbhPxudRAa6Xgl88whFmtUU3dqyD1Nntz680g/exec', {
        issueDetails: ticket.issue,
        cabinName: ticket.cabin,
        userEmail: `${userId}@slack.user`
      });

      await say(`📝 Got it. I’ve saved this issue under *${ticket.cabin}* and will check SOPs now...`);

      const keywords = normalize(ticket.issue).split(/\s+/);
      let matchedFile = null;
      let matchedLines = [];

      for (const [filename, content] of Object.entries(sopFiles)) {
        const lines = content.split(/\r?\n/);
        let currentCabin = null;
        let buffer = [];
        let collecting = false;

        for (const line of lines) {
          const taskMatch = line.match(/task[:\-\s]*(.*)/i);
          if (taskMatch) {
            if (collecting && buffer.length) break;
            currentCabin = taskMatch[1].trim();
            collecting = normalize(currentCabin) === normalize(ticket.cabin);
            buffer = [];
            continue;
          }

          if (collecting) buffer.push(line);
        }

        if (collecting && buffer.length > 0) {
          const matchOnAny = buffer.some(l => keywords.some(word => normalize(l).includes(word)));
          if (matchOnAny) {
            matchedFile = filename;
            matchedLines = buffer;
            break;
          }
        }
      }

      if (matchedFile) {
        const formatted = matchedLines.map(line => {
          const label = line.split(':')[0].replace(/[_\-]/g, ' ').replace(/\d+$/, '').trim();
          const value = line.split(':')[1]?.trim() ?? line.trim();
          return `*${label}*: ${value}`;
        }).join('\n');

        await say(`📄 From *${matchedFile}*, here’s the info I found for *${ticket.cabin}*:\n\n${formatted}`);
      } else {
        await say(`I couldn’t find any SOP files regarding the issue. Let’s see if we can figure this out together.`);

        const convo = await openai.chat.completions.create({
          model: 'gpt-4',
          messages: [
            { role: 'system', content: "You are a helpful assistant helping a CSR troubleshoot guest issues. Only ask 1-2 questions at a time. Speak conversationally. Do not say you are an AI or that you're using GPT." },
            ...ticket.context
          ]
        });

        const response = convo.choices[0].message.content;
        ticket.context.push({ role: 'assistant', content: response });
        await say(response);
      }
    } else {
      ticket.context.push({ role: 'user', content: text });
      const convo = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: "You are a helpful assistant helping a CSR troubleshoot guest issues. Only ask 1-2 questions at a time. Speak conversationally. Do not say you are an AI or that you're using GPT." },
          ...ticket.context
        ]
      });

      const response = convo.choices[0].message.content;
      ticket.context.push({ role: 'assistant', content: response });
      await say(response);
    }
  } catch (err) {
    console.error('❌ Error:', err);
    await say("⚠️ Something went wrong. Let Jake know.");
  }
});

(async () => {
  loadSOPFiles();
  await app.start();
  console.log('⚡ Sol is up and running!');
})();
