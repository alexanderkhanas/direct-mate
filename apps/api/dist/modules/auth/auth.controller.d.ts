import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    register(dto: RegisterDto): Promise<{
        accessToken: string;
        user: any;
    }>;
    login(dto: LoginDto): Promise<{
        accessToken: string;
        user: Omit<import("../tenants/entities/user.entity").User, "passwordHash">;
    }>;
    logout(): {
        success: boolean;
    };
    me(user: JwtPayload): Promise<import("../tenants/entities/user.entity").User>;
    deleteAccount(user: JwtPayload): Promise<{
        success: boolean;
    }>;
}
