export type CloudAffordance = 'open' | 'wake' | 'login';

/**
 * Single presentation/action判据 for cloud entry points.
 * A membership without an instance cannot create one locally; CIS browser
 * login is therefore the only useful action in both zero-instance and
 * login-required states.
 */
export function resolveCloudAffordance(input: {
  hasInstance: boolean;
  online: boolean;
  status?: { loginRequired?: boolean } | null;
}): CloudAffordance {
  if (!input.hasInstance || input.status?.loginRequired === true) return 'login';
  return input.online ? 'open' : 'wake';
}
