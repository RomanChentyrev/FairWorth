const DESTINATION_VISUALS = {
  paris: {
    image: '/images/destinations/paris.jpg',
    tags: {
      en: 'France · culture and food', ru: 'Франция · культура и кухня', de: 'Frankreich · Kultur und Genuss',
      fr: 'France · culture et cuisine', it: 'Francia · cultura e cucina', es: 'Francia · cultura y gastronomía',
      'zh-CN': '法国 · 文化与美食', ar: 'فرنسا · الثقافة والطعام',
    },
  },
  singapore: {
    image: '/images/destinations/singapore.jpg',
    tags: {
      en: 'Singapore · city and food', ru: 'Сингапур · город и кухня', de: 'Singapur · Stadt und Genuss',
      fr: 'Singapour · ville et cuisine', it: 'Singapore · città e cucina', es: 'Singapur · ciudad y gastronomía',
      'zh-CN': '新加坡 · 城市与美食', ar: 'سنغافورة · المدينة والطعام',
    },
  },
  'da nang': {
    image: '/images/destinations/da-nang.jpg',
    tags: {
      en: 'Vietnam · beach and calm', ru: 'Вьетнам · пляж и спокойствие', de: 'Vietnam · Strand und Ruhe',
      fr: 'Viêt Nam · plage et calme', it: 'Vietnam · spiaggia e relax', es: 'Vietnam · playa y calma',
      'zh-CN': '越南 · 海滩与宁静', ar: 'فيتنام · الشاطئ والهدوء',
    },
  },
};

const FEATURED_DESTINATIONS = ['paris', 'singapore', 'da nang'];

export function destinationVisual(city, lang = 'en') {
  const visual = DESTINATION_VISUALS[String(city || '').trim().toLowerCase()];
  if (!visual) return { image: '/images/destinations/generic-flight.jpg', tag: '' };
  return { image: visual.image, tag: visual.tags[lang] || visual.tags.en };
}

export function selectFeaturedDestinations(destinations, limit = 3) {
  const list = Array.isArray(destinations) ? destinations : [];
  const selected = FEATURED_DESTINATIONS
    .map(city => list.find(item => String(item.city || '').trim().toLowerCase() === city))
    .filter(Boolean);
  const selectedKeys = new Set(selected.map(item => `${item.city}-${item.country}`));
  return [...selected, ...list.filter(item => !selectedKeys.has(`${item.city}-${item.country}`))].slice(0, limit);
}
