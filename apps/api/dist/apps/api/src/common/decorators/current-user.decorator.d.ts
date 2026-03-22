export interface JwtPayload {
    sub: string;
    email: string;
    role: string;
    tenantId: string;
}
export declare const CurrentUser: (...dataOrPipes: unknown[]) => ParameterDecorator;
