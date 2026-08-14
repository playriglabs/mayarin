/// <reference types="astro/client" />

declare module "*.png?inline" {
  const src: string;
  export default src;
}
