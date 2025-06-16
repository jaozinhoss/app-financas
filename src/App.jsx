import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { 
    getFirestore, 
    collection, 
    addDoc, 
    query, 
    onSnapshot, 
    doc, 
    deleteDoc,
    writeBatch
} from 'firebase/firestore';
import { ArrowUpCircle, ArrowDownCircle, Trash2, FileScan, Bot, Loader2, PlusCircle, LogOut, Copy, Plus, ClipboardCheck, AlertTriangle } from 'lucide-react';

// --- Configuração do Firebase (NÃO ALTERE) ---
const firebaseConfig = JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- Descrições Padrão ---
const defaultDescriptions = [
    { id: 'd1', name: 'Aluguel' }, { id: 'd2', name: 'Supermercado' },
    { id: 'd3', name: 'Conta de Luz' }, { id: 'd4', name: 'Conta de Água' },
    { id: 'd5', name: 'Internet/Telefone' }, { id: 'd6', name: 'Transporte/Combustível' },
    { id: 'd7', name: 'Salário' }, { id: 'd8', name: 'Lazer' }, { id: 'd9', name: 'Educação'}
];

// --- Função Helper para Checar Duplicidade ---
const isTransactionDuplicate = (newTx, existingTransactions) => {
    const newTxDate = new Date(newTx.date);
    return existingTransactions.some(existingTx => {
        const existingTxDate = new Date(existingTx.date);
        const isSameDate = newTxDate.getUTCFullYear() === existingTxDate.getUTCFullYear() &&
                           newTxDate.getUTCMonth() === existingTxDate.getUTCMonth() &&
                           newTxDate.getUTCDate() === existingTxDate.getUTCDate();
        
        const isSameAmount = Math.abs(existingTx.amount - newTx.amount) < 0.01;

        return existingTx.description.trim() === newTx.description.trim() &&
               isSameAmount &&
               isSameDate;
    });
};


