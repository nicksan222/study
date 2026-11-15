import aiBoundary from './rules/ai-boundary.ts';
import featureLayout from './rules/feature-layout.ts';
import serverLayerBoundary from './rules/server-layer-boundary.ts';

export default {
  'feature-layout': featureLayout,
  'server-layer-boundary': serverLayerBoundary,
  'ai-boundary': aiBoundary
};
