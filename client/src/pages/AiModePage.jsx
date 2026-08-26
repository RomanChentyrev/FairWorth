import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUp, Bot, CalendarDays, Check, ChevronRight, CircleDollarSign, Clock3,
  Hotel, LoaderCircle, MapPin, Menu, MessageSquarePlus, PanelRightClose,
  Plane, Plus, Route, Sparkles, Trash2, UserRound, X,
} from 'lucide-react';
import { aiModeApi, flightsApi, hotelsApi } from '../api';
import { useLang } from '../i18n/LanguageContext';
import { useTripBasket } from '../context/TripBasketContext';
import { formatAmount } from '../utils/money';
import { buildBudgetOptions } from '../utils/aiBudgetPlan';
import styles from './AiModePage.module.css';

const QUICK_ACTIONS = [
  { key: 'inspiration', icon: MapPin, prompt: 'ai_prompt_inspiration' },
  { key: 'hotel', icon: Hotel, prompt: 'ai_prompt_hotel' },
  { key: 'flight', icon: Plane, prompt: 'ai_prompt_flight' },
  { key: 'plan', icon: Route, prompt: 'ai_prompt_plan' },
  { key: 'budget', icon: CircleDollarSign, prompt: 'ai_prompt_budget' },
];

function readableDate(value, lang) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });
}

function compactHotel(hotel) {
  return {
    id: String(hotel.id), type: 'hotel', name: hotel.name, city: hotel.city, location: hotel.location,
    image_url: hotel.image_url || hotel.thumbnail_url || null, stars: Number(hotel.stars || 0),
    rating: hotel.rating == null ? null : Number(hotel.rating), price: Number(hotel.min_price || 0),
    currency: hotel.price_details?.currency || 'USD', score: Number(hotel.fairworth_score || 0),
    adjusted_score: Number(hotel.adjusted_score || hotel.fairworth_score || 0),
    score_reliability: hotel.score_reliability == null ? null : Number(hotel.score_reliability),
    availability_status: hotel.availability_status || (hotel.min_price ? 'available' : 'price_pending'),
    reasons: (hotel.score_explanation_factors || hotel.personalization_reasons || []).slice(0, 3),
  };
}

function compactFlight(ticket, context) {
  return {
    id: String(ticket.id || `${ticket.source}-${ticket.airline}-${ticket.departure_at}-${ticket.price}`),
    type: 'flight', airline: ticket.airline_name || ticket.airline || 'Airline', flight_number: ticket.flight_number || null,
    origin: ticket.origin_airport || ticket.origin || context.origin,
    destination: ticket.destination_airport || ticket.destination || context.destination,
    departure_at: ticket.departure_at || null, arrival_at: ticket.arrival_local_at || null,
    return_at: ticket.return_at || null,
    duration: Number(ticket.duration_to || ticket.duration || 0), stops: ticket.transfers ?? ticket.stops ?? null,
    price: Number(ticket.price || 0), currency: ticket.currency || context.currency || 'USD',
    score: Number(ticket.fairworth_score || 0), adjusted_score: Number(ticket.adjusted_score || ticket.fairworth_score || 0),
    fare_confidence: ticket.fare_confidence == null ? null : Number(ticket.fare_confidence),
    source: ticket.source || null, alternative_date: Boolean(ticket.is_alternative_date),
  };
}

function ContextChip({ icon: Icon, children }) {
  return <span className={styles.contextChip}>{Icon && <Icon size={13} />}{children}</span>;
}

function HotelResult({ result, onSelect, onOpen, t }) {
  return <article className={styles.resultCard}>
    <button className={styles.resultImage} type="button" onClick={onOpen} style={result.image_url ? { backgroundImage: `url(${result.image_url})` } : undefined} aria-label={result.name}>
      {!result.image_url && <Hotel size={25} />}
      {result.score > 0 && <span className={styles.scoreBadge}>{result.score}</span>}
    </button>
    <div className={styles.resultBody}>
      <div className={styles.resultEyebrow}>{'★'.repeat(Math.min(result.stars, 5)) || 'Hotel'}</div>
      <button className={styles.resultTitle} type="button" onClick={onOpen}>{result.name}</button>
      <div className={styles.resultMeta}><MapPin size={12} /> {result.location || result.city}</div>
      <div className={styles.resultBottom}>
        <div><strong>{result.price ? `$${formatAmount(result.price)}` : '—'}</strong><span>{t('card_per_night')}</span></div>
        <button type="button" onClick={onSelect}><Plus size={14} /> {t('ai_add')}</button>
      </div>
    </div>
  </article>;
}

