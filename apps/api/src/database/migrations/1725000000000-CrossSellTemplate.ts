import { MigrationInterface, QueryRunner } from 'typeorm';

export class CrossSellTemplate1725000000000 implements MigrationInterface {
  async up(_queryRunner: QueryRunner): Promise<void> {
    // Cross-sell is now handled as a secondaryReply in code, not via template.
    // This migration is intentionally empty (was previously inserting a priority 95 template).
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    // Nothing to revert
  }
}
