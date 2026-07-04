const https = require('https');
const { withRetry } = require('../utils/retry');
const { URL } = require('url');

const BASE_URL = 'https://data.xotelo.com/api/rates';
const CACHE_TTL_HOURS = 12;

const TRIPADVISOR_URLS = {
  'Marina Bay Sands': 'https://www.tripadvisor.com/Hotel_Review-g294265-d1770798-Reviews-Marina_Bay_Sands-Singapore.html',
  'Raffles Singapore': 'https://www.tripadvisor.com/Hotel_Review-g294265-d301583-Reviews-Raffles_Singapore-Singapore.html',
  'The Fullerton Hotel Singapore': 'https://www.tripadvisor.com/Hotel_Review-g294265-d302312-Reviews-The_Fullerton_Hotel_Singapore-Singapore.html',
  'The Fullerton Bay Hotel Singapore': 'https://www.tripadvisor.com/Hotel_Review-g294265-d1950197-Reviews-The_Fullerton_Bay_Hotel_Singapore-Singapore.html',
  'Mandarin Oriental Singapore': 'https://www.tripadvisor.com/Hotel_Review-g294265-d302395-Reviews-Mandarin_Oriental_Singapore-Singapore.html',
  'The Ritz-Carlton Millenia Singapore': 'https://www.tripadvisor.com/Hotel_Review-g294265-d301686-Reviews-The_Ritz_Carlton_Millenia_Singapore-Singapore.html',
  'Shangri-La Singapore': 'https://www.tripadvisor.com/Hotel_Review-g294265-d302021-Reviews-Shangri_La_Singapore-Singapore.html',
  'Pan Pacific Singapore': 'https://www.tripadvisor.com/Hotel_Review-g294265-d300850-Reviews-Pan_Pacific_Singapore-Singapore.html',
  'Fairmont Singapore': 'https://www.tripadvisor.com/Hotel_Review-g294265-d301851-Reviews-Fairmont_Singapore-Singapore.html',
  'Swissotel The Stamford Singapore': 'https://www.tripadvisor.com/Hotel_Review-g294265-d299196-Reviews-Swissotel_The_Stamford_Singapore-Singapore.html',
  'Conrad Singapore Marina Bay': 'https://www.tripadvisor.com/Hotel_Review-g294265-d299215-Reviews-Conrad_Singapore_Marina_Bay-Singapore.html',
  'InterContinental Singapore': 'https://www.tripadvisor.com/Hotel_Review-g294265-d299199-Reviews-InterContinental_Singapore-Singapore.html',
  'Parkroyal Collection Marina Bay': 'https://www.tripadvisor.com/Hotel_Review-g294265-d299198-Reviews-PARKROYAL_COLLECTION_Marina_Bay_Singapore-Singapore.html',
  'Andaz Singapore': 'https://www.tripadvisor.com/Hotel_Review-g294265-d12189182-Reviews-Andaz_Singapore-Singapore.html',
  'Capella Singapore': 'https://www.tripadvisor.com/Hotel_Review-g294264-d1503407-Reviews-Capella_Singapore-Sentosa_Island.html',
  'W Singapore Sentosa Cove': 'https://www.tripadvisor.com/Hotel_Review-g294264-d1770797-Reviews-W_Singapore_Sentosa_Cove-Sentosa_Island.html',
  'Sofitel Singapore Sentosa Resort & Spa': 'https://www.tripadvisor.com/Hotel_Review-g294264-d301231-Reviews-Sofitel_Singapore_Sentosa_Resort_Spa-Sentosa_Island.html',
  'Atlantis The Palm': 'https://www.tripadvisor.com/Hotel_Review-g295424-d1027419-Reviews-Atlantis_The_Palm-Dubai_Emirate_of_Dubai.html',
  'Atlantis The Royal': 'https://www.tripadvisor.com/Hotel_Review-g295424-d24145282-Reviews-Atlantis_The_Royal-Dubai_Emirate_of_Dubai.html',
  'Burj Al Arab': 'https://www.tripadvisor.com/Hotel_Review-g295424-d301758-Reviews-Burj_Al_Arab-Dubai_Emirate_of_Dubai.html',
  'Jumeirah Beach Hotel': 'https://www.tripadvisor.com/Hotel_Review-g295424-d301757-Reviews-Jumeirah_Beach_Hotel-Dubai_Emirate_of_Dubai.html',
  'Armani Hotel Dubai': 'https://www.tripadvisor.com/Hotel_Review-g295424-d1735244-Reviews-Armani_Hotel_Dubai-Dubai_Emirate_of_Dubai.html',
  'Address Downtown': 'https://www.tripadvisor.com/Hotel_Review-g295424-d634471-Reviews-Address_Downtown-Dubai_Emirate_of_Dubai.html',
  'Palazzo Versace Dubai': 'https://www.tripadvisor.com/Hotel_Review-g295424-d8798340-Reviews-Palazzo_Versace_Dubai-Dubai_Emirate_of_Dubai.html',
  'One&Only Royal Mirage': 'https://www.tripadvisor.com/Hotel_Review-g295424-d301704-Reviews-One_Only_Royal_Mirage-Dubai_Emirate_of_Dubai.html',
  'Atlantis Desert Resort (Bab Al Shams)': 'https://www.tripadvisor.com/Hotel_Review-g295424-d306019-Reviews-Bab_Al_Shams-Dubai_Emirate_of_Dubai.html',
  'Five Palm Jumeirah Dubai': 'https://www.tripadvisor.com/Hotel_Review-g295424-d12122852-Reviews-FIVE_Palm_Jumeirah-Dubai_Emirate_of_Dubai.html',
  'W Dubai The Palm': 'https://www.tripadvisor.com/Hotel_Review-g295424-d15038491-Reviews-W_Dubai_The_Palm-Dubai_Emirate_of_Dubai.html',
  'Raffles Dubai': 'https://www.tripadvisor.com/Hotel_Review-g295424-d650625-Reviews-Raffles_Dubai-Dubai_Emirate_of_Dubai.html',
  'Park Hyatt Dubai': 'https://www.tripadvisor.com/Hotel_Review-g295424-d306023-Reviews-Park_Hyatt_Dubai-Dubai_Emirate_of_Dubai.html',
  'Jumeirah Al Qasr': 'https://www.tripadvisor.com/Hotel_Review-g295424-d320011-Reviews-Jumeirah_Al_Qasr-Dubai_Emirate_of_Dubai.html',
  'Madinat Jumeirah Al Naseem': 'https://www.tripadvisor.com/Hotel_Review-g295424-d11860271-Reviews-Jumeirah_Al_Naseem-Dubai_Emirate_of_Dubai.html',
  'Emirates Palace Mandarin Oriental Abu Dhabi': 'https://www.tripadvisor.com/Hotel_Review-g294013-d301220-Reviews-Emirates_Palace_Mandarin_Oriental_Abu_Dhabi-Abu_Dhabi_Emirate_of_Abu_Dhabi.html',
  'The St. Regis Abu Dhabi': 'https://www.tripadvisor.com/Hotel_Review-g294013-d5018758-Reviews-The_St_Regis_Abu_Dhabi-Abu_Dhabi_Emirate_of_Abu_Dhabi.html',
  'The Ritz-Carlton Abu Dhabi Grand Canal': 'https://www.tripadvisor.com/Hotel_Review-g294013-d2301527-Reviews-The_Ritz_Carlton_Abu_Dhabi_Grand_Canal-Abu_Dhabi_Emirate_of_Abu_Dhabi.html',
  'Qasr Al Sarab Desert Resort by Anantara': 'https://www.tripadvisor.com/Hotel_Review-g13949881-d1514328-Reviews-Qasr_Al_Sarab_Desert_Resort_by_Anantara-Liwa_Abu_Dhabi_Emirate_of_Abu_Dhabi.html',
  'Waldorf Astoria Ras Al Khaimah': 'https://www.tripadvisor.com/Hotel_Review-g298551-d302417-Reviews-Waldorf_Astoria_Ras_Al_Khaimah-Ras_Al_Khaimah_Emirate_of_Ras_Al_Khaimah.html',
};

