export type CloudAffordance = 'open' | 'wake' | 'login';

/** Decode the detail-route presence snapshot without treating missing params as online. */
export function parseCloudOnlineRouteParam(value: unknown): boolean {
  return value === '1';
}

export function resolveCloudAffordance(input: {
  hasInstance: boolean;
  online: boolean;
  loginRequired?: boolean;
}): CloudAffordance {
  if (!input.hasInstance || input.loginRequired === true) return 'login';
  return input.online ? 'open' : 'wake';
}
