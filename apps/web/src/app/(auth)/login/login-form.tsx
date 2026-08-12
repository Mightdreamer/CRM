'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signInWithPassword, type SignInState } from './actions';

export function LoginForm() {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [pwState, pwAction, pwPending] = useActionState<SignInState | null, FormData>(
    signInWithPassword,
    null,
  );

  const error = (pwState && !pwState.ok && pwState.error) || null;

  return (
    <div className="space-y-6">
      <form action={pwAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
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
        <div className="space-y-2">
          <Label htmlFor="password">{t('password')}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={pwPending}>
          {pwPending ? '…' : t('signInButton')}
        </Button>
      </form>

      {error && <p className="text-sm text-red-600 text-center">{error}</p>}

      <p className="text-sm text-center">
        <Link href="/forgot-password" className="text-primary hover:underline">
          {t('forgotPassword')}
        </Link>
      </p>
    </div>
  );
}
