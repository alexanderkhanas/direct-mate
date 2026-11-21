import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How an Instagram connection was made, which decides where its calls go:
 *
 * `instagram`: Instagram API with Instagram Login (instagram.com). A 60-day
 * user token, renewed daily; calls on graph.instagram.com.
 * `unified`: Instagram API with Unified Login (Facebook Login for Business).
 * A system-user token; calls on graph.facebook.com.
 *
 * Every Instagram connection made so far came through Unified Login.
 */
export class InstagramLoginMethod1780900000000 implements MigrationInterface {
  name = 'InstagramLoginMethod1780900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE connections
        ADD COLUMN login_method text CHECK (login_method IN ('instagram', 'unified'))
    `);
    await queryRunner.query(`UPDATE connections SET login_method = 'unified' WHERE type = 'instagram'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE connections DROP COLUMN login_method`);
  }
}
