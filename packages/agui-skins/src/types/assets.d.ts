/* Bundler asset imports. Vite handles these natively; tsup/esbuild emits the
   file into dist and hands back its URL (loader in tsup.config.ts). */
declare module "*.woff" {
  const url: string;
  export default url;
}

declare module "*.woff2" {
  const url: string;
  export default url;
}
