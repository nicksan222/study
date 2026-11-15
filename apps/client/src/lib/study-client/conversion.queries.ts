import { rpc } from '@study/contracts/react';

/** Conversion capabilities remain authoritative through the live protocol. */
export function useConversionStrategies() {
  return rpc.sources.conversionStrategies.useQuery({});
}
