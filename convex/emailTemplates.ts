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

/**
 * Escape a user-controlled value before it lands in an HTML branch. Every
 * template interpolates names, org names, addresses and free-text labels into
 * markup, so an unescaped `<` would let a user inject arbitrary HTML into an
 * email read by someone else. Applies to the HTML branch only — the plain-text
 * branch and the subject line take the raw value.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
  const hInviter = esc(inviterName)
  const hOrg = esc(orgName)
  const c = pick(locale, {
    en: {
      subject: `You're invited to ${orgName} on ${APP_NAME}`,
      heading: `Join ${hOrg}`,
      intro: `<strong>${hInviter}</strong> invited you to join <strong>${hOrg}</strong>.`,
      followup: `Click the button below to accept. This link expires in 7 days.`,
      footer: `If you didn't expect this invitation, you can safely ignore this email.`,
      preheader: `${hInviter} invited you to join ${hOrg}.`,
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
      heading: `Rejoindre ${hOrg}`,
      intro: `<strong>${hInviter}</strong> vous a invité à rejoindre <strong>${hOrg}</strong>.`,
      followup: `Cliquez sur le bouton ci-dessous pour accepter. Ce lien expire dans 7 jours.`,
      footer: `Si vous n'attendiez pas cette invitation, vous pouvez ignorer cet e-mail.`,
      preheader: `${hInviter} vous a invité à rejoindre ${hOrg}.`,
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
  const hNewEmail = esc(newEmail)
  const c = pick(locale, {
    en: {
      subject: `Approve email change on ${APP_NAME}`,
      heading: `Approve email change`,
      intro: `Someone requested to change your ${APP_NAME} account email to <strong>${hNewEmail}</strong>.`,
      followup: `If this was you, click below to approve. <strong>If not, ignore this email</strong> — your current address stays unchanged and the request is dropped.`,
      footer: `Your account email is updated only after you approve here.`,
      preheader: `Approve change to ${hNewEmail}.`,
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
      intro: `Quelqu'un a demandé à changer l'e-mail de votre compte ${APP_NAME} pour <strong>${hNewEmail}</strong>.`,
      followup: `Si c'était vous, cliquez ci-dessous pour approuver. <strong>Sinon, ignorez cet e-mail</strong> — votre adresse actuelle reste inchangée et la demande est annulée.`,
      footer: `L'e-mail de votre compte n'est mis à jour qu'après votre approbation ici.`,
      preheader: `Approuver le changement vers ${hNewEmail}.`,
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
  const hName = name ? esc(name) : null
  const c = pick(locale, {
    en: {
      subject: `Confirm account deletion on ${APP_NAME}`,
      heading: `Confirm account deletion`,
      intro: hName
        ? `${hName}, you asked to delete your ${APP_NAME} account.`
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
      intro: hName
        ? `${hName}, vous avez demandé à supprimer votre compte ${APP_NAME}.`
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
  const hEmail = esc(email)
  const c = pick(locale, {
    en: {
      subject: `Your ${APP_NAME} password was changed`,
      heading: `Password changed`,
      intro: `The password for <strong>${hEmail}</strong> was just changed on ${APP_NAME}.`,
      followup: `If you made this change, no action is needed. <strong>If you didn't, your account may be compromised</strong> — reset your password now and review your active sessions.`,
      footer: `For your safety, all other sessions were signed out automatically.`,
      preheader: `Password changed for ${hEmail}.`,
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
      intro: `Le mot de passe de <strong>${hEmail}</strong> vient d'être modifié sur ${APP_NAME}.`,
      followup: `Si vous êtes à l'origine de ce changement, aucune action n'est requise. <strong>Sinon, votre compte est peut-être compromis</strong> — réinitialisez votre mot de passe maintenant et vérifiez vos sessions actives.`,
      footer: `Pour votre sécurité, toutes les autres sessions ont été déconnectées automatiquement.`,
      preheader: `Mot de passe modifié pour ${hEmail}.`,
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

/**
 * Everything the pipeline can say about HOW it read the report, as opposed to
 * what the report says. Appended to the confirmation for queue handlers only.
 */
export interface ReportQuality {
  matchMethod: string
  sources: Array<RecapSource>
  metricsFound: Array<RecapMetric>
  unrecognized: Array<string>
  suspicious: Array<RecapSuspicious>
  missingUsual: Array<string>
  /** Fiche KPI cible checklist — replaces missingUsual when defined. */
  targets?: Array<{ metricType: string; found: boolean; value?: number; unit?: string }>
}

const EUR_FMT = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

/** Real money, reconciled from a bank movement: always to the cent. */
const EUR_CENTS_FMT = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
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

/** Max characters of the raw technical message rendered in a failure recap. */
const FAILURE_DETAIL_MAX = 300

/** Max entry lines rendered per org in the overdue block (rest is "+N more"). */
const OVERDUE_EMAIL_MAX_LINES = 8

/** Max report cards rendered per org in the digest (rest is "+N more"). */
export const REPORT_EMAIL_MAX_CARDS = 6

/** Key points shown under a report card — a recap card, not the report. */
const REPORT_EMAIL_MAX_HIGHLIGHTS = 2

export type DigestOverdueEntry = {
  date: number
  label: string
  direction: 'in' | 'out'
  amountCents: number
}

/**
 * One report filed this week, as the Monday mail shows it: which company sent
 * it, the period it covers, where that company's health stands, and what the
 * report says. Same ingredients as the confirmation the forwarder gets
 * (`reportConfirmationHtml`), minus the score ring, the strengths/watch-outs
 * columns and the KPI tiles — six of those in one mail is a report, not a
 * digest.
 */