const HOTEL_OVERRIDES = {
  'Marina Bay Sands': { location: 'Marina Bay', base_price: 380, rating: 4.4, review_count: 31200, latitude: 1.2834, longitude: 103.8607 },
  'Raffles Singapore': { location: 'City Hall', base_price: 520, rating: 4.6, review_count: 6540, latitude: 1.2949, longitude: 103.8546 },
  'The Fullerton Hotel Singapore': { latitude: 1.2862, longitude: 103.8535 },
  'The Fullerton Bay Hotel Singapore': { location: 'Marina Bay', base_price: 520, rating: 4.7, review_count: 8920, latitude: 1.2868, longitude: 103.8538 },
  'Mandarin Oriental Singapore': { location: 'Marina Bay', base_price: 620, rating: 4.8, review_count: 13080, latitude: 1.2919, longitude: 103.8577 },
  'The Ritz-Carlton Millenia Singapore': { latitude: 1.2906, longitude: 103.8591 },
  'Shangri-La Singapore': { latitude: 1.3045, longitude: 103.8280 },
  'Pan Pacific Singapore': { latitude: 1.2917, longitude: 103.8600 },
  'Fairmont Singapore': { latitude: 1.2933, longitude: 103.8536 },
  'Swissotel The Stamford Singapore': { latitude: 1.2931, longitude: 103.8535 },
  'Conrad Singapore Marina Bay': { latitude: 1.2925, longitude: 103.8592 },
  'InterContinental Singapore': { latitude: 1.2980, longitude: 103.8553 },
  'Parkroyal Collection Marina Bay': { latitude: 1.2912, longitude: 103.8593 },
  'Andaz Singapore': { latitude: 1.3004, longitude: 103.8588 },
  'Capella Singapore': { location: 'Sentosa Island', base_price: 1050, rating: 4.9, review_count: 4210, latitude: 1.2494, longitude: 103.8176 },
  'W Singapore Sentosa Cove': { latitude: 1.2456, longitude: 103.8303 },
  'Sofitel Singapore Sentosa Resort & Spa': { latitude: 1.2499, longitude: 103.8238 },
  'Atlantis The Palm': { location: 'Palm Jumeirah', base_price: 520, rating: 4.6, review_count: 24000, latitude: 25.1304, longitude: 55.1171 },
  'Atlantis The Royal': { location: 'Palm Jumeirah', base_price: 690, rating: 4.7, review_count: 18600, latitude: 25.1318, longitude: 55.1186 },
  'Burj Al Arab': { location: 'Jumeirah Beach', base_price: 1450, rating: 4.7, review_count: 7800, latitude: 25.1412, longitude: 55.1853 },
  'Jumeirah Beach Hotel': { latitude: 25.1417, longitude: 55.1860 },
  'Armani Hotel Dubai': { latitude: 25.1972, longitude: 55.2744 },
  'Address Downtown': { latitude: 25.1970, longitude: 55.2796 },
  'Palazzo Versace Dubai': { latitude: 25.2068, longitude: 55.3470 },
  'One&Only Royal Mirage': { latitude: 25.0985, longitude: 55.1486 },
  'Atlantis Desert Resort (Bab Al Shams)': { latitude: 24.7922, longitude: 55.3689 },
  'Five Palm Jumeirah Dubai': { latitude: 25.1124, longitude: 55.1388 },
  'W Dubai The Palm': { latitude: 25.1078, longitude: 55.1413 },
  'Raffles Dubai': { latitude: 25.2285, longitude: 55.3211 },
  'Park Hyatt Dubai': { latitude: 25.2299, longitude: 55.3270 },
  'Jumeirah Al Qasr': { latitude: 25.1332, longitude: 55.1835 },
  'Madinat Jumeirah Al Naseem': { latitude: 25.1358, longitude: 55.1823 },
  'Emirates Palace Mandarin Oriental Abu Dhabi': { location: 'Corniche', base_price: 520, rating: 4.8, review_count: 7900, latitude: 24.4618, longitude: 54.3175 },
  'The St. Regis Abu Dhabi': { latitude: 24.4707, longitude: 54.3427 },
  'The Ritz-Carlton Abu Dhabi Grand Canal': { latitude: 24.4149, longitude: 54.4880 },
  'Qasr Al Sarab Desert Resort by Anantara': { location: 'Liwa Desert', base_price: 610, rating: 4.8, review_count: 5200, latitude: 23.9046, longitude: 54.4050 },
  'Waldorf Astoria Ras Al Khaimah': { latitude: 25.6869, longitude: 55.7923 },
};

