declare module 'playwright-core/lib/coreBundle' {
  type ComparisonOptions = {
    threshold: number;
    maxDiffPixels: number;
    maxDiffPixelRatio: number;
  };

  const core: {
    utils: {
      getComparator: (
        mimeType: 'image/png'
      ) => (
        actual: Buffer,
        expected: Buffer,
        options: ComparisonOptions
      ) => { errorMessage: string; diff: Buffer } | null;
    };
  };

  export default core;
}

declare module 'playwright-core/lib/utilsBundle' {
  const image: {
    PNG: {
      sync: {
        read: (buffer: Buffer) => { width: number; height: number; data: Buffer };
      };
    };
  };

  export default image;
}
