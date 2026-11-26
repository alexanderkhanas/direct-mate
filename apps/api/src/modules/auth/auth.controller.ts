import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ChallengeDto, CodeDto, EnableTwoFactorDto, TwoFactorProofDto, VerifyTwoFactorDto } from './dto/two-factor.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ClientIpThrottlerGuard } from '../../common/guards/client-ip-throttler.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { SessionsService } from './sessions.service';
import { TwoFactorService } from './two-factor/two-factor.service';

const wrongCode = () => new UnauthorizedException({ message: 'Wrong code', details: { code: 'invalid_code' } });

/** An impersonation token acts as the owner, but the owner's sign-in belongs to the owner alone. */
function ownAccount(user: JwtPayload): string {
  if (user.imp) throw new ForbiddenException({ message: 'Not while viewing as the owner', details: { code: 'impersonating' } });
  return user.sub;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly twoFactor: TwoFactorService,
    private readonly sessions: SessionsService,
  ) {}

  // Sign-up is free and opens a store with model calls (the test chat), so a
  // script must not mint stores. Login is limited against password guessing.
  @Post('register')
  @UseGuards(ClientIpThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(ClientIpThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // ─── The code step of sign-in (with the login's challenge) ───────

  @Post('2fa/verify')
  @HttpCode(200)
  @UseGuards(ClientIpThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  verifyTwoFactor(@Body() dto: VerifyTwoFactorDto) {
    return this.authService.verifyTwoFactor(dto.challenge, { code: dto.code, recoveryCode: dto.recoveryCode });
  }

  @Post('2fa/setup')
  @HttpCode(200)
  @UseGuards(ClientIpThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  setupTwoFactor(@Body() dto: ChallengeDto) {
    return this.authService.setupTwoFactor(dto.challenge);
  }

  @Post('2fa/enable')
  @HttpCode(200)
  @UseGuards(ClientIpThrottlerGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  enableTwoFactor(@Body() dto: EnableTwoFactorDto) {
    return this.authService.enableTwoFactor(dto.challenge, dto.code);
  }

  // ─── A signed-in user's own 2FA (Settings) ───────────────────────

  @Get('2fa')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  twoFactorStatus(@CurrentUser() user: JwtPayload) {
    return this.twoFactor.status(user.sub);
  }

  @Post('2fa/me/setup')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  setupOwnTwoFactor(@CurrentUser() user: JwtPayload) {
    return this.twoFactor.startSetup(ownAccount(user));
  }

  /** Turns 2FA on; every session ends, so a new login token comes back with the recovery codes. */
  @Post('2fa/me/enable')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async enableOwnTwoFactor(@CurrentUser() user: JwtPayload, @Body() dto: CodeDto) {
    const userId = ownAccount(user);
    const recoveryCodes = await this.twoFactor.enable(userId, dto.code);
    if (!recoveryCodes) throw wrongCode();
    return { ...(await this.authService.sessionFor(userId)), recoveryCodes };
  }

  @Post('2fa/me/disable')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async disableOwnTwoFactor(@CurrentUser() user: JwtPayload, @Body() dto: TwoFactorProofDto) {
    const userId = ownAccount(user);
    if (!(await this.twoFactor.disable(userId, dto))) throw wrongCode();
    return this.authService.sessionFor(userId);
  }

  @Post('2fa/me/recovery-codes')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async newRecoveryCodes(@CurrentUser() user: JwtPayload, @Body() dto: TwoFactorProofDto) {
    const recoveryCodes = await this.twoFactor.regenerateRecoveryCodes(ownAccount(user), dto);
    if (!recoveryCodes) throw wrongCode();
    return { recoveryCodes };
  }

  /** Every login token of this user stops working, this one too. */
  @Post('sessions/end-all')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async endAllSessions(@CurrentUser() user: JwtPayload) {
    await this.sessions.endAll(ownAccount(user));
    return { success: true };
  }

  @Post('logout')
  @HttpCode(200)
  logout() {
    return { success: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.me(user.sub);
  }

  @Delete('account')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  deleteAccount(@CurrentUser() user: JwtPayload) {
    return this.authService.deleteAccount(user.sub, user.tenantId);
  }
}
