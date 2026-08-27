export function isSeedPasswordResetAllowed(
  email: string,
  password: string,
  env: {
    nodeEnv?: string;
    seedAdminPassword?: string;
    platformAdminEmails?: string;
  } = {
    nodeEnv: process.env.NODE_ENV,
    seedAdminPassword: process.env.SEED_ADMIN_PASSWORD,
    platformAdminEmails: process.env.PLATFORM_ADMIN_EMAILS
  }
) {
  if (env.nodeEnv === "production") {
    return false;
  }

  const allowedEmails = (env.platformAdminEmails || "admin@crm.local")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return (
    Boolean(env.seedAdminPassword) &&
    env.seedAdminPassword === password &&
    allowedEmails.includes(email.toLowerCase())
  );
}
