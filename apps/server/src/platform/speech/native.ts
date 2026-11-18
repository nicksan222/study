/** @file Binds the pinned transcribe.cpp C ABI for isolated native speech execution. */
import { dlopen, FFIType, ptr } from 'bun:ffi';
import type { Pointer } from 'bun:ffi';

import { StudyError } from '@study/contracts';

const { ptr: pointer, i32, u64, void: nothing, cstring } = FFIType;

const utf8 = (value: string) => new TextEncoder().encode(value + '\0');

const handle = (bytes: Uint8Array) =>
  Number(new DataView(bytes.buffer).getBigUint64(0, true)) as Pointer;

function libraryDirectory() {
  const providers: Record<string, () => string> = {
    'linux-x64': () => import.meta.resolve('@transcribe-cpp/linux-x64-cpu-vulkan/package.json'),
    'linux-arm64': () => import.meta.resolve('@transcribe-cpp/linux-arm64-cpu-vulkan/package.json'),
    'darwin-arm64': () => import.meta.resolve('@transcribe-cpp/darwin-arm64-metal/package.json'),
    'darwin-x64': () => import.meta.resolve('@transcribe-cpp/darwin-x64-cpu/package.json'),
    'win32-x64': () => import.meta.resolve('@transcribe-cpp/win32-x64-cpu-vulkan/package.json')
  };
  const resolve = providers[`${process.platform}-${process.arch}`];

  if (!resolve)
    throw new StudyError('unsupported', 'Local dictation is unavailable on this platform');

  return Bun.fileURLToPath(new URL('.', resolve()));
}

function openNativeLibrary() {
  const directory = libraryDirectory();
  const filename =
    process.platform === 'darwin'
      ? 'libtranscribe.dylib'
      : process.platform === 'win32'
        ? 'transcribe.dll'
        : 'libtranscribe.so';
  const library = dlopen(directory + filename, {
    transcribe_version: { args: [], returns: cstring },
    transcribe_abi_struct_size: { args: [i32], returns: u64 },
    transcribe_init_backends: { args: [pointer], returns: i32 },
    transcribe_model_load_params_init: { args: [pointer], returns: nothing },
    transcribe_model_load_file: { args: [pointer, pointer, pointer], returns: i32 },
    transcribe_model_free: { args: [pointer], returns: nothing },
    transcribe_session_params_init: { args: [pointer], returns: nothing },
    transcribe_session_init: { args: [pointer, pointer, pointer], returns: i32 },
    transcribe_session_free: { args: [pointer], returns: nothing },
    transcribe_run: { args: [pointer, pointer, i32, pointer], returns: i32 },
    transcribe_full_text: { args: [pointer], returns: cstring },
    transcribe_vad_session_init: { args: [pointer, pointer, pointer], returns: i32 },
    transcribe_vad_session_free: { args: [pointer], returns: nothing },
    transcribe_vad_run: { args: [pointer, pointer, i32, pointer], returns: i32 },
    transcribe_vad_result_init: { args: [pointer], returns: nothing },
    transcribe_vad_get_result: { args: [pointer, pointer], returns: i32 },
    transcribe_vad_segment_init: { args: [pointer], returns: nothing },
    transcribe_vad_get_segment: { args: [pointer, i32, pointer], returns: i32 }
  });
  const f = library.symbols;

  function layout(id: number, size: number) {
    if (Number(f.transcribe_abi_struct_size(id)) !== size)
      throw new StudyError('unsupported', 'Speech library ABI does not match the pinned version');
  }

  try {
    if (f.transcribe_version().toString() !== '0.4.2')
      throw new StudyError(
        'unsupported',
        'Speech library version does not match the pinned version'
      );

    layout(0, 32);
    layout(1, 24);
    layout(27, 32);
    layout(28, 24);
    const encoded = utf8(directory);

    check(f.transcribe_init_backends(ptr(encoded)));

    return library;
  } catch (cause) {
    library.close();

    throw cause;
  }
}

function check(status: number) {
  if (status !== 0)
    throw new StudyError(
      'model_unavailable',
      `Speech inference failed with native status ${status}`
    );
}

/** Exercises the same library, ABI and backend initialization used for recognition. */
export function probeNative() {
  openNativeLibrary().close();
}

export function transcribeNative(
  modelPath: string,
  vadPath: string,
  samples: Float32Array,
  filterSilence: boolean
) {
  const library = openNativeLibrary();
  const f = library.symbols;

  function load(path: string) {
    const parameters = new Uint8Array(32);

    f.transcribe_model_load_params_init(ptr(parameters));
    new DataView(parameters.buffer).setInt32(8, 1, true); // TRANSCRIBE_BACKEND_CPU
    const result = new Uint8Array(8);
    const encoded = utf8(path);

    check(f.transcribe_model_load_file(ptr(encoded), ptr(parameters), ptr(result)));

    return handle(result);
  }

  function filterAudio(pcm: Float32Array) {
    vadModel = load(vadPath);
    const result = new Uint8Array(8);

    check(f.transcribe_vad_session_init(vadModel, null, ptr(result)));
    vadSession = handle(result);
    check(f.transcribe_vad_run(vadSession, ptr(pcm), pcm.length, null));
    const summary = new Uint8Array(32);

    f.transcribe_vad_result_init(ptr(summary));
    check(f.transcribe_vad_get_result(vadSession, ptr(summary)));
    const count = new DataView(summary.buffer).getInt32(24, true);

    if (count === 0) return new Float32Array();

    const segments: Float32Array[] = [];

    for (let index = 0; index < count; index++) {
      const segment = new Uint8Array(24);

      f.transcribe_vad_segment_init(ptr(segment));
      check(f.transcribe_vad_get_segment(vadSession, index, ptr(segment)));
      const view = new DataView(segment.buffer);
      const start = Math.max(0, Number(view.getBigInt64(8, true)));
      const end = Math.min(pcm.length, Number(view.getBigInt64(16, true)));

      if (end > start) segments.push(pcm.slice(start, end));
    }

    pcm = new Float32Array(segments.reduce((sum, segment) => sum + segment.length, 0));
    let offset = 0;

    for (const segment of segments) {
      pcm.set(segment, offset);
      offset += segment.length;
    }

    return pcm;
  }

  let model: Pointer | undefined;
  let session: Pointer | undefined;
  let vadModel: Pointer | undefined;
  let vadSession: Pointer | undefined;

  try {
    let pcm = samples;

    if (filterSilence) pcm = filterAudio(samples);

    if (!pcm.length) return '';

    model = load(modelPath);
    const parameters = new Uint8Array(24);

    f.transcribe_session_params_init(ptr(parameters));
    new DataView(parameters.buffer).setInt32(8, 4, true);
    const result = new Uint8Array(8);

    check(f.transcribe_session_init(model, ptr(parameters), ptr(result)));
    session = handle(result);

    function decode(audio: Float32Array): string {
      const status = f.transcribe_run(session!, ptr(audio), audio.length, null);

      // The same bounded retry used upstream: no partial/truncated transcript is published.
      if ((status === 17 || status === 18) && audio.length > 4_000) {
        const middle = Math.floor(audio.length / 2);

        return `${decode(audio.slice(0, middle))} ${decode(audio.slice(middle))}`.trim();
      }

      check(status);

      return f.transcribe_full_text(session!).toString().trim();
    }

    return decode(pcm);
  } finally {
    if (session) f.transcribe_session_free(session);

    if (model) f.transcribe_model_free(model);

    if (vadSession) f.transcribe_vad_session_free(vadSession);

    if (vadModel) f.transcribe_model_free(vadModel);

    library.close();
  }
}
