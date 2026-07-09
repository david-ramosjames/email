export type RecipientFields = {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  firm_name?: string | null;
  city?: string | null;
  practice_area?: string | null;
  notes?: string | null;
};

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string) {
  return EMAIL_RE.test(normalizeEmail(email));
}

export function personalize(template: string, fields: RecipientFields) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const value = fields[key as keyof RecipientFields];
    return value ? String(value) : "";
  });
}

export function addComplianceFooter({
  html,
  text,
  businessIdentity,
  mailingAddress,
  unsubscribeUrl,
}: {
  html: string;
  text: string;
  businessIdentity: string;
  mailingAddress: string;
  unsubscribeUrl: string;
}) {
  const htmlFooter = `
<hr style="border:0;border-top:1px solid #d7dde5;margin:24px 0 12px" />
<p style="font-size:12px;line-height:1.5;color:#536173">
  Sent by ${escapeHtml(businessIdentity)}<br />
  ${escapeHtml(mailingAddress).replace(/\n/g, "<br />")}<br />
  To opt out, visit <a href="${unsubscribeUrl}">${unsubscribeUrl}</a> or reply with "unsubscribe".
</p>`;

  const textFooter = [
    "",
    "--",
    `Sent by ${businessIdentity}`,
    mailingAddress,
    `To opt out, visit ${unsubscribeUrl} or reply with "unsubscribe".`,
  ].join("\n");

  return { html: `${html}\n${htmlFooter}`, text: `${text}\n${textFooter}` };
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
