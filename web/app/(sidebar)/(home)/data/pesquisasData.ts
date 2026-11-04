// export const pesquisas = [
//     {
//         nome: "Pesquisa de satisfação",
//         status: "Ativa",
//         respostas: 120,
//         data: "02/09/2026",
//     },
//     {
//         nome: "Pesquisa de produto1",
//         status: "Encerrada",
//         respostas: 85,
//         data: "01/09/2026",
//     },
//     {
//         nome: "Pesquisa de produto2",
//         status: "Ativa",
//         respostas: 85,
//         data: "01/09/2026",
//     },
//     {
//         nome: "Pesquisa de produto3",
//         status: "Encerrada",
//         respostas: 85,
//         data: "01/09/2026",
//     },
// ];

export const columns = [
    { key: "title", label: "Pesquisa" },
    { key: "status", label: "Status" },
    // { key: "respostas", label: "Respostas" },
    { key: "endDate", label: "Data" },
] as const;
