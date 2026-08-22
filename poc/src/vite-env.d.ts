/// <reference types="vite/client" />

declare module '*.xml?raw' {
  const src: string;
  export default src;
}
