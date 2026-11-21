import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A size chart read in the Claude chat has no picture: Claude reads the image
 * the owner pastes, but can't pass the file on, so only the table is saved.
 *
 * The down fails while such charts exist; delete them first.
 */
export class SizeChartImageOptional1781000000000 implements MigrationInterface {
  name = 'SizeChartImageOptional1781000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE size_charts ALTER COLUMN image_path DROP NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE size_charts ALTER COLUMN image_path SET NOT NULL`);
  }
}
