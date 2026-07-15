import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider, useLang } from './LanguageContext';

function Consumer() { const { lang, toggleLang, t } = useLang(); return <><span>{lang}</span><span>{t('nav_home')}</span><button onClick={toggleLang}>toggle</button></>; }
describe('LanguageProvider', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.lang = 'en'; });
  it('uses English as the first-run default', () => { render(<LanguageProvider><Consumer /></LanguageProvider>); expect(screen.getByText('en')).toBeInTheDocument(); expect(document.documentElement.lang).toBe('en'); });
  it('persists language and updates document lang', () => { render(<LanguageProvider><Consumer /></LanguageProvider>); fireEvent.click(screen.getByRole('button', { name: 'toggle' })); expect(screen.getByText('ru')).toBeInTheDocument(); expect(document.documentElement.lang).toBe('ru'); expect(localStorage.getItem('fw_lang')).toBe('ru'); });
  it('falls back to an unknown key', () => { function Unknown() { return <span>{useLang().t('missing_key')}</span>; } render(<LanguageProvider><Unknown /></LanguageProvider>); expect(screen.getByText('missing_key')).toBeInTheDocument(); });
});
