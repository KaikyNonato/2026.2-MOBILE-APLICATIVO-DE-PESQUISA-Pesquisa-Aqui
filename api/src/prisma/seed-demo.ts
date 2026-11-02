import { db } from './db.js';
import * as bcrypt from 'bcrypt';
import { passwordProblem } from '../auth/password-policy.js';
import { checkNewRuleGroup, evaluateCondition, type StructQuestion } from '../question-rule/rule-logic.js';
import { sanitizeSpec } from '../research/research-template-spec.js';

// Seed de demonstração: cria (se ainda não existirem) empresas, um administrador, pesquisadores e um
// CATÁLOGO de pesquisas completas (questionários, regras de exibição, pesquisadores vinculados com meta,
// cópias em campo) e insere coletas com respostas, localização e registro de sincronização.
//
// Pesquisas criadas (ver `RESEARCHES` mais abaixo):
//   1. Satisfação dos clientes do varejo   (IN_FIELD)  -> 50 coletas (ajustável com SEED_COLLECTIONS)
//   2. Mobilidade urbana                   (IN_FIELD)  -> 60 coletas, com regras de exibição
//   3. Atendimento nas unidades de saúde   (CLOSED)    -> 45 coletas, com regra de exibição
//   4. Consumo de energia nas residências  (PUBLISHED) -> sem coletas (ainda não iniciada)
//   5. Eventos culturais da cidade         (DRAFT)     -> sem coletas, sem pesquisadores (rascunho); grava a entrevista
//   6. Abastecimento de água               (IN_FIELD)  -> 40 coletas, com regras avançadas (operadores, grupos E/OU,
//                                                         ação HIDE e pulo de seção)
//
// O que o seed gera, além de empresa/usuários/pesquisas/respostas:
//   - área-alvo (círculo) nas pesquisas com coletas e localização de início em cada coleta (mapa de coletas);
//   - alguns casos de propósito para a auditoria de qualidade (coleta muito rápida, fora da área, sem localização);
//   - meta de coletas por pesquisador (progresso na tela "Pesquisadores vinculados");
//   - cópias em campo (ResearchDownload): ativas, devolvidas, revogadas e desbloqueadas ("Cópias em campo");
//   - um SyncLog por envio (aparelho + dia), que alimenta "última sincronização" nos relatórios;
//   - um modelo de questionário salvo (SavedTemplate), uma empresa inativa e um pesquisador inativo.
// Fotos e áudios dependem de arquivos e NÃO são gerados (questões PHOTO/MULTIPLE_PHOTOS/AUDIO ficam sem resposta).
//
// Uso (na pasta api):  npm run seed:demo
// Outra quantidade na pesquisa 1:  SEED_COLLECTIONS=250 npm run seed:demo
//   (PowerShell: $env:SEED_COLLECTIONS=250; npm run seed:demo)
// Outra senha dos usuários demo (precisa seguir a política de senha):  SEED_DEMO_PASSWORD=MinhaSenha1 npm run seed:demo
//
// Pode ser executado mais de uma vez: tudo é identificado por nomes/ids fixos (`seed-...`), então
// uma nova execução só completa o que faltar, sem duplicar. Bancos criados por versões antigas deste seed
// são atualizados: senha antiga, coletas sem localização, área-alvo e metas ausentes são completadas.
// O questionário de uma pesquisa já existente NÃO é alterado (a estrutura é a da primeira execução).

const RETAIL_COLLECTIONS = Number(process.env.SEED_COLLECTIONS) || 50;
// Segue a política de senha da API (8 a 64 caracteres, com letra e número). A antiga ('demo123') tinha 7 e não vale mais.
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD || 'demo1234';
const LEGACY_DEMO_PASSWORD = 'demo123';
const COMPANY_NAME = 'Empresa Demo (seed)';
const INACTIVE_COMPANY_NAME = 'Empresa Demo Inativa (seed)';
const DAY = 86_400_000;
const MINUTE = 60_000;

const ADMIN = { name: 'Administrador Demo', username: 'demo.admin' };
const RESEARCHERS = [
    { name: 'Ana Souza', username: 'demo.ana' },
    { name: 'Bruno Lima', username: 'demo.bruno' },
    { name: 'Carla Mendes', username: 'demo.carla' },
    { name: 'Diego Alves', username: 'demo.diego' },
    { name: 'Elisa Rocha', username: 'demo.elisa' },
];
// Pesquisador desativado: aparece na lista (filtro de situação) mas não entra em nenhuma pesquisa.
const INACTIVE_RESEARCHER = { name: 'Fábio Torres', username: 'demo.fabio' };