function FlightResult({ result, onSelect, onOpen, t, lang }) {
  const departure = result.departure_at ? new Date(result.departure_at) : null;
  const stops = result.stops === 0 ? t('flight_direct') : result.stops == null ? t('ai_stops_unknown') : `${result.stops} ${t('flight_stops')}`;
  return <article className={styles.flightResult}>
    <div className={styles.flightMark}><Plane size={18} /></div>
    <div className={styles.flightRoute}>
      <button type="button" className={styles.flightOpen} onClick={onOpen}>
        <strong>{result.origin} <ChevronRight size={13} /> {result.destination}</strong>
      </button>
      <span>{result.airline}{result.flight_number ? ` · ${result.flight_number}` : ''}</span>
      <small>{departure && !Number.isNaN(departure.getTime()) ? departure.toLocaleString(lang, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : t('ai_schedule_pending')} · {stops}</small>
    </div>
    <div className={styles.flightPrice}><strong>${formatAmount(result.price, lang)}</strong><span>{result.currency}</span></div>
    <button className={styles.iconAction} type="button" onClick={onSelect} aria-label={t('ai_add')}><Plus size={16} /></button>
  </article>;
}

function BudgetResult({ result, onHotelSelect, onFlightSelect, onHotelOpen, onFlightOpen, t, lang }) {
  return <article className={`${styles.budgetResult} ${result.within_budget ? styles.budgetWithin : styles.budgetOver}`}>
    <header>
      <span>{result.within_budget ? t('ai_budget_within') : t('ai_budget_closest')}</span>
      <strong>{formatAmount(result.total, lang)} {result.currency}</strong>
    </header>
    <div className={styles.budgetLeg}>
      <Hotel size={16} /><button className={styles.budgetOpen} type="button" onClick={() => onHotelOpen(result.hotel)}><strong>{result.hotel.name}</strong><small>{formatAmount(result.hotel_total, lang)} {result.currency} · {result.nights} {t('ai_nights')}</small></button>
      <button type="button" onClick={() => onHotelSelect(result.hotel)}><Plus size={14} />{t('ai_add')}</button>
    </div>
    <div className={styles.budgetLeg}>
      <Plane size={16} /><button className={styles.budgetOpen} type="button" onClick={() => onFlightOpen(result.flight)}><strong>{result.flight.airline} · {result.flight.origin} → {result.flight.destination}</strong><small>{formatAmount(result.flight_total, lang)} {result.currency} · {result.travelers} {t('ai_travelers')}</small></button>
      <button type="button" onClick={() => onFlightSelect(result.flight)}><Plus size={14} />{t('ai_add')}</button>
    </div>
    <footer>
      <span>{t('ai_budget_total')}</span>
      <strong>{result.within_budget ? `${formatAmount(result.remaining_budget, lang)} ${result.currency} ${t('ai_budget_left')}` : `${formatAmount(result.shortfall, lang)} ${result.currency} ${t('ai_budget_over')}`}</strong>
    </footer>
  </article>;
}

function ToolMessage({ message, context, onHotelSelect, onFlightSelect, onHotelOpen, onFlightOpen, t, lang }) {
  const results = message.metadata?.results || [];
  const tool = message.metadata?.tool;
  return <div className={styles.toolMessage}>
    <div className={styles.toolHeader}>
      <span><Check size={13} /> {tool === 'hotel_search' ? t('ai_hotel_search') : tool === 'flight_search' ? t('ai_flight_search') : tool === 'budget_plan' ? t('ai_budget_plan') : t('ai_tool')}</span>
      <time>{message.metadata?.result_timestamp ? new Date(message.metadata.result_timestamp).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) : ''}</time>
    </div>
    {message.content && <p>{message.content}</p>}
    {tool === 'hotel_search' && <div className={styles.hotelRail}>{results.map(result => <HotelResult key={result.id} result={result} context={context} t={t} onSelect={() => onHotelSelect(result)} onOpen={() => onHotelOpen(result)} />)}</div>}
    {tool === 'flight_search' && <div className={styles.flightList}>{results.map(result => <FlightResult key={result.id} result={result} t={t} lang={lang} onSelect={() => onFlightSelect(result)} onOpen={() => onFlightOpen(result)} />)}</div>}
    {tool === 'budget_plan' && <div className={styles.budgetGrid}>{results.map(result => <BudgetResult key={result.id} result={result} t={t} lang={lang} onHotelSelect={onHotelSelect} onFlightSelect={onFlightSelect} onHotelOpen={onHotelOpen} onFlightOpen={onFlightOpen} />)}</div>}
    {tool === 'compare' && <div className={styles.compareGrid}>{results.map(result => <div key={result.id} className={styles.compareItem}>
      <strong>{result.name || result.airline}</strong>
      <span>{result.type === 'hotel' ? `${result.stars || 0} ★ · ${result.location || result.city || ''}` : `${result.origin} → ${result.destination}`}</span>
      <dl><dt>{t('ai_compare_price')}</dt><dd>{result.price ? `${formatAmount(result.price, lang)} ${result.currency || 'USD'}` : '—'}</dd><dt>{t('ai_compare_score')}</dt><dd>{result.adjusted_score || result.score || '—'}</dd></dl>
    </div>)}</div>}
    {tool === 'itinerary' && <ol className={styles.itinerary}>{results.map(item => <li key={`${item.date}-${item.order}`}><time>{readableDate(item.date, lang)}</time><div><strong>{item.title}</strong>{item.detail && <span>{item.detail}</span>}</div></li>)}</ol>}
    {!results.length && message.metadata?.status === 'no_results' && <div className={styles.emptyTool}><MapPin size={20} /><span>{t('ai_no_verified_options')}</span></div>}
  </div>;
}

