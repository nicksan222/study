declare module '@echogarden/rnnoise-wasm' {
  interface RnnoiseModule {
    readonly HEAPF32: Float32Array;
    _rnnoise_get_frame_size(): number;
    _rnnoise_create(model: number): number;
    _rnnoise_destroy(state: number): void;
    _rnnoise_process_frame(state: number, output: number, input: number): number;
    _malloc(bytes: number): number;
    _free(pointer: number): void;
  }

  export default function initialize(options: { wasmBinary: ArrayBuffer }): Promise<RnnoiseModule>;
}