// Gerador pseudoaleatório com semente fixa: a mesma execução sempre gera os mesmos dados.
function createRandom(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const random = createRandom(20261020);
const between = (min: number, max: number) => Math.floor(random() * (max - min + 1)) + min;
const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
const chance = (probability: number) => random() < probability;
const weightedPick = <T>(items: T[], weights?: number[]): T => {
    if (!weights || weights.length !== items.length) return pick(items);
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = random() * total;
    for (const [index, item] of items.entries()) {
        roll -= weights[index];
        if (roll < 0) return item;
    }
    return items[items.length - 1];
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const FIRST_NAMES = ['João', 'Maria', 'José', 'Ana', 'Pedro', 'Juliana', 'Lucas', 'Fernanda', 'Rafael', 'Camila', 'Marcos', 'Patrícia', 'Gabriel', 'Aline', 'Felipe', 'Larissa', 'Rodrigo', 'Beatriz', 'Thiago', 'Vanessa'];
const LAST_NAMES = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Pereira', 'Costa', 'Ferreira', 'Almeida', 'Nascimento', 'Barbosa', 'Ribeiro', 'Carvalho', 'Gomes', 'Martins', 'Araújo'];
const personName = () => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;

// ---------------------------------------------------------------------------------------------
// Modelo declarativo das pesquisas
// ---------------------------------------------------------------------------------------------

type QuestionType =
    | 'FREE_TEXT' | 'NUMERIC' | 'DATE' | 'TIME' | 'YES_NO' | 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE'
    | 'SCALE_1_5' | 'PHOTO' | 'MULTIPLE_PHOTOS' | 'LOCATION' | 'AUDIO';

type RuleOperator = 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'CONTAINS' | 'NOT_CONTAINS' | 'ANSWERED' | 'NOT_ANSWERED';

interface QuestionDef {
    key: string; // identificador usado pelas regras e pelo gerador de respostas
    statement: string;
    type: QuestionType;
    required?: boolean;
    helpText?: string;
    extra?: Record<string, unknown>; // minValue, maxLength, scaleLeftLabel, minDate, maxFiles...
    options?: string[]; // SINGLE_CHOICE / MULTIPLE_CHOICE
    // --- como gerar as respostas das coletas ---
    optionalChance?: number; // chance de responder quando NÃO é obrigatória (padrão 1)
    weights?: number[]; // pesos das opções (SINGLE_CHOICE)
    pickCount?: [number, number]; // quantas opções marcar (MULTIPLE_CHOICE)
    numeric?: [number, number]; // faixa (NUMERIC)
    yesChance?: number; // chance de "Sim" (YES_NO)
    scalePool?: number[]; // notas possíveis, repetidas para dar peso (SCALE_1_5)
    texts?: string[]; // textos possíveis (FREE_TEXT)
    daysBefore?: number; // DATE: até N dias antes do início da coleta
    hours?: [number, number]; // TIME: faixa de horas
    gen?: () => string; // gerador totalmente personalizado
}

interface SectionDef {
    title: string;
    questions: QuestionDef[];
}

// Uma condição de regra: "a resposta da questão `source` <operador> <valor>".
// value: 'YES' | 'NO' (sim/não), nota '1'..'5', número, texto (texto livre) ou o TEXTO da opção (escolha única/múltipla).
// Sem `operator` vale EQ; ANSWERED / NOT_ANSWERED não usam valor.
interface ConditionDef {
    source: string;
    operator?: RuleOperator;
    value?: string;
}

// Regra de exibição, no formato atual da API: alvo = uma questão OU uma seção inteira (pulo de seção);
// `action` SHOW (padrão) mostra o alvo só quando a regra é verdadeira, HIDE esconde o alvo quando ela é verdadeira.
// Várias condições na mesma regra valem em conjunto (E); regras diferentes sobre o mesmo alvo valem em alternativa (OU).
interface RuleDef {
    target?: string; // key da questão
    targetSection?: number; // posição da seção (0 = primeira)
    action?: 'SHOW' | 'HIDE';
    when: ConditionDef[];
}

interface AreaDef {
    latitude: number;
    longitude: number;
    radiusKm: number;
}

interface ResearchDef {
    slug: string;
    title: string; // identifica a pesquisa (não mude depois de criada)
    description: string;
    objective: string;
    targetAudience: string;
    status: 'DRAFT' | 'PUBLISHED' | 'IN_FIELD' | 'CLOSED';
    recordInterview?: boolean; // pesquisa que grava a entrevista: exige consentimento (e as coletas do seed trazem o aceite)
    startedDaysAgo: number; // início da pesquisa
    endsInDays: number; // fim da pesquisa (negativo = já terminou)
    researchers: string[]; // usernames dos pesquisadores vinculados
    targets?: Record<string, number>; // meta de coletas por pesquisador (username -> meta)
    collections: number; // quantidade de coletas (0 = nenhuma)
    collectionWindow: [number, number]; // coletas espalhadas entre "N dias atrás" e "M dias atrás"
    legacyClientIds?: boolean; // clientId `seed-<n>` (pesquisa original) em vez de `seed-<slug>-<n>`
    center: { latitude: number; longitude: number }; // centro das coordenadas das coletas
    area?: AreaDef; // área-alvo: coletas iniciadas fora dela são sinalizadas na auditoria
    // Cópias extras (aparelho extraviado, quebrado...) além da cópia normal de cada pesquisador.
    extraCopies?: { username: string; device: string; kind: 'REVOKED' | 'REVOKED_UNBLOCKED'; reason: string }[];
    sections: SectionDef[];
    rules?: RuleDef[];
}

const SUGGESTIONS_RETAIL = [
    'Ampliar o horário de funcionamento aos sábados.',
    'Mais opções de pagamento no caixa.',
    'O atendimento é bom, mas a fila demora.',
    'Gostaria de ver mais variedade de produtos.',
    'Os preços poderiam ser mais competitivos.',
    'Melhorar a sinalização dentro da loja.',
    'Ótimo atendimento, continuem assim!',
    'Reduzir o tempo de espera na entrega.',
    'Faltam atendentes nos horários de pico.',
    'Criar um programa de fidelidade.',
];

const SAO_PAULO = { latitude: -23.5505, longitude: -46.6333 }; // São Paulo (SP), região da Praça da Sé

const RESEARCHES: ResearchDef[] = [
    // 1) Pesquisa original do seed (mantida exatamente como era: mesmo título, perguntas e clientIds).
    {
        slug: 'varejo',
        title: 'Satisfação dos clientes do varejo (seed)',
        description: 'Pesquisa de satisfação com clientes do varejo, gerada pelo seed de demonstração.',
        objective: 'Medir a satisfação, o perfil e as sugestões dos clientes da loja.',
        targetAudience: 'Clientes maiores de 16 anos',
        status: 'IN_FIELD',
        startedDaysAgo: 30,
        endsInDays: 30,
        researchers: RESEARCHERS.map((r) => r.username),
        targets: { 'demo.ana': 14, 'demo.bruno': 12, 'demo.carla': 10, 'demo.diego': 8, 'demo.elisa': 6 },
        collections: RETAIL_COLLECTIONS,
        collectionWindow: [14, 0],
        legacyClientIds: true,
        center: SAO_PAULO,
        area: { ...SAO_PAULO, radiusKm: 5 },
        sections: [
            {
                title: 'Perfil do entrevistado',
                questions: [
                    { key: 'name', statement: 'Qual é o seu nome?', type: 'FREE_TEXT', required: true, extra: { maxLength: 80 }, gen: personName },
                    { key: 'age', statement: 'Qual é a sua idade?', type: 'NUMERIC', required: true, extra: { minValue: 16, maxValue: 99 }, numeric: [16, 78] },
                    { key: 'lastPurchase', statement: 'Quando foi a sua última compra?', type: 'DATE', daysBefore: 45, optionalChance: 0.85 },
                    {
                        key: 'income', statement: 'Qual é a sua faixa de renda mensal?', type: 'SINGLE_CHOICE', required: true,
                        options: ['Até 1 salário mínimo', 'De 1 a 3 salários mínimos', 'De 3 a 6 salários mínimos', 'Acima de 6 salários mínimos'],
                    },
                ],
            },
            {
                title: 'Experiência de compra',
                questions: [
                    { key: 'recommend', statement: 'Você recomendaria a loja a um amigo?', type: 'YES_NO', required: true, yesChance: 0.78 },
                    {
                        key: 'service', statement: 'Como avalia o atendimento?', type: 'SCALE_1_5', required: true,
                        extra: { scaleLeftLabel: 'Muito ruim', scaleRightLabel: 'Excelente' },
                        // Notas puxadas para o lado positivo, para o painel ficar com cara de pesquisa real.
                        scalePool: [1, 2, 3, 3, 4, 4, 4, 5, 5, 5],
                    },
                    {
                        key: 'values', statement: 'O que mais você valoriza ao comprar?', type: 'MULTIPLE_CHOICE',
                        extra: { minSelections: 1, maxSelections: 3 }, options: ['Preço', 'Qualidade', 'Atendimento', 'Variedade', 'Localização'],
                        pickCount: [1, 3], optionalChance: 0.9,
                    },
                    { key: 'shoppingTime', statement: 'Em que horário costuma comprar?', type: 'TIME', hours: [8, 20], optionalChance: 0.8 },
                    { key: 'location', statement: 'Local da entrevista', type: 'LOCATION', optionalChance: 0.95 },
                    { key: 'suggestion', statement: 'Deixe uma sugestão para a loja', type: 'FREE_TEXT', extra: { maxLength: 300 }, texts: SUGGESTIONS_RETAIL, optionalChance: 0.5 },
                ],
            },
        ],
    },

    // 2) Mobilidade urbana: em campo, com duas regras de exibição e um aparelho trocado (revogado e desbloqueado).
    {
        slug: 'mobilidade',
        title: 'Mobilidade urbana e transporte (seed)',
        description: 'Levantamento sobre como a população se desloca no dia a dia e o que pode melhorar no transporte local.',
        objective: 'Identificar os meios de transporte mais usados, o tempo de deslocamento e os principais problemas.',
        targetAudience: 'Moradores de diferentes regiões da cidade, maiores de 16 anos',
        status: 'IN_FIELD',
        startedDaysAgo: 21,
        endsInDays: 40,
        researchers: ['demo.ana', 'demo.bruno', 'demo.carla'],
        targets: { 'demo.ana': 25, 'demo.bruno': 20, 'demo.carla': 30 },
        collections: 60,
        collectionWindow: [18, 0],
        center: { latitude: -23.5520, longitude: -46.6350 },
        area: { latitude: -23.5520, longitude: -46.6350, radiusKm: 8 },
        extraCopies: [
            { username: 'demo.carla', device: 'seed-device-carla-antigo', kind: 'REVOKED_UNBLOCKED', reason: 'Celular quebrado: a pesquisadora trocou de aparelho.' },
        ],
        sections: [
            {
                title: 'Perfil do morador',
                questions: [
                    {
                        key: 'bairro', statement: 'Em qual região você mora?', type: 'SINGLE_CHOICE', required: true,
                        options: ['Centro', 'Zona Sul', 'Zona Leste', 'Zona Norte', 'Zona Oeste'], weights: [30, 20, 18, 10, 22],
                    },
                    { key: 'idade', statement: 'Qual é a sua idade?', type: 'NUMERIC', required: true, extra: { minValue: 16, maxValue: 99 }, numeric: [16, 80] },
                    {
                        key: 'ocupacao', statement: 'Qual é a sua ocupação principal?', type: 'SINGLE_CHOICE',
                        options: ['Estudante', 'Trabalhador formal', 'Autônomo', 'Aposentado', 'Desempregado'], weights: [20, 32, 28, 12, 8], optionalChance: 0.9,
                    },
                ],
            },
            {
                title: 'Deslocamento diário',
                questions: [
                    {
                        key: 'meio', statement: 'Qual meio de transporte você mais usa?', type: 'SINGLE_CHOICE', required: true,
                        options: ['A pé', 'Bicicleta', 'Moto', 'Carro', 'Ônibus/Van', 'Mototáxi'], weights: [18, 8, 30, 14, 22, 8],
                    },
                    {
                        key: 'notaTransporte', statement: 'Como avalia o transporte coletivo da cidade?', type: 'SCALE_1_5',
                        extra: { scaleLeftLabel: 'Péssimo', scaleRightLabel: 'Ótimo' }, scalePool: [1, 1, 2, 2, 2, 3, 3, 3, 4, 5],
                    },
                    { key: 'tempo', statement: 'Quantos minutos você leva, em média, no trajeto de ida?', type: 'NUMERIC', required: true, extra: { minValue: 1, maxValue: 240 }, numeric: [5, 90] },
                    { key: 'usaApp', statement: 'Você usa aplicativo de transporte?', type: 'YES_NO', required: true, yesChance: 0.3 },
                    {
                        key: 'qualApp', statement: 'Qual aplicativo ou serviço você usa?', type: 'FREE_TEXT', extra: { maxLength: 80 },
                        texts: ['Uber', '99', 'Táxi por aplicativo', '99Moto', 'Uber Moto'],
                    },
                    {
                        key: 'problemas', statement: 'Quais são os maiores problemas do trânsito e do transporte?', type: 'MULTIPLE_CHOICE',
                        extra: { minSelections: 1, maxSelections: 3 },
                        options: ['Poucos horários de ônibus', 'Ruas mal conservadas', 'Preço da passagem', 'Insegurança', 'Falta de ciclovias', 'Falta de acessibilidade'],
                        pickCount: [1, 3], optionalChance: 0.92,
                    },
                    { key: 'horarioPico', statement: 'Em que horário você mais se desloca?', type: 'TIME', hours: [6, 18], optionalChance: 0.85 },
                    { key: 'local', statement: 'Local da entrevista', type: 'LOCATION', optionalChance: 0.95 },
                    {
                        key: 'sugestao', statement: 'O que a prefeitura poderia fazer para melhorar a mobilidade?', type: 'FREE_TEXT', extra: { maxLength: 300 }, optionalChance: 0.45,
                        texts: [
                            'Consertar os buracos nas ruas da periferia.', 'Colocar mais horários de ônibus nos finais de semana.', 'Fazer faixas de pedestre e iluminação no centro.',
                            'Criar um ponto de ônibus coberto.', 'Fiscalizar o excesso de velocidade das motos.', 'Construir ciclovias ligando os bairros.',
                        ],
                    },
                ],
            },
        ],
        rules: [
            { target: 'qualApp', when: [{ source: 'usaApp', value: 'YES' }] },
            { target: 'notaTransporte', when: [{ source: 'meio', value: 'Ônibus/Van' }] },
        ],
    },

    // 3) Saúde: já encerrada (datas no passado), com uma regra de exibição, cópias devolvidas e um aparelho extraviado.
    {
        slug: 'saude',
        title: 'Atendimento nas unidades de saúde (seed)',
        description: 'Pesquisa de opinião sobre o atendimento recebido nas unidades básicas de saúde do município.',
        objective: 'Medir o tempo de espera, a qualidade do atendimento e a disponibilidade de medicamentos.',
        targetAudience: 'Usuários atendidos nas unidades de saúde nos últimos 30 dias',
        status: 'CLOSED',
        startedDaysAgo: 75,
        endsInDays: -15,
        researchers: ['demo.diego', 'demo.elisa', 'demo.ana'],
        targets: { 'demo.diego': 15, 'demo.elisa': 20, 'demo.ana': 15 },
        collections: 45,
        collectionWindow: [70, 18],
        center: { latitude: -23.5490, longitude: -46.6310 },
        area: { latitude: -23.5490, longitude: -46.6310, radiusKm: 4 },
        extraCopies: [
            { username: 'demo.diego', device: 'seed-device-diego-extraviado', kind: 'REVOKED', reason: 'Aparelho extraviado durante o trabalho de campo.' },
        ],
        sections: [
            {
                title: 'Atendimento recebido',
                questions: [
                    {
                        key: 'unidade', statement: 'Em qual unidade você foi atendido?', type: 'SINGLE_CHOICE', required: true,
                        options: ['UBS Centro', 'UBS Zona Leste', 'UBS Zona Sul', 'AMA/UBS Integrada'], weights: [35, 25, 15, 25],
                    },
                    { key: 'dataAtendimento', statement: 'Quando foi o atendimento?', type: 'DATE', daysBefore: 25, optionalChance: 0.9 },
                    { key: 'espera', statement: 'Quantos minutos você esperou para ser atendido?', type: 'NUMERIC', required: true, extra: { minValue: 0, maxValue: 480 }, numeric: [5, 180] },
                    {
                        key: 'atendimento', statement: 'Como avalia o atendimento dos profissionais?', type: 'SCALE_1_5', required: true,
                        extra: { scaleLeftLabel: 'Muito ruim', scaleRightLabel: 'Excelente' }, scalePool: [1, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5],
                    },
                    { key: 'medicamento', statement: 'Você conseguiu receber os medicamentos receitados?', type: 'YES_NO', required: true, yesChance: 0.62 },
                    {
                        key: 'motivoFalta', statement: 'Por que não recebeu o medicamento?', type: 'SINGLE_CHOICE',
                        options: ['Medicamento em falta', 'Receita não aceita', 'Não havia farmácia aberta', 'Outro motivo'], weights: [55, 15, 20, 10],
                    },
                ],
            },
            {
                title: 'Estrutura e melhorias',
                questions: [
                    {
                        key: 'limpeza', statement: 'Como avalia a limpeza e a conservação da unidade?', type: 'SCALE_1_5',
                        extra: { scaleLeftLabel: 'Muito ruim', scaleRightLabel: 'Excelente' }, scalePool: [2, 3, 3, 4, 4, 4, 5, 5], optionalChance: 0.95,
                    },
                    {
                        key: 'melhorar', statement: 'O que deveria melhorar primeiro?', type: 'MULTIPLE_CHOICE', extra: { minSelections: 1, maxSelections: 2 },
                        options: ['Tempo de espera', 'Limpeza', 'Atendimento da recepção', 'Número de médicos', 'Horário de funcionamento'], pickCount: [1, 2], optionalChance: 0.9,
                    },
                    { key: 'local', statement: 'Local da entrevista', type: 'LOCATION', optionalChance: 0.9 },
                    {
                        key: 'comentario', statement: 'Quer deixar algum comentário?', type: 'FREE_TEXT', extra: { maxLength: 300 }, optionalChance: 0.4,
                        texts: [
                            'Os profissionais são atenciosos, mas faltam médicos.', 'Chego cedo e mesmo assim espero muito.', 'Faltou o remédio de pressão de novo.',
                            'A unidade está mais organizada do que antes.', 'Precisava de atendimento aos sábados.', 'Atendimento excelente, sem reclamações.',
                        ],
                    },
                ],
            },
        ],
        rules: [{ target: 'motivoFalta', when: [{ source: 'medicamento', value: 'NO' }] }],
    },

    // 4) Publicada, mas ainda sem coletas (o app já pode baixá-la; sem cópias, senão ela já estaria "em campo").
    {
        slug: 'energia',
        title: 'Consumo de energia nas residências (seed)',
        description: 'Pesquisa sobre o consumo de energia elétrica e o interesse em energia solar entre as famílias.',
        objective: 'Estimar o gasto médio com energia e o potencial de adesão à energia solar.',
        targetAudience: 'Responsáveis por domicílios urbanos',
        status: 'PUBLISHED',
        startedDaysAgo: 2,
        endsInDays: 60,
        researchers: ['demo.bruno', 'demo.carla'],
        targets: { 'demo.bruno': 40, 'demo.carla': 40 },
        collections: 0,
        collectionWindow: [0, 0],
        center: SAO_PAULO,
        area: { ...SAO_PAULO, radiusKm: 10 },
        sections: [
            {
                title: 'Domicílio',
                questions: [
                    { key: 'moradores', statement: 'Quantas pessoas moram na casa?', type: 'NUMERIC', required: true, extra: { minValue: 1, maxValue: 15 }, numeric: [1, 9] },
                    { key: 'moradia', statement: 'Qual é o tipo de moradia?', type: 'SINGLE_CHOICE', required: true, options: ['Casa própria', 'Casa alugada', 'Apartamento', 'Kitnet ou studio'] },
                ],
            },
            {
                title: 'Consumo e energia solar',
                questions: [
                    {
                        key: 'conta', statement: 'Qual é o valor médio da sua conta de luz?', type: 'SINGLE_CHOICE', required: true,
                        options: ['Até R$ 80', 'De R$ 80 a R$ 150', 'De R$ 150 a R$ 300', 'Acima de R$ 300'],
                    },
                    { key: 'possuiSolar', statement: 'Você já tem painéis de energia solar?', type: 'YES_NO', required: true },
                    { key: 'interesseSolar', statement: 'Você teria interesse em instalar energia solar?', type: 'YES_NO' },
                    {
                        key: 'obstaculo', statement: 'Qual é o maior obstáculo para instalar?', type: 'SINGLE_CHOICE',
                        options: ['Custo inicial', 'Falta de informação', 'Imóvel alugado', 'Não vejo vantagem'],
                    },
                    { key: 'obs', statement: 'Observações do pesquisador', type: 'FREE_TEXT', extra: { maxLength: 300 } },
                ],
            },
        ],
        rules: [
            { target: 'interesseSolar', when: [{ source: 'possuiSolar', value: 'NO' }] },
            { target: 'obstaculo', when: [{ source: 'interesseSolar', value: 'NO' }] },
        ],
    },

    // 5) Rascunho: sem pesquisadores e sem coletas; mostra também os tipos de mídia (foto, fotos, áudio)
    //    e a gravação da entrevista (consentimento obrigatório no app).
    {
        slug: 'cultura',
        title: 'Eventos culturais da cidade (seed)',
        description: 'Rascunho de pesquisa sobre o interesse da população em eventos culturais e festas tradicionais.',
        objective: 'Descobrir quais eventos o público mais valoriza e com que frequência participa.',
        targetAudience: 'Moradores a partir de 14 anos',
        status: 'DRAFT',
        recordInterview: true,
        startedDaysAgo: 0,
        endsInDays: 90,
        researchers: [],
        collections: 0,
        collectionWindow: [0, 0],
        center: SAO_PAULO,
        sections: [
            {
                title: 'Perfil',
                questions: [
                    { key: 'nome', statement: 'Qual é o seu nome?', type: 'FREE_TEXT', required: true, extra: { maxLength: 80 } },
                    { key: 'idade', statement: 'Qual é a sua idade?', type: 'NUMERIC', required: true, extra: { minValue: 14, maxValue: 99 } },
                ],
            },
            {
                title: 'Eventos e participação',
                questions: [
                    {
                        key: 'tipos', statement: 'De quais tipos de evento você mais gosta?', type: 'MULTIPLE_CHOICE', extra: { minSelections: 1, maxSelections: 3 },
                        options: ['Festa junina', 'Show musical', 'Teatro', 'Feira gastronômica', 'Cinema ao ar livre'],
                    },
                    {
                        key: 'frequencia', statement: 'Com que frequência você participa de eventos?', type: 'SINGLE_CHOICE',
                        options: ['Nunca', 'Algumas vezes por ano', 'Uma vez por mês', 'Toda semana'],
                    },
                    { key: 'nota', statement: 'Como avalia a programação cultural atual?', type: 'SCALE_1_5', extra: { scaleLeftLabel: 'Fraca', scaleRightLabel: 'Muito boa' } },
                    { key: 'foto', statement: 'Foto do local do evento', type: 'PHOTO', extra: { maxFiles: 1 } },
                    { key: 'fotos', statement: 'Fotos da estrutura (até 3)', type: 'MULTIPLE_PHOTOS', extra: { maxFiles: 3 } },
                    { key: 'depoimento', statement: 'Depoimento em áudio', type: 'AUDIO', extra: { maxDuration: 60 } },
                ],
            },
        ],
    },

    // 6) Abastecimento de água: em campo, com as regras avançadas (operadores, grupos E/OU, HIDE e pulo de seção),
    //    texto de ajuda e limites de data.
    {
        slug: 'agua',
        title: 'Abastecimento de água nas residências (seed)',
        description: 'Levantamento sobre a forma de abastecimento, as faltas de água e a qualidade percebida pelos moradores.',
        objective: 'Mapear as falhas no abastecimento e a satisfação com o serviço público de água.',
        targetAudience: 'Responsáveis por domicílios urbanos',
        status: 'IN_FIELD',
        startedDaysAgo: 28,
        endsInDays: 30,
        researchers: ['demo.ana', 'demo.bruno', 'demo.diego', 'demo.elisa'],
        targets: { 'demo.ana': 15, 'demo.bruno': 12, 'demo.diego': 10, 'demo.elisa': 10 },
        collections: 40,
        collectionWindow: [25, 0],
        center: { latitude: -23.5540, longitude: -46.6380 },
        area: { latitude: -23.5540, longitude: -46.6380, radiusKm: 6 },
        sections: [
            {
                title: 'Domicílio',
                questions: [
                    {
                        key: 'moradores', statement: 'Quantas pessoas moram na casa?', type: 'NUMERIC', required: true,
                        helpText: 'Conte todos que dormem na casa, inclusive crianças.', extra: { minValue: 1, maxValue: 15 }, numeric: [1, 9],
                    },
                    {
                        key: 'abastecimento', statement: 'Como a casa recebe água?', type: 'SINGLE_CHOICE', required: true,
                        options: ['Rede pública', 'Carro-pipa', 'Poço ou cisterna', 'Outra forma'], weights: [58, 18, 18, 6],
                    },
                ],
            },
            {
                title: 'Falta e qualidade da água',
                questions: [
                    { key: 'falta', statement: 'Ficou sem água nos últimos 30 dias?', type: 'YES_NO', required: true, yesChance: 0.45 },
                    {
                        key: 'ultimaFalta', statement: 'Quando foi a última falta de água?', type: 'DATE',
                        extra: { minDate: isoDate(new Date(Date.now() - 60 * DAY)), maxDate: isoDate(new Date()) }, daysBefore: 30,
                    },
                    { key: 'diasSemAgua', statement: 'Quantos dias ficou sem água, no total?', type: 'NUMERIC', extra: { minValue: 1, maxValue: 30 }, numeric: [1, 12] },
                    {
                        key: 'tratamento', statement: 'Como trata a água para beber?', type: 'MULTIPLE_CHOICE', extra: { minSelections: 1, maxSelections: 2 },
                        options: ['Filtra', 'Ferve', 'Usa cloro', 'Compra água mineral', 'Não trata'], pickCount: [1, 2], optionalChance: 0.9,
                    },
                    {
                        key: 'notaAgua', statement: 'Como avalia a qualidade da água que chega à casa?', type: 'SCALE_1_5', required: true,
                        extra: { scaleLeftLabel: 'Muito ruim', scaleRightLabel: 'Muito boa' }, scalePool: [1, 2, 2, 3, 3, 3, 4, 4, 5],
                    },
                    {
                        key: 'queixa', statement: 'Descreva o problema com a água', type: 'FREE_TEXT', extra: { maxLength: 300 },
                        helpText: 'Cor, cheiro, gosto, pressão ou frequência das faltas.',
                        texts: [
                            'A água chega turva depois dos dias sem abastecimento.', 'Falta água toda semana, sempre no mesmo dia.', 'Cheiro forte de cloro.',
                            'A pressão é muito baixa nas casas mais altas.', 'Depende do carro-pipa, que atrasa.', 'Gosto de ferrugem na água do poço.',
                        ],
                    },
                ],
            },
            {
                title: 'Serviço público de água',
                questions: [
                    { key: 'conta', statement: 'Qual é o valor médio da conta de água (R$)?', type: 'NUMERIC', extra: { minValue: 0, maxValue: 1000 }, numeric: [25, 160], optionalChance: 0.9 },
                    {
                        key: 'satisfacao', statement: 'Como avalia o serviço da companhia de água?', type: 'SCALE_1_5', required: true,
                        extra: { scaleLeftLabel: 'Muito ruim', scaleRightLabel: 'Excelente' }, scalePool: [1, 2, 2, 3, 3, 4, 4, 5],
                    },
                    { key: 'reclamou', statement: 'Já reclamou do serviço à companhia?', type: 'YES_NO', yesChance: 0.35 },
                    { key: 'protocolo', statement: 'Qual o número do protocolo da reclamação?', type: 'NUMERIC', extra: { minValue: 1 }, numeric: [100000, 999999] },
                    {
                        key: 'sugestao', statement: 'Deixe uma sugestão para a companhia', type: 'FREE_TEXT', extra: { maxLength: 300 }, optionalChance: 0.6,
                        texts: ['Avisar com antecedência sobre as faltas.', 'Reduzir o tempo para consertar vazamentos.', 'Abrir um atendimento local.', 'Instalar mais reservatórios.'],
                    },
                ],
            },
        ],
        rules: [
            // Simples (EQ): só pergunta a data e os dias de falta a quem ficou sem água.
            { target: 'ultimaFalta', when: [{ source: 'falta', value: 'YES' }] },
            { target: 'diasSemAgua', when: [{ source: 'falta', value: 'YES' }] },
            // Grupos E/OU: aparece se (nota <= 2 E ficou sem água) OU (ficou 7 dias ou mais sem água).
            { target: 'queixa', when: [{ source: 'notaAgua', operator: 'LTE', value: '2' }, { source: 'falta', value: 'YES' }] },
            { target: 'queixa', when: [{ source: 'diasSemAgua', operator: 'GTE', value: '7' }] },
            // Pulo de seção: a seção inteira só vale para quem recebe água da rede pública.
            { targetSection: 2, when: [{ source: 'abastecimento', value: 'Rede pública' }] },
            // HIDE dentro de uma seção com pulo: o protocolo só aparece para quem reclamou. (Uma regra SHOW própria aqui
            // viraria OU com a da seção e o protocolo apareceria para todos que passam pela seção.)
            { target: 'protocolo', action: 'HIDE', when: [{ source: 'reclamou', value: 'NO' }] },
            // HIDE: quem avaliou o serviço com nota máxima não precisa dar sugestão.
            { target: 'sugestao', action: 'HIDE', when: [{ source: 'satisfacao', value: '5' }] },
        ],
    },
];

// Modelo de questionário salvo pela empresa (aparece na biblioteca de modelos). Mesmo formato dos modelos prontos.
const SAVED_TEMPLATE = {
    name: 'Satisfação rápida de atendimento (seed)',
    category: 'Personalizado',
    description: 'Três perguntas rápidas sobre o atendimento, com pergunta aberta só para quem deu nota baixa.',
    objective: 'Medir a satisfação logo após o atendimento.',
    targetAudience: 'Clientes atendidos no dia',
    recordInterview: false,
    spec: {
        sections: [
            {
                title: 'Atendimento',
                questions: [
                    { key: 'canal', statement: 'Por qual canal você foi atendido?', type: 'SINGLE_CHOICE', isRequired: true, options: ['Balcão', 'Telefone', 'WhatsApp'] },
                    { key: 'nota', statement: 'Como avalia o atendimento?', type: 'SCALE_1_5', isRequired: true, scaleLeftLabel: 'Muito ruim', scaleRightLabel: 'Excelente' },
                    { key: 'motivo', statement: 'O que podemos melhorar?', type: 'FREE_TEXT', maxLength: 300 },
                ],
            },
        ],
        rules: [{ targetKey: 'motivo', action: 'SHOW', conditions: [{ sourceKey: 'nota', operator: 'LTE', value: '3' }] }],
    },
};

// ---------------------------------------------------------------------------------------------
// Empresas e usuários
// ---------------------------------------------------------------------------------------------

async function ensureCompany(legalName: string, situation: 'ACTIVE' | 'INACTIVE') {
    const orm = db.orm.public;
    const existing = await orm.Company.where({ legalName }).first();
    if (existing) return existing;
    return orm.Company.create({
        legalName,
        contactInformation: 'contato@empresademo.com.br | (11) 99999-0000',
        situation,
    });
}

async function ensureUser(
    data: { name: string; username: string },
    profile: 'ADMINISTRATOR' | 'RESEARCHER',
    companyId: number,
    passwordHash: string,
    situation: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
) {
    const orm = db.orm.public;
    const existing = await orm.User.where({ username: data.username }).first();
    if (existing) {
        // Usuário de uma versão antiga do seed ainda com a senha que a política de hoje recusa: passa para a nova.
        // Só mexe em quem não trocou a senha (o hash ainda é o do seed antigo).
        if (!existing.mustChangePassword && (await bcrypt.compare(LEGACY_DEMO_PASSWORD, existing.passwordHash))) {
            const updated = await orm.User.where({ username: data.username }).update({
                passwordHash,
                failedLoginAttempts: 0,
                lockedUntil: null,
            });
            return updated ?? existing;
        }
        return existing;
    }
    return orm.User.create({
        name: data.name,
        username: data.username,
        passwordHash,
        profile,
        situation,
        // Contas de demonstração entram direto, sem a tela de troca de senha temporária.
        mustChangePassword: false,
        companyId,
    });
}

// ---------------------------------------------------------------------------------------------
// Pesquisa: criação e leitura de volta
// ---------------------------------------------------------------------------------------------

interface SeededQuestion {
    id: number;
    key: string;
    def: QuestionDef;
    sectionId: number;
    sectionOrder: number;
    order: number;
    options: { id: number; text: string }[];
    isRequired: boolean;
}

// Regra como está no banco (uma linha por condição).
interface StoredRule {
    id: number;
    sourceQuestionId: number;
    operator: string;
    triggerValue: string;
    targetQuestionId: number | null;
    targetSectionId: number | null;
    action: string;
    groupKey: string | null;
}

interface SeededResearch {
    id: number;
    def: ResearchDef;
    questions: SeededQuestion[]; // na ordem do questionário
    rules: StoredRule[]; // as regras que valem no banco (não as da definição)
}

async function ensureResearch(def: ResearchDef, companyId: number): Promise<SeededResearch> {
    const orm = db.orm.public;
    let research = await orm.Research.where({ companyId, title: def.title }).first();
    const fresh = !research;

    if (!research) {
        research = await orm.Research.create({
            title: def.title,
            description: def.description,
            objective: def.objective,
            startDate: new Date(Date.now() - def.startedDaysAgo * DAY).toISOString(),
            endDate: new Date(Date.now() + def.endsInDays * DAY).toISOString(),
            targetAudience: def.targetAudience,
            status: def.status,
            recordInterview: def.recordInterview ?? false,
            areaLatitude: def.area?.latitude ?? null,
            areaLongitude: def.area?.longitude ?? null,
            areaRadiusKm: def.area?.radiusKm ?? null,
            companyId,
        });

        for (const [sectionIndex, sectionDef] of def.sections.entries()) {
            const section = await orm.Section.create({ title: sectionDef.title, order: sectionIndex + 1, researchId: research.id });

            for (const [questionIndex, q] of sectionDef.questions.entries()) {
                const created = await orm.Question.create({
                    statement: q.statement,
                    type: q.type,
                    helpText: q.helpText ?? null,
                    isRequired: q.required ?? false,
                    order: questionIndex + 1,
                    sectionId: section.id,
                    ...(q.extra ?? {}),
                });
                for (const [optionIndex, text] of (q.options ?? []).entries()) {
                    await orm.QuestionOption.create({ text, order: optionIndex + 1, questionId: created.id });
                }
            }
        }
    } else if (def.area && research.areaLatitude == null && research.areaLongitude == null && research.areaRadiusKm == null) {
        // Pesquisa de uma versão antiga do seed, criada sem área-alvo: completa (sem área, a auditoria não confere o local).
        research =
            (await orm.Research.where({ id: research.id }).update({
                areaLatitude: def.area.latitude,
                areaLongitude: def.area.longitude,
                areaRadiusKm: def.area.radiusKm,
            })) ?? research;
    }
    if (!research) throw new Error(`Não foi possível criar a pesquisa "${def.title}".`);

    // Lê de volta as questões (também quando a pesquisa já existia) na ordem do questionário.
    const sections = [...(await orm.Section.where({ researchId: research.id }).all())].sort((a, b) => a.order - b.order);
    const loaded: Omit<SeededQuestion, 'key' | 'def'>[] = [];
    for (const section of sections) {
        const questions = [...(await orm.Question.where({ sectionId: section.id }).all())].sort((a, b) => a.order - b.order);
        for (const q of questions) {
            const options = [...(await orm.QuestionOption.where({ questionId: q.id }).all())]
                .sort((a, b) => a.order - b.order)
                .map((o) => ({ id: o.id, text: o.text }));
            loaded.push({ id: q.id, sectionId: section.id, sectionOrder: section.order, order: q.order, options, isRequired: q.isRequired });
        }
    }

    const defs = def.sections.flatMap((s) => s.questions);
    if (loaded.length < defs.length) {
        throw new Error(`A pesquisa "${def.title}" existe, mas está incompleta. Apague-a e rode o seed novamente.`);
    }
    const questions: SeededQuestion[] = defs.map((d, index) => ({ ...loaded[index], key: d.key, def: d }));

    // Regras novas só entram em pesquisa recém-criada ou ainda sem coletas: acrescentar regra depois das coletas
    // deixaria respostas antigas incoerentes com o questionário.
    const hasCollections = !fresh && !!(await orm.Collection.where({ researchId: research.id }).first());
    if (fresh || !hasCollections) {
        await ensureRules(def, research.id, questions, sections.map((s) => s.id));
    }

    const rules = [...(await orm.QuestionRule.where({ researchId: research.id }).all())].map((r) => ({
        id: r.id,
        sourceQuestionId: r.sourceQuestionId,
        operator: r.operator ?? 'EQ',
        triggerValue: r.triggerValue,
        targetQuestionId: r.targetQuestionId ?? null,
        targetSectionId: r.targetSectionId ?? null,
        action: r.action ?? 'SHOW',
        groupKey: r.groupKey ?? null,
    }));

    return { id: research.id, def, questions, rules };
}

// Cria as regras da definição que ainda não existem, validando cada uma com a mesma regra da API
// (origem antes do alvo, operador compatível com o tipo, valor válido).
async function ensureRules(def: ResearchDef, researchId: number, questions: SeededQuestion[], sectionIds: number[]) {
    if (!def.rules || def.rules.length === 0) return;
    const orm = db.orm.public;
    const byKey = new Map(questions.map((q) => [q.key, q]));
    const structure: StructQuestion[] = questions.map((q) => ({
        id: q.id,
        sectionId: q.sectionId,
        sectionOrder: q.sectionOrder,
        order: q.order,
        statement: q.def.statement,
        type: q.def.type,
        options: q.options,
    }));
    const existing = [...(await orm.QuestionRule.where({ researchId }).all())];

    for (const [ruleIndex, rule] of def.rules.entries()) {
        const label = `regra ${ruleIndex + 1} de "${def.title}"`;
        const target = rule.target ? byKey.get(rule.target) : undefined;
        const targetSectionId = rule.targetSection !== undefined ? sectionIds[rule.targetSection] : undefined;
        if ((rule.target && !target) || (rule.targetSection !== undefined && targetSectionId === undefined)) {
            throw new Error(`Alvo inválido na ${label}.`);
        }

        const conditions = rule.when.map((c) => {
            const source = byKey.get(c.source);
            if (!source) throw new Error(`Questão de origem "${c.source}" não existe na ${label}.`);
            const operator = c.operator ?? 'EQ';
            let triggerValue = c.value ?? '';
            if (source.def.type === 'SINGLE_CHOICE' || source.def.type === 'MULTIPLE_CHOICE') {
                const option = source.options.find((o) => o.text === c.value);
                if (!option) throw new Error(`Opção "${c.value}" não existe na questão "${source.def.statement}" (${label}).`);
                triggerValue = String(option.id);
            }
            return { sourceQuestionId: source.id, operator, triggerValue };
        });

        const problem = checkNewRuleGroup(structure, [], {
            targetQuestionId: target?.id,
            targetSectionId,
            action: rule.action ?? 'SHOW',
            conditions,
        });
        if (problem) throw new Error(`${label}: ${problem}`);

        // Várias condições = um grupo (E); uma só = condição sozinha (sem groupKey), como a API grava.
        const groupKey = conditions.length > 1 ? `seed-${def.slug}-regra-${ruleIndex + 1}` : null;
        for (const condition of conditions) {
            const already = existing.some(
                (r) =>
                    r.sourceQuestionId === condition.sourceQuestionId &&
                    (r.operator ?? 'EQ') === condition.operator &&
                    r.triggerValue === condition.triggerValue &&
                    (r.targetQuestionId ?? null) === (target?.id ?? null) &&
                    (r.targetSectionId ?? null) === (targetSectionId ?? null) &&
                    (r.action ?? 'SHOW') === (rule.action ?? 'SHOW') &&
                    (r.groupKey ?? null) === groupKey,
            );
            if (already) continue;
            await orm.QuestionRule.create({
                researchId,
                sourceQuestionId: condition.sourceQuestionId,
                operator: condition.operator,
                triggerValue: condition.triggerValue,
                targetQuestionId: target?.id ?? null,
                targetSectionId: targetSectionId ?? null,
                action: rule.action ?? 'SHOW',
                groupKey,
            });
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Respostas
// ---------------------------------------------------------------------------------------------

interface Point {
    latitude: number;
    longitude: number;
    accuracy: number;
}

// Ponto aleatório perto do centro. `spread` em graus: 0.018 ≈ 2 km; 0.12 ≈ 13 km (bem fora de qualquer área do seed).
function randomPoint(center: ResearchDef['center'], spread: number): Point {
    return {
        latitude: Number((center.latitude + (random() - 0.5) * 2 * spread).toFixed(6)),
        longitude: Number((center.longitude + (random() - 0.5) * 2 * spread).toFixed(6)),
        accuracy: between(4, 35),
    };
}

const INSIDE_SPREAD = 0.018;
const OUTSIDE_SPREAD = 0.12;

// Gera o texto da resposta no mesmo formato que o aplicativo envia.
function generateValue(q: SeededQuestion, startedAt: Date, location: Point | null): string | null {
    const d = q.def;
    if (d.gen) return d.gen();

    switch (d.type) {
        case 'FREE_TEXT':
            return d.texts ? pick(d.texts) : null;
        case 'NUMERIC':
            return String(between(...(d.numeric ?? [1, 10])));
        case 'DATE':
            return isoDate(new Date(startedAt.getTime() - between(0, d.daysBefore ?? 30) * DAY));
        case 'TIME': {
            const [from, to] = d.hours ?? [8, 20];
            const hour = String(between(from, to)).padStart(2, '0');
            const minute = String(pick([0, 10, 15, 20, 30, 40, 45, 50])).padStart(2, '0');
            return `${hour}:${minute}`;
        }
        case 'YES_NO':
            return chance(d.yesChance ?? 0.5) ? 'YES' : 'NO';
        case 'SCALE_1_5':
            return String(pick(d.scalePool ?? [1, 2, 3, 4, 5]));
        case 'SINGLE_CHOICE':
            return String(weightedPick(q.options, d.weights).id);
        case 'MULTIPLE_CHOICE': {
            const [min, max] = d.pickCount ?? [1, 2];
            const chosen = [...q.options].sort(() => random() - 0.5).slice(0, between(min, max));
            return JSON.stringify(chosen.map((o) => o.id));
        }
        case 'LOCATION':
            // Sem localização (permissão negada): a questão fica em branco, como no aplicativo.
            return location ? JSON.stringify({ ...location, lowAccuracy: false }) : null;
        default:
            return null; // PHOTO, MULTIPLE_PHOTOS e AUDIO dependem de arquivos: o seed não gera.
    }
}

// Respostas de uma coleta, aplicando as regras de exibição do banco com a mesma conta da API e do app
// (rule-logic.ts): o alvo é visível quando (não há grupo SHOW ou algum SHOW vale) e nenhum HIDE vale;
// a condição só vale se a questão de origem está visível; seção escondida esconde todas as suas questões.
function buildAnswers(research: SeededResearch, startedAt: Date, location: Point | null): { questionId: number; value: string }[] {
    const answers: { questionId: number; value: string }[] = [];
    const given = new Map<number, string>(); // id da questão -> valor respondido
    const visible = new Map<number, boolean>();
    const byId = new Map(research.questions.map((q) => [q.id, q]));

    const holds = (rule: StoredRule) => {
        const source = byId.get(rule.sourceQuestionId);
        if (!source || visible.get(source.id) === false) return false;
        return evaluateCondition(source.def.type, rule.operator, rule.triggerValue, given.get(source.id));
    };

    for (const question of research.questions) {
        const incoming = research.rules.filter(
            (r) => r.targetQuestionId === question.id || (r.targetSectionId !== null && r.targetSectionId === question.sectionId),
        );
        const groups = new Map<string, { action: string; rules: StoredRule[] }>();
        for (const rule of incoming) {
            const key = `${rule.action}|${rule.groupKey ?? `solo-${rule.id}`}`;
            const group = groups.get(key) ?? { action: rule.action, rules: [] };
            group.rules.push(rule);
            groups.set(key, group);
        }
        const trueGroups = (action: string) => [...groups.values()].filter((g) => g.action === action && g.rules.every(holds));
        const hasGroups = (action: string) => [...groups.values()].some((g) => g.action === action);

        const isVisible = (!hasGroups('SHOW') || trueGroups('SHOW').length > 0) && trueGroups('HIDE').length === 0;
        visible.set(question.id, isVisible);
        if (!isVisible) continue;

        // Pergunta obrigatória sempre respondida; as demais, às vezes ficam em branco.
        if (!question.isRequired && !chance(question.def.optionalChance ?? 1)) continue;

        const value = generateValue(question, startedAt, location);
        if (value === null) continue;
        given.set(question.id, value);
        answers.push({ questionId: question.id, value });
    }
    return answers;
}

// ---------------------------------------------------------------------------------------------
// Coletas, cópias em campo e sincronização
// ---------------------------------------------------------------------------------------------

const deviceOf = (username: string) => `seed-device-${username.replace(/^demo\./, '')}`;

interface Researcher {
    id: number;
    username: string;
}

interface CreatedCollection {
    researcherId: number;
    deviceId: string;
    clientId: string;
    collectionId: number;
    receivedAt: Date;
}

async function seedCollections(research: SeededResearch, researchers: Researcher[]) {
    const orm = db.orm.public;
    const { def } = research;
    const team = researchers.filter((r) => def.researchers.includes(r.username));
    const created: CreatedCollection[] = [];
    let skipped = 0;
    if (def.collections === 0 || team.length === 0) return { created, skipped };

    const now = Date.now();
    const [fromDaysAgo, toDaysAgo] = def.collectionWindow;

    for (let n = 1; n <= def.collections; n++) {
        const researcher = team[(n - 1) % team.length];
        const clientId = def.legacyClientIds ? `seed-${n}` : `seed-${def.slug}-${n}`;

        const existing = await orm.Collection.where({ researcherId: researcher.id, clientId }).first();
        if (existing) {
            skipped++;
            continue;
        }

        // Espalha as coletas pela janela da pesquisa, em horário comercial.
        const startedAt = new Date(now - between(toDaysAgo, fromDaysAgo) * DAY);
        startedAt.setHours(between(8, 19), between(0, 59), between(0, 59), 0);
        if (startedAt.getTime() > now) startedAt.setTime(now - between(10, 120) * MINUTE);

        // Casos de propósito para a auditoria de qualidade: coleta muito rápida, fora da área-alvo e sem localização.
        const tooFast = chance(0.04);
        const noLocation = chance(0.05);
        const outOfArea = !noLocation && chance(0.04);

        const durationMs = tooFast ? between(5, 12) * 1000 : between(3, 14) * MINUTE + between(0, 59) * 1000;
        const finishedAt = new Date(startedAt.getTime() + durationMs);
        // O aparelho envia algum tempo depois de terminar (nunca no futuro).
        const receivedAt = new Date(Math.min(now, finishedAt.getTime() + between(2, 90) * MINUTE));
        const location = noLocation ? null : randomPoint(def.center, outOfArea ? OUTSIDE_SPREAD : INSIDE_SPREAD);

        // Pesquisa que grava a entrevista: o aceite vem antes do início da coleta, confirmado pelo pesquisador.
        // (O áudio não é gerado: a auditoria mostrará "áudio ausente" nessas coletas.)
        const consentAt = def.recordInterview ? new Date(startedAt.getTime() - between(30, 180) * 1000) : null;

        const collection = await orm.Collection.create({
            researchId: research.id,
            researcherId: researcher.id,
            deviceId: deviceOf(researcher.username),
            clientId,
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            receivedAt: receivedAt.toISOString(),
            startLatitude: location?.latitude ?? null,
            startLongitude: location?.longitude ?? null,
            locationAccuracy: location?.accuracy ?? null,
            consentGiven: consentAt !== null,
            consentAt: consentAt ? consentAt.toISOString() : null,
            consentConfirmedById: consentAt ? researcher.id : null,
            audioPath: null,
            audioMimeType: null,
            audioSizeBytes: null,
            audioDurationSeconds: null,
        });

        for (const answer of buildAnswers(research, startedAt, location)) {
            await orm.Answer.create({ questionId: answer.questionId, value: answer.value, collectionId: collection.id });
        }
        created.push({ researcherId: researcher.id, deviceId: deviceOf(researcher.username), clientId, collectionId: collection.id, receivedAt });
    }
    return { created, skipped };
}

// Coletas de versões antigas do seed não tinham localização (o mapa ficava vazio) e foram gravadas com
// `receivedAt` = hora do seed. Completa as duas coisas. Só mexe em coleta do seed sem localização e recebida
// muito depois de terminar; depois do ajuste ela deixa de casar, então rodar de novo não repete.
async function modernizeLegacyCollections(research: SeededResearch) {
    const orm = db.orm.public;
    const now = Date.now();
    let updated = 0;

    for (const collection of [...(await orm.Collection.where({ researchId: research.id }).all())]) {
        if (!collection.clientId?.startsWith('seed-')) continue;
        if (collection.startLatitude != null || collection.startLongitude != null) continue;
        const finishedAt = new Date(collection.finishedAt).getTime();
        if (new Date(collection.receivedAt).getTime() - finishedAt < 3 * 60 * MINUTE) continue; // já no padrão novo

        const location = chance(0.95) ? randomPoint(research.def.center, INSIDE_SPREAD) : null;
        await orm.Collection.where({ id: collection.id }).update({
            startLatitude: location?.latitude ?? null,
            startLongitude: location?.longitude ?? null,
            locationAccuracy: location?.accuracy ?? null,
            receivedAt: new Date(Math.min(now, finishedAt + between(2, 90) * MINUTE)).toISOString(),
        });
        updated++;
    }
    return updated;
}

// Um SyncLog por (pesquisador, aparelho, dia): o registro do envio que o aplicativo teria feito.
async function seedSyncLogs(created: CreatedCollection[]) {
    const orm = db.orm.public;
    const batches = new Map<string, CreatedCollection[]>();
    for (const item of created) {
        const key = `${item.researcherId}|${item.deviceId}|${item.receivedAt.toISOString().slice(0, 10)}`;
        batches.set(key, [...(batches.get(key) ?? []), item]);
    }

    for (const items of batches.values()) {
        const last = new Date(Math.max(...items.map((i) => i.receivedAt.getTime())));
        await orm.SyncLog.create({
            researcherId: items[0].researcherId,
            deviceId: items[0].deviceId,
            receivedAt: last.toISOString(),
            totalCount: items.length,
            acceptedCount: items.length,
            existingCount: 0,
            rejectedCount: 0,
            details: JSON.stringify(
                items.map((item, index) => ({ index, clientId: item.clientId, status: 'ACCEPTED', collectionId: item.collectionId })),
            ),
        });
    }
    return batches.size;
}

// Cópias em campo (ResearchDownload): cada pesquisador que coletou baixou a pesquisa no próprio aparelho.
//  - em campo: cópia ativa (trava o questionário, como na API);
//  - encerrada: cópia devolvida;
//  - extras: aparelho revogado pelo administrador (e, quando indicado, depois desbloqueado).
// Publicada/rascunho não têm cópias (o primeiro download já a poria em campo).
async function ensureCopies(research: SeededResearch, researchers: Researcher[], adminId: number) {
    const orm = db.orm.public;
    const { def } = research;
    if (def.status !== 'IN_FIELD' && def.status !== 'CLOSED') return 0;
    if (def.collections === 0) return 0;

    const startedAt = Date.now() - def.startedDaysAgo * DAY;
    const endedAt = Date.now() + def.endsInDays * DAY;
    let created = 0;

    const exists = async (userId: number, deviceId: string) =>
        !!(await orm.ResearchDownload.where({ researchId: research.id, userId, deviceId }).first());

    for (const researcher of researchers.filter((r) => def.researchers.includes(r.username))) {
        const deviceId = deviceOf(researcher.username);
        if (await exists(researcher.id, deviceId)) continue;
        const downloadedAt = new Date(startedAt + between(1, 3) * DAY).toISOString();
        await orm.ResearchDownload.create(
            def.status === 'IN_FIELD'
                ? { researchId: research.id, deviceId, userId: researcher.id, active: true, createdAt: downloadedAt }
                : { researchId: research.id, deviceId, userId: researcher.id, active: false, createdAt: downloadedAt, returnedAt: new Date(endedAt - between(0, 2) * DAY).toISOString() },
        );
        created++;
    }

    for (const extra of def.extraCopies ?? []) {
        const researcher = researchers.find((r) => r.username === extra.username);
        if (!researcher || (await exists(researcher.id, extra.device))) continue;
        const downloadedAt = startedAt + between(2, 5) * DAY;
        const revokedAt = downloadedAt + between(3, 8) * DAY;
        await orm.ResearchDownload.create({
            researchId: research.id,
            deviceId: extra.device,
            userId: researcher.id,
            active: false,
            createdAt: new Date(downloadedAt).toISOString(),
            revokedAt: new Date(revokedAt).toISOString(),
            revokedById: adminId,
            revokeReason: extra.reason,
            ...(extra.kind === 'REVOKED_UNBLOCKED'
                ? { unblockedAt: new Date(revokedAt + DAY).toISOString(), unblockedById: adminId }
                : {}),
        });
        created++;
    }
    return created;
}

// Vincula os pesquisadores da definição à pesquisa, com a meta de coletas (completa a meta que faltar).
async function ensureLinks(research: SeededResearch, researchers: Researcher[]) {
    const orm = db.orm.public;
    const { def } = research;
    for (const researcher of researchers.filter((r) => def.researchers.includes(r.username))) {
        const target = def.targets?.[researcher.username] ?? null;
        const link = await orm.ResearchResearcher.where({ researchId: research.id, userId: researcher.id }).first();
        if (!link) {
            await orm.ResearchResearcher.create({ researchId: research.id, userId: researcher.id, targetCount: target });
        } else if (link.targetCount == null && target !== null) {
            await orm.ResearchResearcher.where({ id: link.id }).update({ targetCount: target });
        }
    }
}

async function ensureSavedTemplate(companyId: number) {
    const orm = db.orm.public;
    const existing = await orm.SavedTemplate.where({ companyId, name: SAVED_TEMPLATE.name }).first();
    if (existing) return false;
    const { spec, ...rest } = SAVED_TEMPLATE;
    await orm.SavedTemplate.create({ ...rest, spec: JSON.stringify(sanitizeSpec(spec)), companyId });
    return true;
}

// ---------------------------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------------------------

async function main() {
    console.log('Iniciando seed de demonstração...');

    const problem = passwordProblem(DEMO_PASSWORD);
    if (problem) throw new Error(`SEED_DEMO_PASSWORD inválida. ${problem}`);
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

    const company = await ensureCompany(COMPANY_NAME, 'ACTIVE');
    await ensureCompany(INACTIVE_COMPANY_NAME, 'INACTIVE');
    const admin = await ensureUser(ADMIN, 'ADMINISTRATOR', company.id, passwordHash);
    const researchers: Researcher[] = [];
    for (const data of RESEARCHERS) researchers.push(await ensureUser(data, 'RESEARCHER', company.id, passwordHash));
    await ensureUser(INACTIVE_RESEARCHER, 'RESEARCHER', company.id, passwordHash, 'INACTIVE');

    console.log('');
    for (const def of RESEARCHES) {
        const research = await ensureResearch(def, company.id);
        await ensureLinks(research, researchers);

        const modernized = await modernizeLegacyCollections(research);
        const { created, skipped } = await seedCollections(research, researchers);
        const syncs = await seedSyncLogs(created);
        const copies = await ensureCopies(research, researchers, admin.id);

        console.log(
            `• ${def.title} [${def.status}] -> coletas criadas: ${created.length} (já existiam: ${skipped}` +
                `${modernized ? `, atualizadas: ${modernized}` : ''}), envios registrados: ${syncs}, cópias criadas: ${copies}.`,
        );
    }

    const templateCreated = await ensureSavedTemplate(company.id);
    if (templateCreated) console.log(`• Modelo salvo criado: ${SAVED_TEMPLATE.name}`);

    console.log('');
    console.log(`Empresa: ${COMPANY_NAME} (e ${INACTIVE_COMPANY_NAME}, inativa)`);
    console.log(`Administrador: ${admin.username} / ${DEMO_PASSWORD}`);
    console.log(`Pesquisadores: ${RESEARCHERS.map((r) => r.username).join(', ')} (senha: ${DEMO_PASSWORD})`);
    console.log(`Pesquisador inativo: ${INACTIVE_RESEARCHER.username}`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });