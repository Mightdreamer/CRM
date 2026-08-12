'use client';

import { useActionState, useState, useTransition } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  requestPasswordResetOtp,
  verifyOtpAndUpdatePassword,
  type VerifyOtpState,
} from './actions';

export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const tErrors = useTranslations('auth.errors');

  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [reqError, setReqError] = useState<string | null>(null);
  const [reqPending, startReqTransition] = useTransition();

  const [verifyState, verifyAction, verifyPending] = useActionState<
    VerifyOtpState | null,
    FormData
  >(verifyOtpAndUpdatePassword, null);

  function submitRequestOtp(formData: FormData) {
    setReqError(null);
    startReqTransition(async () => {
      const result = await requestPasswordResetOtp(null, formData);
      if (result.ok) {
        setEmail(result.email);
        setStep('otp');
      } else {
        setReqError(result.error);
      }
    });
  }

  const verifyError = verifyState && !verifyState.ok ? verifyState.error : null;

  if (step === 'email') {
    return (
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground text-center">
          {t('forgotPasswordDescription')}
        </p>
        <form action={submitRequestOtp} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t('email')}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={reqPending}>
            {reqPending ? t('sending') : t('sendCode')}
          </Button>
        </form>

        {reqError && (
          <p className="text-sm text-red-600 text-center">{tErrors(reqError)}</p>
        )}

        <p className="text-sm text-center">
          <Link href="/login" className="text-primary hover:underline">
            {t('backToLogin')}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground text-center">
        {t('codeSentTo', { email })}
      </p>
      <form action={verifyAction} className="space-y-4">
        <input type="hidden" name="email" value={email} />

        <div className="space-y-2">
          <Label htmlFor="token">{t('otpLabel')}</Label>
          <Input
            id="token"
            name="token"
            inputMode="numeric"
            pattern="[0-9]{6,8}"
            maxLength={8}
            autoComplete="one-time-code"
            required
            value={token}
            onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">{t('newPassword')}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="passwordConfirm">{t('confirmPassword')}</Label>
          <Input
            id="passwordConfirm"
            name="passwordConfirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
          />
        </div>

        <Button type="submit" className="w-full" disabled={verifyPending}>
          {verifyPending ? t('sending') : t('changePasswordButton')}
        </Button>
      </form>

      {verifyError && (
        <p className="text-sm text-red-600 text-center">{tErrors(verifyError)}</p>
      )}

      <form action={submitRequestOtp}>
        <input type="hidden" name="email" value={email} />
        <Button
          type="submit"
          variant="ghost"
          className="w-full"
          disabled={reqPending}
        >
          {reqPending ? t('sending') : t('resendCode')}
        </Button>
      </form>

      {reqError && (
        <p className="text-sm text-red-600 text-center">{tErrors(reqError)}</p>
      )}

      <p className="text-sm text-center">
        <Link href="/login" className="text-primary hover:underline">
          {t('backToLogin')}
        </Link>
      </p>
    </div>
  );
}
