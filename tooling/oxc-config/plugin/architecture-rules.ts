import aiBoundary from './rules/ai-boundary.ts';
import featureLayout from './rules/feature-layout.ts';
import retiredModuleBoundary from './rules/retired-module-boundary.ts';
import serverLayerBoundary from './rules/server-layer-boundary.ts';

export default {
  'feature-layout': featureLayout,
  'server-layer-boundary': serverLayerBoundary,
  'ai-boundary': aiBoundary,
  'retired-module-boundary': retiredModuleBoundary
};
