import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Size charts become data: the table a vision model reads from the image and
 * the owner checks (`size-chart-table.ts`). Existing charts stay `image`, so
 * the bot keeps sending them as before.
 */
export class SizeChartTables1780200000000 implements MigrationInterface {
  name = 'SizeChartTables1780200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE size_charts
        ADD COLUMN "table" jsonb,
        ADD COLUMN status text NOT NULL DEFAULT 'image',
        ADD COLUMN send_image boolean NOT NULL DEFAULT true,
        ADD CONSTRAINT size_charts_status_check CHECK (status IN ('image', 'draft', 'ready'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE size_charts
        DROP CONSTRAINT size_charts_status_check,
        DROP COLUMN send_image,
        DROP COLUMN status,
        DROP COLUMN "table"
    `);
  }
}
