import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider, useLang } from './LanguageContext';

function Consumer() { const { lang, setLanguage, t, l } = useLang(); return <><span>{lang}</span><span>{t('nav_hotels')}</span><span>{l('Something went wrong', 'Что-то пошло не так')}</span><button onClick={() => setLanguage('fr')}>French</button></>; }
describe('LanguageProvider', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.lang = 'en'; });
  it('uses English as the first-run default', () => { render(<LanguageProvider><Consumer /></LanguageProvider>); expect(screen.getByText('en')).toBeInTheDocument(); expect(document.documentElement.lang).toBe('en'); });
  it('persists language and translates catalogue and legacy UI text', () => { render(<LanguageProvider><Consumer /></LanguageProvider>); fireEvent.click(screen.getByRole('button', { name: 'French' })); expect(screen.getByText('fr')).toBeInTheDocument(); expect(document.documentElement.lang).toBe('fr'); expect(localStorage.getItem('fw_lang')).toBe('fr'); expect(screen.getByText('Hôtels')).toBeInTheDocument(); expect(screen.getByText('Un problème est survenu')).toBeInTheDocument(); });
  it('falls back to an unknown key', () => { function Unknown() { return <span>{useLang().t('missing_key')}</span>; } render(<LanguageProvider><Unknown /></LanguageProvider>); expect(screen.getByText('missing_key')).toBeInTheDocument(); });
});
