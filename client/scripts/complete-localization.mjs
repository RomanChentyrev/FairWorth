import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const directory = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(directory, '../src');
const localeRoot = path.join(sourceRoot, 'i18n/locales');
const phraseRoot = path.join(sourceRoot, 'i18n/phrases');
const cachePath = path.resolve(directory, '.localization-cache.json');
const englishCatalogue = JSON.parse(await fs.readFile(path.join(localeRoot, 'en.json'), 'utf8'));
const excluded = new Set([
  path.join(sourceRoot, 'i18n/LanguageContext.jsx'),
  path.join(sourceRoot, 'pages/LegalPage.jsx'),
]);
const languageNames = {
  ru: 'Russian',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  es: 'Spanish',
  'zh-CN': 'Simplified Chinese',
  ar: 'Modern Standard Arabic',
};
const catalogueOverrides = {
  de: { reg_accept_prefix: 'Ich akzeptiere die', reg_accept_connector: 'und die' },
  fr: { reg_accept_prefix: 'J’accepte les', reg_accept_connector: 'et la' },
  it: {
    reg_accept_prefix: 'Accetto i',
    reg_accept_connector: 'e la',
    reg_password: 'Password',
    login_no_account: 'Nessun account?',
  },
  es: { reg_accept_prefix: 'Acepto los', reg_accept_connector: 'y la' },
  'zh-CN': { reg_accept_prefix: '我接受', reg_accept_connector: '和' },
  ar: { reg_accept_prefix: 'أوافق على', reg_accept_connector: 'و' },
};
const phraseOverrides = {
  fr: { 'Something went wrong': 'Un problème est survenu' },
  ar: { data: 'بيانات' },
};

function restorePlaceholders(source, translated) {
  const expected = [...String(source).matchAll(/\{[^}]+\}/g)].map(match => match[0]);
  const received = [...String(translated).matchAll(/\{[^}]+\}/g)].map(match => match[0]);
  if (expected.length !== received.length) throw new Error('Translation changed the number of placeholders');
  let index = 0;
  return String(translated).replace(/\{[^}]+\}/g, () => expected[index++]);
}

