import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    login(dto: LoginDto): Promise<{
        accessToken: string;
        user: Omit<import("../tenants/entities/user.entity").User, "passwordHash">;
    }>;
    logout(): {
        success: boolean;
    };
    me(user: JwtPayload): Promise<import("../tenants/entities/user.entity").User>;
}
