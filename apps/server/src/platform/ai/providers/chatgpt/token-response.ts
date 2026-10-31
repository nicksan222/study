import { StudyError } from '@study/contracts/errors';

export function assertTokenResponse(status: number, message: string) {
  if (status < 200 || status >= 300)
    throw new StudyError(
      [400, 401, 403].includes(status) ? 'auth' : status === 429 ? 'rate_limited' : 'transient',
      message
    );
}
