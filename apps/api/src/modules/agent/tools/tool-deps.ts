import type { SizeChartsService } from '../../size-charts/size-charts.service';
import type { OrderDraftService } from '../../orders/order-draft.service';
import type { CatalogReader } from '../catalog/catalog-reader.service';
import type { CatalogSearch } from '../catalog/catalog-search';

/** Services the tools wrap. */
export interface AgentToolDeps {
  catalog: CatalogReader;
  search: CatalogSearch;
  sizeCharts: Pick<SizeChartsService, 'resolveForContext' | 'getBrandAndCategoryForProduct' | 'publicUrl'>;
  drafts: Pick<OrderDraftService, 'getCurrentDraft' | 'update'>;
}

/**
 * Who this turn is for. Tools are built per turn and close over it, so a tool
 * can only ever touch this store and this conversation.
 */
export interface ToolScope {
  tenantId: string;
  conversationId: string;
  customerId: string;
}
