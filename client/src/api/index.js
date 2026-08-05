import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

function cookieValue(name) {
  const item = document.cookie.split('; ').find(value => value.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}

api.interceptors.request.use(config => {
  const csrf = cookieValue('fw_csrf');
  if (csrf && !['get', 'head', 'options'].includes(String(config.method).toLowerCase())) config.headers['X-CSRF-Token'] = csrf;
  return config;
});

api.interceptors.response.use(response => response, async error => {
  const status = error.response?.status;
  const original = error.config;
  if (status === 401 && original && !original._sessionRetry && !String(original.url).includes('/auth/refresh')) {
    original._sessionRetry = true;
    try {
      await api.post('/auth/refresh');
      return api(original);
    } catch { /* Session expiration is handled below. */ }
  }
  if (status === 401) {
    window.dispatchEvent(new Event('fairworth-auth-expired'));
  }
  if ([401, 403, 429].includes(status)) {
    window.dispatchEvent(new CustomEvent('fairworth-api-status', { detail: {
      status,
      message: error.response?.data?.error || (status === 429 ? 'Too many requests. Please wait and try again.' : 'You do not have access to this action.'),
    } }));
  }
  return Promise.reject(error);
});

export const hotelsApi = {
  search: (params) => api.get('/hotels/search', { params }),
  loadRateBatch: (data, config = {}) => api.post('/hotels/rates/batch', data, config),
  popularDestinations: (params) => api.get('/hotels/popular-destinations', { params }),
  insights: (config = {}) => api.get('/hotels/insights', config),
  refreshInsights: () => api.post('/hotels/insights/refresh'),
  priceCalendar: (params, config = {}) => api.get('/hotels/price-calendar', { params, ...config }),
  get: (id, params = {}) => api.get(`/hotels/${id}`, { params }),
  analyze: (id, body) => api.post(`/hotels/${id}/analyze`, body),
  analyzeStream: async (id, body, onEvent) => {
    const response = await fetch(`/api/hotels/${encodeURIComponent(id)}/analyze/stream`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': cookieValue('fw_csrf') },
      body: JSON.stringify(body),
    });
    if (!response.ok || !response.body) throw new Error(`AI analysis HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new globalThis.TextDecoder();
    let buffer = '';
    let result = null;
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines.filter(Boolean)) {
        const event = JSON.parse(line);
        onEvent?.(event);
        if (event.type === 'analysis') result = event;
        if (event.type === 'error') throw new Error(event.error);
      }
      if (done) break;
    }
    if (!result?.analysis) throw new Error('AI analysis stream ended without a result');
    return result;
  },
  prices: (id) => api.get(`/hotels/${id}/prices`),
};

export const flightsApi = {
  search: (params) => api.get('/flights/search', { params }),
  cheapest: (params) => api.get('/flights/cheapest', { params }),
  top: (params) => api.get('/flights/top', { params }),
  mostSuitable: (params) => api.get('/flights/most-suitable', { params }),
  calendar: (params) => api.get('/flights/calendar', { params }),
  searchAirports: (q) => api.get('/flights/airports/search', { params: { q } }),
  airlines: () => api.get('/flights/airlines'),
};

export const transfersApi = {
  search: (params) => api.get('/transfers/search', { params }),
};

export const usersApi = {
  getMe: () => api.get('/users/me'),
  updatePreferences: (data) => api.put('/users/preferences', data),
  getBookmarks: () => api.get('/users/bookmarks'),
  toggleBookmark: (hotelId) => api.post(`/users/bookmarks/${hotelId}`),
  completeOnboarding: () => api.post('/users/onboarding/complete'),
  updateProfile: (data) => api.put('/users/profile', data),
  changePassword: (data) => api.put('/users/password', data),
  getSessions: () => api.get('/users/sessions'),
  getStats: () => api.get('/users/stats'),
  revokeSession: (id) => api.delete(`/users/sessions/${id}`),
  deleteAccount: (password) => api.delete('/users/me', { data: { password } }),
  exportData: () => api.get('/users/export', { responseType: 'blob' }),
  updateConsent: (behavioural_tracking_consent) => api.put('/users/consent', { behavioural_tracking_consent }),
  updateLocale: locale => api.put('/users/locale', { locale }),
};

export const notificationsApi = {
  watches: () => api.get('/notifications/watches'),
  createWatch: data => api.post('/notifications/watches', data),
  updateWatch: (id, data) => api.patch(`/notifications/watches/${id}`, data),
  deleteWatch: id => api.delete(`/notifications/watches/${id}`),
  settings: () => api.get('/notifications/settings'),
  updateSettings: data => api.put('/notifications/settings', data),
  trips: () => api.get('/notifications/trips'),
  createTrip: data => api.post('/notifications/trips', data),
  updateTrip: (id, data) => api.patch(`/notifications/trips/${id}`, data),
  unsubscribe: token => api.post('/notifications/unsubscribe', { token }),
};

export const legalApi = { current: () => api.get('/legal/current') };
export const capabilitiesApi = { current: () => api.get('/capabilities') };

export const achievementsApi = {
  get: () => api.get('/achievements'),
  addVisit: data => api.post('/achievements/visits', data),
  removeVisit: id => api.delete(`/achievements/visits/${id}`),
};

export const bookingsApi = {
  createDemo: data => api.post('/bookings', data),
  get: reference => api.get(`/bookings/${encodeURIComponent(reference)}`),
};

export const authApi = {
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
  verifyEmail: (token) => api.post('/auth/verify-email', { token }),
  resendVerification: (email) => api.post('/auth/resend-verification', { email }),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token, password) => api.post('/auth/reset-password', { token, password }),
};

export const partnersApi = {
  createClick: data => api.post('/partners/clicks', data),
  getClick: clickId => api.get(`/partners/clicks/${clickId}`),
};

export const adminApi = {
  anomalies: (status = 'open') => api.get('/admin/anomalies', { params: { status } }),
  resolveAnomaly: (type, id) => api.patch(`/admin/anomalies/${type}/${id}/resolve`),
  catalogSync: data => api.post('/admin/catalog/sync', data),
  catalogSyncs: () => api.get('/admin/catalog/syncs'),
  mappingReviews: (status = 'open') => api.get('/admin/catalog/mapping-reviews', { params: { status } }),
  resolveMapping: (id, status) => api.patch(`/admin/catalog/mapping-reviews/${id}`, { status }),
  auditLog: (limit = 100) => api.get('/admin/audit-log', { params: { limit } }),
};

function interactionSessionId() {
  const key = 'fairworth_interaction_session';
  let id = window.sessionStorage.getItem(key);
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(key, id);
  }
  return id;
}

export function searchSessionId() {
  const key = 'fairworth_search_session';
  let id = window.sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(key, id);
  }
  return id;
}

export const interactionsApi = {
  track: (eventType, payload = {}) => api.post('/interactions', {
    event_type: eventType,
    session_id: interactionSessionId(),
    event_id: payload.event_id || `${interactionSessionId()}:${eventType}:${payload.hotel_id || (payload.hotel_ids || []).join(',')}:${JSON.stringify(payload.context || {})}`,
    ...payload,
  }),
};

export const compareApi = {
  compare: (hotel_ids, check_in, check_out, language = 'en', guests = 2, trip_purpose = 'leisure') =>
    api.post('/compare', { hotel_ids, check_in, check_out, language, guests, trip_purpose }),
};

export default api;