export type DigestReportItem = {
  companyName: string
  /** logo.dev URL — null when the company carries no website domain. */
  logoUrl: string | null
  /** Fiche URL — null when SITE_URL is unset. */
  url: string | null
  /** Period the report covers. Absent on a one-off document. */
  period?: string
  /** AI health score of the company (0-10) and its label, when analysed. */
  score?: number
  scoreLabel?: string
  /** Key points of the report. The caller passes them all, two are shown. */
  highlights: Array<string>
}

/**
 * One org's worth of the weekly digest. Every block is optional: a section
 * is only built when the org has something to say AND the recipient still
 * subscribes to that alert, so a reader who muted overdue entries gets the
 * very same mail minus that block.
 */
export type DigestSection = {
  orgName: string
  cash: {
    thresholdCents: number
    minProjectedCents: number
    cashUrl: string
  } | null
  overdue: {
    /** All overdue entries, date ascending (oldest first). */
    entries: Array<DigestOverdueEntry>
    forecastUrl: string
  } | null
  /**
   * Reports filed on this org's companies over the past week. `count` is the
   * week's total, `items` the ones the mail has room for. Null when there
   * were none, or when the reader muted the block — an org with nothing to
   * say drops out of the digest entirely.
   */
  reports: { count: number; items: Array<DigestReportItem> } | null
}

/** The digest's unit of layout — the bordered box the report mail uses too. */
function digestCard(inner: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${BORDER};border-radius:8px;">
  <tr><td style="padding:14px 16px;">${inner}</td></tr>
</table>`
}

/** Small uppercase caption heading a card. */
function cardLabel(text: string): string {
  return `<div style="color:${MUTED};font-size:10px;letter-spacing:0.05em;text-transform:uppercase;line-height:1.4;">${text}</div>`
}

/** A card's secondary action — a link, never a second button. */
function cardLink(label: string, url: string): string {
  return `<p style="margin:12px 0 0;font-size:13px;"><a href="${url}" style="color:${BRAND};font-weight:500;">${label} →</a></p>`
}

/** Company logo, or its initial when the company carries no domain. */
function digestAvatar(name: string, logoUrl: string | null): string {
  return logoUrl
    ? `<img src="${logoUrl}" width="32" height="32" alt="" style="display:block;width:32px;height:32px;border-radius:6px;background:#f1f1f3;">`
    : `<div style="width:32px;height:32px;border-radius:6px;background:#f1f1f3;color:${MUTED};font-weight:600;font-size:13px;text-align:center;line-height:32px;">${esc(name.slice(0, 1).toUpperCase())}</div>`
}

/**
 * One report, one card: identity + period on the left, health chip on the
 * right, two key points underneath. The company name carries the link to its
 * fiche — a button per card would drown the mail.
 */
function reportCard(item: DigestReportItem): string {
  const name = esc(item.companyName)
  const title = item.url
    ? `<a href="${item.url}" style="color:${BRAND};text-decoration:none;font-weight:600;">${name}</a>`
    : `<span style="font-weight:600;">${name}</span>`
  const chip =
    item.score !== undefined
      ? `<span style="display:inline-block;border:1px solid ${scoreColor(item.score)};color:${scoreColor(item.score)};font-size:11px;padding:2px 8px;border-radius:999px;line-height:1.4;white-space:nowrap;">${item.scoreLabel ? `${esc(item.scoreLabel)} · ` : ''}${item.score}/10</span>`
      : ''
  const points = item.highlights
    .slice(0, REPORT_EMAIL_MAX_HIGHLIGHTS)
    .map(
      (h) => `<tr>
      <td width="14" valign="top" style="color:${MUTED};font-size:13px;line-height:1.5;">•</td>
      <td valign="top" style="color:#3f4147;font-size:13px;line-height:1.5;padding-bottom:3px;">${esc(h)}</td>
    </tr>`,
    )
    .join('\n    ')

  return digestCard(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td width="32" valign="middle" style="padding-right:10px;">${digestAvatar(item.companyName, item.logoUrl)}</td>
      <td valign="middle" style="line-height:1.35;">
        <div>${title}</div>
        ${item.period ? `<div style="color:${MUTED};font-size:12px;">${esc(item.period)}</div>` : ''}
      </td>
      <td valign="middle" align="right">${chip}</td>
    </tr>
  </table>${
    points
      ? `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:10px;">
    ${points}
  </table>`
      : ''
  }`)
}

/**
 * The Monday digest: one mail per member AND PER FAMILY — Albo Club on one
 * side, CALTE and its subsidiaries on the other (`lib/weeklyDigest.ts`
 * `familyOf`), so a mail never mixes two balance sheets. One section per org
 * inside, sent by `forecasts.sendWeeklyDigest`. Callers must pass at least
 * one section carrying at least one block — an empty digest is never sent.
 */
