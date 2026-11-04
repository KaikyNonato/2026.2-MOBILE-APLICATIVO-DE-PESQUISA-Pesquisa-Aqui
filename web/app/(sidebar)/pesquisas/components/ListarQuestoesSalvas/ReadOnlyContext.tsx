"use client";

import { createContext, useContext } from "react";

/** Pesquisa publicada ou já baixada por um pesquisador: o questionário só pode ser lido. */
const ReadOnlyContext = createContext(false);

export const ReadOnlyProvider = ReadOnlyContext.Provider;
/** Diz se a lista de questões está em modo somente leitura. */
export const useReadOnly = () => useContext(ReadOnlyContext);
