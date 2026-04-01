import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ConversationsService } from './conversations.service';
import { TakeoverDto } from './dto/takeover.dto';
export declare class ConversationsController {
    private readonly conversationsService;
    constructor(conversationsService: ConversationsService);
    findAll(user: JwtPayload, status?: string, needsHandoff?: string, page?: string, limit?: string): Promise<{
        items: import("./entities/conversation.entity").Conversation[];
        page: number;
        limit: number;
        total: number;
    }>;
    findOne(user: JwtPayload, id: string): Promise<import("./entities/conversation.entity").Conversation>;
    takeover(user: JwtPayload, id: string, dto: TakeoverDto): Promise<import("./entities/conversation.entity").Conversation>;
    release(user: JwtPayload, id: string): Promise<import("./entities/conversation.entity").Conversation>;
}