export function weeklyDigestEmail({
  locale,
  familyName,
  sections,
}: {
  locale: EmailLocale
  /** Name of the family this mail covers, e.g. "Albo" or "Calte". */
  familyName: string
  sections: Array<DigestSection>
}) {
  const eur = (cents: number) =>
    new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(cents / 100)
  const fmtDate = (ms: number) =>
    new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
      dateStyle: 'medium',
      timeZone: 'Europe/Paris',
    }).format(new Date(ms))

  // `label` is passed in so each branch picks its own escaping: raw for the
  // plain-text one, `esc()`-ed for the HTML one.
  const line = (e: DigestOverdueEntry, label: string) =>
    `${fmtDate(e.date)} — ${label} — ${e.direction === 'out' ? '−' : '+'}${eur(e.amountCents)}`

  const c = pick(locale, {
    en: {
      heading: (name: string) => `Your weekly digest — ${name}`,
      cashLabel: 'Projected cash · next 3 months',
      cashUnder: (threshold: number) => `Below your ${eur(threshold)} threshold`,
      cashText: (s: NonNullable<DigestSection['cash']>) =>
        `Projected cash drops to ${eur(s.minProjectedCents)} within the next 3 months — below your ${eur(s.thresholdCents)} threshold.`,
      cashCta: 'Open the cash forecast',
      overdueLabel: (n: number) =>
        `${n} overdue ${n === 1 ? 'entry' : 'entries'}`,
      overdueLine: (n: number) =>
        `${n} expected ${n === 1 ? 'entry is' : 'entries are'} past due and not reconciled yet:`,
      overdueCta: 'Open the forecast',
      more: (n: number) => `+ ${n} more`,
      cashSubject: (n: number) =>
        `${n} cash ${n === 1 ? 'threshold' : 'thresholds'} breached`,
      overdueSubject: (n: number) =>
        `${n} overdue ${n === 1 ? 'entry' : 'entries'}`,
      reportsLine: (n: number) =>
        `<strong>${n}</strong> ${n === 1 ? 'report' : 'reports'} filed this week.`,
      reportsText: (n: number) =>
        `${n} ${n === 1 ? 'report' : 'reports'} filed this week.`,
      reportsSubject: (n: number) =>
        `${n} ${n === 1 ? 'report' : 'reports'} filed`,
      subjectPrefix: 'Weekly digest',
      footer: `You receive this every Monday for the organisations you belong to. Choose which alerts reach you in Settings → Members.`,
    },
    fr: {
      heading: (name: string) => `Votre point hebdo — ${name}`,
      cashLabel: 'Trésorerie projetée · 3 mois',
      cashUnder: (threshold: number) => `Sous votre seuil de ${eur(threshold)}`,
      cashText: (s: NonNullable<DigestSection['cash']>) =>
        `Le solde projeté descend à ${eur(s.minProjectedCents)} dans les 3 prochains mois — sous votre seuil de ${eur(s.thresholdCents)}.`,
      cashCta: 'Ouvrir le prévisionnel',
      overdueLabel: (n: number) => `${n} échéance(s) en retard`,
      overdueLine: (n: number) =>
        `${n} échéance(s) attendue(s) dépassée(s), non rapprochée(s) :`,
      overdueCta: 'Ouvrir le prévisionnel',
      more: (n: number) => `+ ${n} autre(s)`,
      cashSubject: (n: number) => `${n} seuil(s) de trésorerie franchi(s)`,
      overdueSubject: (n: number) => `${n} échéance(s) en retard`,
      reportsLine: (n: number) =>
        `<strong>${n}</strong> report${n === 1 ? '' : 's'} rangé${n === 1 ? '' : 's'} cette semaine.`,
      reportsText: (n: number) =>
        `${n} report${n === 1 ? '' : 's'} rangé${n === 1 ? '' : 's'} cette semaine.`,
      reportsSubject: (n: number) =>
        `${n} report${n === 1 ? '' : 's'} rangé${n === 1 ? '' : 's'}`,
      subjectPrefix: 'Point hebdo',
      footer: `Vous recevez ce mail chaque lundi pour les organisations dont vous êtes membre. Choisissez les alertes qui vous parviennent dans Réglages → Membres.`,
    },
  })

  const cashCount = sections.filter((s) => s.cash).length
  const overdueCount = sections.reduce(
    (sum, s) => sum + (s.overdue?.entries.length ?? 0),
    0,
  )
  // Summed across the family's orgs on purpose: the subject is a headline,
  // not a ledger. A company held by two orgs files one report in each, so
  // this total can exceed the number of emails forwarded (cf. KNOWN_ISSUES).
  const reportsCount = sections.reduce(
    (sum, s) => sum + (s.reports?.count ?? 0),
    0,
  )
  const summary = [
    cashCount > 0 ? c.cashSubject(cashCount) : null,
    overdueCount > 0 ? c.overdueSubject(overdueCount) : null,
    reportsCount > 0 ? c.reportsSubject(reportsCount) : null,
  ]
    .filter(Boolean)
    .join(', ')

  // The org name is a heading only when the mail carries several — the Albo
  // mail would otherwise repeat what its own title already says.
  const showOrgNames = sections.length > 1

  const paragraphs = sections.flatMap((s) => {
    const blocks: Array<string> = []
    if (showOrgNames) {
      blocks.push(
        `<p style="margin:0; font-weight:600; font-size:16px;">${esc(s.orgName)}</p>`,
      )
    }
    if (s.cash) {
      blocks.push(
        digestCard(
          cardLabel(c.cashLabel) +
            `<div style="font-size:22px;font-weight:600;color:${TONE_NEGATIVE};line-height:1.25;margin-top:3px;">${eur(s.cash.minProjectedCents)}</div>` +
            `<div style="color:${MUTED};font-size:13px;margin-top:2px;">${c.cashUnder(s.cash.thresholdCents)}</div>` +
            cardLink(c.cashCta, s.cash.cashUrl),
        ),
      )
    }
    if (s.reports) {
      blocks.push(
        `<p style="margin:0;color:${MUTED};font-size:13px;">${c.reportsLine(s.reports.count)}</p>`,
      )
      blocks.push(...s.reports.items.slice(0, REPORT_EMAIL_MAX_CARDS).map(reportCard))
      const hiddenReports = s.reports.count - Math.min(s.reports.items.length, REPORT_EMAIL_MAX_CARDS)
      if (hiddenReports > 0) {
        blocks.push(
          `<p style="margin:0;color:${MUTED};font-size:13px;">${c.more(hiddenReports)}</p>`,
        )
      }
    }
    if (s.overdue) {
      const shown = s.overdue.entries.slice(0, OVERDUE_EMAIL_MAX_LINES)
      const hidden = s.overdue.entries.length - shown.length
      const rows = shown
        .map(
          (e) => `<tr>
      <td valign="top" style="color:${MUTED};font-size:12px;white-space:nowrap;padding:3px 10px 3px 0;">${fmtDate(e.date)}</td>
      <td valign="top" style="font-size:13px;line-height:1.4;padding:3px 0;">${esc(e.label)}</td>
      <td valign="top" align="right" style="font-size:13px;font-weight:600;white-space:nowrap;padding:3px 0 3px 10px;color:${e.direction === 'out' ? TONE_NEGATIVE : TONE_POSITIVE};">${e.direction === 'out' ? '−' : '+'}${eur(e.amountCents)}</td>
    </tr>`,
        )
        .join('\n    ')
      blocks.push(
        digestCard(
          cardLabel(c.overdueLabel(s.overdue.entries.length)) +
            `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:8px;">
    ${rows}
  </table>` +
            (hidden > 0
              ? `<p style="margin:8px 0 0;color:${MUTED};font-size:13px;">${c.more(hidden)}</p>`
              : '') +
            cardLink(c.overdueCta, s.overdue.forecastUrl),
        ),
      )
    }
    return blocks
  })

  const text = sections.flatMap((s) => {
    const parts = [s.orgName.toUpperCase()]
    if (s.cash) parts.push(`${c.cashText(s.cash)}\n${s.cash.cashUrl}`)
    if (s.reports) {
      parts.push(
        [
          c.reportsText(s.reports.count),
          ...s.reports.items.slice(0, REPORT_EMAIL_MAX_CARDS).map((item) => {
            const head = [
              `- ${item.companyName}`,
              item.period,
              item.score !== undefined ? `${item.score}/10` : undefined,
            ]
              .filter(Boolean)
              .join(' — ')
            return [
              head,
              ...item.highlights
                .slice(0, REPORT_EMAIL_MAX_HIGHLIGHTS)
                .map((h) => `  • ${h}`),
            ].join('\n')
          }),
        ].join('\n'),
      )
    }
    if (s.overdue) {
      parts.push(
        `${c.overdueLine(s.overdue.entries.length)}\n` +
          s.overdue.entries.map((e) => `- ${line(e, e.label)}`).join('\n') +
          `\n${s.overdue.forecastUrl}`,
      )
    }
    return parts
  })

  const html = layout({
    locale,
    preheader: summary,
    heading: c.heading(esc(familyName)),
    paragraphs,
    footer: c.footer,
  })

  return {
    subject: `${c.subjectPrefix} ${familyName} — ${summary}`,
    html,
    text: plainText(text),
  }
}

