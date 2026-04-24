import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository } from 'typeorm';
import { User } from '../tenants/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
export declare class AuthService {
    private readonly userRepo;
    private readonly jwtService;
    private readonly dataSource;
    private readonly subscriptionsService;
    constructor(userRepo: Repository<User>, jwtService: JwtService, dataSource: DataSource, subscriptionsService: SubscriptionsService);
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