async function translateWithGoogle(locale, items) {
  const output = {};
  const groups = [];
  let group = [];
  let size = 0;
  for (const item of items) {
    const itemSize = item.text.length + 20;
    if (group.length && size + itemSize > 3000) {
      groups.push(group);
      group = [];
      size = 0;
    }
    group.push(item);
    size += itemSize;
  }
  if (group.length) groups.push(group);

  for (const entries of groups) {
    const input = entries
      .map((item, index) => `[[[${String(index + 1).padStart(4, '0')}]]]\n${item.text.replace(/\s+/g, ' ')}`)
      .join('\n');
    let lastError;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${locale}&dt=t`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ q: input }),
        });
        if (!response.ok) throw new Error(`Google Translate HTTP ${response.status}`);
        const body = await response.json();
        const content = body?.[0]?.map(part => part?.[0] || '').join('') || '';
        const marker = /\[\[\[(\d{4})\]\]\]\s*([\s\S]*?)(?=\[\[\[\d{4}\]\]\]|$)/g;
        for (const match of content.matchAll(marker)) {
          const item = entries[Number(match[1]) - 1];
          if (item && match[2].trim()) output[item.id] = match[2].trim();
        }
        const missing = entries.filter(item => !output[item.id]);
        if (missing.length) throw new Error(`${locale}: Google missing ${missing.map(item => item.id).join(', ')}`);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await new Promise(resolve => setTimeout(resolve, attempt * 1500));
      }
    }
    if (lastError) throw lastError;
  }
  return output;
}

async function filesUnder(root) {
  const output = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(target));
    else if (/\.(?:js|jsx)$/.test(entry.name)) output.push(target);
  }
  return output;
}

function languageTest(node) {
  if (node?.type === 'Identifier' && ['isRu', 'ru'].includes(node.name)) return true;
  if (node?.type !== 'BinaryExpression' || !['===', '=='].includes(node.operator)) return false;
  return (
    node.left?.type === 'Identifier'
    && node.left.name === 'lang'
    && node.right?.type === 'StringLiteral'
    && node.right.value === 'ru'
  ) || (
    node.right?.type === 'Identifier'
    && node.right.name === 'lang'
    && node.left?.type === 'StringLiteral'
    && node.left.value === 'ru'
  );
}

function usefulPhrase(value) {
  const phrase = String(value || '').replace(/\s+/g, ' ').trim();
  if (!phrase || !/[A-Za-z]/.test(phrase)) return null;
  if (/^(?:https?:|\/|api\/|[A-Z0-9_]{3,})/.test(phrase)) return null;
  return phrase;
}

function stringsInside(node, output) {
  if (!node) return;
  if (node.type === 'StringLiteral') {
    const phrase = usefulPhrase(node.value);
    if (phrase) output.add(phrase);
    return;
  }
  if (node.type === 'TemplateElement') {
    const phrase = usefulPhrase(node.value.raw);
    if (phrase) output.add(phrase);
    return;
  }
  if (node.type === 'JSXText') {
    const phrase = usefulPhrase(node.value);
    if (phrase) output.add(phrase);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'extra'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(item => item?.type && stringsInside(item, output));
    else if (value?.type) stringsInside(value, output);
  }
}

function parse(source) {
  return parser.parse(source, {
    sourceType: 'module',
    plugins: ['jsx', 'importAttributes'],
  });
}

const files = (await filesUnder(sourceRoot)).filter(file => !excluded.has(file));
const phrases = new Set();
const directRussian = new Map();
const sources = new Map();
const translationCache = await fs.readFile(cachePath, 'utf8')
  .then(JSON.parse)
  .catch(() => ({}));

for (const entries of Object.values(translationCache)) {
  for (const [id, item] of Object.entries(entries)) {
    if (id.startsWith('p_') && item?.source) phrases.add(item.source);
  }
}

for (const file of files) {
  const source = await fs.readFile(file, 'utf8');
  sources.set(file, source);
  const ast = parse(source);
  traverse(ast, {
    ConditionalExpression(nodePath) {
      const { node } = nodePath;
      if (!languageTest(node.test)) return;
      stringsInside(node.alternate, phrases);
      if (node.alternate.type === 'StringLiteral' && node.consequent.type === 'StringLiteral') {
        directRussian.set(node.alternate.value, node.consequent.value);
      }
    },
    CallExpression(nodePath) {
      const { node } = nodePath;
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'l' || !node.arguments[0]) return;
      stringsInside(node.arguments[0], phrases);
      if (node.arguments[0].type === 'StringLiteral' && node.arguments[1]?.type === 'StringLiteral') {
        directRussian.set(node.arguments[0].value, node.arguments[1].value);
      }
    },
    ObjectExpression(nodePath) {
      const values = {};
      for (const property of nodePath.node.properties) {
        if (
          property.type !== 'ObjectProperty'
          || property.value.type !== 'StringLiteral'
        ) continue;
        const key = property.key.type === 'Identifier' ? property.key.name : property.key.value;
        if (key === 'en' || key === 'ru') values[key] = property.value.value;
      }
      const english = usefulPhrase(values.en);
      if (!english) return;
      phrases.add(english);
      if (values.ru) directRussian.set(english, values.ru);
    },
  });
}

const historicalPhraseCatalogue = await fs.readFile(path.join(phraseRoot, 'ru.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => ({}));
for (const phrase of Object.keys(historicalPhraseCatalogue)) phrases.add(phrase);

const phraseList = [...phrases].sort((a, b) => a.localeCompare(b));
const phraseIds = new Map(phraseList.map(value => [value, `p_${crypto.createHash('sha1').update(value).digest('hex').slice(0, 12)}`]));
const baseItems = Object.entries(englishCatalogue).map(([key, text]) => ({ id: `b_${key}`, text }));
const phraseItems = phraseList.map(text => ({ id: phraseIds.get(text), text }));

const generatedLocales = ['de', 'fr', 'it', 'es', 'zh-CN', 'ar'];
const cachedLocales = [...generatedLocales, 'ru'];
const requestedLocales = new Set(
  String(process.env.LOCALES || '').split(',').map(locale => locale.trim()).filter(Boolean),
);
const selectedLocales = requestedLocales.size
  ? generatedLocales.filter(locale => requestedLocales.has(locale))
  : generatedLocales;
const existingPhraseCatalogues = {};

for (const locale of cachedLocales) {
  const catalogue = await fs.readFile(path.join(localeRoot, `${locale}.json`), 'utf8')
    .then(JSON.parse)
    .catch(() => ({}));
  const phraseCatalogue = await fs.readFile(path.join(phraseRoot, `${locale}.json`), 'utf8')
    .then(JSON.parse)
    .catch(() => ({}));
  existingPhraseCatalogues[locale] = phraseCatalogue;
  translationCache[locale] ||= {};
  for (const item of baseItems) {
    const translation = catalogue[item.id.slice(2)];
    if (translation) translationCache[locale][item.id] = { source: item.text, translation };
  }
  for (const item of phraseItems) {
    const translation = phraseCatalogue[item.text];
    if (translation) translationCache[locale][item.id] = { source: item.text, translation };
  }
}

const envText = await fs.readFile(path.resolve(directory, '../../server/.env'), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).map(line => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(match => [match[1], match[2].replace(/^['"]|['"]$/g, '')]));
if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required');

async function translateBatch(locale, items) {
  let lastError;
  const translated = {};
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const pending = items.filter(item => !translated[item.id]);
    if (!pending.length) return translated;
    try {
      const controller = new AbortController();
      const timeout = globalThis.setTimeout(() => controller.abort(), 45000);
      let response;
      let body;
      try {
        response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://tripalora.com',
          'X-Title': 'Tripalora locale compiler',
        },
        body: JSON.stringify({
          model: env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free',
          temperature: 0,
          max_tokens: 10000,
          messages: [{
            role: 'user',
            content: [
              `Translate every text into concise, natural ${languageNames[locale]} for the Tripalora premium travel application.`,
              'Preserve product names, placeholders, emoji, punctuation, arrows, currencies, hotel and airline names.',
              'Return plain text only. Return every input on its own line as ID|||TRANSLATION.',
              'Never change the ID or the ||| separator. Do not use tabs, line breaks inside a translation, Markdown, or commentary.',
              '',
              ...pending.map(item => `${item.id}|||${item.text.replace(/\s+/g, ' ')}`),
            ].join('\n'),
          }],
          }),
          signal: controller.signal,
        });
        body = await response.json().catch(() => ({}));
      } finally {
        globalThis.clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(body?.error?.message || `OpenRouter HTTP ${response.status}`);
      const content = String(body?.choices?.[0]?.message?.content || '')
        .replace(/^```(?:text)?\s*/i, '')
        .replace(/\s*```$/, '');
      for (const line of content.split(/\r?\n/)) {
        const separator = line.indexOf('|||');
        if (separator < 1) continue;
        const id = line.slice(0, separator).trim().replace(/^[-*]\s*/, '');
        const value = line.slice(separator + 3).trim();
        if (value) {
          const item = pending.find(candidate => candidate.id === id);
          if (item) translated[id] = restorePlaceholders(item.text, value);
        }
      }
      const missing = items.filter(item => !translated[item.id]);
      if (!missing.length) return translated;
      throw new Error(`${locale}: missing ${missing.map(item => item.id).join(', ')}`);
    } catch (error) {
      lastError = error;
      if (/free-models-per-day|rate limit exceeded/i.test(error.message) || attempt >= 2) {
        process.stderr.write(`${locale}: OpenRouter unavailable, using static-build translation fallback\n`);
        Object.assign(translated, await translateWithGoogle(locale, pending));
        return translated;
      }
      process.stderr.write(`${locale}: batch attempt ${attempt} failed: ${error.message}\n`);
      await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    }
  }
  throw lastError;
}

async function translate(locale, items) {
  const output = Object.fromEntries(items
    .filter(item => translationCache[locale]?.[item.id]?.source === item.text)
    .map(item => [item.id, restorePlaceholders(item.text, translationCache[locale][item.id].translation)]));
  const batchSize = 80;
  const pending = items.filter(item => !output[item.id]);
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize);
    Object.assign(output, await translateBatch(locale, batch));
    translationCache[locale] ||= {};
    for (const item of batch) {
      translationCache[locale][item.id] = { source: item.text, translation: output[item.id] };
    }
    await fs.writeFile(cachePath, `${JSON.stringify(translationCache, null, 2)}\n`);
    process.stdout.write(`${locale}: ${Math.min(offset + batchSize, pending.length)}/${pending.length} new (${Object.keys(output).length}/${items.length} total)\n`);
  }
  return output;
}

await fs.mkdir(phraseRoot, { recursive: true });
for (const locale of selectedLocales) {
  const translated = await translate(locale, [...baseItems, ...phraseItems]);
  const catalogue = {
    ...Object.fromEntries(baseItems.map(item => [item.id.slice(2), translated[item.id]])),
    ...catalogueOverrides[locale],
  };
  const phraseCatalogue = {
    ...existingPhraseCatalogues[locale],
    ...Object.fromEntries(phraseItems.map(item => [item.text, translated[item.id]])),
    ...phraseOverrides[locale],
  };
  await fs.writeFile(path.join(localeRoot, `${locale}.json`), `${JSON.stringify(catalogue, null, 2)}\n`);
  await fs.writeFile(path.join(phraseRoot, `${locale}.json`), `${JSON.stringify(phraseCatalogue, null, 2)}\n`);
}

if (!requestedLocales.size || requestedLocales.has('ru')) {
  const missingRussian = phraseItems.filter(item => !directRussian.has(item.text));
  const russianGenerated = missingRussian.length ? await translate('ru', missingRussian) : {};
  const russianPhrases = Object.fromEntries(phraseItems.map(item => [
    item.text,
    directRussian.get(item.text) || russianGenerated[item.id] || item.text,
  ]));
  await fs.writeFile(path.join(phraseRoot, 'ru.json'), `${JSON.stringify(russianPhrases, null, 2)}\n`);
}

for (const file of files) {
  let source = sources.get(file);
  const ast = parse(source);
  const replacements = [];
  let usesLocalizer = false;
  traverse(ast, {
    ConditionalExpression(nodePath) {
      const { node } = nodePath;
      if (!languageTest(node.test)) return;
      replacements.push({
        start: node.start,
        end: node.end,
        value: `l(${source.slice(node.alternate.start, node.alternate.end)}, ${source.slice(node.consequent.start, node.consequent.end)})`,
      });
      usesLocalizer = true;
    },
  });
  if (!usesLocalizer) continue;

  const nonOverlapping = replacements
    .sort((a, b) => (a.end - a.start) - (b.end - b.start))
    .filter((replacement, index, all) => !all.slice(0, index).some(other => other.start >= replacement.start && other.end <= replacement.end));
  for (const replacement of nonOverlapping.sort((a, b) => b.start - a.start)) {
    source = `${source.slice(0, replacement.start)}${replacement.value}${source.slice(replacement.end)}`;
  }

  const transformedAst = parse(source);
  let inserted = false;
  traverse(transformedAst, {
    VariableDeclarator(nodePath) {
      if (inserted) return;
      const { node } = nodePath;
      if (
        node.id?.type !== 'ObjectPattern'
        || node.init?.type !== 'CallExpression'
        || node.init.callee?.type !== 'Identifier'
        || node.init.callee.name !== 'useLang'
      ) return;
      if (node.id.properties.some(property => property.key?.name === 'l')) return;
      source = `${source.slice(0, node.id.end - 1)}, l${source.slice(node.id.end - 1)}`;
      inserted = true;
    },
  });
  if (!inserted && !/\bl\s*[,}]/.test(source)) throw new Error(`Could not add l() to ${file}`);
  await fs.writeFile(file, source);
}

process.stdout.write(`Compiled ${phraseItems.length} legacy phrases and updated ${files.length} source files.\n`);
