'use server';

import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { createClient } from '@crm/db/server';
import { createServiceClient } from '@crm/db/admin';
import { sendPasswordResetEmail } from '@/lib/email';

export type RequestOtpState =
  | { ok: true; email: string }
  | { ok: false; error: string };

export type VerifyOtpState =
  | { ok: true }
  | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function requestPasswordResetOtp(
  _prev: RequestOtpState | null,
  formData: FormData,
): Promise<RequestOtpState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'invalid_email' };
  }

  if (
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.RESEND_API_KEY ||
    !process.env.EMAIL_FROM
  ) {
    console.error(
      '[forgot-password] missing env vars: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY or EMAIL_FROM',
    );
    return { ok: false, error: 'not_configured' };
  }

  try {
    const admin = createServiceClient();
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
    });

    if (!error && data?.properties?.email_otp) {
      const locale = (await getLocale()) as 'en' | 'es';
      await sendPasswordResetEmail(email, data.properties.email_otp, locale);
    } else if (error) {
      console.warn('[forgot-password] generateLink error', error.message);
    }
  } catch (unexpected) {
    console.error('[forgot-password] unexpected failure', unexpected);
    return { ok: false, error: 'send_failed' };
  }

  return { ok: true, email };
}

export async function verifyOtpAndUpdatePassword(
  _prev: VerifyOtpState | null,
  formData: FormData,
): Promise<VerifyOtpState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const token = String(formData.get('token') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const passwordConfirm = String(formData.get('passwordConfirm') ?? '');

  if (!email || !token) return { ok: false, error: 'missing_fields' };
  if (password.length < 8) return { ok: false, error: 'password_too_short' };
  if (password !== passwordConfirm) return { ok: false, error: 'passwords_dont_match' };

  const supabase = await createClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'recovery',
  });
  if (verifyError) {
    return { ok: false, error: 'otp_invalid' };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    return { ok: false, error: 'update_failed' };
  }

  redirect('/dashboard');
}
