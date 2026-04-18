'use strict';

// AI provider wrapper — set AI_PROVIDER=openai or AI_PROVIDER=anthropic in .env
// To switch providers: change AI_PROVIDER in .env and restart the server.
// Everything else in server.js stays the same — same interface either way.

const EventEmitter = require('events');

const PROVIDER = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

let _anthropic = null;
let _openai = null;

function getAnthropic() {
  if (!_anthropic) {
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

function getOpenAI() {
  if (!_openai) {
    const OpenAI = require('openai');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

// Extract plain text from Anthropic-style system param
function extractSystemText(system) {
  if (!system) return '';
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) return system.map(s => s.text || '').join('\n');
  return '';
}

// Convert Anthropic messages array to OpenAI messages array
function toOpenAIMessages(system, messages) {
  const out = [];
  const sysText = extractSystemText(system);
  if (sysText) out.push({ role: 'system', content: sysText });
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
    } else if (Array.isArray(m.content)) {
      out.push({ role: m.role, content: m.content.map(c => c.text || c.content || '').join('') });
    }
  }
  return out;
}

// Anthropic-interface-compatible streaming wrapper for OpenAI
function openAIStream(params) {
  const emitter = new EventEmitter();
  let aborted = false;
  const controller = new AbortController();

  emitter.abort = () => {
    aborted = true;
    controller.abort();
  };

  const oaiMessages = toOpenAIMessages(params.system, params.messages);

  setImmediate(async () => {
    try {
      const stream = await getOpenAI().chat.completions.create({
        model: OPENAI_MODEL,
        max_tokens: params.max_tokens || 32768,
        messages: oaiMessages,
        stream: true,
      }, { signal: controller.signal });

      let finishReason = null;
      for await (const chunk of stream) {
        if (aborted) break;
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) emitter.emit('text', text);
        if (chunk.choices[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
      }

      if (!aborted) emitter.emit('finalMessage', { stop_reason: finishReason || 'end_turn' });
    } catch (err) {
      if (aborted) return;
      emitter.emit('error', err);
    }
  });

  return emitter;
}

// Anthropic-interface-compatible non-streaming wrapper for OpenAI
async function openAICreate(params) {
  const oaiMessages = toOpenAIMessages(params.system, params.messages);
  const response = await getOpenAI().chat.completions.create({
    model: OPENAI_MODEL,
    max_tokens: params.max_tokens || 8192,
    messages: oaiMessages,
  });
  // Return Anthropic-shaped response
  return {
    content: [{ type: 'text', text: response.choices[0]?.message?.content || '' }],
    stop_reason: response.choices[0]?.finish_reason,
  };
}

const aiClient = {
  messages: {
    stream(params) {
      if (PROVIDER === 'openai') return openAIStream(params);
      return getAnthropic().messages.stream(params);
    },
    async create(params) {
      if (PROVIDER === 'openai') return openAICreate(params);
      return getAnthropic().messages.create(params);
    },
  },
};

module.exports = { aiClient, PROVIDER, OPENAI_MODEL };
