"use client";

import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
} from "@/components/ui/combobox";

interface ComboBoxLayoutProps<T extends string> {
    items: readonly T[];
    labels: Record<T, string>;
    value: T | "";
    onValueChange: (value: T) => void;
    placeholder?: string;
    emptyMessage?: string;
}

/** Seletor com busca (combobox) pronto, montado a partir de uma lista de valores e rótulos. */
export function ComboBoxLayout<T extends string>({
    items,
    labels,
    value,
    onValueChange,
    placeholder = "Selecione uma opção",
    emptyMessage = "Nenhum resultado encontrado!",
}: ComboBoxLayoutProps<T>) {
    return (
        <Combobox<T>
            items={items}
            value={value === "" ? null : value}
            onValueChange={(newValue) => {
                if (newValue !== null && newValue !== undefined) {
                    onValueChange(newValue);
                }
            }}
            itemToStringLabel={(item) => labels[item] ?? ""}
            itemToStringValue={(item) => item}
        >
            <ComboboxInput placeholder={placeholder} />

            <ComboboxContent>
                <ComboboxEmpty>
                    {emptyMessage}
                </ComboboxEmpty>

                <ComboboxList>
                    {(item: T) => (
                        <ComboboxItem key={item} value={item}>
                            {labels[item]}
                        </ComboboxItem>
                    )}
                </ComboboxList>
            </ComboboxContent>
        </Combobox>
    );
}
