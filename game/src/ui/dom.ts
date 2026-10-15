// The one DOM helper: resolve an element by id, or fail loudly.
//
// WHY AN ID AND NOT A SELECTOR. The id is a compile-time contract between this app and `index.html`: a
// missing one is a typo in the markup, and `el` turns it into a thrown error naming the id at the first
// property read rather than into a silent `null` that only shows up as a console warning nobody reads
// (AGENTS.md 6: "`el()` over `querySelector` ... a missing one fails loudly at the first property read").
//
// IT IS SHARED BY ALL THREE DOM USERS — the two screens and the shell in `main.ts` — because three private
// copies of this function is how one of them ends up with a different error message.

export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the page has no #${id}`);
  return found as T;
}
