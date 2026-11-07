import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantSettings } from '../tenants/entities/tenant-settings.entity';
import { ManagerExample } from './entities/manager-example.entity';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { CreateExampleDto } from './dto/create-example.dto';

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(TenantSettings)
    private readonly settingsRepo: Repository<TenantSettings>,
    @InjectRepository(ManagerExample)
    private readonly examplesRepo: Repository<ManagerExample>,
  ) {}

  async getSettings(tenantId: string): Promise<TenantSettings | null> {
    return this.settingsRepo.findOne({ where: { tenantId } });
  }

  async updateSettings(tenantId: string, dto: UpdateSettingsDto): Promise<{ success: boolean }> {
    const existing = await this.settingsRepo.findOne({ where: { tenantId } });
    const patch: Partial<TenantSettings> = {};

    if (dto.brandTone !== undefined) patch.brandTonePrompt = dto.brandTone;
    if (dto.businessHours !== undefined) patch.businessHours = dto.businessHours as any;
    if (dto.handoffRules !== undefined) patch.handoffRules = dto.handoffRules as any;
    if (dto.supportedLanguages !== undefined) patch.supportedLanguages = dto.supportedLanguages;

    if (existing) {
      await this.settingsRepo.update(existing.id, patch);
    } else {
      const settings = this.settingsRepo.create({ tenantId, ...patch });
      await this.settingsRepo.save(settings);
    }

    return { success: true };
  }

  async getExamples(tenantId: string): Promise<ManagerExample[]> {
    return this.examplesRepo.find({ where: { tenantId, isActive: true } });
  }

  /** Fields are picked one by one: the caller's tenant can't be overridden from the body. */
  async createExample(tenantId: string, dto: CreateExampleDto): Promise<ManagerExample> {
    const example = this.examplesRepo.create({
      tenantId,
      customerMessage: dto.customerMessage,
      managerReply: dto.managerReply,
      scenario: dto.scenario ?? null,
      tags: dto.tags ?? [],
    });
    return this.examplesRepo.save(example);
  }

  async deleteExample(tenantId: string, id: string): Promise<{ success: boolean }> {
    await this.examplesRepo.update({ id, tenantId }, { isActive: false });
    return { success: true };
  }
}
