/**
 * OpenTUI intrinsic elements for the root tsconfig's `jsxImportSource: "solid-js"`.
 *
 * `@opentui/solid` ships its `<box>`/`<text>` (etc.) types behind its own
 * `jsx-runtime` module, designed for `jsxImportSource: "@opentui/solid"`. This
 * module augmentation merges the prop types it ships (BoxProps, TextProps)
 * into solid-js's JSX namespace so the existing tsconfig keeps working
 * unchanged. Extend this interface when a new OpenTUI element is used.
 */
import type { BoxProps, TextProps } from "@opentui/solid";

declare module "solid-js" {
  namespace JSX {
    export interface IntrinsicElements {
      box: BoxProps;
      text: TextProps;
    }
  }
}
