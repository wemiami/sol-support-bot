// index.js

const { App } = require('@slack/bolt');
require('dotenv').config();
const axios = require('axios');

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// Track active conversations for structured input
const openTickets = {};

app.message(async ({ message, say }) => {
  const userId = message.user;
  const text = message.text.trim();

  // If we haven't started collecting info yet
  if (!openTickets[userId]) {
    openTickets[userId] = { step: 'awaiting_details' };
    await say(`Hi there <@${userId}>! 👋 Please paste the guest's message and tell me which cabin this is for.`);
    return;
  }

  // If awaiting guest message and cabin
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

    // ✅ Save to Drive via your Apps Script webhook (to be added)
    try {
      await axios.post('https://script.google.com/macros/s/AKfycbwKlvjSioT753iSqy7TI0zd3Tc4KiefbhPxudRAa6Xgl88whFmtUU3dqyD1Nntz680g/exec', {
        issueDetails: parsed.issue,
        cabinName: parsed.cabin,
        userEmail: `${userId}@slack.user`
      });

      await say(`📝 Got it. I’ve saved this issue under *${parsed.cabin}* and will check SOPs now...`);
      // ✅ Next step: search SOPs or fallback to GPT

    } catch (err) {
      await say("⚠️ I ran into an issue trying to log this. Please let Jake know.");
      console.error(err);
    }

    return;
  }
});

// Simple parser for structured input
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

(async () => {
  await app.start();
  console.log('⚡ Sol is up and running!');
})();