export function powensConnectionAlertEmail({
  locale,
  orgName,
  connectorName,
  health,
  lastSyncAt,
  errorMessage,
  cashUrl,
}: {
  locale: EmailLocale
  orgName: string
  connectorName: string
  health: 'stale' | 'action_required'
  lastSyncAt: number | null
  errorMessage: string | null
  cashUrl: string
}) {
  const fmtDate = (ms: number) =>
    new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/Paris',
    }).format(new Date(ms))
  const lastSync = lastSyncAt != null ? fmtDate(lastSyncAt) : null
  const hOrg = esc(orgName)
  const hConnector = esc(connectorName)
  // `errorMessage` is relayed verbatim from the banking institution — the one
  // value here we don't author ourselves.
  const hError = errorMessage ? esc(errorMessage) : null

  const c = pick(locale, {
    en: {
      subject:
        health === 'action_required'
          ? `Bank connection — ${connectorName} needs to be reconnected (${orgName})`
          : `Bank connection — ${connectorName} has not synced recently (${orgName})`,
      heading:
        health === 'action_required'
          ? `${hConnector}: reconnection required`
          : `${hConnector}: sync is late`,
      intro:
        health === 'action_required'
          ? `The <strong>${hConnector}</strong> bank connection of <strong>${hOrg}</strong> requires your action (new password, strong authentication…). Until you reconnect it, balances and transactions stop updating.`
          : `The <strong>${hConnector}</strong> bank connection of <strong>${hOrg}</strong> has not completed a successful sync for more than 48 hours. Balances and transactions may be out of date.`,
      followup:
        health === 'action_required'
          ? `Open the Cash page and use the “Reconnect” button next to the connection.`
          : `This often resolves on its own (bank site down, temporary block). If it persists, reconnect from the Cash page.`,
      footer: `You receive this because bank connections are monitored for ${hOrg}. One email per incident — no reminders until the state changes.`,
      preheader: `${hConnector} (${hOrg}) — bank sync issue.`,
      cta: 'Open the Cash page',
      text: [
        health === 'action_required'
          ? `The ${connectorName} bank connection of ${orgName} requires your action (new password, strong authentication…). Until you reconnect it, balances and transactions stop updating.`
          : `The ${connectorName} bank connection of ${orgName} has not completed a successful sync for more than 48 hours. Balances and transactions may be out of date.`,
        lastSync ? `Last successful sync: ${lastSync}.` : '',
        errorMessage ? `Message from the institution: ${errorMessage}` : '',
        `Open the Cash page: ${cashUrl}`,
      ],
    },
    fr: {
      subject:
        health === 'action_required'
          ? `Connexion bancaire — ${connectorName} à reconnecter (${orgName})`
          : `Connexion bancaire — ${connectorName} sans synchro récente (${orgName})`,
      heading:
        health === 'action_required'
          ? `${hConnector} : reconnexion nécessaire`
          : `${hConnector} : synchronisation en retard`,
      intro:
        health === 'action_required'
          ? `La connexion bancaire <strong>${hConnector}</strong> de <strong>${hOrg}</strong> attend une action de votre part (nouveau mot de passe, authentification forte…). Tant qu'elle n'est pas reconnectée, les soldes et transactions ne se mettent plus à jour.`
          : `La connexion bancaire <strong>${hConnector}</strong> de <strong>${hOrg}</strong> n'a pas réussi de synchronisation depuis plus de 48 heures. Les soldes et transactions peuvent être obsolètes.`,
      followup:
        health === 'action_required'
          ? `Ouvrez la page Trésorerie et utilisez le bouton « Reconnecter » à côté de la connexion.`
          : `Cela se résout souvent tout seul (site de la banque indisponible, blocage temporaire). Si ça persiste, reconnectez depuis la page Trésorerie.`,
      footer: `Vous recevez cet email car les connexions bancaires de ${hOrg} sont surveillées. Un email par incident — pas de rappel tant que l'état ne change pas.`,
      preheader: `${hConnector} (${hOrg}) — problème de synchronisation bancaire.`,
      cta: 'Ouvrir la Trésorerie',
      text: [
        health === 'action_required'
          ? `La connexion bancaire ${connectorName} de ${orgName} attend une action de votre part (nouveau mot de passe, authentification forte…). Tant qu'elle n'est pas reconnectée, les soldes et transactions ne se mettent plus à jour.`
          : `La connexion bancaire ${connectorName} de ${orgName} n'a pas réussi de synchronisation depuis plus de 48 heures. Les soldes et transactions peuvent être obsolètes.`,
        lastSync ? `Dernière synchronisation réussie : ${lastSync}.` : '',
        errorMessage ? `Message de l'établissement : ${errorMessage}` : '',
        `Ouvrir la Trésorerie : ${cashUrl}`,
      ],
    },
  })

  const detailParagraphs = [
    lastSync
      ? pick(locale, {
          en: `Last successful sync: <strong>${lastSync}</strong>.`,
          fr: `Dernière synchronisation réussie : <strong>${lastSync}</strong>.`,
        })
      : '',
    hError
      ? pick(locale, {
          en: `Message from the institution: “${hError}”`,
          fr: `Message de l'établissement : « ${hError} »`,
        })
      : '',
  ].filter(Boolean)

  const html = layout({
    locale,
    preheader: c.preheader,
    heading: c.heading,
    paragraphs: [c.intro, ...detailParagraphs, c.followup],
    cta: { label: c.cta, url: cashUrl },
    footer: c.footer,
  })

  return { subject: c.subject, html, text: plainText(c.text) }
}