export default function AiModePage() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { basket, selectHotel, selectFlight } = useTripBasket();
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [toolStatus, setToolStatus] = useState('');
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia('(max-width: 760px)').matches);
  const [composerFocused, setComposerFocused] = useState(false);
  const [visualViewportHeight, setVisualViewportHeight] = useState(null);
  const [visualViewportOffset, setVisualViewportOffset] = useState(0);
  const timelineRef = useRef(null);

  useEffect(() => {
    const compactViewport = window.matchMedia('(max-width: 760px)');
    const handleViewportChange = event => {
      if (event.matches) setContextOpen(false);
    };
    compactViewport.addEventListener('change', handleViewportChange);
    return () => compactViewport.removeEventListener('change', handleViewportChange);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    const updateHeight = () => {
      const browserHeight = Number(window.innerHeight) || 0;
      const visualHeight = Number(viewport?.height) || browserHeight;
      setVisualViewportHeight(Math.round(Math.min(browserHeight, visualHeight)));
      setVisualViewportOffset(Math.max(0, Math.round(Number(viewport?.offsetTop) || 0)));
    };
    updateHeight();
    viewport?.addEventListener('resize', updateHeight);
    viewport?.addEventListener('scroll', updateHeight);
    window.addEventListener('resize', updateHeight);
    return () => {
      viewport?.removeEventListener('resize', updateHeight);
      viewport?.removeEventListener('scroll', updateHeight);
      window.removeEventListener('resize', updateHeight);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('aiKeyboardOpen', composerFocused);
    document.body.classList.add('aiModeActive');
    if (composerFocused) document.body.style.overflow = 'hidden';
    else document.body.style.removeProperty('overflow');
    return () => {
      document.body.classList.remove('aiKeyboardOpen', 'aiModeActive');
      document.body.style.removeProperty('overflow');
    };
  }, [composerFocused]);

  const context = activeConversation?.search_context || {};
  const sortedConversations = useMemo(() => [...conversations].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)), [conversations]);

  const updateConversation = useCallback(conversation => {
    setActiveConversation(conversation);
    setConversations(current => [conversation, ...current.filter(item => item.id !== conversation.id)]);
  }, []);

  const openConversation = useCallback(async id => {
    setLoading(true); setError('');
    try {
      const response = await aiModeApi.getConversation(id);
      setActiveConversation(response.data.conversation);
      setMessages(response.data.messages || []);
      setSidebarOpen(false);
    } catch (requestError) {
      setError(requestError.response?.data?.error || t('ai_error_generic'));
    } finally { setLoading(false); }
  }, [t]);

  const newConversation = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await aiModeApi.createConversation({ language: lang });
      updateConversation(response.data.conversation);
      setMessages([]);
      setSidebarOpen(false);
    } catch (requestError) {
      setError(requestError.response?.data?.error || t('ai_error_generic'));
    } finally { setLoading(false); }
  }, [lang, t, updateConversation]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const response = await aiModeApi.conversations();
        if (!mounted) return;
        const list = response.data.conversations || [];
        setConversations(list);
        if (list[0]) await openConversation(list[0].id);
        else await newConversation();
      } catch (requestError) {
        if (mounted) { setError(requestError.response?.data?.error || t('ai_error_generic')); setLoading(false); }
      }
    })();
    return () => { mounted = false; };
  }, [newConversation, openConversation, t]);

  useEffect(() => {
    timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, toolStatus]);

  const recordTool = useCallback(async payload => {
    const response = await aiModeApi.recordToolResults(activeConversation.id, payload);
    setMessages(current => [...current, response.data.message]);
  }, [activeConversation?.id]);

  const resolveAirport = useCallback(async value => {
    const clean = String(value || '').trim();
    if (/^[A-Z]{3}$/.test(clean.toUpperCase())) return clean.toUpperCase();
    const response = await flightsApi.searchAirports(clean);
    const candidates = response.data?.data || [];
    return (candidates.find(item => item.type === 'city') || candidates[0])?.code || clean.toUpperCase();
  }, []);

  const findHotelOptions = useCallback(async current => {
    const baseRequest = {
      city: current.destination, check_in: current.date_start, check_out: current.date_end,
      guests: current.travelers || 2, trip_purpose: current.trip_purpose || 'leisure',
      language: lang, limit: 30, sort: 'score', search_session_id: activeConversation.id,
    };
    const available = [];
    const seen = new Set();
    let offset = 0;
    let hasMore = true;
    let page = 0;
    while (hasMore && offset < 180 && available.length < 6) {
      const request = { ...baseRequest, offset, ...(page === 0 ? { search_event: '1' } : {}) };
      const catalog = await hotelsApi.search(request);
      const candidates = (catalog.data.hotels || []).filter(hotel => !seen.has(hotel.id));
      candidates.forEach(hotel => seen.add(hotel.id));
      for (let index = 0; index < candidates.length && available.length < 6; index += 12) {
        const batch = candidates.slice(index, index + 12);
        const rates = await hotelsApi.loadRateBatch({
          hotel_ids: batch.map(hotel => hotel.id), check_in: current.date_start,
          check_out: current.date_end, guests: current.travelers || 2, language: lang,
          trip_purpose: current.trip_purpose || 'leisure',
        });
        for (const hotel of rates.data.hotels || []) {
          if (hotel.availability_status === 'available' && Number(hotel.min_price) > 0) available.push(hotel);
        }
      }
      hasMore = Boolean(catalog.data.has_more) && candidates.length > 0;
      offset = Number(catalog.data.next_offset ?? offset + candidates.length);
      page += 1;
    }
    const results = [...new Map(available.map(hotel => [hotel.id, hotel])).values()]
      .sort((a, b) => Number(b.adjusted_score || b.fairworth_score || 0) - Number(a.adjusted_score || a.fairworth_score || 0))
      .slice(0, 6).map(compactHotel);
    return { request: baseRequest, results };
  }, [activeConversation?.id, lang]);

  const findFlightOptions = useCallback(async (current, { requireRoundTrip = false } = {}) => {
    const [origin, destination] = await Promise.all([resolveAirport(current.origin), resolveAirport(current.destination)]);
    const request = {
      origin, destination, depart_date: current.date_start, return_date: current.date_end || undefined,
      passengers: current.travelers || 1, cabin_class: current.cabin_class || undefined,
      max_stops: current.max_stops ?? undefined, currency: current.currency || 'USD', limit: 10,
      include_alternatives: true,
      allow_profile_fallback: true,
      require_round_trip: requireRoundTrip && Boolean(current.date_end),
    };
    const response = await flightsApi.top(request);
    const offers = response.data.data || [];
    const comparableOffers = requireRoundTrip && current.date_end
      ? offers.filter(ticket => ticket.return_at)
      : offers;
    return {
      request: { ...request, profile_constraints_relaxed: response.data.profile_constraints_relaxed === true },
      results: comparableOffers.slice(0, 8).map(ticket => compactFlight(ticket, request)),
      diagnostics: {
        search_status: response.data.search_status,
        provider_ticket_count: response.data.provider_ticket_count,
        profile_constraints_relaxed: response.data.profile_constraints_relaxed === true,
      },
    };
  }, [resolveAirport]);

  const executeHotelSearch = useCallback(async current => {
    setToolStatus(t('ai_status_hotels'));
    const baseRequest = {
      city: current.destination, check_in: current.date_start, check_out: current.date_end,
      guests: current.travelers || 2, trip_purpose: current.trip_purpose || 'leisure',
      language: lang, limit: 30, sort: 'score', search_session_id: activeConversation.id,
    };
    try {
      const { request, results } = await findHotelOptions(current);
      await recordTool({
        tool: 'hotel_search', status: results.length ? 'success' : 'no_results', request,
        summary: results.length ? t('ai_hotels_found').replace('{count}', results.length) : t('ai_no_hotels'), results,
      });
    } catch (requestError) {
      await recordTool({ tool: 'hotel_search', status: 'error', request: baseRequest, summary: t('ai_provider_error'), results: [], error_code: requestError.response?.data?.code || 'UPSTREAM_ERROR' });
    } finally { setToolStatus(''); }
  }, [activeConversation?.id, findHotelOptions, lang, recordTool, t]);

  const executeFlightSearch = useCallback(async current => {
    setToolStatus(t('ai_status_flights'));
    let request = {};
    try {
      const found = await findFlightOptions(current);
      request = found.request;
      await recordTool({
        tool: 'flight_search', status: found.results.length ? 'success' : 'no_results', request,
        summary: found.results.length ? t('ai_flights_found').replace('{count}', found.results.length) : t('ai_no_flights'), results: found.results,
      });
    } catch (requestError) {
      await recordTool({ tool: 'flight_search', status: 'error', request, summary: t('ai_provider_error'), results: [], error_code: requestError.response?.data?.code || 'UPSTREAM_ERROR' });
    } finally { setToolStatus(''); }
  }, [findFlightOptions, recordTool, t]);

  const executeBudgetPlan = useCallback(async current => {
    setToolStatus(t('ai_status_budget'));
    const budget = Number(current.budget_amount || 0);
    const travelers = Number(current.travelers || 2);
    const request = {
      origin: current.origin, destination: current.destination, date_start: current.date_start,
      date_end: current.date_end, travelers, budget_amount: budget, currency: current.currency || 'USD',
    };
    try {
      const [hotelsResult, flightsResult] = await Promise.allSettled([
        findHotelOptions(current),
        findFlightOptions(current, { requireRoundTrip: true }),
      ]);
      const hotels = hotelsResult.status === 'fulfilled' ? hotelsResult.value.results : [];
      const flights = flightsResult.status === 'fulfilled' ? flightsResult.value.results : [];
      const { results, hasWithinBudget } = buildBudgetOptions({ hotels, flights, context: current });
      const summary = results.length
        ? hasWithinBudget ? t('ai_budget_found').replace('{count}', results.length) : t('ai_budget_nearest')
        : hotels.length ? t('ai_budget_no_flights') : flights.length ? t('ai_budget_no_hotels') : t('ai_budget_no_options');
      await recordTool({ tool: 'budget_plan', status: results.length ? 'success' : 'no_results', request, summary, results });
    } catch (requestError) {
      await recordTool({ tool: 'budget_plan', status: 'error', request, summary: t('ai_provider_error'), results: [], error_code: requestError.response?.data?.code || 'UPSTREAM_ERROR' });
    } finally { setToolStatus(''); }
  }, [findFlightOptions, findHotelOptions, recordTool, t]);

  const executeCompare = useCallback(async action => {
    const source = [...messages].reverse().find(message => ['hotel_search', 'flight_search'].includes(message.metadata?.tool) && message.metadata?.results?.length);
    const indexes = action?.result_indexes?.length ? action.result_indexes : [1, 2, 3];
    const results = indexes.map(index => source?.metadata?.results?.[index - 1]).filter(Boolean).slice(0, 4);
    await recordTool({
      tool: 'compare', status: results.length ? 'success' : 'no_results', request: { result_indexes: indexes },
      summary: results.length ? t('ai_compare_ready') : t('ai_compare_empty'), results,
    });
    if (results.length) aiModeApi.track({ event_type: 'ai_compare_opened', conversation_id: activeConversation.id, properties: { count: results.length } }).catch(() => {});
  }, [activeConversation?.id, messages, recordTool, t]);

  const executeItinerary = useCallback(async current => {
    const start = current.date_start ? new Date(`${current.date_start}T00:00:00`) : null;
    const end = current.date_end ? new Date(`${current.date_end}T00:00:00`) : start;
    const validDates = start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end >= start;
    const days = validDates ? Math.min(14, Math.floor((end - start) / 86400000) + 1) : 0;
    const results = Array.from({ length: days }, (_, index) => {
      const date = new Date(start); date.setDate(start.getDate() + index);
      const selected = index === 0 ? basket.hotel?.name || basket.outboundFlight?.title : null;
      return { order: index + 1, date: date.toISOString().slice(0, 10), title: `${t('ai_itinerary_day')} ${index + 1}`, detail: selected || current.destination || '' };
    });
    await recordTool({
      tool: 'itinerary', status: results.length ? 'success' : 'no_results', request: { date_start: current.date_start, date_end: current.date_end },
      summary: results.length ? t('ai_itinerary_ready') : t('ai_itinerary_empty'), results,
    });
  }, [basket.hotel?.name, basket.outboundFlight?.title, recordTool, t]);

  const submit = useCallback(async textValue => {
    const content = String(textValue || draft).trim();
    if (!content || sending || !activeConversation) return;
    setDraft(''); setSending(true); setError('');
    const optimistic = { id: `local-${Date.now()}`, role: 'user', content, created_at: new Date().toISOString() };
    setMessages(current => [...current, optimistic]);
    try {
      const response = await aiModeApi.sendMessage(activeConversation.id, { content, language: lang });
      setMessages(current => [...current.filter(message => message.id !== optimistic.id), response.data.user_message, response.data.assistant_message]);
      updateConversation(response.data.conversation);
      const nextContext = response.data.conversation.search_context || {};
      if (response.data.action?.type === 'hotel_search') await executeHotelSearch(nextContext);
      if (response.data.action?.type === 'flight_search') await executeFlightSearch(nextContext);
      if (response.data.action?.type === 'budget_plan') await executeBudgetPlan(nextContext);
      if (response.data.action?.type === 'compare') await executeCompare(response.data.action);
      if (response.data.action?.type === 'itinerary') await executeItinerary(nextContext);
    } catch (requestError) {
      setMessages(current => current.filter(message => message.id !== optimistic.id));
      setDraft(content);
      setError(requestError.response?.data?.error || t('ai_error_generic'));
    } finally { setSending(false); }
  }, [activeConversation, draft, executeBudgetPlan, executeCompare, executeFlightSearch, executeHotelSearch, executeItinerary, lang, sending, t, updateConversation]);

  const deleteConversation = async (event, id) => {
    event.stopPropagation();
    await aiModeApi.deleteConversation(id);
    const remaining = conversations.filter(item => item.id !== id);
    setConversations(remaining);
    if (activeConversation?.id === id) {
      if (remaining[0]) await openConversation(remaining[0].id);
      else await newConversation();
    }
  };

  const selectHotelResult = result => {
    const nights = context.date_start && context.date_end ? Math.max(1, Math.round((new Date(context.date_end) - new Date(context.date_start)) / 86400000)) : 1;
    selectHotel({ id: result.id, name: result.name, city: result.city, location: result.location, checkIn: context.date_start, checkOut: context.date_end, nights, pricePerNight: result.price, totalPrice: result.price * nights, currency: result.currency || 'USD' });
    aiModeApi.track({ event_type: 'ai_trip_created', conversation_id: activeConversation.id, properties: { entity_type: 'hotel', entity_id: result.id } }).catch(() => {});
  };

  const selectFlightResult = result => {
    selectFlight('outbound', { flightId: result.id, title: `${result.airline} ${result.flight_number || ''}`.trim(), airline: result.airline, flightNumber: result.flight_number, originCode: result.origin, destinationCode: result.destination, date: result.departure_at?.slice(0, 10), provider: result.source, pricePerPerson: result.price, passengers: context.travelers || 1, totalPrice: result.price * (context.travelers || 1), currency: result.currency || 'USD', fairworthScore: result.score, adjustedScore: result.adjusted_score, fareConfidence: result.fare_confidence });
    aiModeApi.track({ event_type: 'ai_trip_created', conversation_id: activeConversation.id, properties: { entity_type: 'flight', entity_id: result.id } }).catch(() => {});
  };

  const openHotelResult = result => {
    aiModeApi.track({ event_type: 'ai_result_clicked', conversation_id: activeConversation.id, properties: { entity_type: 'hotel', entity_id: result.id } }).catch(() => {});
    navigate(`/hotel/${result.id}?check_in=${context.date_start || ''}&check_out=${context.date_end || ''}&guests=${context.travelers || 2}`);
  };

  const openFlightResult = result => {
    const storageKey = `tripalora-flight-${result.id}`;
    window.sessionStorage.setItem(storageKey, JSON.stringify({ flight: result, context }));
    aiModeApi.track({ event_type: 'ai_result_clicked', conversation_id: activeConversation.id, properties: { entity_type: 'flight', entity_id: result.id } }).catch(() => {});
    navigate(`/flight/${encodeURIComponent(result.id)}`, { state: { flight: result, context } });
  };

  const contextItems = [
    context.origin && { icon: Plane, value: context.origin },
    context.destination && { icon: MapPin, value: context.destination },
    context.date_start && { icon: CalendarDays, value: context.date_end ? `${readableDate(context.date_start, lang)} – ${readableDate(context.date_end, lang)}` : readableDate(context.date_start, lang) },
    context.travelers && { icon: UserRound, value: `${context.travelers} ${t('ai_travelers')}` },
    context.budget_amount && { icon: CircleDollarSign, value: `${formatAmount(context.budget_amount, lang)} ${context.currency || ''}` },
  ].filter(Boolean);

  return <main
    className={`${styles.page} ${contextOpen ? '' : styles.contextHidden} ${composerFocused ? styles.keyboardOpen : ''}`}
    style={visualViewportHeight ? {
      '--ai-visual-viewport-height': `${visualViewportHeight}px`,
      '--ai-visual-viewport-offset': `${visualViewportOffset}px`,
    } : undefined}
  >
    <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
      <div className={styles.sidebarHeader}><div><span className={styles.sidebarMark}><Sparkles size={17} /></span><strong>AI Mode</strong></div><button type="button" aria-label="Close conversations" onClick={() => setSidebarOpen(false)} className={styles.mobileClose}><X size={18} /></button></div>
      <button className={styles.newChat} type="button" onClick={newConversation}><MessageSquarePlus size={16} />{t('ai_new_chat')}</button>
      <div className={styles.historyLabel}>{t('ai_history')}</div>
      <div className={styles.historyList}>{sortedConversations.map(conversation => <div key={conversation.id} className={`${styles.historyEntry} ${conversation.id === activeConversation?.id ? styles.historyActive : ''}`}>
        <button type="button" className={styles.historyItem} onClick={() => openConversation(conversation.id)}>
          <span><strong>{conversation.title}</strong><small>{new Date(conversation.updated_at).toLocaleDateString(lang, { month: 'short', day: 'numeric' })}</small></span>
        </button>
        <button type="button" className={styles.historyDelete} aria-label={`Delete ${conversation.title}`} onClick={event => deleteConversation(event, conversation.id)}><Trash2 size={13} /></button>
      </div>)}</div>
      <div className={styles.sidebarFoot}><span className={styles.onlineDot} />{t('ai_grounded')}</div>
    </aside>

    {sidebarOpen && <button className={styles.sidebarBackdrop} type="button" aria-label="Close" onClick={() => setSidebarOpen(false)} />}

    <section className={styles.workspace}>
      <header className={styles.workspaceHeader}>
        <button className={styles.mobileMenu} type="button" aria-label="Open conversations" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><Menu size={18} /></button>
        <div><span><Sparkles size={15} /> AI Travel Assistant</span><small>{t('ai_header_subtitle')}</small></div>
        <span className={styles.assistantStatus}><span className={styles.onlineDot} />{t('ai_grounded')}</span>
        <button className={styles.contextToggle} type="button" aria-label={t('ai_trip_context')} aria-expanded={contextOpen} onClick={() => setContextOpen(value => !value)}><PanelRightClose size={17} /></button>
      </header>

      <div className={`${styles.contextBar} ${contextItems.length === 0 ? styles.contextBarEmpty : ''}`} aria-hidden={contextItems.length === 0 || undefined}>
        {contextItems.map((item, index) => <ContextChip key={`${item.value}-${index}`} icon={item.icon}>{item.value}</ContextChip>)}
      </div>

      <div className={styles.timeline} ref={timelineRef}>
        {loading ? <div className={styles.centerState}><LoaderCircle className={styles.spin} size={26} /><span>{t('ai_loading')}</span></div> : messages.length === 0 ? <div className={styles.welcome}>
          <div className={styles.aiMark}><Sparkles size={25} /></div>
          <p className={styles.kicker}>{t('ai_welcome_kicker')}</p>
          <h1>{t('ai_welcome_title')}</h1>
          <p className={styles.welcomeText}>{t('ai_welcome_text')}</p>
          <div className={styles.quickGrid}>{QUICK_ACTIONS.map(({ key, icon: Icon, prompt }) => <button type="button" key={key} onClick={() => submit(t(prompt))}><Icon size={18} /><span>{t(`ai_quick_${key}`)}</span><ChevronRight size={15} /></button>)}</div>
          <div className={styles.trustLine}><Check size={13} />{t('ai_fact_notice')}</div>
        </div> : <div className={styles.messageList}>{messages.map((message, index) => message.role === 'tool'
          ? <ToolMessage key={`${message.id || 'tool'}-${index}`} message={message} context={context} t={t} lang={lang} onHotelSelect={selectHotelResult} onFlightSelect={selectFlightResult} onHotelOpen={openHotelResult} onFlightOpen={openFlightResult} />
          : <div key={`${message.id || message.role || 'message'}-${index}`} className={`${styles.messageRow} ${message.role === 'user' ? styles.userRow : styles.assistantRow}`}>
            <div className={styles.avatar}>{message.role === 'user' ? <UserRound size={15} /> : <Sparkles size={15} />}</div>
            <div className={styles.bubble}><p>{message.content}</p>{message.metadata?.used_profile_fields?.length > 0 && <span className={styles.profileNote}><Bot size={12} />{t('ai_profile_used')}</span>}</div>
          </div>)}
          {(sending || toolStatus) && <div className={`${styles.messageRow} ${styles.assistantRow}`}><div className={styles.avatar}><Sparkles size={15} /></div><div className={styles.thinking}><LoaderCircle className={styles.spin} size={15} />{toolStatus || t('ai_thinking')}</div></div>}
        </div>}
      </div>

      <div className={styles.composerArea}>
        {error && <div className={styles.error}><span>{error}</span><button type="button" onClick={() => setError('')}><X size={14} /></button></div>}
        <div className={styles.composer}>
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onFocus={() => {
              setComposerFocused(true);
              window.requestAnimationFrame(() => timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight }));
            }}
            onBlur={() => window.setTimeout(() => setComposerFocused(false), 120)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } }}
            placeholder={t('ai_composer_placeholder')}
            rows={1}
            maxLength={4000}
          />
          <button type="button" disabled={!draft.trim() || sending} onClick={() => submit()} aria-label={t('ai_send')}><ArrowUp size={18} /></button>
        </div>
        <small>{t('ai_disclaimer')}</small>
      </div>
    </section>

    <aside className={`${styles.contextPanel} ${contextOpen ? '' : styles.contextClosed}`} aria-hidden={!contextOpen || undefined}>
      <div className={styles.contextHeader}><div><span className={styles.contextIcon}><Route size={17} /></span><span><strong>{t('ai_trip_context')}</strong><small>{t('ai_live_context')}</small></span></div><button type="button" aria-label="Close trip context" onClick={() => setContextOpen(false)}><X size={16} /></button></div>
      <section className={styles.contextSection}><h2>{t('ai_active_request')}</h2>{contextItems.length ? <dl>{context.origin && <><dt>{t('home_from')}</dt><dd>{context.origin}</dd></>}{context.destination && <><dt>{t('home_to')}</dt><dd>{context.destination}</dd></>}{context.date_start && <><dt>{t('results_dates')}</dt><dd>{readableDate(context.date_start, lang)}{context.date_end ? ` – ${readableDate(context.date_end, lang)}` : ''}</dd></>}{context.travelers && <><dt>{t('results_guests')}</dt><dd>{context.travelers}</dd></>}</dl> : <p className={styles.muted}>{t('ai_context_empty')}</p>}</section>
      {(context.hard_constraints?.length > 0 || context.soft_preferences?.length > 0) && <section className={styles.contextSection}><h2>{t('ai_preferences')}</h2><div className={styles.constraintList}>{context.hard_constraints?.map(value => <span key={value} className={styles.hardConstraint}>{value}</span>)}{context.soft_preferences?.map(value => <span key={value}>{value}</span>)}</div></section>}
      <section className={styles.contextSection}><h2>{t('ai_your_trip')}</h2>{basket.hotel || basket.outboundFlight ? <div className={styles.tripSelections}>{basket.hotel && <div><Hotel size={16} /><span><strong>{basket.hotel.name}</strong><small>{basket.hotel.city}</small></span></div>}{basket.outboundFlight && <div><Plane size={16} /><span><strong>{basket.outboundFlight.title}</strong><small>{basket.outboundFlight.originCode} → {basket.outboundFlight.destinationCode}</small></span></div>}</div> : <p className={styles.muted}>{t('ai_trip_empty')}</p>}</section>
      <div className={styles.contextFooter}><Clock3 size={14} /><span>{t('ai_price_notice')}</span></div>
    </aside>
  </main>;
}
