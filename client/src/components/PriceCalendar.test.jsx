import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageContext';
import PriceCalendar from './PriceCalendar';

vi.mock('../api', () => ({
  hotelsApi: {
    priceCalendar: vi.fn(() => Promise.resolve({
      data: { calendar: [], recommendation: null },
    })),
  },
  usersApi: {
    updateLocale: vi.fn(() => Promise.resolve()),
  },
}));

describe('PriceCalendar', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('fw_language_version', '2');
    localStorage.setItem('fw_lang', 'en');
  });

  it('renders a localized month after a destination is selected', () => {
    render(
      <LanguageProvider>
        <PriceCalendar
          city="Singapore"
          checkIn="2026-09-01"
          checkOut="2026-09-05"
          onSelectDate={vi.fn()}
        />
      </LanguageProvider>,
    );

    expect(screen.getByText('September 2026')).toBeInTheDocument();
  });
});
