declare module "html-to-text" {
  export function convert(
    html: string,
    options?: {
      selectors?: Array<{
        selector: string;
        options?: Record<string, unknown>;
      }>;
      wordwrap?: number | false;
    }
  ): string;
}
