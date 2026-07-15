import { useEffect, useState } from 'react';
import { capabilitiesApi } from '../api';

let cached = null;
let pending = null;

export default function useCapabilities() {
  const [state, setState] = useState({ capabilities: cached, loading: !cached, error: null });
  useEffect(() => {
    if (cached) { setState({ capabilities: cached, loading: false, error: null }); return; }
    if (!pending) pending = capabilitiesApi.current().then(response => { cached = response.data.capabilities; return cached; }).finally(() => { pending = null; });
    pending.then(capabilities => setState({ capabilities, loading: false, error: null })).catch(error => setState({ capabilities: null, loading: false, error }));
  }, []);
  return state;
}
