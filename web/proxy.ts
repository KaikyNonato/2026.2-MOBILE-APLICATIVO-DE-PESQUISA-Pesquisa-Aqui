import { jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ['/login'];
// O pesquisador só usa o início, a lista das próprias pesquisas e o perfil (a coleta é no aplicativo).
// Qualquer outra tela do painel volta para o início, mesmo que ele digite o endereço.
const RESEARCHER_PATHS = ['/', '/pesquisas', '/perfil', '/trocar-senha'];
/** Chave para conferir o JWT (a mesma `JWT_SECRET` da API). */
const secret = new TextEncoder().encode(process.env.JWT_SECRET);

/**
 * Proteção de rotas do painel: confere o cookie `access_token` e só deixa passar quem tem sessão
 * válida. Rotas públicas ficam livres.
 */
export const proxy = async (request: NextRequest) => {
    const { pathname } = request.nextUrl;
    const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
    const token = request.cookies.get('access_token')?.value;

    let isValid = false;
    let profile: unknown;

    if (token) {
        try {
            const { payload } = await jwtVerify(token, secret);
            profile = payload.profile;
            isValid = true;
        } catch (error) {
            isValid = false;
        }
    }

    if (!isValid && !isPublicPath) {
        const response = NextResponse.redirect(new URL('/login', request.url));
        response.cookies.delete('access_token');
        return response;
    }

    if (isValid && pathname.startsWith('/login')) return NextResponse.redirect(new URL('/', request.url));

    if (isValid && profile === 'RESEARCHER') {
        const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

        if (!RESEARCHER_PATHS.includes(path)) return NextResponse.redirect(new URL('/', request.url));
    }

    const response = NextResponse.next();

    if (!isPublicPath) {
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    }

    return response;
};

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)',
    ],
};
