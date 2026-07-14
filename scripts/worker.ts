import { Worker } from "bullmq";
import { CampaignRecipientStatus, CampaignStatus, EmailEventType } from "@prisma/client";
import { addComplianceFooter, normalizeEmail, personalize } from "../src/lib/email";
import { prisma } from "../src/lib/prisma";
import { redisConnection, SEND_QUEUE_NAME, SendJobData } from "../src/lib/queue";
import { sendGmailMessage } from "../src/lib/gmail";
import { injectOpenTrackingPixel, openTrackingUrl } from "../src/lib/tracking";

async function shouldStopForErrorRate(campaignId: string, threshold: number) {
  const [failed, sent] = await Promise.all([
    prisma.campaignRecipient.count({ where: { campaignId, status: "failed" } }),
    prisma.campaignRecipient.count({ where: { campaignId, status: "sent" } }),
  ]);
  const totalFinished = failed + sent;
  if (totalFinished < 5) return false;
  return (failed / totalFinished) * 100 >= threshold;
}

async function markCampaignCompleteIfDone(campaignId: string) {
  const remaining = await prisma.campaignRecipient.count({
    where: {
      campaignId,
      status: { in: ["pending", "queued"] },
    },
  });

  if (remaining === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: CampaignStatus.completed, completedAt: new Date() },
    });
  }
}

const worker = new Worker<SendJobData>(
  SEND_QUEUE_NAME,
  async (job) => {
    const item = await prisma.campaignRecipient.findUnique({
      where: { id: job.data.campaignRecipientId },
      include: {
        recipient: true,
        campaign: { include: { owner: true } },
      },
    });

    if (!item) return;
    const { campaign, recipient } = item;

    if (campaign.status !== "sending") {
      await prisma.campaignRecipient.update({
        where: { id: item.id },
        data: { status: CampaignRecipientStatus.pending },
      });
      return;
    }

    if (await shouldStopForErrorRate(campaign.id, campaign.errorRateStopPercent)) {
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: CampaignStatus.paused },
      });
      throw new Error("Campaign paused because the failure rate exceeded the configured limit.");
    }

    const normalizedEmail = normalizeEmail(recipient.email);
    const suppressed = await prisma.suppressionList.findUnique({
      where: { normalizedEmail },
    });

    if (suppressed) {
      await prisma.campaignRecipient.update({
        where: { id: item.id },
        data: {
          status: CampaignRecipientStatus.skipped,
          skippedAt: new Date(),
          errorMessage: "Recipient is on the suppression list.",
        },
      });
      await prisma.emailEvent.create({
        data: {
          campaignId: campaign.id,
          campaignRecipientId: item.id,
          type: EmailEventType.skipped,
          metadata: { reason: "suppressed" },
        },
      });
      await markCampaignCompleteIfDone(campaign.id);
      return;
    }

    const fields = {
      email: recipient.email,
      first_name: recipient.firstName,
      last_name: recipient.lastName,
      firm_name: recipient.firmName,
      city: recipient.city,
      practice_area: recipient.practiceArea,
      notes: recipient.notes,
    };
    const unsubscribeBase = process.env.UNSUBSCRIBE_BASE_URL || "";
    const unsubscribeUrl = `${unsubscribeBase}?email=${encodeURIComponent(recipient.email)}&campaign=${campaign.id}`;
    const html = personalize(campaign.htmlBody, fields);
    const text = personalize(campaign.textBody, fields);
    const withFooter = addComplianceFooter({
      html,
      text,
      businessIdentity: campaign.businessIdentity,
      mailingAddress: campaign.mailingAddress,
      unsubscribeUrl,
    });
    const trackedHtml = campaign.trackOpens
      ? injectOpenTrackingPixel(withFooter.html, openTrackingUrl(item.id))
      : withFooter.html;

    try {
      const sendResult = await sendGmailMessage({
        userId: campaign.ownerId,
        to: recipient.email,
        fromName: campaign.fromName,
        fromEmail: campaign.fromEmailAlias,
        replyTo: campaign.replyToEmail,
        subject: personalize(campaign.subjectLine, fields),
        html: trackedHtml,
        text: withFooter.text,
        headers: {
          "X-Referral-Campaign": campaign.id,
          "X-Referral-Campaign-Recipient": item.id,
        },
      });

      await prisma.campaignRecipient.update({
        where: { id: item.id },
        data: {
          status: CampaignRecipientStatus.sent,
          gmailMessageId: sendResult.gmailMessageId,
          sentAt: new Date(),
          errorMessage: null,
        },
      });
      await prisma.emailEvent.create({
        data: {
          campaignId: campaign.id,
          campaignRecipientId: item.id,
          type: EmailEventType.sent,
          metadata: sendResult,
        },
      });
      await markCampaignCompleteIfDone(campaign.id);
    } catch (error) {
      await prisma.campaignRecipient.update({
        where: { id: item.id },
        data: {
          status: CampaignRecipientStatus.failed,
          errorMessage: error instanceof Error ? error.message : "Unknown send error",
        },
      });
      await prisma.emailEvent.create({
        data: {
          campaignId: campaign.id,
          campaignRecipientId: item.id,
          type: EmailEventType.failed,
          metadata: { error: error instanceof Error ? error.message : "Unknown send error" },
        },
      });
      throw error;
    }
  },
  {
    connection: redisConnection(),
    concurrency: 1,
  },
);

worker.on("ready", () => {
  console.log(`Referral outreach worker listening on ${SEND_QUEUE_NAME}`);
});

worker.on("failed", (job, error) => {
  console.error(`Send job ${job?.id} failed`, error.message);
});
