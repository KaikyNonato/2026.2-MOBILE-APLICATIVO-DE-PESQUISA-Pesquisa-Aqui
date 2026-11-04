import { PartialType } from "@nestjs/mapped-types";
import { CreateResearchDto } from "./create-research.dto.js";

/** Dados editáveis de uma pesquisa (os mesmos da criação, todos opcionais). */
export class UpdateResearchDto extends PartialType(CreateResearchDto) { }
