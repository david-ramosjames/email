import { CampaignRecipientStatus, EmailEventType, Prisma } from "@prisma/client";
import { gmailClientForReading } from "@/lib/gmail";
import { normalizeEmail, validateEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";

type GmailHeader = {
  name?: string | null;
  value?: string | null;
};

type GmailPart = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: GmailPart[] | null;
};

type BounceCandidate = {
  bouncedEmail: string;
  reason: string;
  statusCode?: string;
  hardBounce: boolean;
  campaignRecipientId?: string;
};

const defaultBounceQuery = [
  'from:(mailer-daemon postmaster "Mail Delivery Subsystem")',
  'OR subject:("Delivery Status Notification" Undeliverable "Address not found" "Mail delivery failed")',
  "newer_than:30d",
].join(" ");

function decodeBase64Url(value: string) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function headerValue(headers: GmailHeader[] | undefined, name: string) {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

function collectBodyText(part?: GmailPart | null): string {
  if (!part) return "";

  const own = part.body?.data ? decodeBase64Url(part.body.data) : "";
  const children = (part.parts || []).map((child) => collectBodyText(child)).join("\n");

  return [own, children].filter(Boolean).join("\n");
}

function cleanEmail(value: string) {
  return value
    .trim()
    .replace(/^mailto:/i, "")
    .replace(/[<>"'(),;]+/g, "")
    .toLowerCase();
}

function firstEmailFromBody(body: string) {
  const patterns = [
    /(?:Final|Original)-Recipient:\s*rfc822;\s*([^\s<>;]+)/i,
    /X-Failed-Recipients:\s*([^\s<>;,]+)/i,
    /Recipient address rejected:\s*([^\s<>;,]+)/i,
    /address\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\s+was not found/i,
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    const email = match?.[1] ? cleanEmail(match[1]) : "";
    if (email && validateEmail(email)) return email;
  }

  const fallback = body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const email = fallback ? cleanEmail(fallback) : "";

  return email && validateEmail(email) ? email : "";
}

function campaignRecipientIdFromBody(body: string) {
  return body.match(/X-Referral-Campaign-Recipient:\s*([a-z0-9]+)/i)?.[1];
}

function statusCodeFromBody(body: string) {
  return body.match(/(?:Status|Remote-MTA|Diagnostic-Code):[^\n]*(\b[245]\.\d+\.\d+\b)/i)?.[1] || body.match(/\b[245]\.\d+\.\d+\b/)?.[0];
}

function reasonFromBody(body: string, subject: string) {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const diagnostic = lines.find((line) => /Diagnostic-Code:/i.test(line));
  const rejected = lines.find((line) => /Recipient address rejected|address not found|user unknown|no such user/i.test(line));
  const status = lines.find((line) => /^Status:/i.test(line));

  return (diagnostic || rejected || status || subject || "Delivery failed").replace(/\s+/g, " ").slice(0, 500);
}

function isHardBounce(body: string, statusCode?: string) {
  if (statusCode?.startsWith("5.")) return true;
  if (statusCode?.startsWith("4.")) return false;

  return /address not found|user unknown|no such user|recipient address rejected|mailbox unavailable|does not exist|invalid recipient/i.test(
    body,
  );
}

function shouldInspectMessage(headers: GmailHeader[], body: string) {
  const from = headerValue(headers, "from");
  const subject = headerValue(headers, "subject");

  return /mailer-daemon|postmaster|mail delivery subsystem/i.test(from) || /delivery status notification|undeliverable|address not found|mail delivery failed|returned mail/i.test(subject) || /Final-Recipient:|Diagnostic-Code:|X-Failed-Recipients:/i.test(body);
}

async function alreadyProcessed(gmailMessageId: string) {
  const existing = await prisma.emailEvent.findFirst({
    where: {
      type: EmailEventType.bounced,
      metadata: {
        path: ["gmailMessageId"],
        equals: gmailMessageId,
      },
    },
  });

  return Boolean(existing);
}

async function findCampaignRecipient(candidate: BounceCandidate) {
  if (candidate.campaignRecipientId) {
    const direct = await prisma.campaignRecipient.findUnique({
      where: { id: candidate.campaignRecipientId },
      include: { recipient: true },
    });
    if (direct) return direct;
  }

  return prisma.campaignRecipient.findFirst({
    where: {
      recipient: { normalizedEmail: normalizeEmail(candidate.bouncedEmail) },
      status: { in: [CampaignRecipientStatus.sent, CampaignRecipientStatus.queued, CampaignRecipientStatus.pending] },
    },
    include: { recipient: true },
    orderBy: [{ sentAt: "desc" }, { updatedAt: "desc" }],
  });
}

async function processBounce({
  userId,
  gmailMessageId,
  subject,
  from,
  candidate,
}: {
  userId: string;
  gmailMessageId: string;
  subject: string;
  from: string;
  candidate: BounceCandidate;
}) {
  const campaignRecipient = await findCampaignRecipient(candidate);
  const normalizedEmail = normalizeEmail(candidate.bouncedEmail);
  const suppressionReason = `Bounced: ${candidate.reason}`;

  if (campaignRecipient) {
    await prisma.campaignRecipient.update({
      where: { id: campaignRecipient.id },
      data: {
        status: CampaignRecipientStatus.failed,
        errorMessage: suppressionReason,
      },
    });
  }

  if (candidate.hardBounce) {
    await prisma.suppressionList.upsert({
      where: { normalizedEmail },
      update: {
        email: candidate.bouncedEmail,
        reason: suppressionReason,
        source: "gmail_bounce_monitor",
        createdById: userId,
      },
      create: {
        email: candidate.bouncedEmail,
        normalizedEmail,
        reason: suppressionReason,
        source: "gmail_bounce_monitor",
        createdById: userId,
      },
    });

    await prisma.campaignRecipient.updateMany({
      where: {
        recipient: { normalizedEmail },
        status: { in: [CampaignRecipientStatus.pending, CampaignRecipientStatus.queued] },
      },
      data: {
        status: CampaignRecipientStatus.skipped,
        skippedAt: new Date(),
        errorMessage: "Recipient hard-bounced and was added to the suppression list.",
      },
    });
  }

  await prisma.emailEvent.create({
    data: {
      campaignId: campaignRecipient?.campaignId,
      campaignRecipientId: campaignRecipient?.id,
      type: EmailEventType.bounced,
      metadata: {
        gmailMessageId,
        subject,
        from,
        bouncedEmail: candidate.bouncedEmail,
        reason: candidate.reason,
        statusCode: candidate.statusCode,
        hardBounce: candidate.hardBounce,
        suppressed: candidate.hardBounce,
      } satisfies Prisma.InputJsonObject,
    },
  });

  return { suppressed: candidate.hardBounce, matched: Boolean(campaignRecipient), reason: suppressionReason };
}

export async function syncBouncesForUser(userId: string) {
  const gmail = await gmailClientForReading(userId);
  const query = process.env.BOUNCE_SEARCH_QUERY || defaultBounceQuery;
  const maxResults = Number(process.env.BOUNCE_SYNC_MAX_RESULTS || 25);
  const response = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  let inspected = 0;
  let processed = 0;
  let suppressed = 0;
  let matched = 0;
  const reasons: Array<{ email: string; reason: string; suppressed: boolean }> = [];

  for (const message of response.data.messages || []) {
    if (!message.id || (await alreadyProcessed(message.id))) continue;

    inspected += 1;
    const fullMessage = await gmail.users.messages.get({
      userId: "me",
      id: message.id,
      format: "full",
    });
    const payload = fullMessage.data.payload as GmailPart | undefined;
    const headers = (fullMessage.data.payload?.headers || []) as GmailHeader[];
    const body = collectBodyText(payload);

    if (!shouldInspectMessage(headers, body)) continue;

    const bouncedEmail = firstEmailFromBody(body);
    if (!bouncedEmail) continue;

    const subject = headerValue(headers, "subject");
    const from = headerValue(headers, "from");
    const statusCode = statusCodeFromBody(body);
    const candidate: BounceCandidate = {
      bouncedEmail,
      statusCode,
      reason: reasonFromBody(body, subject),
      hardBounce: isHardBounce(body, statusCode),
      campaignRecipientId: campaignRecipientIdFromBody(body),
    };
    const result = await processBounce({
      userId,
      gmailMessageId: message.id,
      subject,
      from,
      candidate,
    });

    processed += 1;
    if (result.suppressed) suppressed += 1;
    if (result.matched) matched += 1;
    reasons.push({ email: bouncedEmail, reason: result.reason, suppressed: result.suppressed });
  }

  return {
    query,
    inspected,
    processed,
    suppressed,
    matched,
    reasons,
  };
}
