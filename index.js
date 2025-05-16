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
      // Save ticket to Drive via Google Apps Script webhook
      await axios.post('https://script.google.com/macros/s/AKfycbwKlvjSioT753iSqy7TI0zd3Tc4KiefbhPxudRAa6Xgl88whFmtUU3dqyD1Nntz680g/exec', {
        issueDetails: parsed.issue,
        cabinName: parsed.cabin,
        userEmail: `${userId}@slack.user`
      });

      await say(`📝 Got it. I’ve saved this issue under *${parsed.cabin}* and will check SOPs now...`);

      // Search synced SOPs for a match
      try {
        const sopResponse = await axios.get('https://sol-support-bot-paf9.onrender.com/sync-sops');
        const sopFiles = sopResponse.data || {};

        console.log("🗂️ Loaded SOP files:", Object.keys(sopFiles));  // Add this debug log
        
        let matchedFile = null;
        let matchText = '';

        // Normalize quotes and case
        const normalize = str => str.toLowerCase().replace(/[\u2018\u2019\u201C\u201D]/g, "'");

        const keywords = normalize(parsed.issue).split(/\s+/); // split into words

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
      } catch (searchErr) {
        console.error('❌ SOP search failed:', searchErr);
        await say("⚠️ I had trouble checking the SOPs. Let Jake know.");
      }

    } catch (err) {
      await say("⚠️ I ran into an issue trying to log this. Please let Jake know.");
      console.error(err);
    }

    return;
  }
});

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
