# Travelpayouts Flight Data API — интеграция для Fairworth

## Что добавлено

```
server/
  services/travelpayouts.js   ← Сервис: все запросы к API + in-memory кэш
  routes/flights.js           ← Express роуты /api/flights/*
  index.js                    ← Главный сервер (flights роут подключён)
  .env.example                ← Шаблон переменных окружения
  data/                       ← Статичные JSON файлы (аэропорты, авиакомпании)

client/src/
  api/flights.js              ← Клиентский API-модуль
  components/PriceCalendar.jsx         ← Компонент ценового календаря
  components/PriceCalendar.module.css  ← Стили календаря
  components/PopularDestinations.jsx   ← Блок "Куда полететь"
```

---

## Быстрый старт

### 1. Получить токен

1. Идём на https://www.travelpayouts.com/
2. Регистрируемся (бесплатно, без карты)
3. Переходим: **Разработчикам → API → Токен для данных**
4. Копируем токен

### 2. Настроить .env

```bash
cp server/.env.example server/.env
# Вставляем токен:
TRAVELPAYOUTS_TOKEN=ваш_токен_здесь
```

### 3. Установить зависимости и запустить

```bash
cd server
npm install
node index.js
```

---

## API эндпоинты

### Дешёвые билеты
```
GET /api/flights/cheapest?origin=MOW&destination=SIN&depart_date=2026-08&currency=USD
```
Параметры:
- `origin` — IATA города вылета (обязательно)
- `destination` — IATA города прилёта или `-` для всех направлений
- `depart_date` — `2026-08` (месяц) или `2026-08-15` (день)
- `return_date` — опционально
- `currency` — USD / EUR / RUB (по умолчанию USD)

Пример ответа:
```json
{
  "success": true,
  "count": 5,
  "origin": "MOW",
  "data": [
    {
      "destination": "SIN",
      "price": 420,
      "airline": "EK",
      "flight_number": 132,
      "departure_at": "2026-08-10T10:30:00Z",
      "return_at": "2026-08-20T14:00:00Z",
      "expires_at": "2026-06-25T18:00:00Z"
    }
  ]
}
```

### Только прямые рейсы
```
GET /api/flights/direct?origin=MOW&destination=SIN&depart_date=2026-08
```

### Ценовой календарь
```
GET /api/flights/calendar?origin=MOW&destination=SIN&depart_date=2026-08
```
Возвращает цены за каждый день месяца + статистику:
```json
{
  "success": true,
  "stats": { "min": 380, "max": 650, "avg": 490, "cheap": ["2026-08-12", "2026-08-13"] },
  "data": [
    { "date": "2026-08-01", "price": 520, "airline": "SQ" },
    { "date": "2026-08-02", "price": 480, "airline": "EK" }
  ]
}
```

### Популярные направления
```
GET /api/flights/popular?origin=MOW&currency=USD
```

### Поиск аэропорта (автокомплит)
```
GET /api/flights/airports/search?q=singapore
```
```json
{
  "data": [
    { "type": "airport", "code": "SIN", "name": "Changi Airport", "city": "Singapore", "country": "SG" }
  ]
}
```

### Все авиакомпании
```
GET /api/flights/airlines
```

---

## Использование компонентов

### Ценовой календарь

```jsx
import PriceCalendar from './components/PriceCalendar';

function FlightSearch() {
  const [selectedDate, setSelectedDate] = useState(null);

  return (
    <PriceCalendar
      origin="MOW"
      destination="SIN"
      currency="USD"
      selectedDate={selectedDate}
      onSelectDate={(date, info) => {
        setSelectedDate(date);
        console.log(`Выбрано: ${date}, цена: $${info.price}`);
      }}
    />
  );
}
```

### Популярные направления

```jsx
import PopularDestinations from './components/PopularDestinations';

function HomePage() {
  return (
    <PopularDestinations
      origin="MOW"
      currency="USD"
      onSelect={({ destination, price }) => {
        navigate(`/results?city=${destination}`);
      }}
    />
  );
}
```

---

## Кэширование

| Данные | TTL |
|--------|-----|
| Дешёвые билеты | 3 часа |
| Ценовой календарь | 3 часа |
| Популярные направления | 6 часов |
| Аэропорты, авиакомпании | 24 часа (файл на диске) |

Данные Travelpayouts — кэш Aviasales. Они не real-time, но отлично подходят для:
- Блока вдохновения "Куда полететь"
- Ценового календаря
- Поиска дешёвых дней
- Автокомплита аэропортов

---

## IATA коды популярных городов

| Город | IATA |
|-------|------|
| Москва | MOW |
| Санкт-Петербург | LED |
| Сингапур | SIN |
| Дубай | DXB |
| Бангкок | BKK |
| Токио | NRT |
| Лондон | LON |
| Париж | PAR |
| Нью-Йорк | NYC |
| Мальдивы | MLE |
