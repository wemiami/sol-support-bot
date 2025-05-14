const { App } = require('@slack/bolt');
require('dotenv').config();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

app.message(async ({ message, say }) => {
  if (message.subtype === undefined || message.subtype === 'bot_message') {
    await say(`Hi there <@${message.user}>! How can I help today?`);
  }
});

(async () => {
  await app.start();
  console.log('⚡️ Sol is up and running!');
})();
