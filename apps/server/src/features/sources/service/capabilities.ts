/** @file Owns capabilities within this feature. */

import type { importCapabilityInputSchema, importCapabilitySchema } from '@study/contracts';
import { ChatGptSession } from '@study/server';
import type { AuthManager } from '@study/server';
import { Effect, Option } from 'effect';

import { Settings } from '#server/features/settings/index';
import { decoderPath } from '#server/features/sources/decoders/capability';
import type {
  ConversionContext,
  ConversionInput
} from '#server/features/sources/service/conversion/registry';
import { conversions } from '#server/features/sources/service/conversion/strategies';

export function sourceCapabilityOperations() {
  return {
    conversionStrategies: () =>
      Settings.use((settings) => settings.language()).pipe(
        Effect.map((locale) => conversions.list(locale)),
        Effect.provide(Settings.layer)
      ),
    convertDocument: (strategyId: string, input: ConversionInput, context: ConversionContext) =>
      conversions.convert(strategyId, input, context),
    importCapability: Effect.fnUntraced(function* (input: typeof importCapabilityInputSchema.Type) {
      const session = yield* Effect.serviceOption(ChatGptSession);
      const path = decoderPath(input);
      const authentication = (() => {
        if (Option.isNone(session)) return 'unavailable' as const;

        const auth: AuthManager = session.value.manager;

        return auth.sessionConfigured ? ('session_configured' as const) : ('signed_out' as const);
      })();

      return {
        kind: input.kind,
        recognized: input.kind !== 'other',
        status: path !== 'none' && path !== 'vision' ? 'supported' : 'unavailable',
        path,
        reason:
          path === 'none'
            ? 'no_decoder'
            : path === 'vision'
              ? 'provider_unverified'
              : 'local_decoder',
        provider: { authentication, capability: 'unverified' }
      } satisfies typeof importCapabilitySchema.Type;
    })
  };
}
