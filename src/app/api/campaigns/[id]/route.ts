import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { campaignSchema } from "@/lib/schemas";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    const campaign = await prisma.campaign.findFirst({
      where: { id, ownerId: session.user.id },
      include: {
        campaignRecipients: {
          include: { recipient: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!campaign) throw new Error("Campaign not found.");

    return NextResponse.json({ campaign });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const session = await requireAdmin();
    const { id } = await context.params;
    const body = campaignSchema.partial().parse(await request.json());
    const campaign = await prisma.campaign.findFirst({
      where: { id, ownerId: session.user.id },
    });

    if (!campaign) throw new Error("Campaign not found.");
    if (campaign.status !== "draft" && campaign.status !== "paused") {
      throw new Error("Only draft or paused campaigns can be edited.");
    }

    if (body.fromEmailAlias) {
      const alias = await prisma.sendAlias.findFirst({
        where: {
          userId: session.user.id,
          email: body.fromEmailAlias.toLowerCase(),
          isVerified: true,
        },
      });
      if (!alias) throw new Error("That sender alias is not verified.");
      body.fromEmailAlias = body.fromEmailAlias.toLowerCase();
    }

    const updated = await prisma.campaign.update({
      where: { id },
      data: body,
    });

    await auditLog({
      userId: session.user.id,
      action: "campaign.updated",
      entity: "campaign",
      entityId: id,
    });

    return NextResponse.json({ campaign: updated });
  } catch (error) {
    return apiError(error);
  }
}
