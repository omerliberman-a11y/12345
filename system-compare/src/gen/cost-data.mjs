// Emits the cost calculator's data: /data/cost-<categoryId>.js — the products and offers of one category,
// loaded with SC.load('cost-<id>') when that category is chosen (about 1–13 KB each; the reader never downloads
// the other 65). Shapes are documented in src/lib/cost-catalog.mjs. Nothing here decides which offers are
// modelled: that is the adapter allow-list in the same module.

import { compactCostCatalog } from '../lib/cost-catalog.mjs';

export async function generate(ctx, emit) {
  const { files } = compactCostCatalog(ctx);
  for (const [id, data] of Object.entries(files)) {
    await emit(`/data/cost-${id}.js`, `SC.define("cost-${id}",${JSON.stringify(data)});`);
  }
}
