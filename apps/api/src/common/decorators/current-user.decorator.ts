import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  tenantId: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<Request & { user: JwtPayload }>();
    const user = request.user;

    // Superadmin can override tenant context via X-Tenant-Id header
    if (user?.role === 'superadmin') {
      const overrideTenantId = request.headers['x-tenant-id'] as string | undefined;
      if (overrideTenantId && UUID_REGEX.test(overrideTenantId)) {
        return { ...user, tenantId: overrideTenantId };
      }
    }

    return user;
  },
);
