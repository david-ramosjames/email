import { createHmac, timingSafeEqual } from "crypto";

function trackingSecret() {
  return process.env.TRACKING_SECRET || process.env.NEXTAUTH_SECRET || "local-open-tracking-secret";
}

function appBaseUrl() {
  const unsubscribeBase = process.env.UNSUBSCRIBE_BASE_URL?.replace(/\/unsubscribe\/?$/, "");
  const base = process.env.TRACKING_BASE_URL || process.env.NEXTAUTH_URL || unsubscribeBase || "";
  return base.replace(/\/$/, "");
}

export function openTrackingToken(campaignRecipientId: string) {
  return createHmac("sha256", trackingSecret()).update(campaignRecipientId).digest("base64url");
}

export function verifyOpenTrackingToken(campaignRecipientId: string, token: string) {
  const expected = openTrackingToken(campaignRecipientId);
  const expectedBuffer = Buffer.from(expected);
  const tokenBuffer = Buffer.from(token);

  return expectedBuffer.length === tokenBuffer.length && timingSafeEqual(expectedBuffer, tokenBuffer);
}

export function openTrackingUrl(campaignRecipientId: string) {
  const base = appBaseUrl();
  if (!base) return "";

  const params = new URLSearchParams({
    cr: campaignRecipientId,
    t: openTrackingToken(campaignRecipientId),
  });

  return `${base}/api/track/open?${params.toString()}`;
}

export function injectOpenTrackingPixel(html: string, trackingUrl: string) {
  if (!trackingUrl) return html;

  const pixel = `<img src="${trackingUrl}" width="1" height="1" alt="" style="display:none;height:1px;width:1px;border:0;margin:0;padding:0" />`;

  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${pixel}</body>`);
  }

  return `${html}\n${pixel}`;
}
