import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('response_templates')
export class ResponseTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'text' })
  scenario!: string;

  @Column({ type: 'text', nullable: true })
  stage!: string | null;

  @Column({ type: 'jsonb' })
  blocks!: string[];

  @Column({ type: 'jsonb', default: '[]' })
  requiredVariables!: string[];

  @Column({ type: 'jsonb', default: '[]' })
  toneTags!: string[];

  @Column({ type: 'int', default: 50 })
  priority!: number;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
