import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { User } from '../tenants/entities/user.entity';
import { LoginDto } from './dto/login.dto';
export declare class AuthService {
    private readonly userRepo;
    private readonly jwtService;
    constructor(userRepo: Repository<User>, jwtService: JwtService);
    login(dto: LoginDto): Promise<{
        accessToken: string;
        user: Omit<User, 'passwordHash'>;
    }>;
    me(userId: string): Promise<User>;
}
