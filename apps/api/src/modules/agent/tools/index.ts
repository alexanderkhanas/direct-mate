import {
  browseCategoryTool,
  getProductTool,
  getSizeHelpTool,
  searchProductsTool,
  sendSizeChartTool,
  showProductsTool,
} from './catalog.tools';
import {
  getOrderDraftTool,
  placeOrderTool,
  sendPaymentDetailsTool,
  updateOrderDraftTool,
} from './order.tools';
import { handoffTool } from './handoff.tool';
import type { AgentToolDeps, ToolScope } from './tool-deps';
import type { AgentStoreSettings } from '../store-settings.service';

export type { AgentToolDeps, ToolScope } from './tool-deps';

export const HANDOFF_TOOL = 'handoff';

type Serial = <T>(fn: () => Promise<T>) => Promise<T>;

/** Runs calls one after another, in the order they were made. */
export function serialQueue(): Serial {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

/**
 * The model can call several tools in one step, and the SDK runs them at the
 * same time. For the order draft that is a race: «update_order_draft» and
 * «get_order_draft» in one step let the read see the draft before the write.
 * Order tools therefore run one at a time, in the order the model called them.
 */
function inOrder<T extends { execute?: (...args: never[]) => unknown }>(t: T, serial: Serial): T {
  const execute = t.execute;
  if (!execute) return t;
  return { ...t, execute: (...args: never[]) => serial(async () => execute(...args)) };
}

/**
 * The agent's tools for one turn. Built per turn so each closes over this
 * turn's store and conversation; the model never passes a tenant or
 * conversation id, so it can't reach another one.
 *
 * Tool descriptions are the routing logic now — what the classifier prompt
 * and keyword allowlists used to decide. Edit them with the same care.
 *
 * A store whose sizes need a manager (`sizing.advice: 'consult'`) gets no
 * get_size_help: the prompt says not to name a size, and without the tool
 * there is nothing to name one from.
 */
export function buildAgentTools(deps: AgentToolDeps, scope: ToolScope, settings: AgentStoreSettings) {
  const serial = serialQueue();
  return {
    search_products: searchProductsTool(deps, scope),
    browse_category: browseCategoryTool(deps, scope),
    get_product: getProductTool(deps, scope),
    ...(settings.sizing.advice !== 'consult' && { get_size_help: getSizeHelpTool(deps, scope, settings) }),
    send_size_chart: sendSizeChartTool(deps, scope),
    show_products: showProductsTool(deps, scope),
    get_order_draft: inOrder(getOrderDraftTool(deps, scope, settings), serial),
    update_order_draft: inOrder(updateOrderDraftTool(deps, scope, settings), serial),
    place_order: inOrder(placeOrderTool(deps, scope, settings), serial),
    send_payment_details: inOrder(sendPaymentDetailsTool(deps, scope, settings), serial),
    [HANDOFF_TOOL]: handoffTool(),
  };
}

export type AgentTools = ReturnType<typeof buildAgentTools>;
