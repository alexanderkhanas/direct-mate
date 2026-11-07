import { finishProducts, WarningLog, type FeedFormat, type ParsedFeed } from './feed-normalize';
import { parseGoogleMerchant } from './parsers/gmc.parser';
import { parseSheet } from './parsers/sheet.parser';
import { parseYml } from './parsers/yml.parser';

/** Feed text → products ready for `CatalogService.importCatalog`, ids prefixed with `feed:`. */
export function parseFeed(format: FeedFormat, body: string, opts: { maxProducts: number | null }): ParsedFeed {
  const warnings = new WarningLog();
  const parsed =
    format === 'gmc' ? parseGoogleMerchant(body, warnings)
    : format === 'yml' ? parseYml(body, warnings)
    : parseSheet(body, warnings);
  const products = finishProducts(parsed.products, warnings, opts);
  return { format, products, warnings: warnings.list(), itemCount: parsed.itemCount };
}
