import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageContext';
import { ForgotPasswordPage } from './AuthActionPage';

const { forgotPassword } = vi.hoisted(() => ({ forgotPassword: vi.fn() }));
vi.mock('../api', () => ({ authApi: { forgotPassword, verifyEmail: vi.fn(), resendVerification: vi.fn(), resetPassword: vi.fn() } }));
const renderPage = () => render(<MemoryRouter><LanguageProvider><ForgotPasswordPage /></LanguageProvider></MemoryRouter>);
describe('ForgotPasswordPage', () => {
  beforeEach(() => { forgotPassword.mockReset(); localStorage.clear(); sessionStorage.clear(); });
  it('shows a useful network error and allows retry', async () => { forgotPassword.mockRejectedValueOnce(new Error('Network Error')); renderPage(); fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } }); fireEvent.click(screen.getByRole('button', { name: 'Send reset link' })); expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the service'); expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled(); });
  it('stores the development token and confirms success', async () => { forgotPassword.mockResolvedValueOnce({ data: { development_token: 'reset-token' } }); renderPage(); fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } }); fireEvent.submit(screen.getByLabelText('Email').closest('form')); await waitFor(() => expect(sessionStorage.getItem('fairworth_reset_token')).toBe('reset-token')); expect(screen.getByText(/reset email was sent/i)).toBeInTheDocument(); });
});
