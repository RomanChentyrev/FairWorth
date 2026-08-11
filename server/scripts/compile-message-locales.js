require('dotenv').config();
const fs = require('fs');
const path = require('path');

const source = require('../i18n/messages.en.json');
const languages = { de: 'German', fr: 'French', it: 'Italian', es: 'Spanish', 'zh-CN': 'Simplified Chinese', ar: 'Modern Standard Arabic' };
const requestedLocales = new Set(
  String(process.env.LOCALES || '').split(',').map(locale => locale.trim()).filter(Boolean),
);

function restorePlaceholders(sourceText, translatedText) {
  const expected = [...sourceText.matchAll(/\{[^}]+\}/g)].map(match => match[0]);
  const received = [...translatedText.matchAll(/\{[^}]+\}/g)].map(match => match[0]);
  if (expected.length !== received.length) throw new Error('Translation changed the number of placeholders');
  let index = 0;
  return translatedText.replace(/\{[^}]+\}/g, () => expected[index++]);
}

async function googleTranslate(locale) {
  const entries = Object.entries(source);
  const output = {};
  const groups = [];
  let group = [];
  let size = 0;
  for (const entry of entries) {
    const itemSize = entry[1].length + 20;
    if (group.length && size + itemSize > 3000) {
      groups.push(group);
      group = [];
      size = 0;
    }
    group.push(entry);
    size += itemSize;
  }
  if (group.length) groups.push(group);

  for (const entriesGroup of groups) {
    const input = entriesGroup
      .map(([, text], index) => `[[[${String(index + 1).padStart(4, '0')}]]]\n${text.replace(/\s+/g, ' ')}`)
      .join('\n');
    let completed = false;
    let lastError;
    for (let attempt = 1; attempt <= 4 && !completed; attempt += 1) {
      try {
        const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${locale}&dt=t`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ q: input }),
        });
        if (!response.ok) throw new Error(`Google Translate HTTP ${response.status}`);
        const body = await response.json();
        const content = body?.[0]?.map(part => part?.[0] || '').join('') || '';
        for (const match of content.matchAll(/\[\[\[(\d{4})\]\]\]\s*([\s\S]*?)(?=\[\[\[\d{4}\]\]\]|$)/g)) {
          const entry = entriesGroup[Number(match[1]) - 1];
          if (entry && match[2].trim()) output[entry[0]] = restorePlaceholders(entry[1], match[2].trim());
        }
        const missing = entriesGroup.filter(([key]) => !output[key]);
        if (missing.length) throw new Error(`${locale}: missing ${missing.map(([key]) => key).join(', ')}`);
        completed = true;
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, attempt * 1500));
      }
    }
    if (!completed) throw lastError;
  }
  return output;
}

async function request(locale, language) {
  const properties = Object.fromEntries(Object.keys(source).map(key => [key, { type: 'string' }]));
  let response;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://tripalora.com',
          'X-Title': 'Tripalora server locale compiler',
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free',
          temperature: 0,
          max_tokens: 8000,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: `tripalora_server_${locale}`,
              strict: true,
              schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
            },
          },
          messages: [{
            role: 'user',
            content: `Translate every value into natural ${language} for Tripalora authentication, hotel scoring and transactional email messages. Preserve every {placeholder}, product name, punctuation and email terminology. Return all keys.\n\n${JSON.stringify(source)}`,
          }],
        }),
      });
      break;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    }
  }
  if (!response) throw lastError;
  const body = await response.json();
  if (!response.ok && /free-models-per-day|rate limit exceeded/i.test(body?.error?.message || '')) {
    const result = await googleTranslate(locale);
    fs.writeFileSync(path.join(__dirname, `../i18n/messages.${locale}.json`), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`Generated ${locale} with static-build fallback: ${Object.keys(result).length} messages`);
    return;
  }
  if (!response.ok) throw new Error(body?.error?.message || `OpenRouter HTTP ${response.status}`);
  const result = JSON.parse(body.choices[0].message.content);
  for (const key of Object.keys(source)) if (!String(result[key] || '').trim()) throw new Error(`${locale}: missing ${key}`);
  for (const key of Object.keys(source)) result[key] = restorePlaceholders(source[key], result[key]);
  fs.writeFileSync(path.join(__dirname, `../i18n/messages.${locale}.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Generated ${locale}: ${Object.keys(result).length} messages`);
}

(async () => {
  for (const [locale, language] of Object.entries(languages)) {
    if (!requestedLocales.size || requestedLocales.has(locale)) await request(locale, language);
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
