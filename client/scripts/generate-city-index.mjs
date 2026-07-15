import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cities } = require('world-cities-json');
const outputDirectory = path.resolve('public/data');
const outputFile = path.join(outputDirectory, 'world-cities.json');

const compactCities = cities
  .filter(city => Number(city.population || 0) >= 50000)
  .map(city => ({
    i: city.id,
    n: city.city,
    a: city.admin_name,
    c: city.country,
    cc: city.iso2,
    x: Number(city.lng),
    y: Number(city.lat),
    p: Number(city.population || 0),
  }));

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(compactCities));
console.log(`Generated ${compactCities.length} searchable cities in ${outputFile}`);
