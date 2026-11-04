import { IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";

enum CompanySituation {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE'
}

/** Dados para cadastrar uma empresa: razão social, contato e situação. */
export class CreateCompanyDto {
  @IsNotEmpty()
  @IsString()
  legalName: string;

  @IsNotEmpty()
  @IsString()
  contactInformation: string;

  @IsOptional()
  @IsEnum(CompanySituation)
  situation?: CompanySituation;
}
