const crypto = require('crypto');
const { db } = require('../db/database');
const { callAI, languageName, supportedLanguage } = require('./ai');

function sourceHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

async function translateField({ entityType, entityId, fieldName, value, locale }) {
  const language = supportedLanguage(locale);
  if (!value || language === 'en') return value;
  const hash = sourceHash(value);
  const cached = await db.prepare(`
    SELECT translated_text FROM localized_content
    WHERE entity_type = ? AND entity_id = ? AND field_name = ? AND locale = ? AND source_hash = ?
  `).get(entityType, entityId, fieldName, language, hash);
  if (cached) return cached.translated_text;

  const prompt = `Translate the following hotel content into natural ${languageName(language)}.
Preserve hotel names, brand names, addresses, measurements and proper nouns.
Do not add facts, commentary, headings or quotation marks. Return only the translation.

${value}`;
  const translated = await callAI(prompt);
  if (!translated) return value;
  await db.prepare(`
    INSERT INTO localized_content (
      entity_type, entity_id, field_name, locale, source_hash, translated_text, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (entity_type, entity_id, field_name, locale)
    DO UPDATE SET source_hash = EXCLUDED.source_hash,
      translated_text = EXCLUDED.translated_text,
      updated_at = CURRENT_TIMESTAMP
  `).run(entityType, entityId, fieldName, language, hash, translated);
  return translated;
}

async function translateFields(fields, locale) {
  const language = supportedLanguage(locale);
  if (language === 'en' || !fields.length) return fields.map(field => field.value);
  const output = new Array(fields.length);
  const missing = [];

  for (const [index, field] of fields.entries()) {
    if (!field.value) {
      output[index] = field.value;
      continue;
    }
    const hash = sourceHash(field.value);
    const cached = await db.prepare(`
      SELECT translated_text FROM localized_content
      WHERE entity_type = ? AND entity_id = ? AND field_name = ? AND locale = ? AND source_hash = ?
    `).get(field.entityType, field.entityId, field.fieldName, language, hash);
    if (cached) output[index] = cached.translated_text;
    else missing.push({ ...field, index, hash });
  }
  if (!missing.length) return output;

  const prompt = `Translate each Tripalora hotel text into natural ${languageName(language)}.
Preserve hotel and room names, brands, addresses, measurements and proper nouns.
Do not add facts or commentary. Return every item on one line as its numeric ID, three pipe characters, and the translation.

${missing.map((field, index) => `${index + 1}|||${String(field.value).replace(/\s+/g, ' ')}`).join('\n')}`;
  const content = await callAI(prompt);
  const translated = {};
  for (const line of String(content || '').split(/\r?\n/)) {
    const separator = line.indexOf('|||');
    if (separator < 1) continue;
    const id = Number(line.slice(0, separator).trim());
    const value = line.slice(separator + 3).trim();
    if (id > 0 && value) translated[id - 1] = value;
  }

  for (const [missingIndex, field] of missing.entries()) {
    const value = translated[missingIndex] || field.value;
    output[field.index] = value;
    if (value === field.value) continue;
    await db.prepare(`
      INSERT INTO localized_content (
        entity_type, entity_id, field_name, locale, source_hash, translated_text, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (entity_type, entity_id, field_name, locale)
      DO UPDATE SET source_hash = EXCLUDED.source_hash,
        translated_text = EXCLUDED.translated_text,
        updated_at = CURRENT_TIMESTAMP
    `).run(field.entityType, field.entityId, field.fieldName, language, field.hash, value);
  }
  return output;
}

function hotelLocalizationFields(hotel, rooms = []) {
  const fields = [{
    entityType: 'hotel',
    entityId: hotel.id,
    fieldName: 'description',
    value: hotel.description,
  }];
  for (const [index, room] of rooms.entries()) {
    const entityId = room.id || `${hotel.id}:${index}`;
    fields.push({ entityType: 'room', entityId, fieldName: 'name', value: room.name });
    fields.push({ entityType: 'room', entityId, fieldName: 'view_type', value: room.view_type });
  }
  return fields;
}

function applyHotelLocalization(hotel, rooms, values, language, metadata = {}) {
  let offset = 1;
  return {
    hotel: { ...hotel, description: values[0], content_language: language, ...metadata },
    rooms: rooms.map(room => ({
      ...room,
      name: values[offset++],
      view_type: values[offset++],
      content_language: language,
    })),
  };
}

async function localizeHotelFromCache(hotel, locale, rooms = []) {
  const language = supportedLanguage(locale);
  if (!hotel || language === 'en') return { hotel, rooms, translation_pending: false };
  const fields = hotelLocalizationFields(hotel, rooms);
  const cachedValues = await Promise.all(fields.map(async field => {
    if (!field.value) return { value: field.value, missing: false };
    const cached = await db.prepare(`
      SELECT translated_text FROM localized_content
      WHERE entity_type = ? AND entity_id = ? AND field_name = ? AND locale = ? AND source_hash = ?
    `).get(field.entityType, field.entityId, field.fieldName, language, sourceHash(field.value));
    return { value: cached?.translated_text || field.value, missing: !cached };
  }));
  const translationPending = cachedValues.some(item => item.missing);
  return {
    ...applyHotelLocalization(
      hotel,
      rooms,
      cachedValues.map(item => item.value),
      translationPending ? 'en' : language,
      translationPending ? { translation_pending: true } : {},
    ),
    translation_pending: translationPending,
  };
}

async function localizeHotel(hotel, locale, rooms = []) {
  const language = supportedLanguage(locale);
  if (!hotel || language === 'en') return { hotel, rooms };
  try {
    const fields = hotelLocalizationFields(hotel, rooms);
    const values = await translateFields(fields, language);
    return applyHotelLocalization(hotel, rooms, values, language);
  } catch (error) {
    console.warn(`[localization] ${hotel.id}/${language}: ${error.message}`);
    return {
      hotel: { ...hotel, content_language: 'en', translation_unavailable: true },
      rooms,
    };
  }
}

module.exports = { localizeHotel, localizeHotelFromCache, translateField, translateFields };
