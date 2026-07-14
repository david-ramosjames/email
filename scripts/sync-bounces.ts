import "dotenv/config";
import { syncBouncesForUser } from "../src/lib/bounces";
import { prisma } from "../src/lib/prisma";

async function main() {
  const users = await prisma.user.findMany({
    where: {
      role: "admin",
      approvedAt: { not: null },
    },
    select: { id: true, email: true },
  });

  for (const user of users) {
    const result = await syncBouncesForUser(user.id);
    console.log("Bounce sync complete", { email: user.email, ...result });
  }
}

main()
  .catch((error) => {
    console.error("Bounce sync failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
