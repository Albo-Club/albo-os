/**
 * Email templates. Plain text + HTML are sent together (multipart/alternative)
 * — a strong anti-spam signal and required for accessibility.
 *
 * HTML uses inline styles since Gmail / Outlook strip <style> tags.
 * Layout is a single 560px column, mobile-safe.
 *
 * Each template is bilingual (en/fr). The recipient's locale is resolved from
 * their stored `preferredLanguage` (via `users.localeForEmail` or the caller's
 * own lookup); English is the fallback. Copy here is user-facing — keep it in
 * sync with the front-end `auth` namespace where the flows overlap.
 */

export type EmailLocale = 'en' | 'fr'

const APP_NAME = 'albo-os'
const BRAND = '#0f0f10'
const MUTED = '#6b6b73'
const BORDER = '#e7e7ea'
const BG = '#ffffff'
const BUTTON_BG = '#0f0f10'
const BUTTON_FG = '#ffffff'

function layout({
  locale,
  preheader,
  heading,
  paragraphs,
  cta,
  footer,
}: {
  locale: EmailLocale
  preheader: string
  heading: string
  paragraphs: Array<string>
  cta?: { label: string; url: string }
  footer: string
}) {
  const ctaHtml = cta
    ? `<tr><td style="padding: 24px 0 8px;">
        <a href="${cta.url}"
          style="display:inline-block; background:${BUTTON_BG}; color:${BUTTON_FG}; text-decoration:none; padding:12px 20px; border-radius:8px; font-weight:600; font-size:14px;">
          ${cta.label}
        </a>
      </td></tr>`
    : ''
  const bodyHtml = paragraphs
    .map(
      (p) =>
        `<tr><td style="padding-bottom:14px; line-height:1.55;">${p}</td></tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${heading}</title>
</head>
<body style="margin:0; padding:0; background:${BG}; color:${BRAND}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Arial, sans-serif;">
  <span style="display:none; max-height:0; overflow:hidden; opacity:0;">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:560px; border:1px solid ${BORDER}; border-radius:14px; background:${BG};">
        <tr><td style="padding:28px 32px 0;">
          <div style="font-weight:700; font-size:18px; letter-spacing:-0.01em;">${APP_NAME}</div>
        </td></tr>
        <tr><td style="padding:20px 32px 8px;">
          <h1 style="margin:0 0 8px; font-size:20px; font-weight:600; line-height:1.3;">${heading}</h1>
        </td></tr>
        <tr><td style="padding:0 32px 8px; font-size:15px; color:${BRAND};">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            ${bodyHtml}
            ${ctaHtml}
          </table>
        </td></tr>
        <tr><td style="padding:24px 32px 28px; border-top:1px solid ${BORDER}; color:${MUTED}; font-size:12px; line-height:1.5;">
          ${footer}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function plainText(parts: Array<string>): string {
  return parts.filter(Boolean).join('\n\n')
}

function pick<T>(locale: EmailLocale, copy: Record<EmailLocale, T>): T {
  return copy[locale] ?? copy.en
}

const urlFallback = (locale: EmailLocale, url: string) =>
  pick(locale, {
    en: `If the button doesn't work, copy this URL into your browser:<br><span style="color:${MUTED}; word-break:break-all;">${url}</span>`,
    fr: `Si le bouton ne fonctionne pas, copiez cette URL dans votre navigateur :<br><span style="color:${MUTED}; word-break:break-all;">${url}</span>`,
  })

