import 'server-only';
import { Resend } from 'resend';

let cached: Resend | null = null;

function client(): Resend {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not configured');
  cached = new Resend(key);
  return cached;
}

function from(): string {
  const value = process.env.EMAIL_FROM;
  if (!value) throw new Error('EMAIL_FROM is not configured');
  return value;
}

type Locale = 'en' | 'es';

const copy = {
  en: {
    subject: 'Your password reset code',
    heading: 'Reset your password',
    intro: 'Use the code below to finish resetting your password. The code expires in 1 hour.',
    ignore: 'If you did not request this, you can safely ignore this email.',
  },
  es: {
    subject: 'Tu código para restablecer la contraseña',
    heading: 'Restablece tu contraseña',
    intro: 'Usa el código de abajo para completar el cambio de contraseña. Expira en 1 hora.',
    ignore: 'Si no solicitaste esto, puedes ignorar este correo con tranquilidad.',
  },
} satisfies Record<Locale, Record<string, string>>;

export async function sendPasswordResetEmail(
  email: string,
  otp: string,
  locale: Locale = 'es',
): Promise<void> {
  const t = copy[locale] ?? copy.es;

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
      <h1 style="font-size:20px;margin:0 0 16px">${t.heading}</h1>
      <p style="margin:0 0 16px;line-height:1.5">${t.intro}</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f4f4f5;padding:16px;text-align:center;border-radius:8px;margin:0 0 16px">${otp}</div>
      <p style="margin:0;color:#666;font-size:13px">${t.ignore}</p>
    </div>
  `;

  const text = `${t.heading}\n\n${t.intro}\n\n${otp}\n\n${t.ignore}`;

  await client().emails.send({
    from: from(),
    to: email,
    subject: t.subject,
    html,
    text,
  });
}
