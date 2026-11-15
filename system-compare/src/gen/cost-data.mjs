// Emits the cost calculator's data:
//   /data/cost-index.js     categories grouped like the category index + which have calculator-ready offers (~3 KB)
//   /data/cost-<id>.js      products and offers of one category, loaded when the category is chosen (1–12 KB each)
// Shapes are documented in src/lib/cost-catalog.mjs. Nothing here changes which offers are modelled.

import { compactCostCatalog } from '../lib/cost-catalog.mjs';

export async function generate(ctx, emit) {
  const { index, files } = compactCostCatalog(ctx);
  await emit('/data/cost-index.js', `SC.define("cost-index",${JSON.stringify(index)});`);
  for (const [id, data] of Object.entries(files)) {
    await emit(`/data/cost-${id}.js`, `SC.define("cost-${id}",${JSON.stringify(data)});`);
  }
}