export function invitationEmail({
  locale,
  inviterName,
  orgName,
  acceptUrl,
}: {
  locale: EmailLocale
  inviterName: string
  orgName: string
  acceptUrl: string
}) {
  const c = pick(locale, {
    en: {
      subject: `You're invited to ${orgName} on ${APP_NAME}`,
      heading: `Join ${orgName}`,
      intro: `<strong>${inviterName}</strong> invited you to join <strong>${orgName}</strong>.`,
      followup: `Click the button below to accept. This link expires in 7 days.`,
      footer: `If you didn't expect this invitation, you can safely ignore this email.`,
      preheader: `${inviterName} invited you to join ${orgName}.`,
      cta: 'Accept invitation',
      text: [
        `${inviterName} invited you to join ${orgName} on ${APP_NAME}.`,
        `Accept the invitation:`,
        acceptUrl,
        `This link expires in 7 days.`,
        `If you didn't expect this invitation, you can safely ignore this email.`,
      ],
    },
    fr: {
      subject: `Vous êtes invité à rejoindre ${orgName} sur ${APP_NAME}`,
      heading: `Rejoindre ${orgName}`,
      intro: `<strong>${inviterName}</strong> vous a invité à rejoindre <strong>${orgName}</strong>.`,
      followup: `Cliquez sur le bouton ci-dessous pour accepter. Ce lien expire dans 7 jours.`,
      footer: `Si vous n'attendiez pas cette invitation, vous pouvez ignorer cet e-mail.`,
      preheader: `${inviterName} vous a invité à rejoindre ${orgName}.`,
      cta: 'Accepter l’invitation',
      text: [
        `${inviterName} vous a invité à rejoindre ${orgName} sur ${APP_NAME}.`,
        `Accepter l’invitation :`,
        acceptUrl,
        `Ce lien expire dans 7 jours.`,
        `Si vous n'attendiez pas cette invitation, vous pouvez ignorer cet e-mail.`,
      ],
    },
  })

  const html = layout({
    locale,
    preheader: c.preheader,
    heading: c.heading,
    paragraphs: [c.intro, c.followup],
    cta: { label: c.cta, url: acceptUrl },
    footer: c.footer,
  })

  return { subject: c.subject, html, text: plainText(c.text) }
}

export function changeEmailVerificationEmail({
  locale,
  url,
  newEmail,
}: {
  locale: EmailLocale
  url: string
  newEmail: string
}) {
  // Sent to the CURRENT address. Acts as approval gate: a hijacked session
  // can request the change, but only the legitimate owner of the current
  // inbox can authorize it.
  const c = pick(locale, {
    en: {
      subject: `Approve email change on ${APP_NAME}`,
      heading: `Approve email change`,
      intro: `Someone requested to change your ${APP_NAME} account email to <strong>${newEmail}</strong>.`,
      followup: `If this was you, click below to approve. <strong>If not, ignore this email</strong> — your current address stays unchanged and the request is dropped.`,
      footer: `Your account email is updated only after you approve here.`,
      preheader: `Approve change to ${newEmail}.`,
      cta: 'Approve email change',
      text: [
        `Approve email change on ${APP_NAME}.`,
        `Someone requested to change your account email to ${newEmail}.`,
        `If this was you, open this link to approve:`,
        url,
        `If not, ignore this email — your current address stays unchanged.`,
      ],
    },
    fr: {
      subject: `Approuver le changement d'e-mail sur ${APP_NAME}`,
      heading: `Approuver le changement d'e-mail`,
      intro: `Quelqu'un a demandé à changer l'e-mail de votre compte ${APP_NAME} pour <strong>${newEmail}</strong>.`,
      followup: `Si c'était vous, cliquez ci-dessous pour approuver. <strong>Sinon, ignorez cet e-mail</strong> — votre adresse actuelle reste inchangée et la demande est annulée.`,
      footer: `L'e-mail de votre compte n'est mis à jour qu'après votre approbation ici.`,
      preheader: `Approuver le changement vers ${newEmail}.`,
      cta: 'Approuver le changement',
      text: [
        `Approuver le changement d'e-mail sur ${APP_NAME}.`,
        `Quelqu'un a demandé à changer l'e-mail de votre compte pour ${newEmail}.`,
        `Si c'était vous, ouvrez ce lien pour approuver :`,
        url,
        `Sinon, ignorez cet e-mail — votre adresse actuelle reste inchangée.`,
      ],
    },
  })

  const html = layout({
    locale,
    preheader: c.preheader,
    heading: c.heading,
    paragraphs: [c.intro, c.followup],
    cta: { label: c.cta, url },
    footer: c.footer,
  })

  return { subject: c.subject, html, text: plainText(c.text) }
}