export function vectorizeFailureEmail({
  locale,
  orgName,
  itemLabel,
  detail,
  targetUrl,
}: {
  locale: EmailLocale
  orgName: string
  itemLabel: string
  /** Machine code from vectorize.ts `classifyIndexError` — shown verbatim. */
  detail: string
  targetUrl: string
}) {
  const hOrg = esc(orgName)
  const hItem = esc(itemLabel)
  const hDetail = esc(detail)

  const c = pick(locale, {
    en: {
      subject: `Document indexing failed — ${itemLabel} (${orgName})`,
      heading: `“${hItem}” could not be indexed`,
      intro: `The document <strong>${hItem}</strong> (${hOrg}) could not be added to the assistant's search index, despite several spaced attempts. Until it is indexed, the assistant cannot search its content.`,
      followup: `The file itself is safe and untouched. Open the sheet and use the retry button next to the document — if the provider was saturated, a later retry usually goes through.`,
      footer: `You receive this because document indexing is monitored for ${hOrg}. One email per failed document.`,
      preheader: `“${hItem}” is not searchable by the assistant.`,
      cta: 'Open the sheet',
      text: [
        `The document "${itemLabel}" (${orgName}) could not be added to the assistant's search index, despite several spaced attempts.`,
        `Error code: ${detail}`,
        `The file itself is safe and untouched. Open the sheet and use the retry button next to the document: ${targetUrl}`,
      ],
    },
    fr: {
      subject: `Indexation en échec — ${itemLabel} (${orgName})`,
      heading: `« ${hItem} » n'a pas pu être indexé`,
      intro: `Le document <strong>${hItem}</strong> (${hOrg}) n'a pas pu être ajouté à l'index de recherche de l'assistant, malgré plusieurs tentatives espacées. Tant qu'il n'est pas indexé, l'assistant ne peut pas chercher dans son contenu.`,
      followup: `Le fichier lui-même est intact. Ouvrez la fiche et utilisez le bouton de relance à côté du document — si le fournisseur était saturé, une relance plus tard passe en général.`,
      footer: `Vous recevez cet email car l'indexation des documents de ${hOrg} est surveillée. Un email par document en échec.`,
      preheader: `« ${hItem} » n'est pas cherchable par l'assistant.`,
      cta: 'Ouvrir la fiche',
      text: [
        `Le document « ${itemLabel} » (${orgName}) n'a pas pu être ajouté à l'index de recherche de l'assistant, malgré plusieurs tentatives espacées.`,
        `Code d'erreur : ${detail}`,
        `Le fichier lui-même est intact. Ouvrez la fiche et utilisez le bouton de relance à côté du document : ${targetUrl}`,
      ],
    },
  })

  const detailParagraph = pick(locale, {
    en: `Error code: <code>${hDetail}</code>`,
    fr: `Code d'erreur : <code>${hDetail}</code>`,
  })

  const html = layout({
    locale,
    preheader: c.preheader,
    heading: c.heading,
    paragraphs: [c.intro, detailParagraph, c.followup],
    cta: { label: c.cta, url: targetUrl },
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

/**
 * Quality-control blocks appended to the confirmation for whoever handles the
 * review queue: what was read, which target KPIs were found, which values look
 * off. Never shown to someone whose role stops at forwarding — they have
 * nothing to do with it.
 */
function qualityBlocks(d: ReportQuality): Array<string> {
  const sources = d.sources.map((s) => {
    const icon = STATE_ICONS[s.state] ?? ''
    const detail = s.detail ? ` — ${esc(SOURCE_DETAIL_LABELS[s.detail] ?? s.detail)}` : ''
    return `${icon} ${esc(s.label)}${detail}`
  })

  const targets = (d.targets ?? []).map((t) =>
    t.found && t.value !== undefined && t.unit !== undefined
      ? `✅ ${esc(t.metricType)} : <b>${formatMetricValue(t.value, t.unit)}</b>`
      : `⚠️ ${esc(t.metricType)} : absent de ce report`,
  )
  // With a target checklist, the generic metrics list only carries the
  // extras (targets are already itemized above).
  const targetKeys = new Set((d.targets ?? []).map((t) => t.metricType))
  const metrics = d.metricsFound
    .filter((m) => !targetKeys.has(m.metricType))
    .map((m) => `${esc(m.metricType)} : <b>${formatMetricValue(m.value, m.unit)}</b>`)
  const suspicious = d.suspicious.map(
    (s) =>
      `${esc(s.metricType)} : ${formatMetricValue(s.value, s.unit)} (précédent : ${formatMetricValue(
        s.previousValue,
        s.unit,
      )}) — vérifier une éventuelle erreur d'unité`,
  )

  return [
    `<p style="margin:22px 0 0;color:${MUTED};font-size:13px;">Rattachement confirmé par : ${esc(matchMethodLabel(d.matchMethod))}</p>`,
    listBlock('Sources', sources),
    listBlock('KPIs cibles', targets),
    listBlock(targets.length > 0 ? 'Autres métriques enregistrées' : 'Métriques enregistrées', metrics),
    listBlock('⚠️ Valeurs inhabituelles', suspicious),
    listBlock('Métriques non reconnues (conservées sur le report, hors séries)', d.unrecognized.map(esc)),
    listBlock('Habituelles mais absentes de ce report', d.missingUsual.map(esc)),
  ].filter(Boolean)
}

/**
 * Confirmation, soft failure and duplicate notices — the three mails a
 * forwarder can receive, plus the copy broadcast to the rest of the org.
 *
 * These carry business data (committed amount, AI synthesis) where the
 * recap above carries pipeline data (sources read, metrics extracted). The
 * caller is responsible for scoping `entities` to the recipient's own
 * organizations — see `reportNotify.entityCards`.
 */

/** Brand tones, from src/styles/brand.css (oklch converted to hex: mail
 *  clients have no custom properties and no oklch support). */
const TONE_POSITIVE = '#009966'
const TONE_NEGATIVE = '#e7000b'
const TONE_WARNING = '#d27c1b'

/**
 * Score → colour. Mirrors `scoreVerdict` in src/lib/reportScore.ts band for
 * band: move one, move the other, or a company reads "En bonne voie" in amber
 * on the fiche and in green in its mail.
 */
function scoreColor(score: number): string {
  if (score >= 7) return TONE_POSITIVE
  if (score >= 5) return TONE_WARNING
  return TONE_NEGATIVE
}

const MONTH_FMT = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric' })

export interface ReportEntityCard {
  name: string
  orgName: string
  /** logo.dev URL — null when the company carries no website domain. */
  logoUrl: string | null
  /** Fiche URL — null when SITE_URL is unset. */
  url: string | null
  /**
   * What the org actually wired to this company, in EUR cents — the sum of
   * the outflows reconciled against its deals ("Versé" in the app), not the
   * commitment. Most CALTE deals carry no commitment at all, so keying the
   * line on it left it blank on nearly every report.
   */
  paidCents?: number
  /** First investment date on this company, ms epoch. */
  firstInvestmentAt?: number
  /** Period label of the report that came before this one. */
  previousPeriod?: string
  synthesis?: ReportSynthesis
}

export interface ReportSynthesis {
  score?: number
  scoreLabel?: string
  summary: string
  goodPoints: Array<string>
  badPoints: Array<string>
  insights: Array<{
    label: string
    value: string
    trend?: string
    direction?: 'up' | 'down' | 'stable'
    context?: string
  }>
}

export interface ReportConfirmationData {
  entities: Array<ReportEntityCard>
  /** Absent on a one-off document that covers no period. */
  reportPeriod?: string
  /** Key highlights of the report just filed — capped at 3 by the caller. */
  highlights: Array<string>
  /** True when this confirmation closes a failure the forwarder was told about. */
  afterFix?: boolean
  /** Set on the copy sent to members who did not forward anything. */
  forwardedBy?: string
  /** Portal arrival instead of a forward: nobody sent this, it was published.
   *  Reads the same as `forwardedBy` (it is news for everyone), but says where
   *  it came from rather than who relayed it. */
  publishedOn?: string
  /** Titles of the publications this announcement covers — the portal gives no
   *  extracted highlights, so the titles are what names the arrival. */
  publicationTitles?: Array<string>
  /** Present only for a reader who handles the review queue. */
  quality?: ReportQuality
}

/** Entity identity block: logo (or initial), name, organization. */
function entityBlock(e: ReportEntityCard): string {
  const logo = e.logoUrl
    ? `<img src="${e.logoUrl}" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border-radius:6px;background:#f1f1f3;">`
    : `<div style="width:40px;height:40px;border-radius:6px;background:#f1f1f3;color:${MUTED};font-weight:600;font-size:15px;text-align:center;line-height:40px;">${esc(e.name.slice(0, 1).toUpperCase())}</div>`
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${BORDER};border-radius:8px;">
  <tr><td style="padding:12px 14px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td width="40" valign="middle" style="vertical-align:middle;padding-right:12px;">${logo}</td>
        <td valign="middle" style="vertical-align:middle;">
          <div style="font-weight:600;line-height:1.3;">${esc(e.name)}</div>
          <div style="color:${MUTED};font-size:13px;line-height:1.3;">${esc(e.orgName)}</div>
        </td>
      </tr>
    </table>
  </td></tr>
</table>`
}

/**
 * Fiche facts. "Versé" comes from reconciled bank movements, so it is shown
 * TO THE CENT — cf. CLAUDE.md "l'actuel au centime, l'estimé arrondi". A
 * commitment would have been rounded to the euro; this is not one.
 * Returns '' when the company carries neither a payment nor an earlier report.
 */
function factsBlock(e: ReportEntityCard): string {
  const parts: Array<string> = []
  if (e.paidCents !== undefined) {
    const when = e.firstInvestmentAt
      ? ` depuis ${MONTH_FMT.format(new Date(e.firstInvestmentAt))}`
      : ''
    parts.push(
      `Versé&nbsp;: <b style="color:${BRAND};">${esc(EUR_CENTS_FMT.format(e.paidCents / 100))}</b>${esc(when)}`,
    )
  }
  if (e.previousPeriod) {
    parts.push(`Report précédent&nbsp;: <b style="color:${BRAND};">${esc(e.previousPeriod)}</b>`)
  }
  if (parts.length === 0) return ''
  return `<p style="margin:12px 0 0;color:${MUTED};font-size:13px;">${parts.join('&nbsp;&nbsp;·&nbsp;&nbsp;')}</p>`
}

/**
 * Font size of a KPI value, from its length. A tile is ~180px wide in a
 * 560px shell: a short figure ("86k€") can be big, a long one wraps and
 * has to shrink. No fixed heights anywhere — a value that wraps used to
 * overflow its 28px box and paint over the context line below.
 */
function valueFontSize(value: string): number {
  if (value.length <= 12) return 21
  if (value.length <= 24) return 17
  return 15
}

/**
 * One KPI tile, as a table CELL rather than a nested table: cells of the same
 * row share its height, so the three tiles keep a common baseline whatever
 * their text — which is what the removed fixed heights were trying to buy.
 */
function insightCell(i: ReportSynthesis['insights'][number], width: string): string {
  const tone =
    i.direction === 'up' ? TONE_POSITIVE : i.direction === 'down' ? TONE_NEGATIVE : null
  const chip = i.trend
    ? `<span style="display:inline-block;border:1px solid ${tone ?? BORDER};color:${tone ?? MUTED};font-size:11px;padding:1px 6px;border-radius:999px;line-height:1.4;">${esc(i.trend)}</span>`
    : ''
  return `<td width="${width}" valign="top" style="vertical-align:top;border:1px solid ${BORDER};border-radius:8px;padding:11px 12px;">
    <div style="color:${MUTED};font-size:10px;letter-spacing:0.05em;text-transform:uppercase;line-height:1.3;">${esc(i.label)}</div>
    <div style="font-size:${valueFontSize(i.value)}px;font-weight:600;line-height:1.25;margin-top:3px;word-break:break-word;">${esc(i.value)}</div>
    ${chip ? `<div style="margin-top:5px;line-height:1.4;">${chip}</div>` : ''}
    ${i.context ? `<div style="color:${MUTED};font-size:11px;margin-top:5px;line-height:1.35;">${esc(i.context)}</div>` : ''}
  </td>`
}

/**
 * The fiche's own synthesis card, rebuilt for email. The score is a bordered
 * rounded square rather than the app's SVG progress ring: Gmail strips SVG
 * from received mail, so the ring would arrive empty.
 */
function synthesisCard(name: string, s: ReportSynthesis): string {
  const blocks: Array<string> = [
    `<p style="margin:0 0 14px;color:${MUTED};font-size:12px;">Synthèse IA · où en est ${esc(name)}</p>`,
  ]

  if (s.score !== undefined) {
    const color = scoreColor(s.score)
    blocks.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td width="44" valign="middle" style="vertical-align:middle;padding-right:12px;">
      <div style="width:44px;height:44px;border-radius:10px;border:2px solid ${color};color:${color};font-size:19px;font-weight:600;text-align:center;line-height:40px;">${s.score}</div>
    </td>
    <td valign="middle" style="vertical-align:middle;">
      ${s.scoreLabel ? `<span style="font-weight:600;font-size:15px;">${esc(s.scoreLabel)}</span>` : ''}
      <span style="color:${MUTED};font-size:14px;">&nbsp;Score ${s.score}/10</span>
    </td>
  </tr>
</table>`)
  }

  blocks.push(`<p style="margin:14px 0 0;color:#3f4147;">${esc(s.summary)}</p>`)

  if (s.goodPoints.length > 0 || s.badPoints.length > 0) {
    const col = (heading: string, color: string, items: Array<string>, pad: string) =>
      `<td valign="top" width="50%" style="vertical-align:top;${pad}">
    <p style="margin:0 0 7px;color:${color};font-size:11px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;">${heading}</p>
    ${items.map((it, idx) => `<p style="margin:0 0 ${idx === items.length - 1 ? '0' : '5px'};font-size:13px;line-height:1.4;">${esc(it)}</p>`).join('\n    ')}
  </td>`
    blocks.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:18px;">
  <tr>
  ${col('Points forts', TONE_POSITIVE, s.goodPoints, 'padding-right:10px;')}
  ${col('Points de vigilance', TONE_NEGATIVE, s.badPoints, 'padding-left:10px;')}
  </tr>
</table>`)
  }

  if (s.insights.length > 0) {
    const tiles = s.insights.slice(0, 3)
    // Gutters are spacer cells: the tiles carry the border themselves, so
    // padding between them is not an option.
    const gutter = `<td width="10" style="font-size:0;line-height:0;">&nbsp;</td>`
    const width = `${Math.floor((100 - 2 * tiles.length) / tiles.length)}%`
    const cells = tiles.map((i) => insightCell(i, width)).join(`\n  ${gutter}\n  `)
    blocks.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:18px;">
  <tr>
  ${cells}
  </tr>
</table>`)
  }

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${BORDER};border-radius:8px;margin-top:22px;">
  <tr><td style="padding:18px;">
${blocks.join('\n')}
  </td></tr>
</table>`
}

/** Primary action button. Inline-block anchor — no VML, Outlook shows a square. */
function buttonBlock(label: string, url: string): string {
  return `<p style="margin:22px 0 0;"><a href="${url}" style="display:inline-block;background:${BUTTON_BG};color:${BUTTON_FG};text-decoration:none;font-weight:500;font-size:14px;padding:10px 18px;border-radius:6px;">${esc(label)}</a></p>`
}

/** Bulleted list rendered as a table — <ul> indentation is unreliable in mail. */
function bulletBlock(heading: string, items: Array<string>): string {
  if (items.length === 0) return ''
  const rows = items
    .map(
      (it, idx) =>
        `<tr>
    <td width="16" valign="top" style="vertical-align:top;color:${MUTED};font-size:14px;line-height:1.5;">•</td>
    <td valign="top" style="vertical-align:top;color:#3f4147;font-size:14px;line-height:1.5;${idx === items.length - 1 ? '' : 'padding-bottom:7px;'}">${esc(it)}</td>
  </tr>`,
    )
    .join('\n  ')
  return `<p style="margin:20px 0 8px;font-weight:600;">${heading}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
  ${rows}
</table>`
}

/**
 * The report is filed — the mail that carries the whole point of the circuit.
 * Same template for the forwarder's thread reply and for the copy the rest of
 * the org receives; `forwardedBy` and `afterFix` are the only differences.
 */
export function reportConfirmationHtml(d: ReportConfirmationData): string {
  const periodLabel = d.reportPeriod ? esc(d.reportPeriod) : 'document ponctuel'
  const announced = Boolean(d.forwardedBy) || Boolean(d.publishedOn)
  const title = announced
    ? `📈 Nouveau report — ${periodLabel}`
    : `✅ Report rangé — ${periodLabel}`

  const blocks: Array<string> = []

  if (d.afterFix) {
    blocks.push(
      `<p style="margin:0 0 14px;color:${MUTED};">Le report qui coinçait est maintenant rangé.</p>`,
    )
  }
  if (d.forwardedBy) {
    blocks.push(
      `<p style="margin:0 0 14px;color:${MUTED};">Transféré par ${esc(d.forwardedBy)}.</p>`,
    )
  } else if (d.publishedOn) {
    blocks.push(
      `<p style="margin:0 0 14px;color:${MUTED};">${esc(d.publishedOn)}.</p>`,
    )
  }

  for (const e of d.entities) {
    blocks.push(entityBlock(e))
    const facts = factsBlock(e)
    if (facts) blocks.push(facts)
    blocks.push(bulletBlock('Ce que dit ce report', d.highlights.slice(0, 3)))
    if (d.publicationTitles?.length)
      blocks.push(bulletBlock('Publications', d.publicationTitles))
    if (e.synthesis) blocks.push(synthesisCard(e.name, e.synthesis))
    if (e.url) blocks.push(buttonBlock(`Ouvrir la fiche ${e.name}`, e.url))
  }

  if (d.quality) blocks.push(...qualityBlocks(d.quality))

  if (!announced) {
    blocks.push(
      `<p style="margin:14px 0 0;color:${MUTED};font-size:13px;">Tu n'as rien d'autre à faire.</p>`,
    )
  }

  return recapShell(title, blocks.filter(Boolean))
}

/**
 * The report could not be filed, told to someone whose role stops at
 * forwarding. No cause, no technical detail, no link to the queue: nothing
 * they could act on. It cannot name the company either — half the failures
 * are precisely the circuit failing to identify one.
 *
 * It promises a human, which is only true because the front forbids emptying
 * the report-issues recipient list (`organizations.setMemberAlertPref`).
 */
export function reportSoftFailureHtml(subject: string, receivedAt: number): string {
  const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(
    new Date(receivedAt),
  )
  return recapShell("⚠️ Ton report n'a pas pu être rangé automatiquement", [
    `<p style="margin:0;">Le mail «&nbsp;<i>${esc(subject)}</i>&nbsp;», transféré le ${esc(day)}, est bien arrivé avec ses pièces jointes. Rien n'est perdu.</p>`,
    `<p style="margin:12px 0 0;color:${MUTED};">L'équipe Albo OS a été prévenue et va le rattacher à la main. Tu recevras la confirmation dès que ce sera fait&nbsp;— rien à faire de ton côté.</p>`,
  ])
}

