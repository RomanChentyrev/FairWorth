import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider, useLang } from './LanguageContext';

function Consumer() { const { lang, setLanguage, t, l } = useLang(); return <><span>{lang}</span><span>{t('nav_hotels')}</span><span>{l('Something went wrong', 'Что-то пошло не так')}</span><button onClick={() => setLanguage('fr')}>French</button><button onClick={() => setLanguage('zh-CN')}>Chinese</button><button onClick={() => setLanguage('ar')}>Arabic</button></>; }
describe('LanguageProvider', () => {
  beforeEach(() => { localStorage.clear(); document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; });
  it('uses English as the first-run default', () => { render(<LanguageProvider><Consumer /></LanguageProvider>); expect(screen.getByText('en')).toBeInTheDocument(); expect(document.documentElement.lang).toBe('en'); });
  it('persists language and translates catalogue and legacy UI text', () => { render(<LanguageProvider><Consumer /></LanguageProvider>); fireEvent.click(screen.getByRole('button', { name: 'French' })); expect(screen.getByText('fr')).toBeInTheDocument(); expect(document.documentElement.lang).toBe('fr'); expect(localStorage.getItem('fw_lang')).toBe('fr'); expect(screen.getByText('Hôtels')).toBeInTheDocument(); expect(screen.getByText('Un problème est survenu')).toBeInTheDocument(); });
  it('supports Simplified Chinese catalogue and legacy UI text', () => { render(<LanguageProvider><Consumer /></LanguageProvider>); fireEvent.click(screen.getByRole('button', { name: 'Chinese' })); expect(screen.getByText('zh-CN')).toBeInTheDocument(); expect(document.documentElement.lang).toBe('zh-CN'); expect(localStorage.getItem('fw_lang')).toBe('zh-CN'); expect(screen.getByText('酒店')).toBeInTheDocument(); expect(screen.getByText('出错了')).toBeInTheDocument(); });
  it('supports Arabic catalogue, legacy UI text and RTL layout', () => { render(<LanguageProvider><Consumer /></LanguageProvider>); fireEvent.click(screen.getByRole('button', { name: 'Arabic' })); expect(screen.getByText('ar')).toBeInTheDocument(); expect(document.documentElement.lang).toBe('ar'); expect(document.documentElement.dir).toBe('rtl'); expect(localStorage.getItem('fw_lang')).toBe('ar'); expect(screen.getByText('الفنادق')).toBeInTheDocument(); expect(screen.getByText('حدث خطأ ما')).toBeInTheDocument(); });
  it('falls back to an unknown key', () => { function Unknown() { return <span>{useLang().t('missing_key')}</span>; } render(<LanguageProvider><Unknown /></LanguageProvider>); expect(screen.getByText('missing_key')).toBeInTheDocument(); });
});