export function deleteAccountVerificationEmail({
  locale,
  url,
  name,
}: {
  locale: EmailLocale
  url: string
  name?: string | null
}) {
  const c = pick(locale, {
    en: {
      subject: `Confirm account deletion on ${APP_NAME}`,
      heading: `Confirm account deletion`,
      intro: name
        ? `${name}, you asked to delete your ${APP_NAME} account.`
        : `You asked to delete your ${APP_NAME} account.`,
      followup: `This will permanently remove your profile, your organization memberships, and your access. <strong>This cannot be undone.</strong>`,
      footer: `If you didn't request this, ignore this email and nothing happens.`,
      preheader: `Confirm account deletion.`,
      cta: 'Delete my account',
      text: [
        name
          ? `${name}, you asked to delete your ${APP_NAME} account.`
          : `You asked to delete your ${APP_NAME} account.`,
        `This will permanently remove your profile and access. This cannot be undone.`,
        `Confirm by opening this link:`,
        url,
        `If you didn't request this, ignore this email.`,
      ],
    },
    fr: {
      subject: `Confirmer la suppression du compte sur ${APP_NAME}`,
      heading: `Confirmer la suppression du compte`,
      intro: name
        ? `${name}, vous avez demandé à supprimer votre compte ${APP_NAME}.`
        : `Vous avez demandé à supprimer votre compte ${APP_NAME}.`,
      followup: `Cela supprimera définitivement votre profil, vos adhésions aux organisations et votre accès. <strong>Cette action est irréversible.</strong>`,
      footer: `Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail et rien ne se passera.`,
      preheader: `Confirmer la suppression du compte.`,
      cta: 'Supprimer mon compte',
      text: [
        name
          ? `${name}, vous avez demandé à supprimer votre compte ${APP_NAME}.`
          : `Vous avez demandé à supprimer votre compte ${APP_NAME}.`,
        `Cela supprimera définitivement votre profil et votre accès. Cette action est irréversible.`,
        `Confirmez en ouvrant ce lien :`,
        url,
        `Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`,
      ],
    },
  })

  const html = layout({
    locale,
    preheader: c.preheader,
    heading: c.heading,
    paragraphs: [c.intro, c.followup],
    cta: { label: c.cta, url },
    footer: c.footer,
  })

  return { subject: c.subject, html, text: plainText(c.text) }
}

export function verificationEmail({
  locale,
  url,
}: {
  locale: EmailLocale
  url: string
}) {
  const c = pick(locale, {
    en: {
      subject: `Verify your email on ${APP_NAME}`,
      heading: `Verify your email`,
      intro: `Confirm this is your email address by clicking the button below. You'll be signed in automatically.`,
      footer: `If you didn't create an account, you can safely ignore this email.`,
      preheader: `Verify your email on ${APP_NAME}.`,
      cta: 'Verify email',
      text: [
        `Verify your email on ${APP_NAME}.`,
        `Open this link to verify and sign in:`,
        url,
        `If you didn't create an account, you can safely ignore this email.`,
      ],
    },
    fr: {
      subject: `Vérifiez votre e-mail sur ${APP_NAME}`,
      heading: `Vérifiez votre e-mail`,
      intro: `Confirmez qu'il s'agit bien de votre adresse e-mail en cliquant sur le bouton ci-dessous. Vous serez connecté automatiquement.`,
      footer: `Si vous n'avez pas créé de compte, vous pouvez ignorer cet e-mail.`,
      preheader: `Vérifiez votre e-mail sur ${APP_NAME}.`,
      cta: 'Vérifier l’e-mail',
      text: [
        `Vérifiez votre e-mail sur ${APP_NAME}.`,
        `Ouvrez ce lien pour vérifier et vous connecter :`,
        url,
        `Si vous n'avez pas créé de compte, vous pouvez ignorer cet e-mail.`,
      ],
    },
  })

  const html = layout({
    locale,
    preheader: c.preheader,
    heading: c.heading,
    paragraphs: [c.intro, urlFallback(locale, url)],
    cta: { label: c.cta, url },
    footer: c.footer,
  })

  return { subject: c.subject, html, text: plainText(c.text) }
}