function slugifyHotelName(name) {
  return `hotel-${name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;
}

function inferDestination(name, url) {
  const text = `${name} ${url}`;
  if (text.includes('Ras_Al_Khaimah')) {
    return { city: 'Ras Al Khaimah', country: 'UAE', location: 'Ras Al Khaimah' };
  }
  if (text.includes('Abu_Dhabi') || text.includes('Liwa')) {
    return { city: text.includes('Liwa') ? 'Liwa' : 'Abu Dhabi', country: 'UAE', location: text.includes('Liwa') ? 'Liwa Desert' : 'Abu Dhabi' };
  }
  if (text.includes('Dubai')) {
    return { city: 'Dubai', country: 'UAE', location: name.includes('Palm') || name.includes('Atlantis') || name.includes('Royal Mirage') ? 'Palm Jumeirah' : 'Dubai' };
  }
  if (text.includes('Sentosa')) {
    return { city: 'Singapore', country: 'Singapore', location: 'Sentosa Island' };
  }
  return { city: 'Singapore', country: 'Singapore', location: name.includes('Marina') || name.includes('Fullerton') || name.includes('Mandarin') ? 'Marina Bay' : 'Singapore' };
}

function defaultBasePrice(city, name) {
  if (HOTEL_OVERRIDES[name]?.base_price) return HOTEL_OVERRIDES[name].base_price;
  if (city === 'Dubai') return name.includes('Burj') || name.includes('Royal') ? 950 : 520;
  if (city === 'Abu Dhabi') return 480;
  if (city === 'Liwa') return 610;
  if (city === 'Ras Al Khaimah') return 360;
  return 520;
}

function defaultAmenities(city, location) {
  const amenities = ['pool', 'spa', 'gym', 'restaurant', 'bar', 'breakfast', 'wifi', 'concierge'];
  if (['Dubai', 'Abu Dhabi', 'Liwa', 'Ras Al Khaimah'].includes(city) || location.includes('Sentosa')) {
    amenities.push('beach');
  }
  if (location.includes('Desert') || city === 'Liwa') amenities.push('desert');
  return JSON.stringify(amenities);
}

function buildHotelCatalog() {
  return Object.entries(TRIPADVISOR_URLS).map(([name, tripadvisor_url]) => {
    const destination = inferDestination(name, tripadvisor_url);
    const override = HOTEL_OVERRIDES[name] || {};
    const location = override.location || destination.location;
    const base_price = defaultBasePrice(destination.city, name);
    return {
      id: slugifyHotelName(name),
      name,
      location,
      city: destination.city,
      country: destination.country,
      stars: 5,
      description: `${name} is a luxury hotel in ${location}, ${destination.city}, connected to Fairworth through TripAdvisor identifiers and Xotelo live price checks.`,
      amenities: defaultAmenities(destination.city, location),
      latitude: override.latitude ?? null,
      longitude: override.longitude ?? null,
      base_price,
      rating: override.rating || 4.6,
      review_count: override.review_count || 5000,
      tripadvisor_url,
      tripadvisor_location_id: extractTripadvisorLocationId(tripadvisor_url),
      tripadvisor_hotel_key: extractTripadvisorHotelKey(tripadvisor_url),
    };
  });
}

function extractTripadvisorHotelKey(value = '') {
  const match = String(value).match(/(?:Hotel_Review-)?(g\d+-d\d+)/i);
  return match ? match[1] : null;
}

function extractTripadvisorLocationId(value = '') {
  const key = extractTripadvisorHotelKey(value);
  return key ? key.split('-d')[1] : null;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Fairworth/1.0',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Xotelo HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Xotelo JSON parse error: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error('Xotelo request timeout'));
    });
  });
}

async function getRates({ hotel_key, check_in, check_out }) {
  const url = new URL(BASE_URL);
  url.searchParams.set('hotel_key', hotel_key);
  url.searchParams.set('chk_in', check_in);
  url.searchParams.set('chk_out', check_out);

  const payload = await withRetry(() => fetchJson(url), { attempts: 3, baseDelayMs: 300 });
  if (payload.error) throw new Error(String(payload.error));

  return {
    check_in: payload.result?.chk_in || check_in,
    check_out: payload.result?.chk_out || check_out,
    currency: payload.result?.currency || 'USD',
    rates: Array.isArray(payload.result?.rates) ? payload.result.rates : [],
    timestamp: payload.timestamp || Date.now(),
  };
}

module.exports = {
  CACHE_TTL_HOURS,
  HOTEL_CATALOG: buildHotelCatalog(),
  TRIPADVISOR_URLS,
  extractTripadvisorHotelKey,
  extractTripadvisorLocationId,
  getRates,
};
