import { CampaignStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    const campaign = await prisma.campaign.findFirst({
      where: { id, ownerId: session.user.id },
    });

    if (!campaign) throw new Error("Campaign not found.");

    const duplicate = await prisma.campaign.create({
      data: {
        ownerId: session.user.id,
        sendAliasId: campaign.sendAliasId,
        name: `${campaign.name} Copy`,
        subjectLine: campaign.subjectLine,
        fromName: campaign.fromName,
        fromEmailAlias: campaign.fromEmailAlias,
        replyToEmail: campaign.replyToEmail,
        htmlBody: campaign.htmlBody,
        textBody: campaign.textBody,
        businessIdentity: campaign.businessIdentity,
        mailingAddress: campaign.mailingAddress,
        throttlePerHour: campaign.throttlePerHour,
        errorRateStopPercent: campaign.errorRateStopPercent,
        status: CampaignStatus.draft,
      },
    });

    await auditLog({
      userId: session.user.id,
      action: "campaign.duplicated",
      entity: "campaign",
      entityId: duplicate.id,
      metadata: { sourceCampaignId: id },
    });

    return NextResponse.json({ campaign: duplicate });
  } catch (error) {
    return apiError(error);
  }
}