export function resetPasswordEmail({
  locale,
  url,
}: {
  locale: EmailLocale
  url: string
}) {
  const c = pick(locale, {
    en: {
      subject: `Reset your ${APP_NAME} password`,
      heading: `Reset your password`,
      intro: `We received a request to reset your ${APP_NAME} password. Click the button below to choose a new one. This link expires in 1 hour.`,
      footer: `If you didn't request a password reset, ignore this email and your password stays unchanged.`,
      preheader: `Reset your ${APP_NAME} password.`,
      cta: 'Reset password',
      text: [
        `Reset your ${APP_NAME} password.`,
        `Open this link to choose a new password (expires in 1 hour):`,
        url,
        `If you didn't request this, ignore this email.`,
      ],
    },
    fr: {
      subject: `Réinitialisez votre mot de passe ${APP_NAME}`,
      heading: `Réinitialisez votre mot de passe`,
      intro: `Nous avons reçu une demande de réinitialisation de votre mot de passe ${APP_NAME}. Cliquez sur le bouton ci-dessous pour en choisir un nouveau. Ce lien expire dans 1 heure.`,
      footer: `Si vous n'avez pas demandé de réinitialisation, ignorez cet e-mail et votre mot de passe reste inchangé.`,
      preheader: `Réinitialisez votre mot de passe ${APP_NAME}.`,
      cta: 'Réinitialiser le mot de passe',
      text: [
        `Réinitialisez votre mot de passe ${APP_NAME}.`,
        `Ouvrez ce lien pour choisir un nouveau mot de passe (expire dans 1 heure) :`,
        url,
        `Si vous n'avez pas demandé cela, ignorez cet e-mail.`,
      ],
    },
  })

  const html = layout({
    locale,
    preheader: c.preheader,
    heading: c.heading,
    paragraphs: [c.intro, urlFallback(locale, url)],
    cta: { label: c.cta, url },
    footer: c.footer,
  })

  return { subject: c.subject, html, text: plainText(c.text) }
}

export function passwordChangedEmail({
  locale,
  email,
  resetUrl,
}: {
  locale: EmailLocale
  email: string
  resetUrl: string
}) {
  // Post-event notification — fired AFTER the password is already changed.
  const c = pick(locale, {
    en: {
      subject: `Your ${APP_NAME} password was changed`,
      heading: `Password changed`,
      intro: `The password for <strong>${email}</strong> was just changed on ${APP_NAME}.`,
      followup: `If you made this change, no action is needed. <strong>If you didn't, your account may be compromised</strong> — reset your password now and review your active sessions.`,
      footer: `For your safety, all other sessions were signed out automatically.`,
      preheader: `Password changed for ${email}.`,
      cta: 'Reset password',
      text: [
        `Your ${APP_NAME} password was just changed.`,
        `If you didn't do this, reset your password now: ${resetUrl}`,
        `For your safety, all other sessions were signed out automatically.`,
      ],
    },
    fr: {
      subject: `Votre mot de passe ${APP_NAME} a été modifié`,
      heading: `Mot de passe modifié`,
      intro: `Le mot de passe de <strong>${email}</strong> vient d'être modifié sur ${APP_NAME}.`,
      followup: `Si vous êtes à l'origine de ce changement, aucune action n'est requise. <strong>Sinon, votre compte est peut-être compromis</strong> — réinitialisez votre mot de passe maintenant et vérifiez vos sessions actives.`,
      footer: `Pour votre sécurité, toutes les autres sessions ont été déconnectées automatiquement.`,
      preheader: `Mot de passe modifié pour ${email}.`,
      cta: 'Réinitialiser le mot de passe',
      text: [
        `Votre mot de passe ${APP_NAME} vient d'être modifié.`,
        `Si vous n'êtes pas à l'origine de ce changement, réinitialisez votre mot de passe maintenant : ${resetUrl}`,
        `Pour votre sécurité, toutes les autres sessions ont été déconnectées automatiquement.`,
      ],
    },
  })

  const html = layout({
    locale,
    preheader: c.preheader,
    heading: c.heading,
    paragraphs: [c.intro, c.followup],
    cta: { label: c.cta, url: resetUrl },
    footer: c.footer,
  })

  return { subject: c.subject, html, text: plainText(c.text) }
}