// --- Componente Principal do Aplicativo ---
export default function App() {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    
    const [householdId, setHouseholdId] = useState('');
    const [inputHouseholdId, setInputHouseholdId] = useState('');
    const [transactions, setTransactions] = useState([]);
    const [descriptions, setDescriptions] = useState(defaultDescriptions);
    const [isProcessing, setIsProcessing] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [isCopied, setIsCopied] = useState(false);
    const [statementTransactions, setStatementTransactions] = useState(null);
    const [duplicateToConfirm, setDuplicateToConfirm] = useState(null);
    
    // Efeito de Inicialização do Firebase
    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const authInstance = getAuth(app);
            setDb(firestore);
            setAuth(authInstance);
            onAuthStateChanged(authInstance, async (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    await signInAnonymously(authInstance);
                }
                setIsAuthReady(true);
            });
        } catch (error) { console.error("Erro Firebase Init:", error); }
    }, []);

    // Efeito para carregar ID familiar
    useEffect(() => {
        const savedHouseholdId = localStorage.getItem('householdId');
        if (savedHouseholdId) setHouseholdId(savedHouseholdId);
    }, []);

    // Efeito para buscar dados do Firestore
    useEffect(() => {
        if (isAuthReady && db && householdId) {
            const transCollection = collection(db, `artifacts/${appId}/public/data/households/${householdId}/transactions`);
            const unsubscribeTrans = onSnapshot(query(transCollection), (snapshot) => {
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), date: doc.data().date?.toDate() || new Date(doc.data().date) }));
                data.sort((a, b) => b.date - a.date);
                setTransactions(data);
            });
            const descCollection = collection(db, `artifacts/${appId}/public/data/households/${householdId}/descriptions`);
            const unsubscribeDesc = onSnapshot(query(descCollection), (snapshot) => {
                const customDescriptions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                const allDescriptions = [...defaultDescriptions, ...customDescriptions];
                const uniqueNames = new Set();
                const uniqueDescriptions = allDescriptions.filter(desc => {
                    if (uniqueNames.has(desc.name)) return false;
                    uniqueNames.add(desc.name);
                    return true;
                });
                uniqueDescriptions.sort((a, b) => a.name.localeCompare(b.name));
                setDescriptions(uniqueDescriptions);
            });
            return () => { unsubscribeTrans(); unsubscribeDesc(); };
        }
    }, [db, isAuthReady, householdId, appId]);

    const handleSetHousehold = () => {
        if (inputHouseholdId.trim()) {
            const newId = inputHouseholdId.trim();
            setHouseholdId(newId);
            localStorage.setItem('householdId', newId);
        }
    };
    const generateHouseholdId = () => {
        const newId = `familia-${crypto.randomUUID().slice(0, 8)}`;
        setHouseholdId(newId); setInputHouseholdId(newId); localStorage.setItem('householdId', newId);
    };
    const handleLogout = () => {
        localStorage.removeItem('householdId'); setHouseholdId(''); setInputHouseholdId(''); setTransactions([]);
    };
    const copyHouseholdId = () => {
        const tempInput = document.createElement('input');
        tempInput.value = householdId; document.body.appendChild(tempInput);
        tempInput.select(); document.execCommand('copy');
        document.body.removeChild(tempInput); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000);
    };

    const { totalIncome, totalExpenses, balance } = useMemo(() => {
        const income = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
        const expenses = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
        return { totalIncome: income, totalExpenses: expenses, balance: income - expenses };
    }, [transactions]);
    
    const handleAddTransaction = async (transactionData) => {
        if (!db || !householdId) return;
        setDuplicateToConfirm(null);
        const { isInstallment, installmentCount, ...baseTransaction } = transactionData;
        try {
            if (isInstallment && installmentCount > 1) {
                const batch = writeBatch(db); const groupId = crypto.randomUUID();
                const startDate = new Date(baseTransaction.date); startDate.setDate(startDate.getDate() + 1);
                for (let i = 0; i < installmentCount; i++) {
                    const installmentDate = new Date(startDate); installmentDate.setMonth(startDate.getMonth() + i);
                    const docRef = doc(collection(db, `artifacts/${appId}/public/data/households/${householdId}/transactions`));
                    batch.set(docRef, { ...baseTransaction, description: `${baseTransaction.description} (${i + 1}/${installmentCount})`, date: installmentDate, installmentInfo: { current: i + 1, total: installmentCount, groupId }, createdAt: new Date(), userId });
                }
                await batch.commit();
            } else {
                await addDoc(collection(db, `artifacts/${appId}/public/data/households/${householdId}/transactions`), { ...baseTransaction, date: new Date(baseTransaction.date), createdAt: new Date(), userId });
            }
            setShowForm(false);
        } catch (error) { console.error("Erro ao adicionar transação:", error); }
    };
    
    const attemptAddTransaction = (transactionData) => {
        if (isTransactionDuplicate(transactionData, transactions)) {
            setDuplicateToConfirm(transactionData);
        } else {
            handleAddTransaction(transactionData);
        }
    };


    const handleAddMultipleTransactions = async (transactionsToAdd) => {
        if (!db || !householdId || transactionsToAdd.length === 0) {
            setStatementTransactions(null);
            return;
        }
        const batch = writeBatch(db);
        transactionsToAdd.forEach(t => {
            const docRef = doc(collection(db, `artifacts/${appId}/public/data/households/${householdId}/transactions`));
            batch.set(docRef, {
                ...t,
                date: new Date(t.date),
                createdAt: new Date(),
                userId
            });
        });
        try {
            await batch.commit();
        } catch (error) {
            console.error("Erro ao adicionar transações em lote:", error);
        } finally {
            setStatementTransactions(null);
        }
    };
    
    const handleDeleteTransaction = async (id) => {
        if (!db || !householdId) return;
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/public/data/households/${householdId}/transactions`, id));
        } catch(error) { console.error("Erro ao deletar transação:", error); }
    };
    
    const handleAddDescription = async (name) => {
        if (!db || !householdId || !name) return;
        if (descriptions.some(d => d.name.toLowerCase() === name.toLowerCase())) return;
        try {
            await addDoc(collection(db, `artifacts/${appId}/public/data/households/${householdId}/descriptions`), { name: name });
        } catch(error) { console.error("Erro ao adicionar descrição:", error); }
    };

    // --- RENDERIZAÇÃO ---
    if (!householdId) {
        return ( <div className="bg-gray-900 min-h-screen text-white flex items-center justify-center p-4 font-sans"><div className="w-full max-w-md bg-gray-800 p-8 rounded-2xl shadow-2xl text-center"><Bot size={64} className="mx-auto text-cyan-400 mb-4" /><h1 className="text-3xl font-bold mb-2">Bem-vindo(a) ao GastoCerto AI</h1><p className="text-gray-400 mb-8">Controle financeiro colaborativo para sua família.</p><div className="space-y-4"><input type="text" value={inputHouseholdId} onChange={(e) => setInputHouseholdId(e.target.value)} placeholder="Digite um ID Familiar existente" className="w-full bg-gray-700 text-white p-3 rounded-lg border-2 border-gray-600 focus:outline-none focus:border-cyan-500" /><button onClick={handleSetHousehold} className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold p-3 rounded-lg transition-transform transform hover:scale-105"> Acessar Família </button></div><div className="my-6 flex items-center"><div className="flex-grow border-t border-gray-600"></div><span className="flex-shrink mx-4 text-gray-500">OU</span><div className="flex-grow border-t border-gray-600"></div></div><button onClick={generateHouseholdId} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold p-3 rounded-lg transition-transform transform hover:scale-105"> Criar Nova Família </button></div></div> );
    }
    
    return (
        <div className="bg-gray-900 min-h-screen font-sans text-white p-4 sm:p-6 lg:p-8"><div className="max-w-4xl mx-auto">
            <header className="flex flex-col sm:flex-row justify-between items-center mb-6 pb-4 border-b border-gray-700"><div className="text-center sm:text-left mb-4 sm:mb-0"><h1 className="text-3xl font-bold text-cyan-400">GastoCerto AI</h1><div className="flex items-center gap-2 mt-2 text-gray-400"><span>ID da Família:</span><span className="font-mono bg-gray-800 px-2 py-1 rounded">{householdId}</span><button onClick={copyHouseholdId} className="text-gray-500 hover:text-cyan-400"> {isCopied ? 'Copiado!' : <Copy size={16} />} </button></div></div><button onClick={handleLogout} className="flex items-center gap-2 bg-gray-700 hover:bg-red-600 px-4 py-2 rounded-lg font-semibold transition-colors"> <LogOut size={18} /> Sair </button></header>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8"><div className="bg-gradient-to-br from-gray-800 to-gray-800/50 p-5 rounded-xl shadow-lg"><h2 className="text-lg font-semibold text-green-400 flex items-center gap-2"><ArrowUpCircle />Rendas</h2><p className="text-3xl font-bold mt-2">R$ {totalIncome.toFixed(2).replace('.', ',')}</p></div><div className="bg-gradient-to-br from-gray-800 to-gray-800/50 p-5 rounded-xl shadow-lg"><h2 className="text-lg font-semibold text-red-400 flex items-center gap-2"><ArrowDownCircle />Despesas</h2><p className="text-3xl font-bold mt-2">R$ {totalExpenses.toFixed(2).replace('.', ',')}</p></div><div className={`bg-gradient-to-br from-gray-800 to-gray-800/50 p-5 rounded-xl shadow-lg ${balance >= 0 ? 'text-cyan-400' : 'text-amber-400'}`}><h2 className="text-lg font-semibold flex items-center gap-2">Saldo</h2><p className="text-3xl font-bold mt-2">R$ {balance.toFixed(2).replace('.', ',')}</p></div></div>
            <div className="mb-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <button onClick={() => setShowForm(true)} className="flex justify-center items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-4 rounded-lg transition-transform transform hover:scale-105"> <PlusCircle size={20} /> Adicionar Manual </button>
                <GeminiUploader mode="single" onProcessing={setIsProcessing} onComplete={attemptAddTransaction} />
                <GeminiUploader mode="statement" onProcessing={setIsProcessing} onComplete={setStatementTransactions} />
            </div>
            {isProcessing && ( <div className="flex justify-center items-center gap-3 text-cyan-400 my-4 p-3 bg-gray-800 rounded-lg"> <Loader2 className="animate-spin" /> <span className="font-semibold">Analisando documento... A IA está trabalhando.</span> </div> )}
            {showForm && ( <TransactionForm onSubmit={attemptAddTransaction} onClose={() => setShowForm(false)} descriptions={descriptions} onAddDescription={handleAddDescription} /> )}
            {duplicateToConfirm && <DuplicateConfirmationModal transaction={duplicateToConfirm} onConfirm={() => handleAddTransaction(duplicateToConfirm)} onCancel={() => setDuplicateToConfirm(null)} />}
            {statementTransactions && <StatementConfirmationModal statementTransactions={statementTransactions} existingTransactions={transactions} onConfirm={handleAddMultipleTransactions} onCancel={() => setStatementTransactions(null)} />}
            <div className="bg-gray-800 p-4 sm:p-6 rounded-xl shadow-lg"><h2 className="text-xl font-bold mb-4">Histórico de Transações</h2><div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2">{transactions.length > 0 ? (transactions.map(t => (<div key={t.id} className="flex items-center justify-between bg-gray-700/50 p-3 rounded-lg"><div className="flex items-center gap-3"><div className={`p-2 rounded-full ${t.type === 'income' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}> {t.type === 'income' ? <ArrowUpCircle size={20} /> : <ArrowDownCircle size={20} />} </div><div><p className="font-semibold">{t.description}</p><p className="text-sm text-gray-400"> {new Date(t.date).toLocaleDateString('pt-BR', {timeZone: 'UTC'})} {t.isRecurring && <span className="ml-2 text-xs bg-indigo-500/50 px-2 py-0.5 rounded-full">Recorrente</span>} </p></div></div><div className="flex items-center gap-4"><p className={`font-bold text-lg ${t.type === 'income' ? 'text-green-400' : 'text-red-400'}`}> {t.type === 'income' ? '+' : '-'} R$ {t.amount.toFixed(2).replace('.', ',')} </p><button onClick={() => handleDeleteTransaction(t.id)} className="text-gray-500 hover:text-red-500"> <Trash2 size={18} /> </button></div></div>))) : ( <p className="text-center text-gray-500 py-8">Nenhuma transação encontrada.</p> )}</div></div>
        </div></div>
    );
}

