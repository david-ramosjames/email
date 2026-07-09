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
    const result = await prisma.campaign.updateMany({
      where: { id, ownerId: session.user.id },
      data: { status: CampaignStatus.paused },
    });
    if (result.count === 0) throw new Error("Campaign not found.");
    await auditLog({ userId: session.user.id, action: "campaign.paused", entity: "campaign", entityId: id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
