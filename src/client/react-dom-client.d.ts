/**
 * Minimal local typing for react-dom/client (zero-dependency mandate: pulling
 * @types/react-dom as a devDep for ONE call site is heavier than declaring the
 * surface we use — createRoot over an element, the same minimal face
 * SidebarMountDeps already declares for tests). If the host ever bundles
 * @types/react-dom, delete this file.
 */
declare module 'react-dom/client' {
  import type { ReactNode } from 'react'
  export function createRoot(container: Element | DocumentFragment): { render(node: ReactNode): void; unmount(): void }
}
