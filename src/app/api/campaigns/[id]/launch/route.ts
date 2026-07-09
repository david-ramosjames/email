import { CampaignRecipientStatus, CampaignStatus, EmailEventType } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { jobDelayForIndex, sendQueue } from "@/lib/queue";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  const queue = sendQueue();
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    const campaign = await prisma.campaign.findFirst({
      where: { id, ownerId: session.user.id },
      include: { campaignRecipients: true },
    });

    if (!campaign) throw new Error("Campaign not found.");
    if (!campaign.testSentAt) throw new Error("A test email must be sent before launch.");
    if (campaign.status === "completed" || campaign.status === "sending") {
      throw new Error("This campaign is already launched or completed.");
    }

    const alreadySent = campaign.campaignRecipients.some((item) => item.status === "sent");
    if (alreadySent && campaign.status !== "paused") {
      throw new Error("This campaign already has sent recipients and cannot be launched again.");
    }

    const recipients = campaign.campaignRecipients.filter((item) => item.status === "pending");
    if (recipients.length === 0) throw new Error("No pending recipients are available to send.");

    await prisma.campaign.update({
      where: { id },
      data: {
        status: CampaignStatus.sending,
        launchedAt: campaign.launchedAt || new Date(),
      },
    });

    for (const [index, item] of recipients.entries()) {
      await prisma.campaignRecipient.update({
        where: { id: item.id },
        data: {
          status: CampaignRecipientStatus.queued,
          queuedAt: new Date(),
        },
      });
      await queue.add(
        "send-recipient",
        { campaignRecipientId: item.id },
        {
          jobId: item.id,
          delay: jobDelayForIndex(index, campaign.throttlePerHour),
        },
      );
      await prisma.emailEvent.create({
        data: {
          campaignId: id,
          campaignRecipientId: item.id,
          type: EmailEventType.queued,
        },
      });
    }

    await auditLog({
      userId: session.user.id,
      action: "campaign.launched",
      entity: "campaign",
      entityId: id,
      metadata: { queued: recipients.length, throttlePerHour: campaign.throttlePerHour },
    });

    return NextResponse.json({ queued: recipients.length });
  } catch (error) {
    return apiError(error);
  } finally {
    await queue.close();
  }
}