// --- Componente do Formulário de Transação (Manual) ---
function TransactionForm({ onSubmit, onClose, descriptions, onAddDescription }) {
    const [description, setDescription] = useState('');
    const [showNewDescriptionInput, setShowNewDescriptionInput] = useState(false);
    const [newDescription, setNewDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [type, setType] = useState('expense');
    const [isRecurring, setIsRecurring] = useState(false);
    const [isInstallment, setIsInstallment] = useState(false);
    const [installmentCount, setInstallmentCount] = useState(2);
    const handleDescriptionChange = (e) => {
        if (e.target.value === 'add_new') { setShowNewDescriptionInput(true); setDescription(''); } 
        else { setShowNewDescriptionInput(false); setDescription(e.target.value); }
    };
    const handleAddNewDescription = () => {
        if (newDescription.trim()) { onAddDescription(newDescription.trim()); setDescription(newDescription.trim()); setNewDescription(''); setShowNewDescriptionInput(false); }
    };
    const handleSubmit = (e) => {
        e.preventDefault(); if (!description || !amount || !date) return;
        onSubmit({ description, amount: parseFloat(amount), date, type, isRecurring, isInstallment, installmentCount: parseInt(installmentCount, 10) });
    };
    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 animate-fade-in"><div className="bg-gray-800 rounded-xl p-6 w-full max-w-lg shadow-2xl relative"><button onClick={onClose} className="absolute top-3 right-3 text-gray-500 hover:text-white">&times;</button><h2 className="text-2xl font-bold mb-6 text-center">Nova Transação</h2><form onSubmit={handleSubmit} className="space-y-4"><div className="space-y-2"><label className="text-sm font-semibold text-gray-400">Descrição</label><select value={description} onChange={handleDescriptionChange} className="w-full bg-gray-700 p-3 rounded-lg border-2 border-gray-600 focus:outline-none focus:border-cyan-500"><option value="" disabled>Selecione ou adicione</option>{descriptions.map(d => <option key={d.id || d.name} value={d.name}>{d.name}</option>)}<option value="add_new" className="text-cyan-400 font-bold">-- Adicionar nova --</option></select>{showNewDescriptionInput && (<div className="flex gap-2 pt-2"><input type="text" placeholder="Nova descrição" value={newDescription} onChange={e => setNewDescription(e.target.value)} className="flex-grow bg-gray-600 p-2 rounded-lg border-2 border-gray-500 focus:outline-none focus:border-cyan-500"/><button type="button" onClick={handleAddNewDescription} className="bg-cyan-600 hover:bg-cyan-700 p-2 rounded-lg"><Plus size={20}/></button></div>)}</div><div><label className="text-sm font-semibold text-gray-400">{isInstallment ? 'Valor da Parcela' : 'Valor'}</label><input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="150.50" className="w-full bg-gray-700 p-3 rounded-lg border-2 border-gray-600 focus:outline-none focus:border-cyan-500"/></div><div><label className="text-sm font-semibold text-gray-400">Data de Vencimento {isInstallment ? '(1ª Parcela)' : ''}</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full bg-gray-700 p-3 rounded-lg border-2 border-gray-600 focus:outline-none focus:border-cyan-500"/></div><div className="flex gap-4"><button type="button" onClick={() => setType('expense')} className={`flex-1 p-3 rounded-lg font-bold ${type === 'expense' ? 'bg-red-600' : 'bg-gray-700'}`}>Despesa</button><button type="button" onClick={() => setType('income')} className={`flex-1 p-3 rounded-lg font-bold ${type === 'income' ? 'bg-green-600' : 'bg-gray-700'}`}>Renda</button></div><div className="space-y-3"><div className="flex items-center gap-3 bg-gray-700 p-3 rounded-lg"><input type="checkbox" id="installment" checked={isInstallment} onChange={e => setIsInstallment(e.target.checked)} className="h-5 w-5 rounded accent-indigo-500" disabled={type === 'income'}/><label htmlFor="installment" className={`font-semibold select-none ${type === 'income' ? 'text-gray-500' : ''}`}>É uma compra parcelada?</label></div>{isInstallment && type === 'expense' && (<div className="bg-gray-700 p-3 rounded-lg"><label htmlFor="installmentCount" className="font-semibold select-none">Nº de Parcelas</label><input type="number" id="installmentCount" min="2" max="72" value={installmentCount} onChange={e => setInstallmentCount(e.target.value)} className="w-full bg-gray-600 p-2 mt-2 rounded-lg"/></div>)}{<div className="flex items-center gap-3 bg-gray-700 p-3 rounded-lg"><input type="checkbox" id="recurring" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} className="h-5 w-5 rounded accent-cyan-500"/><label htmlFor="recurring" className="font-semibold select-none">É recorrente?</label></div>}</div><button type="submit" className="w-full bg-cyan-600 hover:bg-cyan-700 p-3 rounded-lg font-bold">{isInstallment && type === 'expense' ? 'Salvar Parcelamento' : 'Salvar Transação'}</button></form></div></div>
    );
}

