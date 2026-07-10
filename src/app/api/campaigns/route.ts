import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { campaignSchema, normalizeCampaignInput } from "@/lib/schemas";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await requireAdmin();
    const campaigns = await prisma.campaign.findMany({
      where: { ownerId: session.user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        campaignRecipients: {
          select: { status: true },
        },
      },
    });

    return NextResponse.json({
      campaigns: campaigns.map((campaign) => ({
        ...campaign,
        stats: campaign.campaignRecipients.reduce(
          (acc, item) => {
            acc.total += 1;
            acc[item.status] = (acc[item.status] || 0) + 1;
            return acc;
          },
          { total: 0 } as Record<string, number>,
        ),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdmin();
    const body = normalizeCampaignInput(campaignSchema.parse(await request.json()));
    const alias = await prisma.sendAlias.findFirst({
      where: {
        userId: session.user.id,
        email: body.fromEmailAlias.toLowerCase(),
        isVerified: true,
      },
    });

    if (!alias) {
      throw new Error("Choose a verified Google Workspace send alias before saving.");
    }

    const campaign = await prisma.campaign.create({
      data: {
        ownerId: session.user.id,
        sendAliasId: alias.id,
        ...body,
      },
    });

    await auditLog({
      userId: session.user.id,
      action: "campaign.created",
      entity: "campaign",
      entityId: campaign.id,
    });

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
