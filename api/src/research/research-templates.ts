// Biblioteca de questionários prontos (modelos). Cada modelo descreve só a ESTRUTURA: seções, questões, opções e
// regras de exibição. A mesma representação (`QuestionnaireSpec`) serve para duplicar uma pesquisa existente.

export interface SpecQuestion {
    /** Nome interno para as regras apontarem para a questão. */
    key: string;
    statement: string;
    type: string;
    helpText?: string | null;
    isRequired?: boolean;
    /** Textos das opções (escolha única e múltipla). A posição na lista é a ordem. */
    options?: string[];
    minSelections?: number | null;
    maxSelections?: number | null;
    minValue?: number | null;
    maxValue?: number | null;
    minDate?: string | null;
    maxDate?: string | null;
    maxLength?: number | null;
    scaleLeftLabel?: string | null;
    scaleRightLabel?: string | null;
    maxFiles?: number | null;
    maxDuration?: number | null;
}

export interface SpecSection {
    title: string;
    questions: SpecQuestion[];
}

export interface SpecCondition {
    sourceKey: string;
    operator?: string;
    /** Valor cru (Sim/Não = YES/NO, escala 1 a 5, número, texto). Em questões de escolha, use `optionIndex`. */
    value?: string;
    /** Em questões de escolha: posição (0 = primeira) da opção na lista da questão de origem. */
    optionIndex?: number;
}

export interface SpecRule {
    /** Alvo: uma questão ou uma seção inteira (posição 0 = primeira seção). */
    targetKey?: string;
    targetSectionIndex?: number;
    action?: 'SHOW' | 'HIDE';
    /** Várias condições = todas precisam ser verdadeiras (E). */
    conditions: SpecCondition[];
}

export interface QuestionnaireSpec {
    sections: SpecSection[];
    rules: SpecRule[];
}

export interface ResearchTemplate extends QuestionnaireSpec {
    id: string;
    name: string;
    category: string;
    description: string;
    objective: string;
    targetAudience: string;
    recordInterview?: boolean;
}

const q = (key: string, statement: string, type: string, extra: Partial<SpecQuestion> = {}): SpecQuestion => ({ key, statement, type, ...extra });

