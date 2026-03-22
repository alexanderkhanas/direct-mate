import { IsIn, IsString } from 'class-validator';

export class UpdateFragmentReviewDto {
  @IsString()
  @IsIn(['approved', 'rejected', 'pending'])
  reviewStatus!: string;
}
