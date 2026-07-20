export function assertSmsSecurityConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const debugEnabled =
    String(env.SMS_VERIFICATION_DEBUG || '').trim().toLowerCase() ===
    'true';
  if (debugEnabled && env.NODE_ENV !== 'test') {
    const error: any = new Error(
      'SMS_VERIFICATION_DEBUG is allowed only when NODE_ENV=test.',
    );
    error.code = 'SMS_DEBUG_CONFIG_INVALID';
    throw error;
  }
}
