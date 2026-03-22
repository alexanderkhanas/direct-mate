import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
export declare class SettingsController {
    private readonly settingsService;
    constructor(settingsService: SettingsService);
    getSettings(user: JwtPayload): Promise<import("../tenants/entities/tenant-settings.entity").TenantSettings | null>;
    updateSettings(user: JwtPayload, dto: UpdateSettingsDto): Promise<{
        success: boolean;
    }>;
    getExamples(user: JwtPayload): Promise<import("./entities/manager-example.entity").ManagerExample[]>;
    createExample(user: JwtPayload, body: any): Promise<import("./entities/manager-example.entity").ManagerExample>;
    deleteExample(id: string): Promise<{
        success: boolean;
    }>;
}
