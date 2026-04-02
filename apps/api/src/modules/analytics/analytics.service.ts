import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class AnalyticsService {
  constructor(private readonly dataSource: DataSource) {}

  async getDashboard(tenantId: string) {
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const to = new Date();

    const [summary, conversationsPerDay, funnel, handoffReasons, avgResponseTime, recentOrders] =
      await Promise.all([
        this.getSummary(tenantId, from),
        this.getConversationsPerDay(tenantId, from),
        this.getFunnel(tenantId, from),
        this.getHandoffReasons(tenantId, from),
        this.getAvgResponseTime(tenantId, from),
        this.getRecentOrders(tenantId),
      ]);

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      summary,
      conversationsPerDay,
      funnel,
      handoffReasons,
      avgResponseTimeMs: avgResponseTime,
      recentOrders,
    };
  }

  private async getSummary(tenantId: string, from: Date) {
    const rows = await this.dataSource.query(
      `SELECT
        COUNT(*) AS total_conversations,
        COUNT(*) FILTER (WHERE needs_handoff = false) AS auto_handled,
        COUNT(*) FILTER (WHERE needs_handoff = true) AS handoff_count
      FROM conversations
      WHERE tenant_id = $1 AND created_at >= $2`,
      [tenantId, from],
    );

    const orderRows = await this.dataSource.query(
      `SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(total_amount), 0) AS total_revenue,
        COALESCE(MAX(currency), 'UAH') AS currency
      FROM orders
      WHERE tenant_id = $1 AND created_at >= $2`,
      [tenantId, from],
    );

    const total = parseInt(rows[0].total_conversations, 10) || 0;
    const autoHandled = parseInt(rows[0].auto_handled, 10) || 0;

    return {
      totalConversations: total,
      automationRate: total > 0 ? autoHandled / total : 0,
      totalOrders: parseInt(orderRows[0].total_orders, 10) || 0,
      totalRevenue: parseFloat(orderRows[0].total_revenue) || 0,
      currency: orderRows[0].currency || 'UAH',
    };
  }

  private async getConversationsPerDay(tenantId: string, from: Date) {
    const rows = await this.dataSource.query(
      `SELECT
        d::date AS date,
        COALESCE(total, 0) AS total,
        COALESCE(auto_handled, 0) AS "autoHandled"
      FROM generate_series($2::date, CURRENT_DATE, '1 day') d
      LEFT JOIN (
        SELECT
          created_at::date AS day,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE needs_handoff = false) AS auto_handled
        FROM conversations
        WHERE tenant_id = $1 AND created_at >= $2
        GROUP BY day
      ) c ON c.day = d::date
      ORDER BY d`,
      [tenantId, from],
    );

    return rows.map((r: any) => ({
      date: r.date.toISOString().split('T')[0],
      total: parseInt(r.total, 10),
      autoHandled: parseInt(r.autoHandled, 10),
    }));
  }

  private async getFunnel(tenantId: string, from: Date) {
    const rows = await this.dataSource.query(
      `SELECT
        COUNT(DISTINCT c.id) AS started,
        COUNT(DISTINCT c.id) FILTER (
          WHERE cs.context_json->>'lastPresentedProducts' IS NOT NULL
        ) AS product_shown,
        COUNT(DISTINCT c.id) FILTER (
          WHERE cs.selected_variant_id IS NOT NULL
            OR cs.context_json->>'selectedVariantId' IS NOT NULL
        ) AS variant_selected,
        COUNT(DISTINCT o.id) AS order_created
      FROM conversations c
      LEFT JOIN conversation_state cs ON cs.conversation_id = c.id
      LEFT JOIN orders o ON o.customer_id = c.customer_id AND o.tenant_id = c.tenant_id AND o.created_at >= $2
      WHERE c.tenant_id = $1 AND c.created_at >= $2`,
      [tenantId, from],
    );

    return {
      started: parseInt(rows[0].started, 10) || 0,
      productShown: parseInt(rows[0].product_shown, 10) || 0,
      variantSelected: parseInt(rows[0].variant_selected, 10) || 0,
      orderCreated: parseInt(rows[0].order_created, 10) || 0,
    };
  }

  private async getHandoffReasons(tenantId: string, from: Date) {
    const rows = await this.dataSource.query(
      `SELECT
        COALESCE(handoff_reason, 'unknown') AS reason,
        COUNT(*) AS count
      FROM conversations
      WHERE tenant_id = $1 AND needs_handoff = true AND created_at >= $2
      GROUP BY handoff_reason
      ORDER BY count DESC
      LIMIT 10`,
      [tenantId, from],
    );

    return rows.map((r: any) => ({
      reason: r.reason,
      count: parseInt(r.count, 10),
    }));
  }

  private async getAvgResponseTime(tenantId: string, from: Date) {
    const rows = await this.dataSource.query(
      `SELECT AVG(response_time_ms) AS avg_ms FROM (
        SELECT
          EXTRACT(EPOCH FROM (
            (SELECT MIN(m2.created_at)
             FROM messages m2
             WHERE m2.conversation_id = m.conversation_id
               AND m2.direction = 'outbound'
               AND m2.role = 'assistant'
               AND m2.created_at > m.created_at)
            - m.created_at
          )) * 1000 AS response_time_ms
        FROM messages m
        WHERE m.tenant_id = $1
          AND m.direction = 'inbound'
          AND m.created_at >= $2
        LIMIT 500
      ) sub
      WHERE response_time_ms IS NOT NULL AND response_time_ms > 0`,
      [tenantId, from],
    );

    return parseFloat(rows[0]?.avg_ms) || 0;
  }

  private async getRecentOrders(tenantId: string) {
    const rows = await this.dataSource.query(
      `SELECT
        o.id,
        o.status,
        o.total_amount AS "totalAmount",
        o.currency,
        COALESCE(cci.full_name, cu.full_name, cu.username, cu.external_user_id) AS "customerName",
        o.created_at AS "createdAt"
      FROM orders o
      LEFT JOIN customers cu ON cu.id = o.customer_id
      LEFT JOIN checkout_customer_info cci ON cci.checkout_session_id = o.checkout_session_id
      WHERE o.tenant_id = $1
      ORDER BY o.created_at DESC
      LIMIT 10`,
      [tenantId],
    );

    return rows;
  }
}
