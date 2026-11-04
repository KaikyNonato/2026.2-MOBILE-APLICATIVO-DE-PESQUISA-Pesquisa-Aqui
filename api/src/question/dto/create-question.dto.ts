import { IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";

enum QuestionType {
  FREE_TEXT = 'FREE_TEXT',
  NUMERIC = 'NUMERIC',
  DATE = 'DATE',
  TIME = 'TIME',
  YES_NO = 'YES_NO',
  SINGLE_CHOICE = 'SINGLE_CHOICE',
  MULTIPLE_CHOICE = 'MULTIPLE_CHOICE',
  SCALE_1_5 = 'SCALE_1_5',
  PHOTO = 'PHOTO',
  MULTIPLE_PHOTOS = 'MULTIPLE_PHOTOS',
  LOCATION = 'LOCATION',
  AUDIO = 'AUDIO',
}

/** Dados para criar uma questão: enunciado, tipo, texto de ajuda, obrigatoriedade e a seção dela. */
export class CreateQuestionDto {
  @IsNotEmpty()
  @IsString()
  statement: string;

  @IsEnum(QuestionType)
  @IsNotEmpty()
  type: QuestionType;

  @IsOptional()
  @IsString()
  helpText?: string;

  @IsBoolean()
  isRequired: boolean;

  @IsNumber()
  @IsNotEmpty()
  order: number;

  @IsNumber()
  @IsNotEmpty()
  sectionId: number;

  @IsOptional()
  @IsNumber()
  minSelections?: number;

  @IsOptional()
  @IsNumber()
  maxSelections?: number;

  @IsOptional()
  @IsNumber()
  minValue?: number;

  @IsOptional()
  @IsNumber()
  maxValue?: number;

  @IsOptional()
  @IsString()
  minDate?: string;

  @IsOptional()
  @IsString()
  maxDate?: string;

  @IsOptional()
  @IsNumber()
  maxLength?: number;

  @IsOptional()
  @IsString()
  scaleLeftLabel?: string;

  @IsOptional()
  @IsString()
  scaleRightLabel?: string;

  @IsOptional()
  @IsNumber()
  maxFiles?: number;

  @IsOptional()
  @IsNumber()
  maxDuration?: number;
}
