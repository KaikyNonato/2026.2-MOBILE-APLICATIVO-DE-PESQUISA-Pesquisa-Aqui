import { createParamDecorator, ExecutionContext } from "@nestjs/common";

/**
 * Decorator de parâmetro que entrega o usuário da requisição (`request.user`) ou só um campo dele,
 * se `data` for informado.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof any | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    return data ? user?.[data as string] : user;
  }
);
