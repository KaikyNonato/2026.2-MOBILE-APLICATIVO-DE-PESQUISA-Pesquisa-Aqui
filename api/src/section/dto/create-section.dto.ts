import { IsNotEmpty, IsNumber, IsString } from "class-validator";

/** Dados para criar uma seção: título, ordem e a pesquisa à qual ela pertence. */
export class CreateSectionDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNumber()
  @IsNotEmpty()
  order: number;

  @IsNumber()
  @IsNotEmpty()
  researchId: number;
}
