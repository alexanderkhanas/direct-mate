import { MigrationInterface, QueryRunner } from 'typeorm';

export class VariantImageUrl1728000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE product_variants ADD COLUMN image_url TEXT`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE product_variants DROP COLUMN image_url`);
  }
}