// --- Componente Uploader Universal do Gemini ---
function GeminiUploader({ mode, onProcessing, onComplete }) {
    const fileInputRef = React.useRef(null);
    const [singleDocData, setSingleDocData] = useState(null);
    const prompts = {
        single: `Analise este documento financeiro (boleto, nota). Extraia: 'description', 'amount' (valor), e 'date' (vencimento no formato AAAA-MM-DD). Se não achar, retorne null.`,
        statement: `Analise este extrato bancário. Extraia todas as transações, ignorando saldos. Para cada uma, retorne: 'description', 'amount' (valor absoluto), 'date' (formato AAAA-MM-DD), e 'type' ('income' para entradas/créditos, 'expense' para saídas/débitos). Retorne uma lista de objetos.`
    };
    const schemas = {
        single: { type: "OBJECT", properties: { description: { type: "STRING" }, amount: { type: "NUMBER" }, date: { type: "STRING" } } },
        statement: { type: "ARRAY", items: { type: "OBJECT", properties: { description: { type: "STRING" }, amount: { type: "NUMBER" }, date: { type: "STRING" }, type: { type: "STRING", enum: ["income", "expense"] } } } }
    };
    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        onProcessing(true); setSingleDocData(null);
        try {
            const base64Image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; });
            const payload = { contents: [{ role: "user", parts: [{ text: prompts[mode] }, { inlineData: { mimeType: file.type, data: base64Image } }] }], generationConfig: { responseMimeType: "application/json", responseSchema: schemas[mode] } };
            const apiKey = ""; const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
            const result = await response.json();
            if (result.candidates && result.candidates[0]) {
                const data = JSON.parse(result.candidates[0].content.parts[0].text);
                if (mode === 'single') {
                    onComplete({ description: data.description || "Não encontrado", amount: data.amount || 0, date: data.date || new Date().toISOString().split('T')[0], type: 'expense', isRecurring: false });
                } else { onComplete(data); }
            } else throw new Error("Resposta da IA inválida.");
        } catch (error) { console.error(`Erro Gemini (${mode}):`, error); } 
        finally { onProcessing(false); if(fileInputRef.current) fileInputRef.current.value = ""; }
    };
    return (<><input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" /><button onClick={() => fileInputRef.current?.click()} className="w-full flex justify-center items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-lg transition-transform transform hover:scale-105"><FileScan size={20} /> {mode === 'single' ? 'Analisar Boleto/Nota' : 'Analisar Extrato'}</button></>);
}

