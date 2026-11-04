import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { OPERATORS, RULE_ACTIONS } from '../rule-logic.js';

/** Uma condição: a resposta da questão de origem, comparada com `triggerValue` pelo `operator`. */
export class RuleConditionDto {
  @IsInt()
  sourceQuestionId: number;

  // Padrão EQ. EQ/NEQ/GT/GTE/LT/LTE/CONTAINS/NOT_CONTAINS/ANSWERED/NOT_ANSWERED.
  @IsOptional()
  @IsIn(OPERATORS as unknown as string[])
  operator?: string;

  // YES_NO: "YES" | "NO"; escolhas: id da opção; escala: "1" a "5"; número/texto: o próprio valor.
  // Vazio (ou ausente) em ANSWERED / NOT_ANSWERED.
  @IsOptional()
  @IsString()
  triggerValue?: string;
}

/**
 * Formato novo: `conditions` (1 a 10, todas valendo em conjunto = E) + alvo (questão OU seção) +
 * ação.
 * Formato antigo (continua valendo): sourceQuestionId + triggerValue + targetQuestionId, uma
 * condição "é igual a".
 * Várias regras no mesmo alvo valem em alternativa (OU).
 */
export class CreateQuestionRuleDto {
  @IsOptional()
  @IsInt()
  sourceQuestionId?: number;

  @IsOptional()
  @IsIn(OPERATORS as unknown as string[])
  operator?: string;

  @IsOptional()
  @IsString()
  triggerValue?: string;

  @IsOptional()
  @IsInt()
  targetQuestionId?: number;

  // Pulo de seção: a regra vale para todas as questões da seção.
  @IsOptional()
  @IsInt()
  targetSectionId?: number;

  // SHOW (padrão): o alvo só aparece quando a regra é verdadeira. HIDE: o alvo some quando ela é verdadeira.
  @IsOptional()
  @IsIn(RULE_ACTIONS as unknown as string[])
  action?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RuleConditionDto)
  conditions?: RuleConditionDto[];
}