export function magicLinkEmail({
  locale,
  url,
}: {
  locale: EmailLocale
  url: string
}) {
  const c = pick(locale, {
    en: {
      subject: `Your ${APP_NAME} sign-in link`,
      heading: `Sign in to ${APP_NAME}`,
      intro: `Click the button below to sign in. This link expires in 5 minutes.`,
      footer: `If you didn't request this, you can safely ignore this email.`,
      preheader: `Sign in to ${APP_NAME}.`,
      cta: 'Sign in',
      text: [
        `Sign in to ${APP_NAME}.`,
        `Open this link to sign in (expires in 5 minutes):`,
        url,
        `If you didn't request this, you can safely ignore this email.`,
      ],
    },
    fr: {
      subject: `Votre lien de connexion ${APP_NAME}`,
      heading: `Connexion à ${APP_NAME}`,
      intro: `Cliquez sur le bouton ci-dessous pour vous connecter. Ce lien expire dans 5 minutes.`,
      footer: `Si vous n'avez pas demandé cela, vous pouvez ignorer cet e-mail.`,
      preheader: `Connexion à ${APP_NAME}.`,
      cta: 'Se connecter',
      text: [
        `Connexion à ${APP_NAME}.`,
        `Ouvrez ce lien pour vous connecter (expire dans 5 minutes) :`,
        url,
        `Si vous n'avez pas demandé cela, vous pouvez ignorer cet e-mail.`,
      ],
    },
  })

  const html = layout({
    locale,
    preheader: c.preheader,
    heading: c.heading,
    paragraphs: [c.intro, urlFallback(locale, url)],
    cta: { label: c.cta, url },
    footer: c.footer,
  })

  return { subject: c.subject, html, text: plainText(c.text) }
}

// ─── Report pipeline recaps (AgentMail, brick 6) ─────────────────────────────
// French-only on purpose: these are internal pipeline notifications for the
// two members (both French), sent via the AgentMail inbox — not Resend.
// Compact inline-styled HTML (no multipart machinery needed for replies).

export interface RecapMetric {
  metricType: string
  value: number
  unit: string
}

export interface RecapSuspicious {
  metricType: string
  value: number
  unit: string
  previousValue: number
}

export interface RecapSource {
  kind: string
  label: string
  state: 'extracted' | 'stored' | 'failed'
  detail?: string
}

export interface ReportRecapData {
  companies: Array<{ name: string; orgName: string; url: string | null }>
  reportPeriod: string
  reportType: string
  matchMethod: string
  sources: Array<RecapSource>
  metricsFound: Array<RecapMetric>
  unrecognized: Array<string>
  suspicious: Array<RecapSuspicious>
  missingUsual: Array<string>
}

const EUR_FMT = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

function formatMetricValue(value: number, unit: string): string {
  if (unit === 'EUR_cents') return EUR_FMT.format(value / 100)
  if (unit === 'bps') return `${(value / 100).toLocaleString('fr-FR')} %`
  if (unit === 'months') return `${value.toLocaleString('fr-FR')} mois`
  return value.toLocaleString('fr-FR')
}

const MATCH_METHOD_LABELS: Record<string, string> = {
  domain: "domaine de l'expéditeur",
  name: 'nom dans le message',
  'domain+name': 'domaine + nom',
  manual: 'rattachement manuel',
}

function matchMethodLabel(method: string): string {
  const fund = method.startsWith('fund_forward:')
  const base = fund ? method.slice('fund_forward:'.length) : method
  const label = MATCH_METHOD_LABELS[base] ?? base
  return fund ? `${label} (report transmis par un fonds)` : label
}

const SOURCE_DETAIL_LABELS: Record<string, string> = {
  ocr_failed: 'lecture impossible — vérifie le fichier',
  parse_failed: 'fichier illisible',
  download_failed: 'téléchargement impossible',
  file_too_large: 'fichier > 20 Mo — non conservé',
  notion_unreachable:
    "page Notion inaccessible — vérifie qu'elle est partagée publiquement, puis « Retraiter » depuis la file",
  gdrive_unreachable: 'fichier Drive non partagé — active « accès par lien » ou joins le fichier',
  docsend_failed: 'conversion DocSend impossible — télécharge le PDF et re-transfère',
  small_image_skipped: 'petite image (logo) ignorée',
  empty_workbook: 'classeur vide',
}

