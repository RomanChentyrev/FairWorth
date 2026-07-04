import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'fairworth_trip_basket';

const DEFAULT_BASKET = {
  hotel: null,
  outboundFlight: null,
  returnFlight: null,
  transfer: null,
};

const TripBasketContext = createContext(null);

function readBasket() {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || 'null');
    return parsed ? { ...DEFAULT_BASKET, ...parsed, transfer: null } : DEFAULT_BASKET;
  } catch {
    return DEFAULT_BASKET;
  }
}

function writeBasket(nextBasket) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(nextBasket));
}

export function TripBasketProvider({ children }) {
  const [basket, setBasket] = useState(readBasket);

  useEffect(() => {
    const resetForUser = () => {
      window.sessionStorage.removeItem(STORAGE_KEY);
      setBasket(DEFAULT_BASKET);
    };
    window.addEventListener('fairworth-user-changed', resetForUser);
    return () => window.removeEventListener('fairworth-user-changed', resetForUser);
  }, []);

  const updateBasket = (updater) => {
    setBasket(current => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      writeBasket(next);
      return next;
    });
  };

  const value = useMemo(() => {
    const selectHotel = (hotel) => updateBasket(current => ({ ...current, hotel }));
    const selectFlight = (leg, flight) => updateBasket(current => ({
      ...current,
      [leg === 'return' ? 'returnFlight' : 'outboundFlight']: flight,
    }));
    const selectTransfer = (transfer) => updateBasket(current => ({ ...current, transfer }));
    const removeItem = (item) => updateBasket(current => ({
      ...current,
      [item]: null,
    }));
    const clearBasket = () => updateBasket(DEFAULT_BASKET);

    const selectedCount = [
      basket.hotel,
      basket.outboundFlight,
      basket.returnFlight,
    ].filter(Boolean).length;

    const total = [
      basket.hotel?.totalPrice,
      basket.outboundFlight?.totalPrice,
      basket.returnFlight?.totalPrice,
    ].reduce((sum, value) => sum + (Number(value) || 0), 0);

    return {
      basket,
      selectedCount,
      total,
      selectHotel,
      selectFlight,
      selectTransfer,
      removeItem,
      clearBasket,
    };
  }, [basket]);

  return (
    <TripBasketContext.Provider value={value}>
      {children}
    </TripBasketContext.Provider>
  );
}

export function useTripBasket() {
  const context = useContext(TripBasketContext);
  if (!context) throw new Error('useTripBasket must be used inside TripBasketProvider');
  return context;
}