// --- Componente Modal de Confirmação de Duplicata ---
function DuplicateConfirmationModal({ transaction, onConfirm, onCancel }) {
    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 animate-fade-in">
            <div className="bg-gray-800 rounded-xl p-6 w-full max-w-lg shadow-2xl">
                <h2 className="text-2xl font-bold mb-4 text-center text-amber-400 flex items-center justify-center gap-3">
                    <AlertTriangle /> Transação Duplicada
                </h2>
                <p className="text-center text-gray-400 mb-6">Esta transação parece já existir. Deseja adicioná-la mesmo assim?</p>
                <div className="bg-gray-700/50 p-4 rounded-lg text-left mb-6">
                    <p><strong className="text-gray-400 w-24 inline-block">Descrição:</strong> {transaction.description}</p>
                    <p><strong className="text-gray-400 w-24 inline-block">Valor:</strong> R$ {Number(transaction.amount).toFixed(2).replace('.', ',')}</p>
                    <p><strong className="text-gray-400 w-24 inline-block">Data:</strong> {new Date(transaction.date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</p>
                </div>
                <div className="flex gap-4">
                    <button onClick={onCancel} className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 rounded-lg">Não, Cancelar</button>
                    <button onClick={onConfirm} className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold py-3 rounded-lg">Sim, Adicionar Mesmo Assim</button>
                </div>
            </div>
        </div>
    );
}


// --- Componente Modal de Confirmação do Extrato ---
function StatementConfirmationModal({ statementTransactions, existingTransactions, onConfirm, onCancel }) {
    const processedTxs = useMemo(() => {
        return statementTransactions.map(tx => ({
            ...tx,
            isDuplicate: isTransactionDuplicate(tx, existingTransactions)
        }));
    }, [statementTransactions, existingTransactions]);

    const [selected, setSelected] = useState(() => {
        const initialSelected = new Set();
        processedTxs.forEach((tx, i) => {
            if (!tx.isDuplicate) {
                initialSelected.add(i);
            }
        });
        return initialSelected;
    });

    const handleToggle = (index) => {
        const newSelected = new Set(selected);
        if (newSelected.has(index)) { newSelected.delete(index); } else { newSelected.add(index); }
        setSelected(newSelected);
    };

    const handleConfirm = () => {
        const transactionsToImport = processedTxs.filter((_, i) => selected.has(i)).map(({isDuplicate, ...rest}) => rest); // Remove o campo isDuplicate
        onConfirm(transactionsToImport);
    };

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 animate-fade-in"><div className="bg-gray-800 rounded-xl p-6 w-full max-w-2xl shadow-2xl flex flex-col"><h2 className="text-2xl font-bold mb-4 text-center text-indigo-400 flex items-center justify-center gap-3"><ClipboardCheck /> Revisar Transações do Extrato</h2><p className="text-center text-gray-400 mb-4">A IA encontrou {processedTxs.length} transações. Duplicatas foram desmarcadas.</p><div className="flex-grow overflow-y-auto max-h-[60vh] pr-2 space-y-2 mb-4">{processedTxs.map((t, i) => (<div key={i} className={`flex items-center gap-3 p-3 rounded-lg transition-all ${selected.has(i) ? 'bg-gray-700' : 'bg-gray-700/50 opacity-60'}`}><input type="checkbox" checked={selected.has(i)} onChange={() => handleToggle(i)} className="h-5 w-5 rounded accent-cyan-500 flex-shrink-0" /><div className={`flex-grow grid grid-cols-3 gap-2 items-center`}><p className="font-semibold col-span-2 sm:col-span-1 truncate">{t.description}</p><p className="font-mono text-sm hidden sm:block">{new Date(t.date).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}</p><div className="flex justify-end items-center gap-2"><p className={`font-bold text-right ${t.type === 'income' ? 'text-green-400' : 'text-red-400'}`}>{t.type === 'income' ? '+' : '-'} R$ {Number(t.amount).toFixed(2).replace('.',',')}</p>{t.isDuplicate && (<span className="text-xs bg-amber-500/50 text-amber-300 px-2 py-0.5 rounded-full hidden sm:inline">DUPLICATA</span>)}</div></div></div>))}</div><div className="mt-auto flex gap-4 pt-4 border-t border-gray-700"><button onClick={onCancel} className="flex-1 bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 rounded-lg">Cancelar</button><button onClick={handleConfirm} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-lg">Importar {selected.size} Transações</button></div></div></div>
    );
}
