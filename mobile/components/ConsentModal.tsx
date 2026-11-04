import React, { useState } from 'react';
import { Modal, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Mic } from 'lucide-react-native';

interface ConsentModalProps {
    visible: boolean;
    researchTitle?: string;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * Pedido de consentimento antes de a coleta começar, nas pesquisas que gravam a entrevista.
 * A confirmação é do pesquisador, atestando que o entrevistado foi informado e consentiu.
 */
export default function ConsentModal({ visible, researchTitle, onConfirm, onCancel }: ConsentModalProps) {
    const [informed, setInformed] = useState(false);

    const handleCancel = () => {
        setInformed(false);
        onCancel();
    };

    const handleConfirm = () => {
        setInformed(false);
        onConfirm();
    };

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
            <View style={styles.overlay}>
                <View style={styles.card}>
                    <View style={styles.header}>
                        <Mic size={22} color="#447762" />
                        <Text style={styles.title}>Gravação da entrevista</Text>
                    </View>

                    {researchTitle ? <Text style={styles.research}>{researchTitle}</Text> : null}

                    <Text style={styles.text}>
                        Esta pesquisa grava o áudio da entrevista inteira, do início ao fim. A voz é um dado pessoal:
                        explique ao entrevistado que a conversa será gravada e para que a gravação será usada.
                    </Text>
                    <Text style={styles.text}>
                        A coleta só pode começar com o consentimento dele. O aceite fica registrado com a data, a hora e o
                        seu nome.
                    </Text>

                    <View style={styles.checkRow}>
                        <Switch
                            value={informed}
                            onValueChange={setInformed}
                            trackColor={{ true: '#447762' }}
                        />
                        <Text style={styles.checkLabel}>O entrevistado foi informado e consentiu com a gravação.</Text>
                    </View>

                    <View style={styles.actions}>
                        <TouchableOpacity style={[styles.button, styles.cancel]} onPress={handleCancel}>
                            <Text style={styles.cancelText}>Cancelar</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.button, styles.confirm, !informed && styles.confirmDisabled]}
                            onPress={handleConfirm}
                            disabled={!informed}
                        >
                            <Text style={styles.confirmText}>Iniciar coleta</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: '#00000099', justifyContent: 'center', padding: 24 },
    card: { backgroundColor: '#fff', borderRadius: 12, padding: 20, gap: 12 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { fontSize: 18, fontWeight: 'bold', color: '#18181b' },
    research: { fontSize: 14, color: '#447762', fontWeight: '600' },
    text: { fontSize: 14, color: '#52525b', lineHeight: 20 },
    checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
    checkLabel: { flex: 1, fontSize: 14, color: '#18181b', fontWeight: '600' },
    actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
    button: { flex: 1, padding: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    cancel: { borderWidth: 1, borderColor: '#d4d4d8' },
    cancelText: { color: '#52525b', fontWeight: 'bold' },
    confirm: { backgroundColor: '#447762' },
    confirmDisabled: { backgroundColor: '#a1b8ae' },
    confirmText: { color: '#fff', fontWeight: 'bold' },
});
