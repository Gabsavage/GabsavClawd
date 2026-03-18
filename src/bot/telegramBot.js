import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { updateConceptStatus } from '../database/db.js';

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

function fluxLabel(flux) {
  switch (String(flux)) {
    case '1': return '🌍 Flux 1 — World → Crypto';
    case '2': return '🔄 Flux 2 — Crypto → Crypto';
    case '3': return '🔥 Flux 3 — CT Trend';
    default:  return `Flux ${flux}`;
  }
}

function formatSource(concept) {
  if (!concept.source_signal && !concept.subreddit) return null;
  // Perplexity signals have source_signal but no subreddit
  if (concept.source_signal) return null; // shown via topic field instead
  if (concept.subreddit === 'polymarket') return 'Polymarket';
  if (concept.subreddit === 'google_trends') return 'Google Trends';
  return `r/${concept.subreddit}`;
}

function formatDate(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Message formatting
// ---------------------------------------------------------------------------

function formatConcept(concept) {
  const lines = [
    `🚨 <b>New Meme Token Signal</b>`,
    `<i>${esc(fluxLabel(concept.flux))}</i>`,
    ``,
  ];

  const fluxStr = String(concept.flux);

  if (fluxStr === '1') {
    // Flux 1 — full Perplexity signal block
    const source = formatSource(concept);
    const topic  = concept.topic || concept.source_signal || concept.title;
    if (topic || source || concept.url) {
      lines.push(`📰 <b>Signal</b>`);
      if (topic)           lines.push(`Topic: ${esc(topic)}`);
      if (concept.summary) lines.push(`${esc(concept.summary)}`);
      if (source)          lines.push(`Source: ${esc(source)}`);
      if (concept.url)     lines.push(`URL: ${concept.url}`);
      const strength = concept.signal_strength;
      const spread   = concept.spread;
      const velocity = concept.velocity;
      if (strength != null || spread || velocity) {
        const parts = [];
        if (strength != null) parts.push(`Signal: ${strength}/10`);
        if (spread)           parts.push(`Spread: ${esc(spread)}`);
        if (velocity)         parts.push(`Velocity: ${esc(velocity)}`);
        lines.push(parts.join(' | '));
      }
      if (concept.shelf_life) lines.push(`Shelf life: ${esc(concept.shelf_life)}`);
      if (concept.absurdity_angle && concept.absurdity_angle !== 'none') {
        lines.push(`Angle: <i>${esc(concept.absurdity_angle)}</i>`);
      }
      const sourcesArr = Array.isArray(concept.sources) ? concept.sources : [];
      lines.push(`Sources: ${sourcesArr.length > 0 ? sourcesArr.map(esc).join(', ') : 'N/A'}`);
      if (concept.source_date) lines.push(`Date: ${esc(concept.source_date)}`);
      lines.push(``);
    }
  } else if (fluxStr === '2' || fluxStr === '3') {
    // Flux 2 & 3 — compact inspiration block
    if (concept.source_migrations) {
      lines.push(`💡 Inspiration: ${esc(concept.source_migrations)}`);
      lines.push(``);
    }
  }

  lines.push(
    `🪙 <b>Token Concept</b>`,
    `Name: <b>${esc(concept.name)}</b>  |  Ticker: <code>$${esc(concept.ticker)}</code>`,
    `Description: ${esc(concept.description)}`,
    `Narrative: <i>${esc(concept.narrative)}</i>`,
  );

  return lines.join('\n');
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
      if (concept.db_id) {
        try { updateConceptStatus(concept.db_id, 'approved', 'launched via Telegram'); } catch {}
      }
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
      if (concept.db_id) {
        try { updateConceptStatus(concept.db_id, 'rejected', 'skipped via Telegram'); } catch {}
      }
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
      if (concept.db_id) {
        try { updateConceptStatus(concept.db_id, 'hot', 'marked hot via Telegram'); } catch {}
      }
      await saveHotTopic(concept);
      await removeButtons(chatId, messageId);
      await tgPost('sendMessage', {
        chat_id: chatId,
        text: `🔥 Angle saved as hot topic:\n<i>${esc(concept.topic || concept.title || concept.name)}</i>`,
        parse_mode: 'HTML',
      });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Slash command handler
// ---------------------------------------------------------------------------

async function handleCommand(text, chatId) {
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case '/help': {
      await tgPost('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: [
          '<b>Available commands</b>',
          '',
          '/status — last cycle stats',
          '/pending — list queued token launches',
          '/help — show this message',
        ].join('\n'),
      });
      break;
    }

    case '/status': {
      await tgPost('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: [
          '<b>Scout Status</b>',
          '',
          `Pending launches: ${pendingLaunches.length}`,
        ].join('\n'),
      });
      break;
    }

    case '/pending': {
      if (pendingLaunches.length === 0) {
        await tgPost('sendMessage', { chat_id: chatId, text: 'No pending launches.' });
        break;
      }
      const list = pendingLaunches
        .map((c, i) => `${i + 1}. <b>${esc(c.name)}</b> <code>$${esc(c.ticker)}</code>`)
        .join('\n');
      await tgPost('sendMessage', {
        chat_id: chatId,
        parse_mode: 'HTML',
        text: `<b>Pending Launches (${pendingLaunches.length})</b>\n\n${list}`,
      });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Text message handler (Modify reply flow)
// ---------------------------------------------------------------------------

async function handleMessage(message) {
  const text = message.text?.trim() ?? '';
  const chatId = message.chat.id;

  if (text.startsWith('/')) {
    await handleCommand(text, chatId);
    return;
  }

  if (!awaitingModify) return;
  if (chatId !== awaitingModify.chatId) return;

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

  if (concept.db_id) {
    try { updateConceptStatus(concept.db_id, 'approved', `modified: ${message.text}`); } catch {}
  }

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
    topic: concept.topic || concept.title || concept.name,
    ticker: concept.ticker,
    flux: concept.flux,
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
      if (res.status === 401) {
        console.error('[telegramBot] Polling 401 — invalid TELEGRAM_BOT_TOKEN, stopping bot');
        polling = false;
        return;
      }
      console.warn(`[telegramBot] Polling ${res.status} — retrying in 5s`);
      await new Promise((r) => setTimeout(r, 5000));
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
