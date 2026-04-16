import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository } from 'typeorm';
import { User } from '../tenants/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
export declare class AuthService {
    private readonly userRepo;
    private readonly jwtService;
    private readonly dataSource;
    constructor(userRepo: Repository<User>, jwtService: JwtService, dataSource: DataSource);
    login(dto: LoginDto): Promise<{
        accessToken: string;
        user: Omit<User, 'passwordHash'>;
    }>;
    me(userId: string): Promise<User>;
    deleteAccount(userId: string, tenantId: string): Promise<{
        success: boolean;
    }>;
    register(dto: RegisterDto): Promise<{
        accessToken: string;
        user: any;
    }>;
    private slugify;
    private randomSuffix;
    private createDefaultTemplates;
}