const REVIEW_REASON_LABELS: Record<string, string> = {
  no_match: 'participation introuvable',
  ambiguous: 'plusieurs participations possibles',
  identify_error: "erreur technique pendant l'identification",
  analyze_error: "erreur technique pendant l'analyse",
  no_content: 'aucun contenu exploitable',
  unknown_sender: 'expéditeur inconnu',
  spam: 'marqué comme spam',
}

export function cashAlertEmail({
  locale,
  orgName,
  thresholdCents,
  minProjectedCents,
  cashUrl,
}: {
  locale: EmailLocale
  orgName: string
  thresholdCents: number
  minProjectedCents: number
  cashUrl: string
}) {
  const eur = (cents: number) =>
    new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(cents / 100)

  const c = pick(locale, {
    en: {
      subject: `Cash alert — ${orgName} projected below ${eur(thresholdCents)}`,
      heading: `Cash below your threshold`,
      intro: `The projected cash balance of <strong>${orgName}</strong> drops to <strong>${eur(minProjectedCents)}</strong> within the next 3 months — below your ${eur(thresholdCents)} alert threshold.`,
      followup: `The projection includes committed and planned entries (overdue ones included). Review the forecast to see which month dips and what drives it.`,
      footer: `You receive this because a cash threshold alert is active for ${orgName}. Adjust or disable it on the Cash page. No more than one alert per week.`,
      preheader: `Projected balance ${eur(minProjectedCents)} — under your ${eur(thresholdCents)} threshold.`,
      cta: 'Open the cash forecast',
      text: [
        `The projected cash balance of ${orgName} drops to ${eur(minProjectedCents)} within the next 3 months — below your ${eur(thresholdCents)} alert threshold.`,
        `Review the forecast: ${cashUrl}`,
        `You receive this because a cash threshold alert is active for ${orgName}. No more than one alert per week.`,
      ],
    },
    fr: {
      subject: `Alerte trésorerie — ${orgName} projetée sous ${eur(thresholdCents)}`,
      heading: `Trésorerie sous votre seuil`,
      intro: `Le solde projeté de <strong>${orgName}</strong> descend à <strong>${eur(minProjectedCents)}</strong> dans les 3 prochains mois — sous votre seuil d'alerte de ${eur(thresholdCents)}.`,
      followup: `La projection inclut l'engagé et le prévu (retards compris). Ouvrez le prévisionnel pour voir quel mois creuse et ce qui l'explique.`,
      footer: `Vous recevez cet email car une alerte de seuil est active pour ${orgName}. Ajustez-la ou désactivez-la sur la page Trésorerie. Au plus une alerte par semaine.`,
      preheader: `Solde projeté ${eur(minProjectedCents)} — sous votre seuil de ${eur(thresholdCents)}.`,
      cta: 'Ouvrir le prévisionnel',
      text: [
        `Le solde projeté de ${orgName} descend à ${eur(minProjectedCents)} dans les 3 prochains mois — sous votre seuil d'alerte de ${eur(thresholdCents)}.`,
        `Ouvrir le prévisionnel : ${cashUrl}`,
        `Vous recevez cet email car une alerte de seuil est active pour ${orgName}. Au plus une alerte par semaine.`,
      ],
    },
  })

  const html = layout({
    locale,
    preheader: c.preheader,
    heading: c.heading,
    paragraphs: [c.intro, c.followup, urlFallback(locale, cashUrl)],
    cta: { label: c.cta, url: cashUrl },
    footer: c.footer,
  })

  return { subject: c.subject, html, text: plainText(c.text) }
}

export function reviewReasonLabel(reason: string): string {
  return REVIEW_REASON_LABELS[reason] ?? reason
}