export const TEMPLATES: ResearchTemplate[] = [
    {
        id: 'satisfacao-cliente',
        name: 'Satisfação do cliente',
        category: 'Mercado',
        description: 'Nota de 0 a 10, avaliação do atendimento e pergunta aberta só para quem deu nota baixa.',
        objective: 'Medir a satisfação dos clientes e identificar pontos de melhora.',
        targetAudience: 'Clientes atendidos nos últimos 30 dias',
        sections: [
            {
                title: 'Sobre o atendimento',
                questions: [
                    q('visita', 'Quantas vezes você usou nosso serviço nos últimos 3 meses?', 'SINGLE_CHOICE', { isRequired: true, options: ['1 vez', '2 a 3 vezes', '4 ou mais vezes'] }),
                    q('nota', 'De 0 a 10, o quanto você recomendaria nosso serviço a um amigo?', 'NUMERIC', { isRequired: true, minValue: 0, maxValue: 10 }),
                    q('atendimento', 'Como você avalia o atendimento?', 'SCALE_1_5', { isRequired: true, scaleLeftLabel: 'Muito ruim', scaleRightLabel: 'Excelente' }),
                ],
            },
            {
                title: 'Melhorias',
                questions: [
                    q('melhorar', 'O que podemos melhorar?', 'FREE_TEXT', { maxLength: 500 }),
                    q('elogio', 'O que você mais gostou?', 'FREE_TEXT', { maxLength: 500 }),
                    q('contato', 'Podemos entrar em contato para entender melhor sua opinião?', 'YES_NO'),
                ],
            },
        ],
        rules: [
            // Nota baixa (até 6): pergunta o que melhorar. Nota alta (9 ou mais): pergunta o elogio.
            { targetKey: 'melhorar', conditions: [{ sourceKey: 'nota', operator: 'LTE', value: '6' }] },
            { targetKey: 'elogio', conditions: [{ sourceKey: 'nota', operator: 'GTE', value: '9' }] },
        ],
    },
    {
        id: 'perfil-domicilio',
        name: 'Perfil do domicílio e do morador',
        category: 'Social',
        description: 'Dados do domicílio e do morador, pulando toda a seção de trabalho para quem não trabalha.',
        objective: 'Conhecer o perfil socioeconômico das famílias da área pesquisada.',
        targetAudience: 'Moradores adultos da área-alvo',
        sections: [
            {
                title: 'Morador',
                questions: [
                    q('idade', 'Qual a sua idade?', 'NUMERIC', { isRequired: true, minValue: 0, maxValue: 120 }),
                    q('escolaridade', 'Qual o seu nível de escolaridade?', 'SINGLE_CHOICE', { isRequired: true, options: ['Sem escolaridade', 'Fundamental', 'Médio', 'Superior', 'Pós-graduação'] }),
                    q('trabalha', 'Você está trabalhando atualmente?', 'YES_NO', { isRequired: true }),
                ],
            },
            {
                title: 'Trabalho',
                questions: [
                    q('ocupacao', 'Qual a sua ocupação principal?', 'FREE_TEXT', { maxLength: 120 }),
                    q('vinculo', 'Qual o seu vínculo de trabalho?', 'SINGLE_CHOICE', { options: ['Carteira assinada', 'Autônomo', 'Servidor público', 'Informal'] }),
                    q('renda', 'Qual a sua renda mensal (R$)?', 'NUMERIC', { minValue: 0 }),
                ],
            },
            {
                title: 'Domicílio',
                questions: [
                    q('moradores', 'Quantas pessoas moram na casa?', 'NUMERIC', { isRequired: true, minValue: 1, maxValue: 40 }),
                    q('agua', 'A casa tem água encanada?', 'YES_NO', { isRequired: true }),
                    q('foto', 'Foto da fachada do domicílio', 'PHOTO'),
                    q('local', 'Localização do domicílio', 'LOCATION'),
                ],
            },
        ],
        rules: [
            // Pulo de seção: quem não trabalha não responde a seção "Trabalho" inteira.
            { targetSectionIndex: 1, action: 'HIDE', conditions: [{ sourceKey: 'trabalha', operator: 'EQ', value: 'NO' }] },
        ],
    },
    {
        id: 'intencao-compra',
        name: 'Conhecimento e intenção de compra',
        category: 'Mercado',
        description: 'Quem não conhece a marca pula a seção de opinião; renda alta ou preferência por loja ativam perguntas extras.',
        objective: 'Medir conhecimento da marca e intenção de compra no público-alvo.',
        targetAudience: 'Consumidores acima de 18 anos',
        sections: [
            {
                title: 'Conhecimento da marca',
                questions: [
                    q('conhece', 'Você conhece a marca?', 'YES_NO', { isRequired: true }),
                    q('canais', 'Onde você costuma comprar este tipo de produto?', 'MULTIPLE_CHOICE', { options: ['Loja física', 'Site', 'Aplicativo', 'Redes sociais'], minSelections: 1 }),
                ],
            },
            {
                title: 'Opinião sobre a marca',
                questions: [
                    q('qualidade', 'Como você avalia a qualidade dos produtos?', 'SCALE_1_5', { scaleLeftLabel: 'Muito ruim', scaleRightLabel: 'Excelente' }),
                    q('preco', 'O preço é justo?', 'YES_NO'),
                    q('comprou', 'Você já comprou da marca?', 'YES_NO'),
                ],
            },
            {
                title: 'Intenção de compra',
                questions: [
                    q('intencao', 'Qual a chance de você comprar nos próximos 3 meses?', 'SCALE_1_5', { isRequired: true, scaleLeftLabel: 'Nenhuma', scaleRightLabel: 'Certa' }),
                    q('motivo', 'O que mais pesaria na sua decisão de compra?', 'FREE_TEXT', { maxLength: 300 }),
                    q('loja', 'Em qual loja você compraria?', 'FREE_TEXT', { maxLength: 120 }),
                ],
            },
        ],
        rules: [
            { targetSectionIndex: 1, action: 'HIDE', conditions: [{ sourceKey: 'conhece', operator: 'EQ', value: 'NO' }] },
            // E: só pergunta a loja de quem comprou E marcou "Loja física".
            { targetKey: 'loja', conditions: [{ sourceKey: 'comprou', operator: 'EQ', value: 'YES' }, { sourceKey: 'canais', operator: 'EQ', optionIndex: 0 }] },
            { targetKey: 'motivo', conditions: [{ sourceKey: 'intencao', operator: 'GTE', value: '4' }] },
        ],
    },
    {
        id: 'servicos-publicos',
        name: 'Opinião sobre serviços públicos locais',
        category: 'Opinião pública',
        description: 'Avaliação de saúde, educação e segurança do bairro, com gravação da entrevista.',
        objective: 'Levantar a percepção da população sobre os serviços públicos do bairro.',
        targetAudience: 'Moradores do bairro com 16 anos ou mais',
        recordInterview: true,
        sections: [
            {
                title: 'Perfil',
                questions: [
                    q('tempo', 'Há quanto tempo você mora no bairro?', 'SINGLE_CHOICE', { isRequired: true, options: ['Menos de 1 ano', '1 a 5 anos', 'Mais de 5 anos'] }),
                    q('local', 'Local da entrevista', 'LOCATION'),
                ],
            },
            {
                title: 'Avaliação dos serviços',
                questions: [
                    q('saude', 'Como você avalia o serviço de saúde do bairro?', 'SCALE_1_5', { isRequired: true, scaleLeftLabel: 'Muito ruim', scaleRightLabel: 'Muito bom' }),
                    q('educacao', 'Como você avalia as escolas do bairro?', 'SCALE_1_5', { isRequired: true, scaleLeftLabel: 'Muito ruim', scaleRightLabel: 'Muito bom' }),
                    q('seguranca', 'Como você avalia a segurança do bairro?', 'SCALE_1_5', { isRequired: true, scaleLeftLabel: 'Muito ruim', scaleRightLabel: 'Muito bom' }),
                    q('problema', 'Qual o principal problema que o poder público deveria resolver?', 'FREE_TEXT', { maxLength: 400 }),
                    q('relato', 'Relato em áudio (opcional)', 'AUDIO', { maxDuration: 120 }),
                ],
            },
        ],
        rules: [
            // Nota baixa em qualquer um dos três: pergunta o principal problema (grupos diferentes = OU).
            { targetKey: 'problema', conditions: [{ sourceKey: 'saude', operator: 'LTE', value: '2' }] },
            { targetKey: 'problema', conditions: [{ sourceKey: 'educacao', operator: 'LTE', value: '2' }] },
            { targetKey: 'problema', conditions: [{ sourceKey: 'seguranca', operator: 'LTE', value: '2' }] },
        ],
    },
    {
        id: 'auditoria-ponto-venda',
        name: 'Auditoria de ponto de venda',
        category: 'Campo',
        description: 'Checklist de loja com foto, localização, preço e estoque; detalha apenas o que está em falta.',
        objective: 'Verificar presença, preço e exposição do produto nos pontos de venda.',
        targetAudience: 'Pontos de venda cadastrados',
        sections: [
            {
                title: 'Identificação',
                questions: [
                    q('nome', 'Nome do estabelecimento', 'FREE_TEXT', { isRequired: true, maxLength: 120 }),
                    q('local', 'Localização do ponto de venda', 'LOCATION', { isRequired: true }),
                    q('fachada', 'Foto da fachada', 'PHOTO', { isRequired: true }),
                ],
            },
            {
                title: 'Produto',
                questions: [
                    q('presente', 'O produto está disponível na loja?', 'YES_NO', { isRequired: true }),
                    q('preco', 'Preço na prateleira (R$)', 'NUMERIC', { minValue: 0 }),
                    q('fotos', 'Fotos da exposição do produto', 'MULTIPLE_PHOTOS', { maxFiles: 4 }),
                    q('ruptura', 'Motivo da falta do produto', 'SINGLE_CHOICE', { options: ['Sem estoque', 'Nunca trabalhou com a marca', 'Entrega atrasada', 'Outro'] }),
                    q('obs', 'Observações', 'FREE_TEXT', { maxLength: 500 }),
                ],
            },
        ],
        rules: [
            { targetKey: 'preco', conditions: [{ sourceKey: 'presente', operator: 'EQ', value: 'YES' }] },
            { targetKey: 'fotos', conditions: [{ sourceKey: 'presente', operator: 'EQ', value: 'YES' }] },
            { targetKey: 'ruptura', conditions: [{ sourceKey: 'presente', operator: 'EQ', value: 'NO' }] },
        ],
    },
];

export function templateSummary(t: ResearchTemplate) {
    return {
        id: t.id,
        name: t.name,
        category: t.category,
        description: t.description,
        objective: t.objective,
        targetAudience: t.targetAudience,
        recordInterview: t.recordInterview ?? false,
        sectionCount: t.sections.length,
        questionCount: t.sections.reduce((n, s) => n + s.questions.length, 0),
        ruleCount: t.rules.length,
        sections: t.sections.map((s) => ({ title: s.title, questions: s.questions.map((x) => ({ statement: x.statement, type: x.type })) })),
    };
}
