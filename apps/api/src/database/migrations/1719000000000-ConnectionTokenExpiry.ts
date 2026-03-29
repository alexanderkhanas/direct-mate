import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConnectionTokenExpiry1719000000000 implements MigrationInterface {
  name = 'ConnectionTokenExpiry1719000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "connections" ADD COLUMN "token_expires_at" timestamptz`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "connections" DROP COLUMN "token_expires_at"`);
  }
}
