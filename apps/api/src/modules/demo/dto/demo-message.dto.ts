import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class DemoMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  sessionKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500, { message: 'too_long' })
  text!: string;

  /**
   * Optional demo tenant slug. Defaults to `'demo-women-clothes'` server-side
   * when omitted (preserves backward compat with the single-tenant client).
   * Slug shape: kebab-case starting with `demo-`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^demo-[a-z0-9-]+$/, {
    message: 'tenantSlug must match /^demo-[a-z0-9-]+$/',
  })
  tenantSlug?: string;
}
