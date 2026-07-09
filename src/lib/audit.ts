import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function auditLog({
  userId,
  action,
  entity,
  entityId,
  metadata,
}: {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      entity,
      entityId,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    },
  });
}
