import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { AvailabilityService } from './availability.service';
import { CheckAvailabilityDto } from './dto/check-availability.dto';
export declare class AvailabilityController {
    private readonly availabilityService;
    constructor(availabilityService: AvailabilityService);
    check(user: JwtPayload, dto: CheckAvailabilityDto): Promise<import("./availability.service").AvailabilityResult>;
}