const STATE_ICONS: Record<string, string> = {
  extracted: '✅',
  stored: '📦',
  failed: '⚠️',
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function recapShell(title: string, blocks: Array<string>): string {
  return `<div style="font-family: ui-sans-serif, system-ui, sans-serif; font-size: 14px; color: ${BRAND}; max-width: 560px;">
  <p style="margin: 0 0 12px; font-weight: 600;">${title}</p>
  ${blocks.join('\n')}
</div>`
}

function listBlock(heading: string, items: Array<string>): string {
  if (items.length === 0) return ''
  return `<p style="margin: 12px 0 4px; font-weight: 600;">${heading}</p>
<ul style="margin: 0; padding-left: 18px; color: ${MUTED};">
  ${items.map((i) => `<li style="margin: 2px 0;">${i}</li>`).join('\n  ')}
</ul>`
}

/** Success recap — replied in the forward's thread. */
export function reportRecapSuccessHtml(d: ReportRecapData): string {
  const companies = d.companies
    .map((c) => {
      const label = `${esc(c.name)} <span style="color:${MUTED};">(${esc(c.orgName)})</span>`
      return c.url ? `<a href="${c.url}" style="color:${BRAND};">${label}</a>` : label
    })
    .join(' · ')

  const sources = d.sources.map((s) => {
    const icon = STATE_ICONS[s.state] ?? ''
    const detail = s.detail ? ` — ${esc(SOURCE_DETAIL_LABELS[s.detail] ?? s.detail)}` : ''
    return `${icon} ${esc(s.label)}${detail}`
  })

  const metrics = d.metricsFound.map(
    (m) => `${esc(m.metricType)} : <b>${formatMetricValue(m.value, m.unit)}</b>`,
  )
  const suspicious = d.suspicious.map(
    (s) =>
      `${esc(s.metricType)} : ${formatMetricValue(s.value, s.unit)} (précédent : ${formatMetricValue(
        s.previousValue,
        s.unit,
      )}) — vérifier une éventuelle erreur d'unité`,
  )

  return recapShell(`✅ Report rangé — ${esc(d.reportPeriod)} (${esc(d.reportType)})`, [
    `<p style="margin: 0 0 4px;">${companies}</p>`,
    `<p style="margin: 0; color: ${MUTED};">Rattachement confirmé par : ${esc(matchMethodLabel(d.matchMethod))}</p>`,
    listBlock('Sources', sources),
    listBlock('Métriques enregistrées', metrics),
    listBlock('⚠️ Valeurs inhabituelles', suspicious),
    listBlock('Métriques non reconnues (conservées sur le report, hors séries)', d.unrecognized.map(esc)),
    listBlock('Habituelles mais absentes de ce report', d.missingUsual.map(esc)),
  ])
}

/** Failure recap — replied in the thread (member senders only). */
export function reportRecapFailureHtml(reason: string, queueUrl: string): string {
  return recapShell(`⚠️ Report non traité — ${esc(reviewReasonLabel(reason))}`, [
    `<p style="margin: 0; color: ${MUTED};">L'email est conservé dans la file « Reports entrants ». Tu peux le rattacher à une participation ou le retraiter depuis Albo OS.</p>`,
    `<p style="margin: 12px 0 0;"><a href="${queueUrl}" style="color:${BRAND};">Ouvrir la file des reports entrants</a></p>`,
  ])
}

/** Quarantine notice — a FRESH email to the members (never a thread reply). */
export function reportQuarantineHtml(
  fromEmail: string,
  subject: string,
  reason: string,
  queueUrl: string,
): string {
  return recapShell(`🛡️ Email en quarantaine — ${esc(reviewReasonLabel(reason))}`, [
    `<p style="margin: 0;">Expéditeur : <b>${esc(fromEmail)}</b></p>`,
    `<p style="margin: 4px 0 0;">Objet : ${esc(subject)}</p>`,
    `<p style="margin: 12px 0 0; color: ${MUTED};">Aucune réponse n'a été envoyée à l'expéditeur. Si cet email est légitime, rattache-le ou retraite-le depuis la file.</p>`,
    `<p style="margin: 12px 0 0;"><a href="${queueUrl}" style="color:${BRAND};">Ouvrir la file des reports entrants</a></p>`,
  ])
}
