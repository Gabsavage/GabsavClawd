import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOT_TOPICS_PATH = path.join(__dirname, 'hotTopics.json');

const API = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// In-memory state
const pendingLaunches = [];
const concepts = new Map();   // conceptId -> concept
let conceptCounter = 0;
let awaitingModify = null;    // { chatId, conceptId } — set while waiting for Modify reply
let pollOffset = 0;
let polling = false;

// ---------------------------------------------------------------------------
// Telegram API helpers
// ---------------------------------------------------------------------------

async function tgPost(method, body) {
  const res = await fetch(`${API()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram ${method} error ${res.status}: ${err}`);
  }
  return res.json();
}

// HTML is used instead of MarkdownV2 to avoid heavy escaping requirements
function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

function formatConcept(concept) {
  return [
    `🚨 <b>New Meme Token Signal</b>`,
    ``,
    `📰 <b>Signal</b>`,
    `Title: ${esc(concept.title)}`,
    `Source: r/${esc(concept.subreddit)}`,
    ``,
    `🪙 <b>Token Concept</b>`,
    `Name: <b>${esc(concept.name)}</b>  |  Ticker: <code>$${esc(concept.ticker)}</code>`,
    `Description: ${esc(concept.description)}`,
    `Narrative: <i>${esc(concept.narrative)}</i>`,
    ``,
    `📊 <b>Score:</b> ${concept.score}/100`,
    `🧠 <b>Reasoning:</b> ${esc(concept.reasoning)}`,
  ].join('\n');
}

function buildKeyboard(conceptId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Launch',          callback_data: `launch:${conceptId}` },
        { text: '✏️ Modify',          callback_data: `modify:${conceptId}` },
      ],
      [
        { text: '❌ Skip',            callback_data: `skip:${conceptId}` },
        { text: '🔥 Keep this angle', callback_data: `hot:${conceptId}` },
      ],
    ],
  };
}

// ---------------------------------------------------------------------------
// Public: send a concept card
// ---------------------------------------------------------------------------

async function sendConcept(concept) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID environment variable is not set');
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN environment variable is not set');

  const id = ++conceptCounter;
  concepts.set(id, { ...concept });

  await tgPost('sendMessage', {
    chat_id: chatId,
    text: formatConcept(concept),
    parse_mode: 'HTML',
    reply_markup: buildKeyboard(id),
  });

  return id;
}

// ---------------------------------------------------------------------------
// Callback query handler (button presses)
// ---------------------------------------------------------------------------

async function removeButtons(chatId, messageId) {
  await tgPost('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}

async function handleCallbackQuery(query) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const [action, idStr] = query.data.split(':');
  const conceptId = parseInt(idStr, 10);
  const concept = concepts.get(conceptId);

  // Always acknowledge the callback immediately to stop the spinner
  await tgPost('answerCallbackQuery', { callback_query_id: query.id });

  if (!concept) return; // stale button from a previous session

  switch (action) {
    case 'launch': {
      pendingLaunches.push({ ...concept, launchedAt: new Date().toISOString() });
      await removeButtons(chatId, messageId);
      await tgPost('sendMessage', {
        chat_id: chatId,
        text: `✅ <b>$${esc(concept.ticker)}</b> added to pending launches. Total queued: <b>${pendingLaunches.length}</b>`,
        parse_mode: 'HTML',
      });
      break;
    }

    case 'modify': {
      awaitingModify = { chatId, conceptId };
      await tgPost('sendMessage', {
        chat_id: chatId,
        text: `✏️ Send me your modifications for <b>$${esc(concept.ticker)}</b>.\n\nReply with any changes (e.g. "change ticker to MOON, make description funnier"):`,
        parse_mode: 'HTML',
      });
      break;
    }

    case 'skip': {
      concepts.delete(conceptId);
      await removeButtons(chatId, messageId);
      console.log(`[telegramBot] Skipped $${concept.ticker} — user rejected`);
      await tgPost('sendMessage', {
        chat_id: chatId,
        text: `❌ <b>$${esc(concept.ticker)}</b> skipped.`,
        parse_mode: 'HTML',
      });
      break;
    }

    case 'hot': {
      await saveHotTopic(concept);
      await removeButtons(chatId, messageId);
      await tgPost('sendMessage', {
        chat_id: chatId,
        text: `🔥 Angle saved as hot topic:\n<i>${esc(concept.angle)}</i>`,
        parse_mode: 'HTML',
      });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Text message handler (Modify reply flow)
// ---------------------------------------------------------------------------

async function handleMessage(message) {
  if (!awaitingModify) return;
  if (message.chat.id !== awaitingModify.chatId) return;

  const { conceptId } = awaitingModify;
  awaitingModify = null;

  const concept = concepts.get(conceptId);
  if (!concept) return;

  const updated = {
    ...concept,
    modifications: message.text,
    modifiedAt: new Date().toISOString(),
  };
  concepts.set(conceptId, updated);
  pendingLaunches.push({ ...updated, launchedAt: new Date().toISOString() });

  await tgPost('sendMessage', {
    chat_id: message.chat.id,
    text: `✅ <b>$${esc(concept.ticker)}</b> updated and added to pending launches.\n\n<b>Modifications noted:</b> <i>${esc(message.text)}</i>`,
    parse_mode: 'HTML',
  });
}

// ---------------------------------------------------------------------------
// Hot topics persistence
// ---------------------------------------------------------------------------

async function loadHotTopics() {
  try {
    const raw = await readFile(HOT_TOPICS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveHotTopic(concept) {
  const topics = await loadHotTopics();
  topics.push({
    angle: concept.angle,
    ticker: concept.ticker,
    title: concept.title,
    subreddit: concept.subreddit,
    savedAt: new Date().toISOString(),
  });
  await writeFile(HOT_TOPICS_PATH, JSON.stringify(topics, null, 2));
}

// ---------------------------------------------------------------------------
// Long-poll loop
// ---------------------------------------------------------------------------

async function poll() {
  try {
    const res = await fetch(`${API()}/getUpdates?offset=${pollOffset}&timeout=30`);
    if (!res.ok) {
      console.warn(`[telegramBot] Polling ${res.status} — retrying`);
      return;
    }
    const data = await res.json();
    for (const update of data.result) {
      pollOffset = update.update_id + 1;
      if (update.callback_query) {
        await handleCallbackQuery(update.callback_query).catch((err) =>
          console.warn(`[telegramBot] Callback handler error: ${err.message}`)
        );
      } else if (update.message?.text) {
        await handleMessage(update.message).catch((err) =>
          console.warn(`[telegramBot] Message handler error: ${err.message}`)
        );
      }
    }
  } catch (err) {
    console.warn(`[telegramBot] Poll error: ${err.message}`);
  }
}

function startBot() {
  if (polling) return;
  polling = true;
  console.log('[telegramBot] Bot started — listening for updates');
  (async function loop() {
    while (polling) {
      await poll();
    }
  })();
}

function stopBot() {
  polling = false;
}

function getPendingLaunches() {
  return [...pendingLaunches];
}

export { sendConcept, startBot, stopBot, getPendingLaunches };
