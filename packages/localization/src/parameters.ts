/** Named placeholders use a single pair of braces, for example `{subject}`. */
export type ParameterNames<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | ParameterNames<Rest>
  : never;