/**
 * The report was already in Albo OS — a second forward of something already
 * filed. "Rafraîchi" rather than "ignoré" on purpose: nothing distinguishes a
 * duplicate from a corrected version of the same period, and both really do
 * update the stored report.
 */
export function reportDuplicateHtml(d: {
  entityName: string
  reportPeriod?: string
  url: string | null
}): string {
  const period = d.reportPeriod ? `, ${esc(d.reportPeriod)}` : ''
  return recapShell(`📬 Déjà rangé — ${esc(d.entityName)}${period}`, [
    `<p style="margin:0;color:${MUTED};">Ce report était déjà dans Albo OS. Il a été rafraîchi avec ce que contenait ton mail, rien n'a été dupliqué.</p>`,
    ...(d.url ? [buttonBlock(`Ouvrir la fiche ${d.entityName}`, d.url)] : []),
  ])
}

/**
 * Failure recap — replied in the thread (queue handlers only). `detail` is
 * the raw technical message: dev-facing, never translated, and bounded —
 * a Zod validation error runs to hundreds of characters.
 */
export function reportRecapFailureHtml(
  reason: string,
  queueUrl: string,
  detail?: string,
): string {
  const trimmed = detail?.trim()
  const bounded =
    trimmed && trimmed.length > FAILURE_DETAIL_MAX
      ? `${trimmed.slice(0, FAILURE_DETAIL_MAX)}…`
      : trimmed
  return recapShell(`⚠️ Report non traité — ${esc(reviewReasonLabel(reason))}`, [
    `<p style="margin: 0; color: ${MUTED};">L'email est conservé dans la file « Reports entrants ». Tu peux le rattacher à une participation ou le retraiter depuis Albo OS.</p>`,
    ...(bounded
      ? [
          `<p style="margin: 12px 0 0; color: ${MUTED}; font-size: 12px;">Détail technique : ${esc(bounded)}</p>`,
        ]
      : []),
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
